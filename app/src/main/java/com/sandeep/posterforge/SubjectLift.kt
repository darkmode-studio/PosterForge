package com.sandeep.posterforge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * 2.1 subject lift ("lift the subject" like iOS) and image clipboard.
 * The segmentation engine is behind [Segmenter] so the cropping / file / error logic is unit-testable without
 * Play services; the real engine is [MlKitSegmenter] (on-device ML Kit Subject Segmentation, model via Play services).
 */
object SubjectLift {
    /** Returns the subject on a transparent background (same size as the input), or null when no subject was found. */
    fun interface Segmenter { fun foreground(src: Bitmap): Bitmap? }

    /** Thrown by a segmenter when Play services / the model is missing; [code] is "no_play_services" | "model_downloading" | "unavailable". */
    class Unavailable(val code: String, msg: String) : Exception(msg)

    data class Box(val x: Int, val y: Int, val w: Int, val h: Int)

    /** Tight bounding box of pixels whose alpha > [threshold]; null when the bitmap is fully transparent. */
    fun alphaBounds(b: Bitmap, threshold: Int = 8): Box? {
        val w = b.width; val h = b.height; val row = IntArray(w)
        var x0 = w; var y0 = h; var x1 = -1; var y1 = -1
        for (y in 0 until h) {
            b.getPixels(row, 0, w, 0, y, w, 1)
            for (x in 0 until w) if ((row[x] ushr 24) > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
        }
        return if (x1 < 0) null else Box(x0, y0, x1 - x0 + 1, y1 - y0 + 1)
    }

    /**
     * Decodes [bytes] (max side [maxSide]), segments, crops to the subject and writes a PNG into [dir].
     * Result: { ok, file, w, h, x, y, srcW, srcH } where x/y/srcW/srcH let the page place the layer exactly over the photo,
     * or { ok:false, code, error }.
     */
    fun run(bytes: ByteArray, maxSide: Int, dir: File, seg: Segmenter): JSONObject {
        val d = try { Jobs.decodeScaled(bytes, maxSide) } catch (e: Exception) { return fail("bad_image", e.message ?: "Cannot read photo") }
        val src = d.bitmap
        val fg = try { seg.foreground(src) } catch (e: Unavailable) { return fail(e.code, e.message ?: e.code) }
            catch (e: Exception) { return fail("failed", e.message ?: e.javaClass.simpleName) }
        if (fg == null) return fail("no_subject", "No clear subject found in this photo")
        val box = alphaBounds(fg) ?: return fail("no_subject", "No clear subject found in this photo")
        val crop = Bitmap.createBitmap(fg, box.x, box.y, box.w, box.h)
        val name = "j" + UUID.randomUUID().toString().replace("-", "") + ".png"
        FileOutputStream(File(dir.apply { mkdirs() }, name)).use { crop.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return JSONObject().put("ok", true).put("file", name).put("w", box.w).put("h", box.h).put("x", box.x).put("y", box.y)
            .put("srcW", src.width).put("srcH", src.height)
    }

    fun fail(code: String, msg: String): JSONObject = JSONObject().put("ok", false).put("code", code).put("error", msg)

    /** Puts [file] (must live under a FileProvider path) on the system clipboard as an image content URI. */
    fun copyToClipboard(ctx: Context, file: File, label: String = "PosterForge image",
                        toUri: (File) -> Uri = { FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", it) }): Uri {
        val uri = toUri(file)
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData(label, arrayOf("image/png"), ClipData.Item(uri))
        cm.setPrimaryClip(clip)
        return uri
    }

    /**
     * Reads an image from the system clipboard (first item with an image URI), re-encodes it as PNG into [dir].
     * Result { ok, file, w, h } or { ok:false, code:"empty"|"not_image", error }.
     */
    fun pasteFromClipboard(ctx: Context, dir: File, maxSide: Int = 4096): JSONObject {
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = cm.primaryClip ?: return fail("empty", "Clipboard is empty")
        for (i in 0 until clip.itemCount) {
            val uri = clip.getItemAt(i).uri ?: continue
            val type = ctx.contentResolver.getType(uri) ?: clip.description.getMimeType(0)
            if (type != null && !type.startsWith("image/")) continue
            val bytes = try { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } } catch (_: Exception) { null } ?: continue
            val d = try { Jobs.decodeScaled(bytes, maxSide) } catch (_: Exception) { continue }
            val name = "j" + UUID.randomUUID().toString().replace("-", "") + ".png"
            FileOutputStream(File(dir.apply { mkdirs() }, name)).use { d.bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            return JSONObject().put("ok", true).put("file", name).put("w", d.bitmap.width).put("h", d.bitmap.height)
        }
        return fail("not_image", "The clipboard has no image")
    }

    @Suppress("unused") internal fun decode(bytes: ByteArray): Bitmap? = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}
