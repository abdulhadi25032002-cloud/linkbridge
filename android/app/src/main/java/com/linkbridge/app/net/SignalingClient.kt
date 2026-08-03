package com.linkbridge.app.net

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * WebSocket signaling client used by the device. Reconnects automatically
 * with exponential backoff after network changes or drops.
 */
class SignalingClient(
    private val deviceToken: String,
    private val listener: Listener,
) {
    interface Listener {
        fun onConnected()
        fun onDisconnected(reason: String?)
        fun onConsentRequest(sessionId: String, kind: String, requestedAt: String, turn: TurnConfig?)
        fun onSignal(sessionId: String, from: String, signal: Signal)
        fun onSessionEnd(sessionId: String)
        fun onRelayData(sessionId: String, channel: String, payload: String)
    }

    data class Signal(val type: String, val payload: JSONObject)

    data class TurnConfig(val urls: List<String>, val username: String?, val credential: String?)

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var closed = false
    private var attempt = 0
    private var reconnectDelay = 1_000L

    fun connect() {
        closed = false
        open()
    }

    private fun open() {
        val request = Request.Builder()
            .url(Endpoints.wsUrl)
            .build()
        webSocket = client.newWebSocket(request, listenerImpl)
    }

    private val listenerImpl = object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            attempt = 0
            reconnectDelay = 1_000L
            send(mapOf("type" to "auth", "token" to deviceToken))
        }

        override fun onMessage(ws: WebSocket, text: String) {
            handleMessage(text)
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            listener.onDisconnected(t.message)
            scheduleReconnect()
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            if (!closed) scheduleReconnect()
        }
    }

    private fun handleMessage(text: String) {
        val msg = try {
            JSONObject(text)
        } catch (_: Exception) {
            return
        }
        when (msg.optString("type")) {
            "authed" -> listener.onConnected()
            "consent.request" -> listener.onConsentRequest(
                msg.optString("sessionId"),
                msg.optString("kind"),
                msg.optString("requestedAt"),
                parseTurn(msg.optJSONObject("turn")),
            )
            "signal" -> {
                val data = msg.optJSONObject("data") ?: return
                listener.onSignal(
                    msg.optString("sessionId"),
                    msg.optString("from"),
                    Signal(data.optString("type"), data),
                )
            }
            "session.end" -> listener.onSessionEnd(msg.optString("sessionId"))
            "relay.data" -> listener.onRelayData(
                msg.optString("sessionId"),
                msg.optString("channel"),
                msg.optString("payload"),
            )
        }
    }

    private fun parseTurn(json: JSONObject?): TurnConfig? {
        if (json == null) return null
        val url = json.optString("url").takeIf { it.isNotBlank() } ?: return null
        return TurnConfig(
            urls = listOf(url),
            username = json.optString("username").takeIf { it.isNotBlank() },
            credential = json.optString("credential").takeIf { it.isNotBlank() },
        )
    }

    private fun scheduleReconnect() {
        if (closed) return
        val delay = reconnectDelay
        reconnectDelay = (reconnectDelay * 2).coerceAtMost(15_000L)
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ open() }, delay)
    }

    fun sendConsentResponse(sessionId: String, granted: Boolean) {
        send(
            mapOf(
                "type" to "consent.response",
                "sessionId" to sessionId,
                "granted" to granted,
            ),
        )
    }

    fun sendSignal(sessionId: String, to: String, data: JSONObject) {
        send(mapOf("type" to "signal", "sessionId" to sessionId, "to" to to, "data" to data))
    }

    fun endSession(sessionId: String) {
        send(mapOf("type" to "session.end", "sessionId" to sessionId))
    }

    fun sendRelay(sessionId: String, to: String, channel: String, payload: String) {
        send(
            mapOf(
                "type" to "relay.data",
                "sessionId" to sessionId,
                "to" to to,
                "channel" to channel,
                "payload" to payload,
            ),
        )
    }

    private fun send(map: Map<String, Any>) {
        webSocket?.send(JSONObject(map).toString())
    }

    fun close() {
        closed = true
        webSocket?.close(1000, "bye")
        client.dispatcher.executorService.shutdown()
    }
}
