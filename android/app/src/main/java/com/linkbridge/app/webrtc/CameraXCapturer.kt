package com.linkbridge.app.webrtc

import android.content.Context
import android.view.Surface
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame
import java.util.concurrent.Executor

/**
 * Camera video source backed by CameraX. Frames are streamed through a
 * [SurfaceTextureHelper] so they arrive as [VideoFrame]s on the WebRTC
 * video source. Only ever runs after the user grants the CAMERA permission.
 */
class CameraXCapturer(
    private val context: Context,
    private val lifecycleOwner: LifecycleOwner,
    private val cameraSelector: CameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA,
) : VideoCapturer {

    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var observer: CapturerObserver? = null
    private var preview: Preview? = null
    private var cameraProvider: ProcessCameraProvider? = null

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
        val executor: Executor = ContextCompat.getMainExecutor(context)
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            val provider = runCatching { future.get() }.getOrNull() ?: return@addListener
            cameraProvider = provider
            sth.setDefaultBufferSize(width, height)
            sth.setFrameListener(
                { frame: VideoFrame -> observer?.onFrameCaptured(frame) },
                width,
                height,
            )
            preview = Preview.Builder()
                .setTargetResolution(android.util.Size(width, height))
                .build()
            preview?.setSurfaceProvider { request ->
                request.setSurface(
                    Surface(sth.surfaceTexture),
                    executor,
                ) {}
            }
            provider.unbindAll()
            provider.bindToLifecycle(lifecycleOwner, cameraSelector, preview)
        }, executor)
    }

    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {
        // Handled by the bound CameraX Preview resolution.
    }

    override fun stopCapture() {
        cameraProvider?.unbindAll()
        surfaceTextureHelper?.stopListening()
        observer?.onCapturerStopped()
    }

    override fun dispose() {
        cameraProvider?.unbindAll()
        cameraProvider = null
        surfaceTextureHelper?.dispose()
        surfaceTextureHelper = null
    }

    override fun isScreencast(): Boolean = false
}
