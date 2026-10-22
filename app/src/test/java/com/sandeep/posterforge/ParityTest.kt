package com.sandeep.posterforge

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 2.0 colour maths: values must match js/imaging.js exactly (vectors produced by the browser test, e2e_v2.py). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ParityTest {
    @Test fun curveLutMatchesJs() {
        val lut = ImageOps.curveLUT(listOf(floatArrayOf(0f, 0f), floatArrayOf(64f, 48f), floatArrayOf(128f, 128f), floatArrayOf(192f, 208f), floatArrayOf(255f, 255f)))
        assertEquals(22.0, lut[32].toDouble(), 0.01)
        assertEquals(91.27734375, lut[100].toDouble(), 0.01)
        assertEquals(215.50466918945312, lut[200].toDouble(), 0.01)
        assertEquals(0.0, lut[0].toDouble(), 1e-4); assertEquals(255.0, lut[255].toDouble(), 1e-4)
        for (i in 1 until 256) assertTrue("monotone at $i", lut[i] >= lut[i - 1])
    }
    @Test fun hslAdjustMatchesJs() {
        val out = FloatArray(3)
        ImageOps.hslAdjust(220f, 120f, 40f, listOf(floatArrayOf(30f, 20f, 30f, 10f)), out)
        assertEquals(245.48, out[0].toDouble(), 0.05); assertEquals(144.06, out[1].toDouble(), 0.05); assertEquals(26.42, out[2].toDouble(), 0.05)
    }
    @Test fun grainNoiseMatchesJs() {
        assertEquals(0.20979629205767902, ImageOps.grainNoise(3, 7).toDouble(), 1e-5)
        assertEquals(0.5631342030975814, ImageOps.grainNoise(1000, 2000).toDouble(), 1e-5)
    }
    @Test fun filterFromJsonReadsNewKeys() {
        val f = filterFromJson(JSONObject("""{"brightness":5,"curve":[[0,0],[128,150],[255,255]],"hsl":{"orange":[10,-20,5],"blue":[0,0,0]},"grain":30}"""))
        assertEquals(5, f.brightness); assertEquals(3, f.curve!!.size); assertEquals(150f, f.curve!![1][1], 0f)
        assertEquals(30, f.grain); assertEquals(-20f, f.hsl!!["orange"]!![1], 0f)
        assertFalse(f.isIdentity)
        assertEquals(1, ImageOps.hslBands(f.hsl!!).size)
        assertTrue(filterFromJson(JSONObject("{}")).isIdentity)
    }
    /** 2.3 sharpen: identical to imaging.js sharpenData (vector produced by node on the same 8x4 image). */
    @Test fun sharpenMatchesJs() {
        val w = 8; val h = 4; val px = IntArray(w * h)
        for (y in 0 until h) for (x in 0 until w) px[y * w + x] = (255 shl 24) or ((if (x < 4) 100 else 180) shl 16) or (((x * 30 + y * 10) % 256) shl 8) or 50
        ImageOps.sharpen(px, w, h, 60, 1)
        val exp = intArrayOf(100,0,50,100,27,50,100,57,50,76,87,50,204,117,50,180,147,50,180,177,50,180,216,50,100,1,50,100,40,50,100,70,50,76,100,50,204,130,50,180,160,50,180,190,50,180,229,50,100,11,50,100,50,50,100,80,50,76,110,50,204,140,50,180,170,50,180,200,50,180,239,50,100,24,50,100,63,50,100,93,50,76,123,50,204,153,50,180,183,50,180,213,50,180,252,50)
        for (i in 0 until w * h) {
            assertEquals("r$i", exp[i * 3], (px[i] shr 16) and 255); assertEquals("g$i", exp[i * 3 + 1], (px[i] shr 8) and 255); assertEquals("b$i", exp[i * 3 + 2], px[i] and 255)
        }
        assertEquals(40, filterFromJson(JSONObject("""{"sharpen":40}""")).sharpen)
        assertFalse(filterFromJson(JSONObject("""{"sharpen":40}""")).isIdentity)
    }
}
