package com.sandeep.posterforge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream
import java.io.File

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SubjectLiftTest {
    private val ctx: Context get() = ApplicationProvider.getApplicationContext()
    private fun png(w: Int, h: Int, c: Int = Color.BLUE): ByteArray {
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888); b.eraseColor(c)
        return ByteArrayOutputStream().also { b.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
    }
    /** fake engine: keeps a rectangle as the "subject" */
    private val rectSeg = SubjectLift.Segmenter { src ->
        val m = FloatArray(src.width * src.height)
        for (y in 30 until 70) for (x in 20 until 60) m[y * src.width + x] = 0.97f; m }

    @Test fun alphaBoundsFindsSubject() {
        val b = Bitmap.createBitmap(50, 40, Bitmap.Config.ARGB_8888); b.eraseColor(Color.TRANSPARENT)
        b.setPixel(10, 5, Color.WHITE); b.setPixel(30, 20, Color.WHITE)
        assertEquals(SubjectLift.Box(10, 5, 21, 16), SubjectLift.alphaBounds(b))
        b.eraseColor(Color.TRANSPARENT); assertNull(SubjectLift.alphaBounds(b))
    }

    @Test fun runCropsAndWritesPng() {
        val dir = File(ctx.cacheDir, "jobs-test")
        val r = SubjectLift.run(png(100, 100), 2048, dir, rectSeg)
        assertTrue(r.toString(), r.getBoolean("ok"))
        assertEquals(40, r.getInt("w")); assertEquals(40, r.getInt("h")); assertEquals(20, r.getInt("x")); assertEquals(30, r.getInt("y"))
        assertEquals(100, r.getInt("srcW"))
        val f = File(dir, r.getString("file")); assertTrue(f.exists()); assertTrue(r.getString("file").matches(Regex("j[0-9a-f]{32}\\.png")))
        val out = BitmapFactory.decodeFile(f.absolutePath); assertEquals(40, out.width)
    }

    @Test fun runReportsNoSubjectAndUnavailable() {
        val dir = File(ctx.cacheDir, "jobs-test")
        val none = SubjectLift.run(png(60, 60), 2048, dir) { null }
        assertFalse(none.getBoolean("ok")); assertEquals("no_subject", none.getString("code"))
        val empty = SubjectLift.run(png(60, 60), 2048, dir) { s -> FloatArray(s.width * s.height) }
        assertEquals("no_subject", empty.getString("code"))
        // a mask that keeps the whole photo must not produce a duplicate layer
        val whole = SubjectLift.run(png(60, 60), 2048, dir) { s -> FloatArray(s.width * s.height) { 1f } }
        assertFalse(whole.getBoolean("ok")); assertEquals("no_subject", whole.getString("code"))
        val gps = SubjectLift.run(png(60, 60), 2048, dir) { throw SubjectLift.Unavailable("no_play_services", "needs Play services") }
        assertEquals("no_play_services", gps.getString("code")); assertEquals("needs Play services", gps.getString("error"))
        val bad = SubjectLift.run(byteArrayOf(1, 2, 3), 2048, dir, rectSeg)
        assertEquals("bad_image", bad.getString("code"))
    }

    @Test fun runScalesBigPhotosDown() {
        val r = SubjectLift.run(png(3000, 1500), 1000, File(ctx.cacheDir, "jobs-test")) { s -> assertTrue(s.width <= 1000); rectSeg.mask(s) }
        assertEquals(1000, r.getInt("srcW")); assertEquals(500, r.getInt("srcH"))
    }

    private fun fakeUri(f: File) = android.net.Uri.parse("content://${ctx.packageName}.fileprovider/exports/${f.name}")
    @Test fun copyPutsContentUriOnClipboard() {
        val f = File(File(ctx.cacheDir, "exports").apply { mkdirs() }, "subject.png"); f.writeBytes(png(10, 10))
        val uri = SubjectLift.copyToClipboard(ctx, f) { fakeUri(it) }
        assertEquals("content", uri.scheme); assertEquals(ctx.packageName + ".fileprovider", uri.authority)
        val clip = (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip!!
        assertEquals(uri, clip.getItemAt(0).uri); assertEquals("image/png", clip.description.getMimeType(0))
    }

    @Test fun fileProviderSharesTheExportsCacheFolder() {
        val xml = File("src/main/res/xml/file_paths.xml").readText()
        assertTrue(xml.contains("cache-path") && xml.contains("exports/"))
        val man = File("src/main/AndroidManifest.xml").readText()
        assertTrue(man.contains("\${applicationId}.fileprovider") && man.contains("grantUriPermissions=\"true\""))
    }

    @Test fun pasteHandlesEmptyAndTextClipboard() {
        val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("t", "hello"))
        val r = SubjectLift.pasteFromClipboard(ctx, File(ctx.cacheDir, "jobs-test"))
        assertFalse(r.getBoolean("ok")); assertEquals("not_image", r.getString("code"))
    }

    @Test fun copyThenPasteRoundTrip() {
        val f = File(File(ctx.cacheDir, "exports").apply { mkdirs() }, "rt.png"); val bytes = png(32, 16, Color.GREEN); f.writeBytes(bytes)
        val uri = SubjectLift.copyToClipboard(ctx, f) { fakeUri(it) }
        org.robolectric.Shadows.shadowOf(ctx.contentResolver).registerInputStream(uri, java.io.ByteArrayInputStream(bytes))
        val r = SubjectLift.pasteFromClipboard(ctx, File(ctx.cacheDir, "jobs-test"))
        assertTrue(r.toString(), r.getBoolean("ok")); assertEquals(32, r.getInt("w")); assertEquals(16, r.getInt("h"))
        assertTrue(File(ctx.cacheDir, "jobs-test/" + r.getString("file")).exists())
    }

    @Test fun maskToAlphaAppliesConfidence() {
        val px = intArrayOf(0xFF102030.toInt(), 0xFF405060.toInt(), 0xFF708090.toInt(), 0xFFA0B0C0.toInt(), 0xFFFFFFFF.toInt())
        val out = SubjectLift.maskToAlpha(px, floatArrayOf(0f, 0.2f, 0.5f, 0.9f, Float.NaN))
        assertEquals(0, out[0]); assertEquals(0, out[1]); assertEquals(0, out[4])          // background -> fully transparent
        assertEquals(128, out[2] ushr 24); assertEquals(0x708090, out[2] and 0xFFFFFF)       // soft edge keeps colour
        assertEquals(0xFFA0B0C0.toInt(), out[3])                                            // subject stays opaque, unchanged
    }

    @Test fun maskToAlphaRejectsShortMask() {
        try { SubjectLift.maskToAlpha(IntArray(4), FloatArray(3)); fail("expected") } catch (_: IllegalArgumentException) {}
    }

    @Test fun alphaBoundsOnArrayAndTransparentShare() {
        val px = IntArray(10 * 8); px[2 * 10 + 3] = 0xFF000000.toInt(); px[5 * 10 + 7] = 0x80000000.toInt()
        assertEquals(SubjectLift.Box(3, 2, 5, 4), SubjectLift.alphaBounds(px, 10, 8))
        assertNull(SubjectLift.alphaBounds(IntArray(6), 3, 2))
        assertEquals(78f / 80f, SubjectLift.transparentShare(px), 1e-6f)
    }

    @Test fun liftedPngIsTransparentOutsideTheSubject() {
        // opaque photo (no alpha channel) like a camera JPEG: the cutout must still carry real transparency
        val src = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888); src.eraseColor(Color.BLUE); src.setHasAlpha(false)
        val bytes = ByteArrayOutputStream().also { src.compress(Bitmap.CompressFormat.JPEG, 95, it) }.toByteArray()
        val seg = SubjectLift.Segmenter { s -> FloatArray(s.width * s.height) { i -> val x = i % s.width; val y = i / s.width; if ((x - 50) * (x - 50) + (y - 50) * (y - 50) < 400) 1f else 0f } }
        val dir = File(ctx.cacheDir, "jobs-test"); val r = SubjectLift.run(bytes, 2048, dir, seg)
        assertTrue(r.toString(), r.getBoolean("ok"))
        val out = BitmapFactory.decodeFile(File(dir, r.getString("file")).absolutePath)
        assertTrue(out.hasAlpha())
        assertEquals(0, Color.alpha(out.getPixel(0, 0)))                         // corner of the box = background, cut away
        assertEquals(255, Color.alpha(out.getPixel(out.width / 2, out.height / 2)))
        assertTrue(Color.blue(out.getPixel(out.width / 2, out.height / 2)) > 200)  // subject keeps the photo colour
        assertTrue(out.width < 100 && out.height < 100)
    }
}
