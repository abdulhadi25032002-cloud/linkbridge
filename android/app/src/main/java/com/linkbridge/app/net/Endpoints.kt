package com.linkbridge.app.net

import com.linkbridge.app.BuildConfig

/** Resolved server endpoints from the configured SERVER_URL. */
object Endpoints {
    val base: String = BuildConfig.SERVER_URL.trimEnd('/')

    val wsUrl: String =
        base
            .replaceFirst("https", "wss")
            .replaceFirst("http", "ws") + "/ws"

    fun pairComplete(): String = "$base/api/devices/pair/complete"
    fun deviceState(): String = "$base/api/devices/state"
}
