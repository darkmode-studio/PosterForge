package com.sandeep.posterforge

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * window.PFNative.
 *  Files: begin(name, mime) -> token, append(token, b64)..., finish(token, "save"|"share").
 *  Gemini: gemini(token, model, bodyJson) - the key is added natively and never returned to JS.
 *  Results arrive asynchronously at window.__pfNativeCb(token, json).
 */
class NativeBridge(private val activity: MainActivity, private val webView: WebView, private val keys: KeyStore) {
    private data class Pending(val file: File, val name: String, val mime: String, val out: FileOutputStream?)

    private val pending = ConcurrentHashMap<String, Pending>()
    private val io = Executors.newSingleThreadExecutor()
    private val net = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())
    private var waitingForPermission: Pair<String, Pending>? = null
    private val exportDir: File get() = File(activity.cacheDir, "exports").apply { mkdirs() }
    private val jobsDir: File get() = File(activity.cacheDir, "jobs").apply { mkdirs() }
    /** Heavy pixel work runs here, one job at a time (bounded memory), never on the WebView/UI thread. */
    private val work = Executors.newSingleThreadExecutor { r -> Thread(r, "pf-work").apply { priority = Thread.NORM_PRIORITY - 1 } }
    private val jobs = ConcurrentHashMap<String, Job>()
    private class Job(val kind: String, val params: JSONObject, val input: java.io.ByteArrayOutputStream = java.io.ByteArrayOutputStream()) { @Volatile var cancelled = false }
    private val exports = ConcurrentHashMap<String, ExportJob>()
    private class ExportJob(val st: Jobs.Stitcher, val name: String, val mime: String, val quality: Int) { @Volatile var failed: String? = null }

    @JavascriptInterface fun isAvailable(): Boolean = true
    @JavascriptInterface fun platform(): String = "android-${Build.VERSION.SDK_INT}"
    @JavascriptInterface fun appVersion(): String = BuildConfig.VERSION_NAME

    // ---- API key (encrypted) ----
    @JavascriptInterface fun hasApiKey(): Boolean = keys.get().isNotBlank()
    /** Only the last 4 characters, so Settings can show which key is stored. */
    @JavascriptInterface fun apiKeyHint(): String = hint(keys.get())
    @JavascriptInterface fun setApiKey(value: String): Boolean { keys.set(value.take(200)); return true }
    @JavascriptInterface fun clearApiKey() { keys.set("") }

    @JavascriptInterface
    fun gemini(token: String, model: String, body: String) {
        net.execute {
            val res = try { Gemini.callWithFallback(keys.get(), model, body) } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", e.message ?: "bad request") }
            reply(token, res)
        }
    }

    @JavascriptInterface
    fun geminiModels(token: String) {
        net.execute { reply(token, try { Gemini.listModels(keys.get()) } catch (e: Exception) { JSONObject().put("ok", false).put("error", e.message ?: "error") }) }
    }

    @JavascriptInterface fun defaultModels(): String = org.json.JSONArray(Gemini.DEFAULT_MODELS).toString()

    @JavascriptInterface
    fun haptic(kind: String) {
        val c = when (kind) {
            "heavy" -> HapticFeedbackConstants.LONG_PRESS
            "confirm" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            else -> if (Build.VERSION.SDK_INT >= 27) HapticFeedbackConstants.KEYBOARD_TAP else HapticFeedbackConstants.VIRTUAL_KEY
        }
        main.post { webView.performHapticFeedback(c) }
    }


    // ---- memory budget ----
    @JavascriptInterface
    fun memoryInfo(): String {
        val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
        val rt = Runtime.getRuntime()
        return JSONObject().put("availMB", mi.availMem / 1048576).put("totalMB", mi.totalMem / 1048576).put("lowMemory", mi.lowMemory)
            .put("memoryClassMB", am.memoryClass).put("heapMaxMB", rt.maxMemory() / 1048576)
            .put("maxExportPixels", ImageOps.maxExportPixels(mi.availMem, mi.lowMemory || am.isLowRamDevice)).toString()
    }

    // ---- background image jobs: jobBegin(kind, params) -> token, jobAppend(token, b64)..., jobRun(token) ----
    // kinds: decode | cutout | filter | trace. Progress: window.__pfNativeProgress(token, 0..1). Result: __pfNativeCb.
    // Image results are written to cache/jobs and served to the page at https://appassets.androidplatform.net/jobs/...
    @JavascriptInterface
    fun jobBegin(kind: String, params: String): String {
        val token = "j" + UUID.randomUUID().toString().replace("-", "")
        jobs[token] = Job(kind, try { JSONObject(params) } catch (_: Exception) { JSONObject() })
        return token
    }
    @JavascriptInterface
    fun jobAppend(token: String, b64: String): Boolean {
        val j = jobs[token] ?: return false
        return try { j.input.write(Base64.decode(b64, Base64.DEFAULT)); true } catch (e: Exception) { false }
    }
    @JavascriptInterface fun jobCancel(token: String) { jobs[token]?.cancelled = true }
    @JavascriptInterface
    fun jobRun(token: String) {
        val j = jobs[token] ?: return reply(token, JSONObject().put("ok", false).put("error", "unknown job"))
        work.execute {
            try { reply(token, runJob(token, j)) }
            catch (e: ImageOps.Cancelled) { reply(token, JSONObject().put("ok", false).put("error", "Cancelled").put("cancelled", true)) }
            catch (e: OutOfMemoryError) { reply(token, JSONObject().put("ok", false).put("error", "Not enough memory for this image")) }
            catch (e: Exception) { reply(token, JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName)) }
            finally { jobs.remove(token) }
        }
    }

    private fun runJob(token: String, j: Job): JSONObject {
        var last = 0L
        val prog = ImageOps.Progress { f -> val now = System.currentTimeMillis(); if (now - last > 120 || f >= 1f) { last = now; progress(token, f) } }
        val r = if (j.kind == "subject") { prog.at(0.1f); SubjectLift.run(j.input.toByteArray(), j.params.optInt("maxSide", 2048).coerceIn(256, 4096), jobsDir, segmenter).also { prog.at(1f) } }
                else Jobs.run(j.kind, j.params, j.input.toByteArray(), jobsDir, token, prog) { j.cancelled }
        r.optString("file").takeIf { it.isNotEmpty() }?.let { r.remove("file"); r.put("url", "https://appassets.androidplatform.net/jobs/$it") }
        return r
    }

    // ---- 2.1 subject lift + image clipboard ----
    /** Swappable for tests. Real engine: on-device ML Kit Subject Segmentation via Play services. */
    internal var segmenter: SubjectLift.Segmenter = SubjectLift.Segmenter { MlKitSegmenter(activity).mask(it) }
    @JavascriptInterface fun subjectInfo(): String = JSONObject().put("playServices", MlKitSegmenter.playServicesOk(activity)).toString()
    /** Reads an image from the system clipboard -> { ok, url, w, h } | { ok:false, code, error } via __pfNativeCb. */
    @JavascriptInterface
    fun clipboardImage(token: String) {
        io.execute {
            val r = try { SubjectLift.pasteFromClipboard(activity, jobsDir) } catch (e: Exception) { SubjectLift.fail("failed", e.message ?: "paste failed") }
            r.optString("file").takeIf { it.isNotEmpty() }?.let { r.remove("file"); r.put("url", "https://appassets.androidplatform.net/jobs/$it") }
            reply(token, r)
        }
    }

    @JavascriptInterface fun jobRelease(url: String) { val name = url.substringAfterLast('/'); if (name.matches(Regex("j[0-9a-f]{32}\\.(png|jpg)"))) File(jobsDir, name).delete() }

    // ---- tiled export: the page renders the poster in strips, Kotlin stitches and encodes off the UI thread ----
    @JavascriptInterface
    fun exportBegin(w: Int, h: Int, mime: String, quality: Int, name: String): String {
        val info = JSONObject(memoryInfo())
        if (w <= 0 || h <= 0 || w.toLong() * h > info.getLong("maxExportPixels")) return JSONObject().put("ok", false).put("error", "Too large for this phone's free memory").toString()
        return try {
            val token = "x" + UUID.randomUUID().toString().replace("-", "")
            exports[token] = ExportJob(Jobs.Stitcher(w, h), safeName(name), if (mime == "image/jpeg") mime else "image/png", quality)
            JSONObject().put("ok", true).put("token", token).toString()
        } catch (e: OutOfMemoryError) { JSONObject().put("ok", false).put("error", "Not enough memory").toString() }
    }
    @JavascriptInterface
    fun exportTile(token: String, x: Int, y: Int, b64: String): Boolean {
        val ex = exports[token] ?: return false
        val bytes = try { Base64.decode(b64, Base64.DEFAULT) } catch (_: Exception) { return false }
        work.execute {
            try { ex.st.tile(x, y, bytes) }
            catch (e: Throwable) { ex.failed = e.message ?: "tile failed" }
        }
        return true
    }
    @JavascriptInterface
    fun exportFinish(token: String, action: String) {
        val ex = exports.remove(token) ?: return reply(token, JSONObject().put("ok", false).put("error", "unknown export"))
        work.execute {
            try {
                if (ex.failed != null) throw IllegalStateException(ex.failed)
                progress(token, 0.1f)
                val f = File(exportDir, "$token-${ex.name}")
                ex.st.encode(f, ex.mime == "image/jpeg", ex.quality)
                ex.st.recycle()
                progress(token, 1f)
                val p = Pending(f, ex.name, ex.mime, null)
                if (action == "share") share(token, p) else {
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
                        ContextCompat.checkSelfPermission(activity, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                        waitingForPermission = token to p; main.post { activity.storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE) }
                    } else save(token, p)
                }
            } catch (e: Throwable) { try { ex.st.recycle() } catch (_: Throwable) {}; reply(token, JSONObject().put("ok", false).put("error", e.message ?: "export failed")) }
        }
    }

    private fun progress(token: String, f: Float) {
        main.post { webView.evaluateJavascript("window.__pfNativeProgress&&window.__pfNativeProgress(${JSONObject.quote(token)},${"%.3f".format(java.util.Locale.US, f)})", null) }
    }

    // ---- file export ----
    @JavascriptInterface
    fun begin(name: String, mime: String): String {
        val token = UUID.randomUUID().toString()
        val safe = safeName(name)
        val f = File(exportDir, "$token-$safe")
        pending[token] = Pending(f, safe, mime, FileOutputStream(f))
        return token
    }

    @JavascriptInterface
    fun append(token: String, b64: String): Boolean {
        val p = pending[token] ?: return false
        return try { p.out!!.write(Base64.decode(b64, Base64.DEFAULT)); true } catch (e: Exception) { false }
    }

    @JavascriptInterface
    fun finish(token: String, action: String) {
        val p = pending.remove(token) ?: return reply(token, JSONObject().put("ok", false).put("error", "unknown token"))
        try { p.out?.flush(); p.out?.close() } catch (_: Exception) {}
        if (action == "share") { share(token, p); return }
        if (action == "copy") {
            main.post {
                try { SubjectLift.copyToClipboard(activity, p.file); reply(token, JSONObject().put("ok", true).put("copied", true)) }
                catch (e: Exception) { reply(token, JSONObject().put("ok", false).put("error", e.message ?: "copy failed")) }
            }
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(activity, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            waitingForPermission = token to p
            main.post { activity.storagePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE) }
            return
        }
        io.execute { save(token, p) }
    }

    fun onStoragePermission(granted: Boolean) {
        val (token, p) = waitingForPermission ?: return
        waitingForPermission = null
        if (granted) io.execute { save(token, p) }
        else { p.file.delete(); reply(token, JSONObject().put("ok", false).put("error", activity.getString(R.string.storage_needed))) }
    }

    private fun save(token: String, p: Pending) {
        val isImage = p.mime.startsWith("image/") && p.mime != "image/svg+xml"
        val folder = if (isImage) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS
        val rel = "$folder/PosterForge"
        try {
            val uri: Uri?
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val resolver = activity.contentResolver
                val collection = if (isImage) MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                                 else MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, p.name)
                    put(MediaStore.MediaColumns.MIME_TYPE, p.mime)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, rel)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                uri = resolver.insert(collection, values) ?: throw IllegalStateException("MediaStore insert failed")
                resolver.openOutputStream(uri)?.use { out -> p.file.inputStream().use { it.copyTo(out, 1 shl 16) } }
                    ?: throw IllegalStateException("Cannot open output")
                values.clear(); values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            } else {
                @Suppress("DEPRECATION")
                val dir = File(Environment.getExternalStoragePublicDirectory(folder), "PosterForge").apply { mkdirs() }
                val dest = uniqueFile(dir, p.name)
                p.file.copyTo(dest, overwrite = false)
                MediaScannerConnection.scanFile(activity, arrayOf(dest.absolutePath), arrayOf(p.mime), null)
                uri = Uri.fromFile(dest)
            }
            p.file.delete()
            main.post { Toast.makeText(activity, activity.getString(R.string.saved_to, rel), Toast.LENGTH_SHORT).show() }
            reply(token, JSONObject().put("ok", true).put("where", rel).put("uri", uri.toString()))
        } catch (e: Exception) {
            p.file.delete()
            reply(token, JSONObject().put("ok", false).put("error", e.message ?: e.javaClass.simpleName))
        }
    }

    private fun share(token: String, p: Pending) {
        main.post {
            try {
                val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", p.file)
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = p.mime
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                activity.startActivity(Intent.createChooser(send, activity.getString(R.string.share_title)))
                reply(token, JSONObject().put("ok", true).put("shared", true))
            } catch (e: Exception) {
                reply(token, JSONObject().put("ok", false).put("error", e.message ?: "share failed"))
            }
        }
    }

    private fun uniqueFile(dir: File, name: String): File {
        var f = File(dir, name); var i = 1
        val base = name.substringBeforeLast('.'); val ext = name.substringAfterLast('.', "")
        while (f.exists()) { f = File(dir, if (ext.isEmpty()) "$base ($i)" else "$base ($i).$ext"); i++ }
        return f
    }

    private fun reply(token: String, json: JSONObject) {
        main.post { webView.evaluateJavascript("window.__pfNativeCb&&window.__pfNativeCb(${JSONObject.quote(token)},${JSONObject.quote(json.toString())})", null) }
    }

    init {
        io.execute {
            exportDir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 86_400_000) it.delete() }
            jobsDir.listFiles()?.forEach { it.delete() } // job results only live for one session
        }
    }

    companion object {
        fun hint(key: String): String = if (key.length >= 8) "••••" + key.takeLast(4) else if (key.isEmpty()) "" else "••••"
        fun safeName(name: String): String = name.replace(Regex("[^\\w.\\- ]"), "_").take(120).ifBlank { "posterforge" }
    }
}
