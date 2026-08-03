package com.linkbridge.app.permissions

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.linkbridge.app.remote.RemoteAccessibilityService

/**
 * Central permission checks. The app never bypasses Android security:
 * every capability is gated behind the official Android permission flow
 * and the user's explicit grant.
 */
object Permissions {
    fun hasNotifications(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || has(context, Manifest.permission.POST_NOTIFICATIONS)

    fun hasCamera(context: Context): Boolean =
        has(context, Manifest.permission.CAMERA)

    fun hasGallery(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= 33) {
            has(context, Manifest.permission.READ_MEDIA_IMAGES)
        } else {
            has(context, Manifest.permission.READ_EXTERNAL_STORAGE)
        }

    fun isAccessibilityEnabled(context: Context): Boolean {
        val expected = ComponentName(context, RemoteAccessibilityService::class.java)
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        return enabled
            .split(':')
            .mapNotNull { runCatching { ComponentName.unflattenFromString(it) }.getOrNull() }
            .any { it == expected }
    }

    private fun has(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) ==
            PackageManager.PERMISSION_GRANTED
}
