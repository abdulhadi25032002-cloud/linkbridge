package com.linkbridge.app.consent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.linkbridge.app.service.RemoteService

/**
 * Routes Accept/Deny taps on consent notifications to the connection service.
 */
class ConsentActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val sessionId = intent.getStringExtra("sessionId") ?: return
        val kind = intent.getStringExtra("kind") ?: return
        val action = intent.action

        val serviceIntent = Intent(context, RemoteService::class.java).apply {
            if (action == ConsentNotifier.ACTION_ACCEPT) {
                this.action = RemoteService.ACTION_CONSENT_ACCEPT
            } else {
                this.action = RemoteService.ACTION_CONSENT_DENY
            }
            putExtra("sessionId", sessionId)
            putExtra("kind", kind)
        }
        context.startForegroundService(serviceIntent)
    }
}
