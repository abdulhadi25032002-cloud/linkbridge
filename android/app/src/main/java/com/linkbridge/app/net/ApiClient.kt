package com.linkbridge.app.net

import com.linkbridge.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class PairingResult(val deviceId: String, val deviceToken: String)

/**
 * Minimal REST client for the LinkBridge API. TLS uses the platform's
 * default system trust store; there is no insecure fallback.
 */
object ApiClient {
    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    suspend fun completePairing(
        token: String,
        name: String,
        model: String,
        manufacturer: String,
        androidVersion: String,
        appVersion: String,
    ): PairingResult = withContext(Dispatchers.IO) {
        val body = JSONObject().apply {
            put("token", token)
            put(
                "device",
                JSONObject().apply {
                    put("name", name)
                    put("model", model)
                    put("manufacturer", manufacturer)
                    put("androidVersion", androidVersion)
                    put("appVersion", appVersion)
                },
            )
        }

        val request = Request.Builder()
            .url(Endpoints.pairComplete())
            .post(body.toString().toRequestBody(jsonMedia))
            .header("User-Agent", "LinkBridge-Android/$appVersion")
            .build()

        client.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ApiException(response.code, parseError(text) ?: "Pairing failed")
            }
            val json = JSONObject(text)
            PairingResult(
                deviceId = json.getString("deviceId"),
                deviceToken = json.getString("deviceToken"),
            )
        }
    }

    suspend fun reportOnline(deviceToken: String): Boolean = withContext(Dispatchers.IO) {
        val body = JSONObject().put("status", "online")
        val request = Request.Builder()
            .url(Endpoints.deviceState())
            .post(body.toString().toRequestBody(jsonMedia))
            .header("Authorization", "Bearer $deviceToken")
            .build()
        runCatching {
            client.newCall(request).execute().use { it.isSuccessful }
        }.getOrDefault(false)
    }

    private fun parseError(text: String): String? = try {
        JSONObject(text).optString("error").takeIf { it.isNotBlank() }
    } catch (_: Exception) {
        null
    }
}

class ApiException(val statusCode: Int, message: String) : Exception(message)
