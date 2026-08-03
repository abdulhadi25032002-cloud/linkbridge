package com.linkbridge.app.remote

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.PointF
import android.view.accessibility.AccessibilityEvent
import kotlin.math.hypot

/**
 * Accessibility service used ONLY to inject touches at the coordinates sent
 * by the dashboard. It never reads window content and never logs events.
 * The user must enable it from Android Accessibility settings.
 */
class RemoteAccessibilityService : AccessibilityService() {

    private var path = Path()
    private var lastPoint = PointF()

    override fun onServiceConnected() {
        super.onServiceConnected()
        GestureDispatcher.bind(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Intentionally empty: no window content is read.
    }

    override fun onInterrupt() {
        // no-op
    }

    override fun onDestroy() {
        GestureDispatcher.unbind(this)
        super.onDestroy()
    }

    /** Dispatches a gesture for the normalized (0..1) coordinates. */
    fun dispatchGesture(action: String, x: Float, y: Float, durationMs: Long?) {
        val metrics = resources.displayMetrics
        val px = (x * metrics.widthPixels).coerceIn(0f, (metrics.widthPixels - 1).toFloat())
        val py = (y * metrics.heightPixels).coerceIn(0f, (metrics.heightPixels - 1).toFloat())

        when (action) {
            "down" -> {
                path.reset()
                path.moveTo(px, py)
                lastPoint = PointF(px, py)
                dispatchStroke(px, py, px, py, 60L)
            }
            "move" -> {
                path.lineTo(px, py)
                val distance = hypot(px - lastPoint.x, py - lastPoint.y)
                val duration = durationMs ?: (distance / 0.4f).toLong().coerceIn(12L, 500L)
                dispatchStroke(lastPoint.x, lastPoint.y, px, py, duration)
                lastPoint = PointF(px, py)
            }
            "up" -> {
                if (lastPoint.x != px || lastPoint.y != py) {
                    dispatchStroke(lastPoint.x, lastPoint.y, px, py, durationMs ?: 60L)
                }
                lastPoint = PointF(px, py)
            }
        }
    }

    private fun dispatchStroke(x1: Float, y1: Float, x2: Float, y2: Float, duration: Long) {
        val strokePath = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(strokePath, 0, duration))
            .build()
        dispatchGesture(gesture, null, null)
    }
}
