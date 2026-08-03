package com.linkbridge.app.webrtc

import android.content.Context
import android.graphics.SurfaceTexture
import android.media.projection.MediaProjection
import android.view.Surface
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame

/**
 * Captures the device screen via MediaProjection and feeds frames to WebRTC.
 * Uses SurfaceTextureHelper so frames become [VideoFrame]s for the video source.
 */
class ScreenCapturer(
    private val mediaProjection: MediaProjection,
    private val captureWidth: Int,
    private val captureHeight: Int,
    private val captureDpi: Int,
) : VideoCapturer {

    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var observer: CapturerObserver? = null
    private var virtualDisplay: VirtualDisplay? = null

    override fun initialize(
        surfaceTextureHelper: SurfaceTextureHelper?,
        appContext: Context?,
        observer: CapturerObserver?,
        sharedCameraThread: Boolean,
    ) {
        this.surfaceTextureHelper = surfaceTextureHelper
        this.observer = observer
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
        val sth = surfaceTextureHelper ?: return
        sth.setDefaultBufferSize(captureWidth, captureHeight)
        sth.setFrameListener(
            { frame: VideoFrame -> observer?.onFrameCaptured(frame) },
            captureWidth,
            captureHeight,
        )
        virtualDisplay = mediaProjection.createVirtualDisplay(
            "LinkBridgeScreenCapture",
            captureWidth,
            captureHeight,
            captureDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            Surface(sth.surfaceTexture),
            null,
            null,
        )
    }

    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {
        // MediaProjection captures at the VirtualDisplay resolution; no dynamic resize.
    }

    override fun stopCapture() {
        virtualDisplay?.release()
        virtualDisplay = null
        surfaceTextureHelper?.stopListening()
        observer?.onCapturerStopped()
    }

    override fun dispose() {
        virtualDisplay?.release()
        virtualDisplay = null
        surfaceTextureHelper?.dispose()
        surfaceTextureHelper = null
    }

    override fun isScreencast(): Boolean = true
}
