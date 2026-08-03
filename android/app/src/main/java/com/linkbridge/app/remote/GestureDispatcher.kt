package com.linkbridge.app.remote

/**
 * Bridges incoming gesture commands to the user-enabled accessibility
 * service. No events are read or logged — only outgoing gestures.
 */
object GestureDispatcher {
    @Volatile
    private var service: RemoteAccessibilityService? = null

    fun bind(service: RemoteAccessibilityService) {
        this.service = service
    }

    fun unbind(service: RemoteAccessibilityService) {
        if (this.service === service) this.service = null
    }

    val isAvailable: Boolean
        get() = service != null

    fun dispatch(action: String, x: Float, y: Float, durationMs: Long?) {
        service?.dispatchGesture(action, x, y, durationMs)
    }
}
