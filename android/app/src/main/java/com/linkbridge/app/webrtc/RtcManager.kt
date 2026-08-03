package com.linkbridge.app.webrtc

import android.content.Context
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.view.Display
import com.linkbridge.app.CaptureState
import com.linkbridge.app.net.SignalingClient
import com.linkbridge.app.remote.GalleryProvider
import com.linkbridge.app.remote.GestureDispatcher
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/**
 * Owns the device's PeerConnection for one remote session. Media is only
 * sent after the session owner granted consent and the required permissions
 * were confirmed. Control messages (gestures, camera, gallery) arrive on
 * the WebRTC data channel, with a WebSocket relay fallback.
 */
class RtcManager(
    private val context: Context,
    private val signaling: SignalingClient,
    private val lifecycleOwner: androidx.lifecycle.LifecycleOwner,
) {
    private val eglBase: EglBase by lazy { EglBase.create() }

    private val factory: PeerConnectionFactory by lazy { createFactory() }

    private var peerConnection: PeerConnection? = null
    private var videoTrack: VideoTrack? = null
    private var videoSource: VideoSource? = null
    private var capturer: VideoCapturer? = null
    private var dataChannel: DataChannel? = null

    private var activeSessionId: String? = null
    private var turn: IceServerConfig? = null

    data class IceServerConfig(val urls: List<String>, val username: String?, val credential: String?)

    private fun createFactory(): PeerConnectionFactory {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions(),
        )
        val encoderFactory = org.webrtc.DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true)
        val decoderFactory = org.webrtc.DefaultVideoDecoderFactory(eglBase.eglBaseContext)
        return PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()
    }

    /**
     * Starts the media source for [kind] ("screen" or "camera"). Called only
     * after the on-device consent gate has completed.
     */
    fun prepare(kind: String, sessionId: String, turnConfig: IceServerConfig?) {
        activeSessionId = sessionId
        turn = turnConfig
        val track = createTrackFor(kind) ?: return
        videoTrack = track
    }

    private fun createTrackFor(kind: String): VideoTrack? {
        val metrics = context.resources.displayMetrics
        val width = metrics.widthPixels
        val height = metrics.heightPixels
        val dpi = metrics.densityDpi

        val sth = SurfaceTextureHelper.create("LinkBridgeCaptureThread", eglBase.eglBaseContext)
        videoSource = factory.createVideoSource(kind == "screen")

        return when (kind) {
            "screen" -> {
                if (!CaptureState.hasCapture()) {
                    android.util.Log.e(TAG, "screen capture consent missing")
                    return null
                }
                val mediaProjection = getMediaProjection() ?: return null
                capturer = ScreenCapturer(mediaProjection, width, height, dpi)
                startCapturer(sth, capturer!!, width, height, 30)
                factory.createVideoTrack("screen$sessionCounter", videoSource)
            }
            "camera" -> {
                capturer = CameraXCapturer(context, lifecycleOwner)
                startCapturer(sth, capturer!!, 1280, 720, 30)
                factory.createVideoTrack("camera$sessionCounter", videoSource)
            }
            else -> {
                sth.dispose()
                videoSource?.dispose()
                videoSource = null
                null
            }
        }.also {
            sessionCounter += 1
        }
    }

    private fun startCapturer(
        sth: SurfaceTextureHelper,
        capturer: VideoCapturer,
        width: Int,
        height: Int,
        fps: Int,
    ) {
        capturer.initialize(
            sth,
            context,
            videoSource?.capturerObserver,
        )
        capturer.startCapture(width, height, fps)
    }

    private fun getMediaProjection(): MediaProjection? {
        val manager = context.getSystemService(MediaProjectionManager::class.java)
        return manager.getMediaProjection(CaptureState.code(), CaptureState.data())
    }

    /** Handles an incoming WebRTC offer and sends back an answer. */
    fun handleOffer(sessionId: String, sdp: String) {
        if (peerConnection == null) ensurePeerConnection(sessionId)
        val pc = peerConnection ?: return

        val description = SessionDescription(SessionDescription.Type.OFFER, sdp)
        pc.setRemoteDescription(
            object : SdpObserver {
                override fun onCreateSuccess(description: SessionDescription?) {}
                override fun onCreateFailure(error: Exception?) {}

                override fun onSetSuccess() {
                    pc.createAnswer(
                        object : SdpObserver {
                            override fun onCreateSuccess(answer: SessionDescription) {
                                pc.setLocalDescription(
                                    object : SdpObserver {
                                        override fun onCreateSuccess(description: SessionDescription?) {}
                                        override fun onCreateFailure(error: Exception?) {}
                                        override fun onSetSuccess() {
                                            sendSignal(
                                                sessionId,
                                                JSONObject()
                                                    .put("type", "answer")
                                                    .put("sdp", answer.description),
                                            )
                                        }
                                        override fun onSetFailure(error: Exception?) {}
                                    },
                                    answer,
                                )
                            }
                            override fun onCreateFailure(error: Exception?) {}
                            override fun onSetSuccess() {}
                            override fun onSetFailure(error: Exception?) {}
                        },
                        org.webrtc.MediaConstraints(),
                    )
                }
                override fun onSetFailure(error: Exception?) {}
            },
            description,
        )
    }

    fun addIceCandidate(candidate: IceCandidate) {
        peerConnection?.addIceCandidate(candidate)
    }

    /** Parses an ICE candidate sent over signaling. */
    fun addIceCandidate(json: JSONObject) {
        val candidate = json.optString("candidate")
        val sdpMid = json.optString("sdpMid", "")
        val sdpMLineIndex = json.optInt("sdpMLineIndex", 0)
        if (candidate.isNotBlank()) {
            addIceCandidate(IceCandidate(sdpMid, sdpMLineIndex, candidate))
        }
    }

    private fun ensurePeerConnection(sessionId: String) {
        if (peerConnection != null) return

        val servers = mutableListOf(org.webrtc.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
        turn?.let { t ->
            if (t.urls.isNotEmpty()) {
                val builder = org.webrtc.IceServer.builder(t.urls[0])
                t.username?.let { builder.setUsername(it) }
                t.credential?.let { builder.setPassword(it) }
                servers.add(builder.createIceServer())
            }
        }

        val config = PeerConnection.RTCConfiguration(servers)
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN

        val observer = createObserver(sessionId)
        peerConnection = factory.createPeerConnection(config, observer)
    }

    private fun createObserver(sessionId: String): PeerConnection.Observer =
        object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                val data = JSONObject()
                    .put("type", "candidate")
                    .put(
                        "candidate",
                        JSONObject()
                            .put("candidate", candidate.sdp)
                            .put("sdpMid", candidate.sdpMid)
                            .put("sdpMLineIndex", candidate.sdpMLineIndex),
                    )
                sendSignal(sessionId, data)
            }

            override fun onDataChannel(dc: DataChannel) {
                dataChannel = dc
                dc.registerObserver(
                    object : DataChannel.Observer {
                        override fun onBufferedAmountChange(previousAmount: Long) {}
                        override fun onStateChange() {}

                        override fun onMessage(buffer: DataChannel.Buffer) {
                            if (!buffer.data.hasRemaining()) return
                            val bytes = ByteArray(buffer.data.remaining())
                            buffer.data.get(bytes)
                            handleControl(String(bytes, Charsets.UTF_8))
                        }
                    },
                )
            }

            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onAddStream(stream: MediaStream) {}
            override fun onRemoveStream(stream: MediaStream) {}
            override fun onRenegotiationNeeded() {}
            override fun onAddTrack(receiver: RtpReceiver, streams: MutableList<MediaStream>) {}
            override fun onRemoveTrack(receiver: RtpReceiver) {}
            override fun onTrack(transceiver: RtpTransceiver) {}
        }

    /**
     * Control channel (or WebSocket relay) message handler.
     * Supported: gesture, camera, gallery, ping.
     */
    fun handleControl(text: String) {
        val msg = try {
            JSONObject(text)
        } catch (_: Exception) {
            return
        }
        when (msg.optString("type")) {
            "gesture" -> GestureDispatcher.dispatch(
                msg.optString("action"),
                msg.optDouble("x", 0.0).toFloat(),
                msg.optDouble("y", 0.0).toFloat(),
                if (msg.has("durationMs")) msg.optLong("durationMs") else null,
            )
            "camera" -> handleCameraAction(msg.optString("action"))
            "gallery" -> handleGalleryAction(msg)
            "ping" -> sendToDashboard(JSONObject().put("type", "pong"))
        }
    }

    private fun handleCameraAction(action: String) {
        // The camera is bound for the whole session; start/stop is handled
        // by the session lifecycle. Nothing else to do here.
    }

    private fun handleGalleryAction(msg: JSONObject) {
        when (msg.optString("action")) {
            "list" -> {
                val images = GalleryProvider.listImages(context)
                val arr = org.json.JSONArray()
                images.forEach { arr.put(it.toJson()) }
                sendToDashboard(JSONObject().put("type", "gallery.list").put("images", arr))
            }
            "open" -> {
                val id = msg.optString("id")
                val dataUrl = GalleryProvider.fullImageDataUrl(context, id)
                if (dataUrl != null) {
                    sendToDashboard(
                        JSONObject()
                            .put("type", "gallery.image")
                            .put("id", id)
                            .put("dataUrl", dataUrl),
                    )
                }
            }
            "close" -> {
                // nothing to release on the device side
            }
        }
    }

    private fun sendToDashboard(json: JSONObject) {
        val dc = dataChannel
        if (dc != null && dc.state() == DataChannel.State.OPEN) {
            val buffer = DataChannel.Buffer(
                java.nio.ByteBuffer.wrap(json.toString().toByteArray(Charsets.UTF_8)),
                false,
            )
            dc.send(buffer)
        } else {
            activeSessionId?.let { sessionId ->
                signaling.sendRelay(sessionId, "owner", "control", json.toString())
            }
        }
    }

    private fun sendSignal(sessionId: String, data: JSONObject) {
        signaling.sendSignal(sessionId, "owner", data)
    }

    fun close() {
        peerConnection?.close()
        peerConnection = null
        dataChannel = null
        capturer?.dispose()
        capturer = null
        videoSource?.dispose()
        videoSource = null
        videoTrack = null
        activeSessionId = null
    }

    companion object {
        private const val TAG = "RtcManager"
        private var sessionCounter = 0
    }
}
