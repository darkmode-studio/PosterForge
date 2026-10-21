package com.sandeep.posterforge

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Pixel algorithms that run natively on background threads (called through NativeBridge jobs).
 * Pure Kotlin on ARGB IntArrays, so they are unit-testable on the JVM and never touch the WebView thread.
 * Every long loop reports progress (0..1) and checks [cancelled].
 */
object ImageOps {
    fun interface Progress { fun at(f: Float) }
    class Cancelled : RuntimeException("Cancelled")

    // ---------------- background cutout (edge flood fill, same behaviour as the JS version) ----------------
    data class CutoutResult(val pixels: IntArray, val removedRatio: Float, val bg: Int)

    fun cutout(src: IntArray, w: Int, h: Int, tolerance: Int, feather: Int, progress: Progress = Progress {}, cancelled: () -> Boolean = { false }): CutoutResult {
        val n = w * h
        val rs = ArrayList<Int>(); val gs = ArrayList<Int>(); val bs = ArrayList<Int>()
        fun sample(x: Int, y: Int) { val c = src[y * w + x]; rs += (c shr 16) and 255; gs += (c shr 8) and 255; bs += c and 255 }
        val sx = max(1, w shr 7); val sy = max(1, h shr 7)
        var x = 0; while (x < w) { sample(x, 0); sample(x, h - 1); x += sx }
        var y = 0; while (y < h) { sample(0, y); sample(w - 1, y); y += sy }
        val R = rs.sorted()[rs.size / 2]; val G = gs.sorted()[gs.size / 2]; val B = bs.sorted()[bs.size / 2]
        val dist = FloatArray(n)
        for (p in 0 until n) { val c = src[p]; dist[p] = hypot(hypot(((c shr 16) and 255) - R.toDouble(), ((c shr 8) and 255) - G.toDouble()), (c and 255) - B.toDouble()).toFloat() }
        progress.at(0.2f)
        val bg = BooleanArray(n); val queue = IntArray(n); var qh = 0; var qt = 0
        fun seed(p: Int) { if (!bg[p] && dist[p] <= tolerance) { bg[p] = true; queue[qt++] = p } }
        for (i in 0 until w) { seed(i); seed((h - 1) * w + i) }
        for (j in 0 until h) { seed(j * w); seed(j * w + w - 1) }
        while (qh < qt) {
            val p = queue[qh++]; val px = p % w
            if (px > 0) seed(p - 1); if (px < w - 1) seed(p + 1)
            if (p >= w) seed(p - w); if (p < w * (h - 1)) seed(p + w)
            if (qh and 0xFFFF == 0) { if (cancelled()) throw Cancelled(); progress.at(0.2f + 0.6f * qh / n) }
        }
        val out = src.copyOf(); var removed = 0
        for (p in 0 until n) {
            if (bg[p]) { out[p] = out[p] and 0x00FFFFFF; removed++; continue }
            if (feather > 0 && dist[p] < tolerance + feather) {
                val px = p % w
                val touches = (px > 0 && bg[p - 1]) || (px < w - 1 && bg[p + 1]) || (p >= w && bg[p - w]) || (p < w * (h - 1) && bg[p + w])
                if (touches) {
                    val a = (out[p] ushr 24)
                    val na = ((dist[p] - tolerance) / feather * a).roundToInt().coerceIn(0, 255)
                    out[p] = (na shl 24) or (out[p] and 0x00FFFFFF)
                }
            }
        }
        progress.at(1f)
        return CutoutResult(out, removed.toFloat() / n, (0xFF shl 24) or (R shl 16) or (G shl 8) or B)
    }

    // ---------------- photo filters ----------------
    data class Filter(val brightness: Int = 0, val contrast: Int = 0, val saturation: Int = 0, val warmth: Int = 0,
                      val blur: Int = 0, val grayscale: Boolean = false, val sepia: Boolean = false, val vignette: Int = 0,
                      val curve: List<FloatArray>? = null, val hsl: Map<String, FloatArray>? = null, val grain: Int = 0) {
        val isIdentity get() = brightness == 0 && contrast == 0 && saturation == 0 && warmth == 0 && blur == 0 && !grayscale && !sepia && vignette == 0 &&
            curve == null && hsl.isNullOrEmpty() && grain == 0
    }

    // ---- v2 colour tools: identical maths to imaging.js ----
    /** Monotone cubic (Fritsch–Carlson) curve through (x, y) points in 0..255. */
    fun curveLUT(points: List<FloatArray>): FloatArray {
        val p = points.map { floatArrayOf(it[0].coerceIn(0f, 255f), it[1].coerceIn(0f, 255f)) }.sortedBy { it[0] }
        val n = p.size; val lut = FloatArray(256) { it.toFloat() }
        if (n < 2) return lut
        val dx = DoubleArray(n - 1); val m = DoubleArray(n - 1); val t = DoubleArray(n)
        for (i in 0 until n - 1) { dx[i] = max(1e-6, (p[i + 1][0] - p[i][0]).toDouble()); m[i] = (p[i + 1][1] - p[i][1]) / dx[i] }
        t[0] = m[0]; t[n - 1] = m[n - 2]
        for (i in 1 until n - 1) t[i] = if (m[i - 1] * m[i] <= 0) 0.0 else (m[i - 1] + m[i]) / 2
        for (i in 0 until n - 1) {
            if (m[i] == 0.0) { t[i] = 0.0; t[i + 1] = 0.0; continue }
            val a = t[i] / m[i]; val b = t[i + 1] / m[i]; val s = a * a + b * b
            if (s > 9) { val k = 3 / sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
        }
        for (xi in 0 until 256) {
            var k = 0; while (k < n - 2 && xi > p[k + 1][0]) k++
            if (xi <= p[0][0]) { lut[xi] = p[0][1]; continue }
            if (xi >= p[n - 1][0]) { lut[xi] = p[n - 1][1]; continue }
            val h = dx[k]; val u = (xi - p[k][0]) / h; val u2 = u * u; val u3 = u2 * u
            lut[xi] = ((2 * u3 - 3 * u2 + 1) * p[k][1] + (u3 - 2 * u2 + u) * h * t[k] + (-2 * u3 + 3 * u2) * p[k + 1][1] + (u3 - u2) * h * t[k + 1]).toFloat()
        }
        return lut
    }
    val HSL_BANDS = listOf("red" to 0f, "orange" to 30f, "yellow" to 60f, "green" to 120f, "aqua" to 180f, "blue" to 235f, "purple" to 285f)
    /** bands: [centre, dHue, dSat, dLum] */
    fun hslBands(hsl: Map<String, FloatArray>): List<FloatArray> = HSL_BANDS.mapNotNull { (k, c) -> hsl[k]?.let { v -> if (v[0] != 0f || v[1] != 0f || v[2] != 0f) floatArrayOf(c, v[0], v[1], v[2]) else null } }
    fun hslAdjust(r0: Float, g0: Float, b0: Float, bands: List<FloatArray>, out: FloatArray) {
        val r = r0.coerceIn(0f, 255f) / 255f; val g = g0.coerceIn(0f, 255f) / 255f; val b = b0.coerceIn(0f, 255f) / 255f
        val mx = max(r, max(g, b)); val mn = min(r, min(g, b)); val l = (mx + mn) / 2; val d = mx - mn
        if (d < 1e-6f) { out[0] = r * 255; out[1] = g * 255; out[2] = b * 255; return }
        val s = if (l > 0.5f) d / (2 - mx - mn) else d / (mx + mn)
        val h = when (mx) { r -> ((g - b) / d + (if (g < b) 6 else 0)) * 60; g -> ((b - r) / d + 2) * 60; else -> ((r - g) / d + 4) * 60 }
        var dh = 0f; var ds = 0f; var dl = 0f
        for (bd in bands) { var dd = abs(h - bd[0]); if (dd > 180) dd = 360 - dd; val w = max(0f, 1 - dd / 45f); if (w > 0) { dh += bd[1] * w; ds += bd[2] * w; dl += bd[3] * w } }
        var h2 = ((h + dh * 0.3f + 360f) % 360f) / 360f
        val s2 = (s * (1 + ds / 100f)).coerceIn(0f, 1f); val l2 = (l + (dl / 100f) * 0.35f * s).coerceIn(0f, 1f)
        val q = if (l2 < 0.5f) l2 * (1 + s2) else l2 + s2 - l2 * s2; val p = 2 * l2 - q
        fun hue(t0: Float): Float { var t = t0; if (t < 0) t += 1; if (t > 1) t -= 1
            return if (t < 1f / 6) p + (q - p) * 6 * t else if (t < 0.5f) q else if (t < 2f / 3) p + (q - p) * (2f / 3 - t) * 6 else p }
        out[0] = hue(h2 + 1f / 3) * 255; out[1] = hue(h2) * 255; out[2] = hue(h2 - 1f / 3) * 255
    }
    fun grainNoise(x: Int, y: Int): Float {
        var h = x * 374761393 + y * 668265263
        h = (h xor (h ushr 13)) * 1274126177; h = h xor (h ushr 16)
        return (h and 0xffff) / 32767.5f - 1f
    }

    fun filter(src: IntArray, w: Int, h: Int, f: Filter, progress: Progress = Progress {}, cancelled: () -> Boolean = { false }, blurScale: Float = 1f): IntArray {
        val out = IntArray(src.size)
        val b = f.brightness * 2.55f
        val c = (100f + f.contrast) / 100f; val cc = c * c
        val s = (100f + f.saturation) / 100f
        val warm = f.warmth * 0.6f
        val cx = w / 2f; val cy = h / 2f; val maxD = sqrt(cx * cx + cy * cy); val vig = f.vignette / 100f
        val lut = f.curve?.let { curveLUT(it) }; val bands = f.hsl?.let { hslBands(it) }?.takeIf { it.isNotEmpty() }
        val grain = f.grain * 0.6f; val cell = max(1, (max(w, h) / 1600f).roundToInt()); val tmp = FloatArray(3)
        for (yy in 0 until h) {
            if (yy and 63 == 0) { if (cancelled()) throw Cancelled(); progress.at(0.7f * yy / h) }
            for (xx in 0 until w) {
                val p = yy * w + xx; val px = src[p]
                var r = ((px shr 16) and 255).toFloat(); var g = ((px shr 8) and 255).toFloat(); var bl = (px and 255).toFloat()
                r += b; g += b; bl += b
                r = (r - 128f) * cc + 128f; g = (g - 128f) * cc + 128f; bl = (bl - 128f) * cc + 128f
                val l = 0.299f * r + 0.587f * g + 0.114f * bl
                r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s
                r += warm; bl -= warm
                if (lut != null) { r = lut[clamp(r)]; g = lut[clamp(g)]; bl = lut[clamp(bl)] }
                if (bands != null) { hslAdjust(r, g, bl, bands, tmp); r = tmp[0]; g = tmp[1]; bl = tmp[2] }
                if (f.grayscale) { val gg = 0.299f * r + 0.587f * g + 0.114f * bl; r = gg; g = gg; bl = gg }
                if (f.sepia) { val rr = 0.393f * r + 0.769f * g + 0.189f * bl; val g2 = 0.349f * r + 0.686f * g + 0.168f * bl; val b2 = 0.272f * r + 0.534f * g + 0.131f * bl; r = rr; g = g2; bl = b2 }
                if (vig > 0f) { val d = hypot(xx - cx, yy - cy) / maxD; val k = 1f - vig * d * d; r *= k; g *= k; bl *= k }
                if (grain > 0f) { val nz = grainNoise(xx / cell, yy / cell) * grain; r += nz; g += nz; bl += nz }
                out[p] = (px and -0x1000000) or (clamp(r) shl 16) or (clamp(g) shl 8) or clamp(bl)
            }
        }
        val radius = (f.blur * blurScale).roundToInt()
        if (radius > 0) { repeat(3) { boxBlur(out, w, h, radius) }; }
        progress.at(1f)
        return out
    }

    private fun clamp(v: Float) = if (v < 0f) 0 else if (v > 255f) 255 else v.toInt()

    /** Separable box blur on all four channels (3 passes ~ gaussian). */
    fun boxBlur(px: IntArray, w: Int, h: Int, r: Int) {
        val tmp = IntArray(px.size)
        pass(px, tmp, w, h, r, true); pass(tmp, px, w, h, r, false)
    }
    private fun pass(src: IntArray, dst: IntArray, w: Int, h: Int, r: Int, horiz: Boolean) {
        val len = if (horiz) w else h; val lines = if (horiz) h else w
        val win = 2 * r + 1
        for (line in 0 until lines) {
            var sa = 0; var sr = 0; var sg = 0; var sb = 0
            fun idx(i: Int): Int { val k = i.coerceIn(0, len - 1); return if (horiz) line * w + k else k * w + line }
            for (i in -r..r) { val c = src[idx(i)]; sa += c ushr 24; sr += (c shr 16) and 255; sg += (c shr 8) and 255; sb += c and 255 }
            for (i in 0 until len) {
                dst[idx(i)] = ((sa / win) shl 24) or ((sr / win) shl 16) or ((sg / win) shl 8) or (sb / win)
                val o = src[idx(i - r)]; val n = src[idx(i + r + 1)]
                sa += (n ushr 24) - (o ushr 24); sr += ((n shr 16) and 255) - ((o shr 16) and 255)
                sg += ((n shr 8) and 255) - ((o shr 8) and 255); sb += (n and 255) - (o and 255)
            }
        }
    }

    // ---------------- raster -> vector tracing ----------------
    /**
     * Colour-quantises (k-means), then traces every colour region's exact pixel boundary (outer edges and holes),
     * simplifies the outlines (Ramer-Douglas-Peucker) and emits an SVG with one evenodd path per colour.
     */
    fun trace(src: IntArray, w: Int, h: Int, colors: Int, progress: Progress = Progress {}, cancelled: () -> Boolean = { false },
              epsilon: Double = 0.9, minArea: Int = 6): String {
        val k = colors.coerceIn(2, 24)
        val n = w * h
        // k-means on a sample of opaque pixels
        val opaque = IntArray(n).let { var m = 0; for (p in 0 until n) if ((src[p] ushr 24) >= 128) it[m++] = p; it.copyOf(m) }
        if (opaque.isEmpty()) return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 $w $h\" width=\"$w\" height=\"$h\"></svg>"
        val step = max(1, opaque.size / 20000)
        val cr = FloatArray(k); val cg = FloatArray(k); val cb = FloatArray(k)
        for (i in 0 until k) { val c = src[opaque[(i.toLong() * (opaque.size - 1) / max(1, k - 1)).toInt()]]; cr[i] = ((c shr 16) and 255).toFloat(); cg[i] = ((c shr 8) and 255).toFloat(); cb[i] = (c and 255).toFloat() }
        repeat(10) { iter ->
            val sr = DoubleArray(k); val sg = DoubleArray(k); val sb = DoubleArray(k); val cnt = IntArray(k)
            var i = 0
            while (i < opaque.size) { val c = src[opaque[i]]; val j = nearest(c, cr, cg, cb); sr[j] += ((c shr 16) and 255).toDouble(); sg[j] += ((c shr 8) and 255).toDouble(); sb[j] += (c and 255).toDouble(); cnt[j]++; i += step }
            for (j in 0 until k) if (cnt[j] > 0) { cr[j] = (sr[j] / cnt[j]).toFloat(); cg[j] = (sg[j] / cnt[j]).toFloat(); cb[j] = (sb[j] / cnt[j]).toFloat() }
            if (cancelled()) throw Cancelled(); progress.at(0.03f * (iter + 1))
        }
        val label = IntArray(n) { -1 }
        for (p in opaque) label[p] = nearest(src[p], cr, cg, cb)
        // one majority pass removes single-pixel speckle
        val lab2 = label.copyOf()
        for (yy in 1 until h - 1) for (xx in 1 until w - 1) {
            val p = yy * w + xx; val l = label[p]
            val a = label[p - 1]; val b = label[p + 1]; val c = label[p - w]; val d = label[p + w]
            if (a != l && a == b && a == c && a == d) lab2[p] = a
        }
        val counts = IntArray(k); for (l in lab2) if (l >= 0) counts[l]++
        val order = (0 until k).filter { counts[it] > 0 }.sortedByDescending { counts[it] }
        progress.at(0.35f)
        val sb = StringBuilder("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 $w $h\" width=\"$w\" height=\"$h\">")
        val W1 = w + 1
        val outA = IntArray(W1 * (h + 1)) { -1 }; val outB = IntArray(W1 * (h + 1)) { -1 }
        val touched = IntArray(4 * n + 4); 
        order.forEachIndexed { oi, colour ->
            if (cancelled()) throw Cancelled()
            var tn = 0
            fun inside(xx: Int, yy: Int) = xx in 0 until w && yy in 0 until h && lab2[yy * w + xx] == colour
            fun add(from: Int, to: Int) { if (outA[from] == -1) { outA[from] = to; touched[tn++] = from } else outB[from] = to }
            for (yy in 0 until h) for (xx in 0 until w) {
                if (lab2[yy * w + xx] != colour) continue
                val v = yy * W1 + xx
                if (!inside(xx, yy - 1)) add(v, v + 1)                // top: left -> right
                if (!inside(xx + 1, yy)) add(v + 1, v + 1 + W1)       // right: top -> bottom
                if (!inside(xx, yy + 1)) add(v + 1 + W1, v + W1)      // bottom: right -> left
                if (!inside(xx - 1, yy)) add(v + W1, v)               // left: bottom -> top
            }
            val path = StringBuilder()
            for (t in 0 until tn) {
                val start = touched[t]
                while (outA[start] != -1 || outB[start] != -1) {
                    val pts = ArrayList<Int>(); var cur = start; var prev = -1
                    do {
                        pts += cur
                        val nxt: Int
                        if (outA[cur] != -1 && outB[cur] != -1 && prev != -1) {
                            // saddle: keep regions 4-connected by turning right relative to the incoming direction
                            val dIn = dir(prev, cur, W1); val dA = dir(cur, outA[cur], W1)
                            nxt = if (dA == (dIn + 1) % 4) outA[cur].also { outA[cur] = outB[cur]; outB[cur] = -1 } else outB[cur].also { outB[cur] = -1 }
                        } else if (outA[cur] != -1) { nxt = outA[cur]; outA[cur] = outB[cur]; outB[cur] = -1 }
                        else if (outB[cur] != -1) { nxt = outB[cur]; outB[cur] = -1 }
                        else break
                        prev = cur; cur = nxt
                    } while (cur != start)
                    if (pts.size < 4) continue
                    val xs = DoubleArray(pts.size) { (pts[it] % W1).toDouble() }; val ys = DoubleArray(pts.size) { (pts[it] / W1).toDouble() }
                    if (abs(polyArea(xs, ys)) < minArea) continue
                    val keep = rdpClosed(xs, ys, epsilon)
                    if (keep.size < 3) continue
                    path.append('M').append(fmt(xs[keep[0]])).append(' ').append(fmt(ys[keep[0]]))
                    for (i in 1 until keep.size) path.append('L').append(fmt(xs[keep[i]])).append(' ').append(fmt(ys[keep[i]]))
                    path.append('Z')
                }
            }
            for (t in 0 until tn) { outA[touched[t]] = -1; outB[touched[t]] = -1 }
            if (path.isNotEmpty()) {
                val hex = String.format("#%02x%02x%02x", cr[colour].roundToInt().coerceIn(0, 255), cg[colour].roundToInt().coerceIn(0, 255), cb[colour].roundToInt().coerceIn(0, 255))
                sb.append("<path fill=\"").append(hex).append("\" stroke=\"").append(hex).append("\" stroke-width=\"0.6\" stroke-linejoin=\"round\" fill-rule=\"evenodd\" d=\"").append(path).append("\"/>")
            }
            progress.at(0.35f + 0.65f * (oi + 1) / order.size)
        }
        return sb.append("</svg>").toString()
    }

    private fun dir(a: Int, b: Int, W1: Int): Int = when (b - a) { 1 -> 0; W1 -> 1; -1 -> 2; else -> 3 } // E,S,W,N (clockwise)
    private fun nearest(c: Int, cr: FloatArray, cg: FloatArray, cb: FloatArray): Int {
        val r = (c shr 16) and 255; val g = (c shr 8) and 255; val b = c and 255
        var best = 0; var bd = Float.MAX_VALUE
        for (j in cr.indices) { val dr = r - cr[j]; val dg = g - cg[j]; val db = b - cb[j]; val d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = j } }
        return best
    }
    private fun fmt(v: Double) = if (v == v.toLong().toDouble()) v.toLong().toString() else String.format("%.1f", v)
    fun polyArea(xs: DoubleArray, ys: DoubleArray): Double { var a = 0.0; for (i in xs.indices) { val j = (i + 1) % xs.size; a += xs[i] * ys[j] - xs[j] * ys[i] }; return a / 2 }

    /** RDP on a closed ring: split at the point farthest from point 0, simplify both halves. */
    fun rdpClosed(xs: DoubleArray, ys: DoubleArray, eps: Double): List<Int> {
        val n = xs.size
        var far = 0; var fd = -1.0
        for (i in 1 until n) { val d = hypot(xs[i] - xs[0], ys[i] - ys[0]); if (d > fd) { fd = d; far = i } }
        val keep = BooleanArray(n); keep[0] = true; keep[far] = true
        rdp(xs, ys, 0, far, eps, keep); rdpWrap(xs, ys, far, n, eps, keep)
        return (0 until n).filter { keep[it] }
    }
    private fun rdp(xs: DoubleArray, ys: DoubleArray, a: Int, b: Int, eps: Double, keep: BooleanArray) {
        if (b - a < 2) return
        var idx = -1; var md = 0.0
        for (i in a + 1 until b) { val d = segDist(xs[i], ys[i], xs[a], ys[a], xs[b], ys[b]); if (d > md) { md = d; idx = i } }
        if (md > eps && idx > 0) { keep[idx] = true; rdp(xs, ys, a, idx, eps, keep); rdp(xs, ys, idx, b, eps, keep) }
    }
    private fun rdpWrap(xs: DoubleArray, ys: DoubleArray, a: Int, n: Int, eps: Double, keep: BooleanArray) {
        // segment from a to n (== point 0)
        if (n - a < 2) return
        var idx = -1; var md = 0.0
        for (i in a + 1 until n) { val d = segDist(xs[i], ys[i], xs[a], ys[a], xs[0], ys[0]); if (d > md) { md = d; idx = i } }
        if (md > eps && idx > 0) { keep[idx] = true; rdp(xs, ys, a, idx, eps, keep); rdpWrap(xs, ys, idx, n, eps, keep) }
    }
    private fun segDist(px: Double, py: Double, ax: Double, ay: Double, bx: Double, by: Double): Double {
        val dx = bx - ax; val dy = by - ay; val l2 = dx * dx + dy * dy
        if (l2 == 0.0) return hypot(px - ax, py - ay)
        val t = (((px - ax) * dx + (py - ay) * dy) / l2).coerceIn(0.0, 1.0)
        return hypot(px - (ax + t * dx), py - (ay + t * dy))
    }

    // ---------------- sizing / memory ----------------
    /** Largest power-of-two sample size that keeps the decoded image at least [maxSide] on its long side. */
    fun sampleSize(w: Int, h: Int, maxSide: Int): Int { var s = 1; while (max(w, h) / (s * 2) >= maxSide) s *= 2; return s }
    fun fit(w: Int, h: Int, maxSide: Int): Pair<Int, Int> { val k = min(1.0, maxSide.toDouble() / max(w, h)); return max(1, (w * k).roundToInt()) to max(1, (h * k).roundToInt()) }

    /**
     * Export pixel budget: the stitched ARGB bitmap needs 4 bytes/pixel plus about the same again while compressing.
     * Use at most a third of what the system reports as available, never more than 80 MP.
     */
    fun maxExportPixels(availBytes: Long, lowMemory: Boolean): Long {
        val budget = availBytes / 3 / 8
        val cap = if (lowMemory) 16_000_000L else 80_000_000L
        return budget.coerceIn(4_000_000L, cap)
    }
}
