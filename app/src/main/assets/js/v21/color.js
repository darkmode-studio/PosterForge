// 2.1 colour maths: WCAG contrast, HSL, harmonies, palette of the photo, and sampling the area under a text layer.
import { extractPalette } from '../tools.js';

export function parseHex(h) {
  if (!h || typeof h !== 'string') return null;
  let s = h.trim();
  const m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i); if (m) return [+m[1], +m[2], +m[3]].map((v) => Math.max(0, Math.min(255, Math.round(v))));
  if (s[0] === '#') s = s.slice(1);
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}/i.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
export const toHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** WCAG 2.x relative luminance */
export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const A = typeof a === 'string' ? parseHex(a) : a, B = typeof b === 'string' ? parseHex(b) : b;
  const l1 = luminance(A), l2 = luminance(B); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, s, l];
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360 / 360; if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const hsl = (hex) => rgbToHsl(parseHex(hex));
const fromHsl = (h, s, l) => toHex(hslToRgb([h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l))]));

/** Harmony suggestions from a base colour. mode: complementary | analogous | monochrome | accent */
export function harmony(base, mode) {
  const [h, s, l] = hsl(base); const S = Math.max(s, 0.35);
  if (mode === 'complementary') return [fromHsl(h + 180, S, 0.85), fromHsl(h + 180, S, 0.6), fromHsl(h + 180, S, 0.3), fromHsl(h + 150, S, 0.7), fromHsl(h + 210, S, 0.7)];
  if (mode === 'analogous') return [fromHsl(h - 30, S, 0.8), fromHsl(h + 30, S, 0.8), fromHsl(h - 30, S, 0.35), fromHsl(h + 30, S, 0.35), fromHsl(h, s, l > 0.5 ? 0.15 : 0.92)];
  if (mode === 'monochrome') return [0.95, 0.82, 0.65, 0.35, 0.18, 0.08].map((L) => fromHsl(h, Math.min(s, 0.6), L));
  // accent: one bold, saturated pop (like the yellow cinematic caption) + neutrals
  return [fromHsl(h + 180, 1, 0.55), fromHsl(52, 1, 0.52), fromHsl(h + 180, 0.95, 0.65), '#ffffff', '#0b0b0b'];
}
export const HARMONIES = [['complementary', 'Complementary'], ['analogous', 'Analogous'], ['monochrome', 'Monochrome'], ['accent', 'Accent']];

export const QUOTE_PALETTES = [
  { name: 'Cinematic', main: '#FFD60A', second: '#F5F5F5', bg: '#0B0B0B' },
  { name: 'Film', main: '#F5EFE6', second: '#A39E96', bg: '#3A3632' },
  { name: 'Sea', main: '#FFFFFF', second: '#0B4F6C', bg: '#0B4F6C' },
  { name: 'Sunset', main: '#FFB38A', second: '#3D1E3D', bg: '#3D1E3D' },
  { name: 'Minimal', main: '#111111', second: '#FAF8F5', bg: '#FAF8F5' },
  { name: 'Gold', main: '#D4AF37', second: '#F7E7B4', bg: '#000000' },
];

/** Renders the layers under `obj` (not obj itself or anything above) and returns stats for the area under it. */
export function sampleUnder(canvas, obj, { maxSide = 160 } = {}) {
  const objs = canvas.getObjects(); const idx = objs.indexOf(obj);
  const r = obj.getBoundingRect(true, true);
  const k = Math.min(1, maxSide / Math.max(r.width, r.height, 1));
  const w = Math.max(1, Math.round(r.width * k)), h = Math.max(1, Math.round(r.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
  const bg = canvas.backgroundColor; ctx.fillStyle = typeof bg === 'string' && bg ? bg : '#000'; ctx.fillRect(0, 0, w, h);
  ctx.setTransform(k, 0, 0, k, -r.left * k, -r.top * k);
  for (let i = 0; i < (idx < 0 ? objs.length : idx); i++) { const o = objs[i]; if (o.visible === false) continue; try { o.render(ctx); } catch (_) {} }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let d; try { d = ctx.getImageData(0, 0, w, h).data; } catch (_) { return null; }
  let sr = 0, sg = 0, sb = 0, n = 0, lmin = 1, lmax = 0; const lums = [];
  for (let i = 0; i < d.length; i += 16) { const px = [d[i], d[i + 1], d[i + 2]]; const L = luminance(px); lums.push(L); sr += px[0]; sg += px[1]; sb += px[2]; n++; if (L < lmin) lmin = L; if (L > lmax) lmax = L; }
  lums.sort((a, b) => a - b);
  const avg = [sr / n, sg / n, sb / n];
  return { avg: toHex(avg), lum: luminance(avg), lmin, lmax, p10: lums[Math.floor(n * 0.1)], p90: lums[Math.floor(n * 0.9)], busy: lums[Math.floor(n * 0.9)] - lums[Math.floor(n * 0.1)], canvas: c };
}
/** Worst-case contrast of `hex` against the sampled area (uses the 10th/90th luminance percentiles, not just the average). */
export function worstContrast(hex, s) {
  const L = luminance(parseHex(hex));
  const c = (a) => (Math.max(L, a) + 0.05) / (Math.min(L, a) + 0.05);
  return Math.min(c(s.p10), c(s.p90), c(s.lum));
}
/** Photo palette (k-means, 6 colours) from the largest image under the object or on the page. */
export function photoPalette(canvas, obj) {
  const imgs = canvas.getObjects().filter((o) => o.type === 'image' && o !== obj && o.visible !== false);
  if (!imgs.length) return [];
  const big = imgs.sort((a, b) => b.getScaledWidth() * b.getScaledHeight() - a.getScaledWidth() * a.getScaledHeight())[0];
  try { return extractPalette(big.getElement(), 6); } catch (_) { return []; }
}
/** Candidate text colours: palette colours pushed lighter/darker + harmonies, filtered by WCAG contrast (AA large text = 3:1). */
export function suggest(sample, palette, mode = 'complementary', min = 3) {
  const out = []; const seen = new Set();
  const push = (hex, src) => { hex = hex.toLowerCase(); if (seen.has(hex)) return; seen.add(hex); const cr = sample ? worstContrast(hex, sample) : 21; out.push({ hex, src, cr, ok: cr >= min }); };
  for (const p of palette) { const [h, s] = hsl(p); push(p, 'photo'); push(fromHsl(h, Math.min(s, 0.7), 0.9), 'photo-light'); push(fromHsl(h, Math.min(s, 0.7), 0.14), 'photo-dark'); }
  for (const x of harmony(sample ? sample.avg : (palette[0] || '#336699'), mode)) push(x, mode);
  push('#ffffff', 'neutral'); push('#111111', 'neutral');
  return out;
}
