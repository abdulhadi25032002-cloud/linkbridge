package com.linkbridge.app.util

import android.content.Context

/** Local storage for pairing credentials (values are encrypted at rest). */
object Prefs {
    private const val FILE = "linkbridge"
    private const val KEY_DEVICE_ID = "device_id"
    private const val KEY_DEVICE_TOKEN = "device_token"
    private const val KEY_DEVICE_NAME = "device_name"

    private fun prefs(context: Context) =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    val isPaired: Boolean
        get() = deviceToken != null && deviceId != null

    var deviceId: String?
        get() = get(KEY_DEVICE_ID)
        set(value) = set(KEY_DEVICE_ID, value)

    var deviceToken: String?
        get() = get(KEY_DEVICE_TOKEN)
        set(value) = set(KEY_DEVICE_TOKEN, value)

    var deviceName: String?
        get() = get(KEY_DEVICE_NAME)
        set(value) = set(KEY_DEVICE_NAME, value)

    private fun get(key: String): String? {
        val stored = prefs(appContext).getString(key, null) ?: return null
        return SecureStore.decrypt(stored)
    }

    private fun set(key: String, value: String?) {
        prefs(appContext).edit().apply {
            if (value == null) remove(key) else putString(key, SecureStore.encrypt(value))
        }.apply()
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }

    // Initialized from the Application class so SecureStore calls have context.
    private lateinit var appContext: Context
    fun init(context: Context) {
        appContext = context.applicationContext
    }
}
