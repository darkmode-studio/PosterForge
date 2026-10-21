package com.sandeep.posterforge

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import kotlin.random.Random

/** Native imaging: pure algorithms + real Android bitmap decode/encode (Robolectric native graphics). */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class ImagingTest {
    private fun disc(w: Int, h: Int, bg: Int, fg: Int, hole: Boolean = true): IntArray {
        val px = IntArray(w * h) { bg }
        for (y in 0 until h) for (x in 0 until w) {
            val d = Math.hypot(x - w / 2.0, y - h / 2.0)
            if (d < w * 0.3) px[y * w + x] = fg
            if (hole && d < w * 0.1) px[y * w + x] = bg
        }
        return px
    }

    @Test fun cutoutRemovesEdgeBackgroundKeepsEnclosedHole() {
        val w = 200; val h = 200
        val r = ImageOps.cutout(disc(w, h, Color.WHITE, Color.rgb(200, 0, 0)), w, h, 45, 10)
        assertEquals(0, r.pixels[5 * w + 5] ushr 24)            // corner background removed
        assertEquals(255, r.pixels[100 * w + 100] ushr 24)      // enclosed white hole kept (not reachable from edge)
        assertEquals(255, r.pixels[100 * w + 55] ushr 24)       // subject kept
        assertTrue(r.removedRatio in 0.6f..0.8f)
    }

    @Test fun filtersBehave() {
        val px = IntArray(4) { Color.rgb(100, 150, 200) }
        val gray = ImageOps.filter(px, 2, 2, ImageOps.Filter(grayscale = true))
        assertTrue(gray.all { Color.red(it) == Color.green(it) && Color.green(it) == Color.blue(it) })
        val bright = ImageOps.filter(px, 2, 2, ImageOps.Filter(brightness = 40))
        assertTrue(Color.red(bright[0]) > 100 && Color.blue(bright[0]) > 200)
        val desat = ImageOps.filter(px, 2, 2, ImageOps.Filter(saturation = -100))
        assertEquals(Color.red(desat[0]).toFloat(), Color.blue(desat[0]).toFloat(), 1f)
        val warm = ImageOps.filter(px, 2, 2, ImageOps.Filter(warmth = 50))
        assertTrue(Color.red(warm[0]) > 100 && Color.blue(warm[0]) < 200)
        assertTrue(ImageOps.Filter().isIdentity)
        // blur spreads a single bright pixel and keeps alpha
        val one = IntArray(21 * 21) { Color.BLACK }; one[10 * 21 + 10] = Color.WHITE
        val bl = ImageOps.filter(one, 21, 21, ImageOps.Filter(blur = 3))
        assertTrue(Color.red(bl[10 * 21 + 12]) > 0 && Color.red(bl[10 * 21 + 10]) < 255 && bl.all { it ushr 24 == 255 })
    }

    @Test fun cancellationStopsWork() {
        val w = 1000; val h = 1000
        try { ImageOps.filter(IntArray(w * h) { Color.GRAY }, w, h, ImageOps.Filter(brightness = 5), cancelled = { true }); fail() } catch (_: ImageOps.Cancelled) {}
    }

    @Test fun traceProducesPathsWithHoles() {
        val w = 120; val h = 120
        val svg = ImageOps.trace(disc(w, h, Color.WHITE, Color.rgb(20, 60, 200)), w, h, 2)
        assertTrue(svg.startsWith("<svg") && svg.endsWith("</svg>"))
        val paths = Regex("<path [^>]*d=\"([^\"]+)\"").findAll(svg).map { it.groupValues[1] }.toList()
        assertEquals(2, paths.size)
        // blue ring: outer contour + hole = 2 subpaths; simplified well below the raw staircase vertex count
        val blue = Regex("fill=\"#14..c8\"[^>]*d=\"([^\"]+)\"").find(svg)!!.groupValues[1]
        assertEquals(2, blue.count { it == 'M' })
        assertTrue(blue.count { it == 'L' } < 300)
        assertFalse(svg.contains("script"))
    }

    @Test fun rdpKeepsSquareCorners() {
        val xs = doubleArrayOf(0.0, 5.0, 10.0, 10.0, 10.0, 5.0, 0.0, 0.0); val ys = doubleArrayOf(0.0, 0.0, 0.0, 5.0, 10.0, 10.0, 10.0, 5.0)
        assertEquals(4, ImageOps.rdpClosed(xs, ys, 0.5).size)
    }

    @Test fun sizingAndMemoryBudget() {
        assertEquals(1, ImageOps.sampleSize(2000, 1500, 2048))
        assertEquals(1, ImageOps.sampleSize(4000, 3000, 2048))  // 4000/2 = 2000 < 2048, so decode full then scale
        assertEquals(2, ImageOps.sampleSize(8000, 6000, 2048))
        assertEquals(2048 to 1536, ImageOps.fit(4000, 3000, 2048))
        assertEquals(16_000_000L, ImageOps.maxExportPixels(8L shl 30, true))
        assertEquals(80_000_000L, ImageOps.maxExportPixels(16L shl 30, false))
        assertEquals(4_000_000L, ImageOps.maxExportPixels(50L shl 20, false))
        assertEquals((1500L shl 20) / 24, ImageOps.maxExportPixels(1500L shl 20, false))
    }

    private fun jpeg12mp(): ByteArray {
        val b = Bitmap.createBitmap(4000, 3000, Bitmap.Config.ARGB_8888)
        val c = Canvas(b); c.drawColor(Color.rgb(230, 230, 230))
        val p = Paint().apply { color = Color.rgb(30, 90, 200) }
        c.drawCircle(2000f, 1500f, 1000f, p)
        val out = ByteArrayOutputStream(); b.compress(Bitmap.CompressFormat.JPEG, 90, out); b.recycle()
        return out.toByteArray()
    }

    @Test fun decode12mpToWorkingSize() {
        val bytes = jpeg12mp()
        val d = Jobs.decodeScaled(bytes, 2048)
        assertEquals(2048, d.bitmap.width); assertEquals(1536, d.bitmap.height)
        assertEquals(4000, d.origW); assertEquals(3000, d.origH)
        d.bitmap.recycle()
    }

    @Test fun jobsRunWritesFiles() {
        val dir = Files.createTempDirectory("jobs").toFile()
        val bytes = jpeg12mp()
        val steps = mutableListOf<Float>()
        val r = Jobs.run("cutout", JSONObject().put("maxSide", 800).put("tolerance", 40), bytes, dir, "jtest", { steps += it })
        assertTrue(r.getBoolean("ok")); assertEquals("jtest.png", r.getString("file")); assertEquals(800, r.getInt("w"))
        assertTrue(r.getDouble("removedRatio") > 0.3); assertTrue(steps.last() == 1f)
        val out = BitmapFactory.decodeFile(File(dir, "jtest.png").path)
        assertEquals(0, Color.alpha(out.getPixel(5, 5))); assertEquals(255, Color.alpha(out.getPixel(400, 300)))
        val f = Jobs.run("filter", JSONObject().put("maxSide", 512).put("filter", JSONObject().put("grayscale", true)), bytes, dir, "jf")
        val g = BitmapFactory.decodeFile(File(dir, f.getString("file")).path).getPixel(256, 192)
        assertEquals(Color.red(g).toFloat(), Color.blue(g).toFloat(), 3f)
        val t = Jobs.run("trace", JSONObject().put("maxSide", 300).put("colors", 3), bytes, dir, "jt")
        assertTrue(t.getString("svg").contains("<path"))
        try { Jobs.run("decode", JSONObject(), byteArrayOf(1, 2, 3), dir, "jx"); fail() } catch (_: IllegalArgumentException) {}
    }

    @Test fun stitcherAssemblesTiles() {
        fun tile(w: Int, h: Int, c: Int): ByteArray { val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888); b.eraseColor(c); val o = ByteArrayOutputStream(); b.compress(Bitmap.CompressFormat.PNG, 100, o); return o.toByteArray() }
        val st = Jobs.Stitcher(300, 500)
        st.tile(0, 0, tile(300, 200, Color.RED)); st.tile(0, 200, tile(300, 200, Color.GREEN)); st.tile(0, 400, tile(300, 100, Color.BLUE))
        assertEquals(3, st.tiles)
        assertEquals(Color.RED, st.pixel(10, 199)); assertEquals(Color.GREEN, st.pixel(10, 200)); assertEquals(Color.BLUE, st.pixel(299, 499))
        val f = File.createTempFile("stitch", ".jpg"); st.encode(f, true, 90); st.recycle()
        val back = BitmapFactory.decodeFile(f.path); assertEquals(300, back.width); assertEquals(500, back.height)
    }

    /** Several 12 MP photos through the native pipeline: bounded memory and time on the JVM. */
    @Test fun perfSeveral12mpImages() {
        val rt = Runtime.getRuntime()
        val dir = Files.createTempDirectory("perf").toFile()
        val bytes = jpeg12mp()
        val times = mutableListOf<Long>(); var peak = 0L
        repeat(4) { i ->
            val t0 = System.nanoTime()
            Jobs.run("decode", JSONObject().put("maxSide", 2048), bytes, dir, "d$i")
            Jobs.run("filter", JSONObject().put("maxSide", 2048).put("filter", JSONObject().put("contrast", 20).put("blur", 2)), bytes, dir, "f$i")
            Jobs.run("cutout", JSONObject().put("maxSide", 2048), bytes, dir, "c$i")
            times += (System.nanoTime() - t0) / 1_000_000
            peak = maxOf(peak, rt.totalMemory() - rt.freeMemory())
        }
        val big = IntArray(4000 * 3000) { Random(it).nextInt() or (0xFF shl 24) }
        val t0 = System.nanoTime(); ImageOps.filter(big, 4000, 3000, ImageOps.Filter(brightness = 10, saturation = 20)); val full = (System.nanoTime() - t0) / 1_000_000
        println("PERF decode+filter+cutout per 12MP photo (ms): $times; full-res 12MP filter: ${full}ms; peak JVM heap ${peak shr 20} MB")
        assertTrue("per-photo pipeline too slow: $times", times.drop(1).all { it < 20_000 })
        assertTrue("heap ${peak shr 20}MB", peak < (900L shl 20))
    }
}
