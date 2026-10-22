// Image processing front-end: runs the native (Kotlin, background thread) job when the Android bridge is present,
// otherwise the JS fallback below. Results are always returned as blob: URLs so history/persistence work unchanged.
import { hasJobs, nativeJob, releaseJobURL } from './native.js';
import { cutoutCanvas, traceCanvasToSVG, canvasToBlob } from './tools.js';

export const WORK_SIDE = 2048; // working size of photos on the canvas (originals are kept for export)

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Decodes a Blob, fitted to maxSide, without ever drawing it full-size where the browser can avoid it. */
export async function decodeFitted(blob, maxSide) {
  let bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  if (k < 1) { const tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k)); bmp.close(); bmp = await createImageBitmap(blob, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' }); }
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
  return { canvas: c, origW: w, origH: h };
}

/** Same maths as ImageOps.filter in Kotlin (kept in step so web preview == native result). */
export function filterCanvas(src, f, blurScale = 1) {
  const w = src.width, h = src.height;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d'); ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, w, h); const d = id.data;
  const b = (f.brightness || 0) * 2.55, c = (100 + (f.contrast || 0)) / 100, cc = c * c, s = (100 + (f.saturation || 0)) / 100, warm = (f.warmth || 0) * 0.6;
  const cx = w / 2, cy = h / 2, maxD = Math.hypot(cx, cy), vig = (f.vignette || 0) / 100;
  const lut = f.curve ? curveLUT(f.curve) : null, bands = f.hsl ? hslBands(f.hsl) : null, grain = (f.grain || 0) * 0.6, cell = Math.max(1, Math.round(Math.max(w, h) / 1600));
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    let r = d[i] + b, g = d[i + 1] + b, bl = d[i + 2] + b;
    r = (r - 128) * cc + 128; g = (g - 128) * cc + 128; bl = (bl - 128) * cc + 128;
    const l = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s;
    r += warm; bl -= warm;
    if (lut) { r = lut[clamp255(r)]; g = lut[clamp255(g)]; bl = lut[clamp255(bl)]; }
    if (bands) { const o3 = hslAdjust(r, g, bl, bands); r = o3[0]; g = o3[1]; bl = o3[2]; }
    if (f.grayscale) { const gg = 0.299 * r + 0.587 * g + 0.114 * bl; r = g = bl = gg; }
    if (f.sepia) { const rr = 0.393 * r + 0.769 * g + 0.189 * bl, g2 = 0.349 * r + 0.686 * g + 0.168 * bl, b2 = 0.272 * r + 0.534 * g + 0.131 * bl; r = rr; g = g2; bl = b2; }
    if (vig > 0) { const dd = Math.hypot(x - cx, y - cy) / maxD; const k = 1 - vig * dd * dd; r *= k; g *= k; bl *= k; }
    if (grain > 0) { const n = grainNoise((x / cell) | 0, (y / cell) | 0) * grain; r += n; g += n; bl += n; }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl;
  }
  if (f.sharpen > 0) sharpenData(d, w, h, f.sharpen, cell);
  ctx.putImageData(id, 0, 0);
  const rad = Math.round((f.blur || 0) * blurScale);
  if (rad > 0) { const t = document.createElement('canvas'); t.width = w; t.height = h; const tc = t.getContext('2d'); tc.filter = `blur(${rad * 1.6}px)`; tc.drawImage(out, 0, 0); return t; }
  return out;
}
/** Unsharp mask, identical to ImageOps.sharpen in Kotlin (one separable box-blur pass, integer division). */
export function sharpenData(d, w, h, amount, r) {
  const n = w * h, bl = new Uint8ClampedArray(d), tmp = new Uint8ClampedArray(d.length), win = 2 * r + 1;
  const pass = (src, dst, horiz) => {
    const len = horiz ? w : h, lines = horiz ? h : w;
    const idx = (line, i) => { const k = i < 0 ? 0 : i >= len ? len - 1 : i; return (horiz ? line * w + k : k * w + line) * 4; };
    for (let line = 0; line < lines; line++) for (let ch = 0; ch < 4; ch++) {
      let s = 0; for (let i = -r; i <= r; i++) s += src[idx(line, i) + ch];
      for (let i = 0; i < len; i++) { dst[idx(line, i) + ch] = (s / win) | 0; s += src[idx(line, i + r + 1) + ch] - src[idx(line, i - r) + ch]; }
    }
  };
  pass(bl, tmp, true); pass(tmp, bl, false);
  const k = amount / 100 * 1.5;
  for (let i = 0; i < n * 4; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + k * (d[i + c] - bl[i + c]));
}
// ---- v2 colour tools (kept identical to ImageOps.kt) ----
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
/** Monotone cubic (Fritsch–Carlson) curve through points [[x,y],...] in 0..255 -> 256-entry LUT. */
export function curveLUT(pts) {
  const p = pts.map(([x, y]) => [Math.max(0, Math.min(255, x)), Math.max(0, Math.min(255, y))]).sort((a, b) => a[0] - b[0]);
  const n = p.length; const lut = new Float32Array(256);
  if (n < 2) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  const dx = [], m = [], t = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { dx[i] = Math.max(1e-6, p[i + 1][0] - p[i][0]); m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; } const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b; if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; } }
  for (let xi = 0; xi < 256; xi++) {
    let k = 0; while (k < n - 2 && xi > p[k + 1][0]) k++;
    if (xi <= p[0][0]) { lut[xi] = p[0][1]; continue; } if (xi >= p[n - 1][0]) { lut[xi] = p[n - 1][1]; continue; }
    const h = dx[k], u = (xi - p[k][0]) / h, u2 = u * u, u3 = u2 * u;
    lut[xi] = (2 * u3 - 3 * u2 + 1) * p[k][1] + (u3 - 2 * u2 + u) * h * t[k] + (-2 * u3 + 3 * u2) * p[k + 1][1] + (u3 - u2) * h * t[k + 1];
  }
  return lut;
}
export const HSL_BANDS = [['red', 0], ['orange', 30], ['yellow', 60], ['green', 120], ['aqua', 180], ['blue', 235], ['purple', 285]];
function hslBands(hsl) { return HSL_BANDS.map(([k, c]) => [c, ...((hsl[k] || [0, 0, 0]).map(Number))]).filter((b) => b[1] || b[2] || b[3]); }
export function hslAdjust(r, g, b, bands) {
  r = Math.max(0, Math.min(255, r)) / 255; g = Math.max(0, Math.min(255, g)) / 255; b = Math.max(0, Math.min(255, b)) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0; const l = (mx + mn) / 2, d = mx - mn;
  if (d < 1e-6) return [r * 255, g * 255, b * 255];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60; else if (mx === g) h = ((b - r) / d + 2) * 60; else h = ((r - g) / d + 4) * 60;
  let dh = 0, ds = 0, dl = 0;
  for (const [c, bh, bs, bl] of bands) { let dd = Math.abs(h - c); if (dd > 180) dd = 360 - dd; const wgt = Math.max(0, 1 - dd / 45); if (wgt > 0) { dh += bh * wgt; ds += bs * wgt; dl += bl * wgt; } }
  let h2 = (h + dh * 0.3 + 360) % 360; const s2 = Math.max(0, Math.min(1, s * (1 + ds / 100))); const l2 = Math.max(0, Math.min(1, l + (dl / 100) * 0.35 * s));
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2, p = 2 * l2 - q; h2 /= 360;
  const hue = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [hue(h2 + 1 / 3) * 255, hue(h2) * 255, hue(h2 - 1 / 3) * 255];
}
/** Deterministic grain in [-1, 1] (integer hash, same in Kotlin). */
export function grainNoise(x, y) {
  let hsh = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
  hsh = Math.imul(hsh ^ (hsh >>> 13), 1274126177); hsh ^= hsh >>> 16;
  return ((hsh & 0xffff) / 32767.5) - 1;
}
export const isIdentityFilter = (f) => !f || !Object.entries(f).some(([k, v]) => (typeof v === 'boolean' ? v : (v && typeof v === 'object') ? true : Number(v) !== 0));

/** JS implementation of every job (browser fallback; also what the test bridge mock calls). */
export async function jsJob(kind, blob, p = {}, onProgress = () => {}) {
  onProgress(0.05); await tick();
  const { canvas, origW, origH } = await decodeFitted(blob, p.maxSide || WORK_SIDE);
  onProgress(0.3); await tick();
  const base = { ok: true, w: canvas.width, h: canvas.height, origW, origH };
  const toURL = async (c, png) => URL.createObjectURL(await canvasToBlob(c, png ? 'image/png' : 'image/jpeg', (p.quality || 92) / 100));
  let r;
  if (kind === 'decode') r = { ...base, url: await toURL(canvas, p.format === 'png') };
  else if (kind === 'cutout') { const c = cutoutCanvas(canvas, p.tolerance ?? 45, p.feather ?? 12); r = { ...base, url: await toURL(c.canvas, true), removedRatio: c.removedRatio, bgColor: c.bgColor }; }
  else if (kind === 'filter') r = { ...base, url: await toURL(filterCanvas(canvas, p.filter || {}, p.blurScale || 1), p.format === 'png') };
  else if (kind === 'trace') r = { ...base, svg: traceCanvasToSVG(canvas, p.colors || 8) };
  else r = { ok: false, error: 'Unknown job ' + kind };
  onProgress(1);
  return r;
}

/**
 * Runs a job (native when available). Image results come back as blob: URLs; native job files are released.
 * opts: { onProgress, signal }
 */
export async function processImage(kind, blob, params, opts = {}) {
  if (!hasJobs()) return jsJob(kind, blob, params, opts.onProgress);
  const r = await nativeJob(kind, blob, params, opts);
  if (r.ok && r.url && !r.url.startsWith('blob:')) {
    const b = await (await fetch(r.url)).blob();
    releaseJobURL(r.url);
    r.url = URL.createObjectURL(b);
  }
  return r;
}
export const urlToBlob = async (u) => (await fetch(u)).blob();
