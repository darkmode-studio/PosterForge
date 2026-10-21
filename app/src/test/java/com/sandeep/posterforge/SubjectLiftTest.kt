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
        val o = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888); o.eraseColor(Color.TRANSPARENT)
        for (y in 30 until 70) for (x in 20 until 60) o.setPixel(x, y, Color.RED); o }

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
        val empty = SubjectLift.run(png(60, 60), 2048, dir) { s -> Bitmap.createBitmap(s.width, s.height, Bitmap.Config.ARGB_8888) }
        assertEquals("no_subject", empty.getString("code"))
        val gps = SubjectLift.run(png(60, 60), 2048, dir) { throw SubjectLift.Unavailable("no_play_services", "needs Play services") }
        assertEquals("no_play_services", gps.getString("code")); assertEquals("needs Play services", gps.getString("error"))
        val bad = SubjectLift.run(byteArrayOf(1, 2, 3), 2048, dir, rectSeg)
        assertEquals("bad_image", bad.getString("code"))
    }

    @Test fun runScalesBigPhotosDown() {
        val r = SubjectLift.run(png(3000, 1500), 1000, File(ctx.cacheDir, "jobs-test")) { s -> assertTrue(s.width <= 1000); rectSeg.foreground(s) }
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
}
