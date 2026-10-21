package com.sandeep.posterforge

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** The Gemini key lives only here: AES-256 encrypted with a key held in the Android Keystore. Never sent to JS. */
interface KeyStore {
    fun get(): String
    fun set(value: String)
}

class SecureStore(context: Context) : KeyStore {
    private val prefs: SharedPreferences = try {
        val master = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "pf_secure", master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        // Corrupted keyset (e.g. restored from another device): wipe and start again rather than crash.
        context.deleteSharedPreferences("pf_secure")
        val master = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "pf_secure", master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }
    override fun get(): String = prefs.getString("gemini_key", "") ?: ""
    override fun set(value: String) { prefs.edit().apply { if (value.isBlank()) remove("gemini_key") else putString("gemini_key", value.trim()) }.apply() }
}
