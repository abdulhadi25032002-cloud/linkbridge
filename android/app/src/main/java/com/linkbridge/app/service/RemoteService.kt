package com.linkbridge.app.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.linkbridge.app.CaptureState
import com.linkbridge.app.MainActivity
import com.linkbridge.app.R
import com.linkbridge.app.consent.ConsentNotifier
import com.linkbridge.app.net.ApiClient
import com.linkbridge.app.net.SignalingClient
import com.linkbridge.app.permissions.Permissions
import com.linkbridge.app.util.Prefs
import com.linkbridge.app.webrtc.RtcManager
import org.json.JSONObject
import org.webrtc.IceCandidate

/**
 * Foreground service that owns the device's secure connection to the
 * dashboard: signaling, consent, WebRTC media, and control handling.
 */
class RemoteService : Service(), LifecycleOwner {

    private val lifecycleRegistry = LifecycleRegistry(this)
    override val lifecycle: Lifecycle get() = lifecycleRegistry

    private var signaling: SignalingClient? = null
    private var rtc: RtcManager? = null
    private var pendingSession: PendingSession? = null

    private data class PendingSession(
        val sessionId: String,
        val kind: String,
        val turn: SignalingClient.TurnConfig?,
    )

    override fun onCreate() {
        super.onCreate()
        lifecycleRegistry.currentState = Lifecycle.State.CREATED
        ensureServiceChannel()
        ConsentNotifier.ensureChannel(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        lifecycleRegistry.currentState = Lifecycle.State.STARTED
        when (intent?.action) {
            ACTION_CONSENT_ACCEPT -> handleConsentAccept(intent)
            ACTION_CONSENT_DENY -> handleConsentDeny(intent)
            ACTION_PREPARE_READY -> handlePrepareReady(intent)
            ACTION_PAIRING_COMPLETE -> connect()
            else -> connect()
        }
        return START_STICKY
    }

    private fun connect() {
        if (signaling != null) return
        val token = Prefs.deviceToken ?: return
        ensureForeground(typeDataSync())

        val client = SignalingClient(token, signalingListener)
        signaling = client
        rtc = RtcManager(this, client, this)
        client.connect()
    }

    private val signalingListener = object : SignalingClient.Listener {
        override fun onConnected() {
            ApiClient.reportOnline(Prefs.deviceToken.orEmpty())
        }

        override fun onDisconnected(reason: String?) {
            // The client reconnects automatically.
        }

        override fun onConsentRequest(sessionId: String, kind: String, requestedAt: String, turn: SignalingClient.TurnConfig?) {
            pendingSession = PendingSession(sessionId, kind, turn)
            ConsentNotifier.showRequest(this@RemoteService, sessionId, kind)
            ensureForeground(typeFor(kind))
        }

        override fun onSignal(sessionId: String, from: String, signal: SignalingClient.Signal) {
            val rtc = rtc ?: return
            when (signal.type) {
                "offer" -> rtc.handleOffer(sessionId, signal.payload.optString("sdp"))
                "answer" -> Unit // device is the answerer
                "candidate" -> rtc.addIceCandidate(signal.payload.optJSONObject("candidate"))
            }
        }

        override fun onSessionEnd(sessionId: String) {
            rtc?.close()
            ConsentNotifier.dismiss(this@RemoteService, sessionId)
            pendingSession = null
            stopForegroundCompat()
        }

        override fun onRelayData(sessionId: String, channel: String, payload: String) {
            if (channel == "control") rtc?.handleControl(payload)
        }
    }

    // --- Consent decision routing ------------------------------------------

    private fun handleConsentAccept(intent: Intent) {
        val sessionId = intent.getStringExtra("sessionId") ?: return
        val kind = intent.getStringExtra("kind") ?: return
        val session = pendingSession
        if (session?.sessionId != sessionId) return

        if (permissionReady(kind)) {
            prepareAndGrant(sessionId, kind, session.turn)
        } else {
            // Route the user to the official Android permission screen.
            val gateIntent = Intent(this, MainActivity::class.java).apply {
                action = MainActivity.ACTION_PREPARE_SESSION
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("sessionId", sessionId)
                putExtra("kind", kind)
            }
            startActivity(gateIntent)
        }
    }

    private fun handleConsentDeny(intent: Intent) {
        val sessionId = intent.getStringExtra("sessionId") ?: return
        signaling?.sendConsentResponse(sessionId, granted = false)
        ConsentNotifier.dismiss(this, sessionId)
        pendingSession = null
    }

    private fun handlePrepareReady(intent: Intent) {
        val sessionId = intent.getStringExtra("sessionId") ?: return
        val kind = intent.getStringExtra("kind") ?: return
        val session = pendingSession
        if (session?.sessionId != sessionId) return
        if (!permissionReady(kind)) return
        prepareAndGrant(sessionId, kind, session.turn)
    }

    /** Called by MainActivity after the user completed the permission gate. */
    private fun prepareAndGrant(sessionId: String, kind: String, turn: SignalingClient.TurnConfig?) {
        val rtc = rtc ?: return
        rtc.prepare(kind, sessionId, turn?.let {
            RtcManager.IceServerConfig(it.urls, it.username, it.credential)
        })
        signaling?.sendConsentResponse(sessionId, granted = true)
        ConsentNotifier.dismiss(this, sessionId)
        ensureForeground(typeFor(kind))
    }

    private fun permissionReady(kind: String): Boolean = when (kind) {
        "screen" -> CaptureState.hasCapture()
        "camera" -> Permissions.hasCamera(this)
        "gallery" -> Permissions.hasGallery(this)
        else -> true
    }

    // --- Foreground notification -------------------------------------------

    private fun ensureServiceChannel() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                SERVICE_CHANNEL_ID,
                getString(R.string.service_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = getString(R.string.service_channel_desc)
            },
        )
    }

    private fun ensureForeground(type: Int) {
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, buildNotification(), type)
        } else {
            startForeground(NOTIFICATION_ID, buildNotification())
        }
    }

    private fun buildNotification(): Notification {
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_logo)
            .setContentTitle(getString(R.string.service_notification_title))
            .setContentText(getString(R.string.service_notification_body))
            .setContentIntent(openApp)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE)
        else @Suppress("DEPRECATION") stopForeground(true)
    }

    private fun typeDataSync(): Int =
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC

    private fun typeFor(kind: String): Int {
        var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
        if (kind == "screen") type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        if (kind == "camera") type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        return type
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        lifecycleRegistry.currentState = Lifecycle.State.DESTROYED
        signaling?.close()
        signaling = null
        rtc?.close()
        rtc = null
        super.onDestroy()
    }

    companion object {
        const val ACTION_START = "com.linkbridge.app.action.START"
        const val ACTION_CONSENT_ACCEPT = "com.linkbridge.app.action.CONSENT_ACCEPT"
        const val ACTION_CONSENT_DENY = "com.linkbridge.app.action.CONSENT_DENY"
        const val ACTION_PREPARE_READY = "com.linkbridge.app.action.PREPARE_READY"
        const val ACTION_PAIRING_COMPLETE = "com.linkbridge.app.action.PAIRING_COMPLETE"

        private const val SERVICE_CHANNEL_ID = "service"
        private const val NOTIFICATION_ID = 1001

        fun start(context: Context) {
            val intent = Intent(context, RemoteService::class.java).setAction(ACTION_START)
            ContextCompat.startForegroundService(context, intent)
        }
    }
}
