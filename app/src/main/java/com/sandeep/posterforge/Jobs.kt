package com.sandeep.posterforge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream

/** Android side of the background image jobs (decode / cutout / filter / trace) and the tiled export stitcher. */
object Jobs {
    data class Decoded(val bitmap: Bitmap, val origW: Int, val origH: Int, val sampleSize: Int)

    /** Decodes with inSampleSize so a 12 MP photo never needs a full-size bitmap, applies EXIF rotation, then fits [maxSide]. */
    fun decodeScaled(bytes: ByteArray, maxSide: Int): Decoded {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0) throw IllegalArgumentException("Not an image")
        val rot = try {
            when (ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90; ExifInterface.ORIENTATION_ROTATE_180 -> 180; ExifInterface.ORIENTATION_ROTATE_270 -> 270; else -> 0
            }
        } catch (_: Exception) { 0 }
        val ss = ImageOps.sampleSize(bounds.outWidth, bounds.outHeight, maxSide)
        val opts = BitmapFactory.Options().apply { inSampleSize = ss; inPreferredConfig = Bitmap.Config.ARGB_8888 }
        var b = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts) ?: throw IllegalArgumentException("Cannot decode image")
        val (tw, th) = ImageOps.fit(b.width, b.height, maxSide)
        if (tw != b.width || th != b.height || rot != 0) {
            val m = Matrix().apply { postScale(tw.toFloat() / b.width, th.toFloat() / b.height); postRotate(rot.toFloat()) }
            val r = Bitmap.createBitmap(b, 0, 0, b.width, b.height, m, true)
            if (r !== b) b.recycle(); b = r
        }
        val (ow, oh) = if (rot == 90 || rot == 270) bounds.outHeight to bounds.outWidth else bounds.outWidth to bounds.outHeight
        return Decoded(b, ow, oh, ss)
    }

    fun write(file: File, px: IntArray, w: Int, h: Int, png: Boolean, quality: Int) {
        val bmp = Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
        try { FileOutputStream(file).use { bmp.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, quality.coerceIn(40, 100), it) } }
        finally { bmp.recycle() }
    }

    /** Runs one job. Image outputs are written to [outDir]/[token].png|jpg and returned as "file". */
    fun run(kind: String, p: JSONObject, bytes: ByteArray, outDir: File, token: String,
            prog: ImageOps.Progress = ImageOps.Progress {}, cancelled: () -> Boolean = { false }): JSONObject {
        val maxSide = p.optInt("maxSide", 2048).coerceIn(16, 8192)
        val d = decodeScaled(bytes, maxSide)
        val bmp = d.bitmap
        try {
            val w = bmp.width; val h = bmp.height
            val px = IntArray(w * h); bmp.getPixels(px, 0, w, 0, 0, w, h)
            bmp.recycle()
            val res = JSONObject().put("ok", true).put("w", w).put("h", h).put("origW", d.origW).put("origH", d.origH).put("sampleSize", d.sampleSize)
            fun out(pixels: IntArray, png: Boolean, q: Int): String { val f = File(outDir, "$token.${if (png) "png" else "jpg"}"); write(f, pixels, w, h, png, q); return f.name }
            when (kind) {
                "decode" -> { prog.at(1f); return res.put("file", out(px, p.optString("format") == "png", p.optInt("quality", 92))) }
                "cutout" -> {
                    val r = ImageOps.cutout(px, w, h, p.optInt("tolerance", 45), p.optInt("feather", 12), prog, cancelled)
                    return res.put("file", out(r.pixels, true, 100)).put("removedRatio", r.removedRatio.toDouble())
                        .put("bgColor", "rgb(${Color.red(r.bg)},${Color.green(r.bg)},${Color.blue(r.bg)})")
                }
                "filter" -> {
                    val f = p.optJSONObject("filter") ?: JSONObject()
                    val o = ImageOps.filter(px, w, h, filterFromJson(f), prog, cancelled, p.optDouble("blurScale", 1.0).toFloat())
                    return res.put("file", out(o, p.optString("format") == "png", p.optInt("quality", 92)))
                }
                "trace" -> return res.put("svg", ImageOps.trace(px, w, h, p.optInt("colors", 8), prog, cancelled))
                else -> throw IllegalArgumentException("Unknown job $kind")
            }
        } finally { if (!bmp.isRecycled) bmp.recycle() }
    }

    /** Receives PNG strips from the page and stitches them into one bitmap, then encodes PNG/JPEG. */
    class Stitcher(val w: Int, val h: Int) {
        private val bmp: Bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        private val canvas = Canvas(bmp)
        var tiles = 0; private set
        fun tile(x: Int, y: Int, png: ByteArray) {
            val t = BitmapFactory.decodeByteArray(png, 0, png.size) ?: throw IllegalArgumentException("Bad tile")
            canvas.drawBitmap(t, x.toFloat(), y.toFloat(), null); t.recycle(); tiles++
        }
        fun encode(file: File, jpeg: Boolean, quality: Int) {
            FileOutputStream(file).use { bmp.compress(if (jpeg) Bitmap.CompressFormat.JPEG else Bitmap.CompressFormat.PNG, quality.coerceIn(40, 100), it) }
        }
        fun pixel(x: Int, y: Int) = bmp.getPixel(x, y)
        fun recycle() = bmp.recycle()
    }
}

/** Parses the JS filter object (same keys as imaging.js filterCanvas). */
fun filterFromJson(f: JSONObject): ImageOps.Filter {
    val curve = f.optJSONArray("curve")?.let { a -> (0 until a.length()).mapNotNull { i -> a.optJSONArray(i)?.let { pt -> floatArrayOf(pt.optDouble(0).toFloat(), pt.optDouble(1).toFloat()) } } }?.takeIf { it.size >= 2 }
    val hsl = f.optJSONObject("hsl")?.let { o -> o.keys().asSequence().mapNotNull { k -> o.optJSONArray(k)?.let { v -> k to floatArrayOf(v.optDouble(0, 0.0).toFloat(), v.optDouble(1, 0.0).toFloat(), v.optDouble(2, 0.0).toFloat()) } }.toMap() }
    return ImageOps.Filter(f.optInt("brightness"), f.optInt("contrast"), f.optInt("saturation"), f.optInt("warmth"),
        f.optInt("blur"), f.optBoolean("grayscale"), f.optBoolean("sepia"), f.optInt("vignette"), curve, hsl, f.optInt("grain"))
}
