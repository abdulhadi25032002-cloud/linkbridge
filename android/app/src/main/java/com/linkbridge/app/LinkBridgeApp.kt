package com.linkbridge.app

import android.app.Activity
import android.app.Application
import android.content.Intent
import com.linkbridge.app.service.RemoteService
import com.linkbridge.app.util.Prefs

class LinkBridgeApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
        // Keep the secure connection alive whenever the device is paired.
        if (Prefs.isPaired) {
            RemoteService.start(this)
        }
    }
}

/**
 * Holds the MediaProjection consent result granted during pairing.
 * Re-used for every screen-sharing session while the process is alive.
 */
object CaptureState {
    @Volatile
    private var resultCode: Int = Activity.RESULT_CANCELED

    @Volatile
    private var data: Intent? = null

    fun save(code: Int, intent: Intent?) {
        resultCode = code
        data = intent
    }

    fun hasCapture(): Boolean = resultCode == Activity.RESULT_OK && data != null

    fun code(): Int = resultCode

    fun data(): Intent? = data

    fun clear() {
        resultCode = Activity.RESULT_CANCELED
        data = null
    }
}
