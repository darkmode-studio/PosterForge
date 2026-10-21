package com.sandeep.posterforge

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Direct Gemini REST calls from the phone. The key is added here, natively, so it never enters the WebView.
 * No model is hard-wired: the user's choice is tried first, and when the API says a model is retired / not found,
 * the call falls back automatically (first to a model the error message suggests, then to current defaults).
 */
object Gemini {
    const val DEFAULT_BASE = "https://generativelanguage.googleapis.com"
    /** Current text models per ai.google.dev/gemini-api/docs/models (checked 21 Oct 2026). Order = fallback order. */
    val DEFAULT_MODELS = listOf("gemini-3.8-flash", "gemini-flash-latest", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash")
    val MODEL_RE = Regex("^[a-z0-9][a-z0-9.\\-]{2,60}$")
    private val UNAVAILABLE_RE = Regex("no longer available|not found|is not supported|not available|deprecated|retired|shut ?down|unknown model|does not exist", RegexOption.IGNORE_CASE)
    private val SUGGEST_RE = Regex("use (?:the )?(?:model )?(?:models/)?([a-z0-9][a-z0-9.\\-]{2,60})", RegexOption.IGNORE_CASE)

    fun clean(model: String?): String? = model?.trim()?.removePrefix("models/")?.lowercase()?.takeIf { MODEL_RE.matches(it) }

    fun isUnavailable(status: Int, message: String): Boolean =
        status == 404 || (status in 400..410 && UNAVAILABLE_RE.containsMatchIn(message))

    fun suggested(message: String): String? = SUGGEST_RE.findAll(message).map { clean(it.groupValues[1]) }.firstOrNull { it != null && it.startsWith("gemini") }

    /** One attempt with one model. */
    fun call(key: String, model: String, body: String, base: String = DEFAULT_BASE, timeoutMs: Int = 90_000): JSONObject {
        if (key.isBlank()) return JSONObject().put("ok", false).put("error", "NO_KEY")
        val m = clean(model) ?: DEFAULT_MODELS[0]
        JSONObject(body) // validate
        val conn = URL("$base/v1beta/models/$m:generateContent").openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = "POST"; conn.connectTimeout = 20_000; conn.readTimeout = timeoutMs; conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.setRequestProperty("x-goog-api-key", key)
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (code !in 200..299) {
                val msg = try { JSONObject(text).getJSONObject("error").optString("message") } catch (_: Exception) { "" }
                JSONObject().put("ok", false).put("status", code).put("model", m).put("error", msg.ifBlank { "HTTP $code" })
                    .put("unavailable", isUnavailable(code, msg))
            } else {
                val parts = JSONObject(text).optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
                val sb = StringBuilder()
                if (parts != null) for (i in 0 until parts.length()) {
                    val p = parts.optJSONObject(i) ?: continue
                    if (!p.optBoolean("thought")) sb.append(p.optString("text"))
                }
                if (sb.isEmpty()) JSONObject().put("ok", false).put("model", m).put("error", "Empty reply (blocked or no text)")
                else JSONObject().put("ok", true).put("model", m).put("text", sb.toString())
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("model", m).put("error", "Network: " + (e.message ?: e.javaClass.simpleName))
        } finally { conn.disconnect() }
    }

    /** Tries the preferred model, then falls back while the API reports the model as unavailable. */
    fun callWithFallback(key: String, preferred: String?, body: String, base: String = DEFAULT_BASE, maxTries: Int = 5): JSONObject {
        val queue = ArrayDeque<String>()
        val tried = mutableListOf<String>()
        fun enqueue(m: String?, front: Boolean = false) { val c = clean(m) ?: return; if (c in tried || c in queue) return; if (front) queue.addFirst(c) else queue.addLast(c) }
        enqueue(preferred); DEFAULT_MODELS.forEach { enqueue(it) }
        var last = JSONObject().put("ok", false).put("error", "No model available")
        val skipped = JSONArray()
        while (queue.isNotEmpty() && tried.size < maxTries) {
            val m = queue.removeFirst(); tried += m
            val r = call(key, m, body, base)
            if (r.optBoolean("ok")) {
                if (tried.size > 1) r.put("fellBackFrom", tried.first()).put("skipped", skipped)
                return r
            }
            last = r
            if (!r.optBoolean("unavailable")) return r // bad key, quota, network: falling back will not help
            skipped.put(m)
            enqueue(suggested(r.optString("error")), front = true)
        }
        return last.put("tried", JSONArray(tried))
    }

    /** GET /v1beta/models: text models that support generateContent (paged). */
    fun listModels(key: String, base: String = DEFAULT_BASE): JSONObject {
        if (key.isBlank()) return JSONObject().put("ok", false).put("error", "NO_KEY")
        val out = JSONArray(); var page: String? = null; var guard = 0
        try {
            do {
                val q = "pageSize=1000" + (page?.let { "&pageToken=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: "")
                val conn = URL("$base/v1beta/models?$q").openConnection() as HttpURLConnection
                conn.connectTimeout = 20_000; conn.readTimeout = 30_000
                conn.setRequestProperty("x-goog-api-key", key)
                val code = conn.responseCode
                val text = (if (code in 200..299) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
                conn.disconnect()
                if (code !in 200..299) {
                    val msg = try { JSONObject(text).getJSONObject("error").optString("message") } catch (_: Exception) { "" }
                    return JSONObject().put("ok", false).put("status", code).put("error", msg.ifBlank { "HTTP $code" })
                }
                val json = JSONObject(text)
                val arr = json.optJSONArray("models") ?: JSONArray()
                for (i in 0 until arr.length()) {
                    val m = arr.optJSONObject(i) ?: continue
                    val methods = m.optJSONArray("supportedGenerationMethods")?.toString() ?: ""
                    val id = clean(m.optString("name")) ?: continue
                    if (!methods.contains("generateContent") || !id.startsWith("gemini")) continue
                    if (Regex("tts|image|live|embedding|audio|transcribe|robotics|computer-use|banana").containsMatchIn(id)) continue
                    out.put(JSONObject().put("id", id).put("label", m.optString("displayName", id)))
                }
                page = json.optString("nextPageToken").ifBlank { null }
            } while (page != null && ++guard < 10)
        } catch (e: Exception) { return JSONObject().put("ok", false).put("error", "Network: " + (e.message ?: "")) }
        return JSONObject().put("ok", true).put("models", out)
    }
}
