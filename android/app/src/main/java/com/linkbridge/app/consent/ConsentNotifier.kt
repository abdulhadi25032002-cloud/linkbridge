package com.linkbridge.app.consent

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.linkbridge.app.MainActivity
import com.linkbridge.app.R

/** Posts heads-up consent notifications that must be approved on-device. */
object ConsentNotifier {
    const val CHANNEL_ID = "consent"
    const val ACTION_ACCEPT = "com.linkbridge.app.CONSENT_ACCEPT"
    const val ACTION_DENY = "com.linkbridge.app.CONSENT_DENY"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.consent_channel_name),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = context.getString(R.string.consent_channel_desc)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            },
        )
    }

    fun showRequest(context: Context, sessionId: String, kind: String) {
        val channelEnabled = android.os.Build.VERSION.SDK_INT < 33 ||
            androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.POST_NOTIFICATIONS,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!channelEnabled) return

        val title = context.getString(R.string.consent_title, labelFor(kind, context))
        val body = bodyFor(kind, context)

        val accept = PendingIntent.getBroadcast(
            context,
            sessionId.hashCode(),
            Intent(context, ConsentActionReceiver::class.java)
                .setAction(ACTION_ACCEPT)
                .putExtra("sessionId", sessionId)
                .putExtra("kind", kind),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val deny = PendingIntent.getBroadcast(
            context,
            sessionId.hashCode() + 1,
            Intent(context, ConsentActionReceiver::class.java)
                .setAction(ACTION_DENY)
                .putExtra("sessionId", sessionId)
                .putExtra("kind", kind),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val openApp = PendingIntent.getActivity(
            context,
            sessionId.hashCode() + 2,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_logo)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(openApp)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(false)
            .addAction(0, context.getString(R.string.consent_deny), deny)
            .addAction(0, context.getString(R.string.consent_accept), accept)
            .build()

        context.getSystemService(NotificationManager::class.java)
            .notify(sessionId.hashCode(), notification)
    }

    fun dismiss(context: Context, sessionId: String) {
        context.getSystemService(NotificationManager::class.java)
            .cancel(sessionId.hashCode())
    }

    private fun labelFor(kind: String, context: Context): String = when (kind) {
        "screen" -> context.getString(R.string.capability_screen)
        "camera" -> context.getString(R.string.capability_camera)
        "gallery" -> context.getString(R.string.capability_gallery)
        else -> kind
    }

    private fun bodyFor(kind: String, context: Context): String = when (kind) {
        "screen" -> context.getString(R.string.consent_screen_body)
        "camera" -> context.getString(R.string.consent_camera_body)
        "gallery" -> context.getString(R.string.consent_gallery_body)
        else -> ""
    }
}
