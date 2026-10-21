// Pro photo tools: crop & straighten, perspective (keystone), curves, HSL, film presets with grain + vignette.
// Geometry is stored normalised in pfGeo and re-applied to the full-resolution original at export.
import { el, sheet, toast, busy, progressTask } from '../ui.js';
import { haptic } from '../native.js';
import { filterCanvas, curveLUT, HSL_BANDS, isIdentityFilter } from '../imaging.js';
import { canvasToBlob } from '../tools.js';

const PF = () => window.PF;
export const IDENTITY_GEO = { rot: 0, pv: 0, ph: 0, crop: { x: 0, y: 0, w: 1, h: 1 } };
const isIdentityGeo = (g) => !g || (!g.rot && !g.pv && !g.ph && g.crop.x === 0 && g.crop.y === 0 && g.crop.w === 1 && g.crop.h === 1);
const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Image failed to load')); i.src = url; });

/** Straighten zoom so a rotated image fully covers its own frame (no empty corners). */
export function straightenZoom(w, h, deg) { const a = Math.abs(deg * Math.PI / 180); return (w * Math.cos(a) + h * Math.sin(a)) / w > (h * Math.cos(a) + w * Math.sin(a)) / h ? (w * Math.cos(a) + h * Math.sin(a)) / w : (h * Math.cos(a) + w * Math.sin(a)) / h; }
/** Applies geometry to a source canvas/image; returns a new canvas. Order: straighten → perspective → crop. */
export function geoCanvas(src, g, maxSide = 1e9) {
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(w0 * g.crop.w, h0 * g.crop.h));
  const W = Math.max(1, Math.round(w0 * k)), H = Math.max(1, Math.round(h0 * k));
  let c = document.createElement('canvas'); c.width = W; c.height = H; let x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  if (g.rot) { const z = straightenZoom(W, H, g.rot); x.translate(W / 2, H / 2); x.rotate(g.rot * Math.PI / 180); x.scale(z, z); x.drawImage(src, -W / 2, -H / 2, W, H); }
  else x.drawImage(src, 0, 0, W, H);
  if (g.pv || g.ph) c = keystone(c, g.pv / 100, g.ph / 100);
  const cx = Math.round(g.crop.x * W), cy = Math.round(g.crop.y * H), cw = Math.max(1, Math.round(g.crop.w * W)), ch = Math.max(1, Math.round(g.crop.h * H));
  if (cx === 0 && cy === 0 && cw === W && ch === H) return c;
  const o = document.createElement('canvas'); o.width = cw; o.height = ch; o.getContext('2d').drawImage(c, cx, cy, cw, ch, 0, 0, cw, ch);
  return o;
}
/** Keystone correction by mesh warp: pv>0 widens the top (fixes buildings leaning back), ph>0 widens the left. Result is zoomed to fill. */
export function keystone(src, pv, ph) {
  const W = src.width, H = src.height; const out = document.createElement('canvas'); out.width = W; out.height = H; const x = out.getContext('2d');
  const sv = Math.abs(pv) * 0.35, sh = Math.abs(ph) * 0.35;
  // destination quad corners for the full source (then zoom to fill the frame)
  const tl = [0, 0], tr = [W, 0], br = [W, H], bl = [0, H];
  if (pv > 0) { tl[0] -= W * sv; tr[0] += W * sv; } else if (pv < 0) { bl[0] -= W * sv; br[0] += W * sv; }
  if (ph > 0) { tl[1] -= H * sh; bl[1] += H * sh; } else if (ph < 0) { tr[1] -= H * sh; br[1] += H * sh; }
  const zx = 1 + sv * 2, zy = 1 + sh * 2; void zx; void zy;
  const N = 16;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const P = (u, v) => lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
  // scale about centre so the warped quad covers the frame
  const minX = Math.max(tl[0], bl[0]), maxX = Math.min(tr[0], br[0]), minY = Math.max(tl[1], tr[1]), maxY = Math.min(bl[1], br[1]);
  const s = Math.max(W / Math.max(1, maxX - minX), H / Math.max(1, maxY - minY), 1);
  const cxm = (minX + maxX) / 2, cym = (minY + maxY) / 2;
  const T = (p) => [(p[0] - cxm) * s + W / 2, (p[1] - cym) * s + H / 2];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const u0 = i / N, u1 = (i + 1) / N, v0 = j / N, v1 = (j + 1) / N;
    const s00 = [u0 * W, v0 * H], s10 = [u1 * W, v0 * H], s01 = [u0 * W, v1 * H], s11 = [u1 * W, v1 * H];
    const d00 = T(P(u0, v0)), d10 = T(P(u1, v0)), d01 = T(P(u0, v1)), d11 = T(P(u1, v1));
    tri(x, src, s00, s10, s01, d00, d10, d01); tri(x, src, s10, s11, s01, d10, d11, d01);
  }
  return out;
}
function tri(ctx, img, s0, s1, s2, d0, d1, d2) {
  // slight dilation hides seams
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3; const g = (p) => [p[0] + (p[0] - cx) * 0.02, p[1] + (p[1] - cy) * 0.02];
  const [e0, e1, e2] = [g(d0), g(d1), g(d2)];
  ctx.save(); ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.lineTo(e2[0], e2[1]); ctx.closePath(); ctx.clip();
  const den = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
  if (Math.abs(den) < 1e-9) { ctx.restore(); return; }
  const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / den;
  const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / den;
  const c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / den;
  const d = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / den;
  const e = (d0[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[0] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[0] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
  const f = (d0[1] * (s1[0] * s2[1] - s2[0] * s1[1]) + d1[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + d2[1] * (s0[0] * s1[1] - s1[0] * s0[1])) / den;
  ctx.setTransform(...(() => { const m = ctx.getTransform(); return [m.a, m.b, m.c, m.d, m.e, m.f]; })()); ctx.transform(a, b, c, d, e, f); ctx.drawImage(img, 0, 0); ctx.restore();
}
/** Used by app.js useOriginals: applies pfGeo to the full-resolution original before filtering. */
async function applyToBlob(blob, g, maxSide, alpha) {
  try { const bmp = await createImageBitmap(blob); const c = geoCanvas(bmp, g, maxSide); bmp.close(); return await canvasToBlob(c, alpha ? 'image/png' : 'image/jpeg', 0.95); } catch (e) { console.warn('geo', e); return null; }
}
window.PFGeo = { applyToBlob, geoCanvas };

export const FILM_PRESETS = [
  ['None', {}],
  ['Kodak warm', { warmth: 18, contrast: 8, saturation: 8, curve: [[0, 18], [64, 70], [128, 134], [192, 200], [255, 246]], grain: 18, vignette: 22 }],
  ['Fuji green', { warmth: -6, saturation: -6, curve: [[0, 12], [64, 66], [128, 130], [192, 196], [255, 244]], hsl: { green: [12, -10, 0], yellow: [-8, -12, 0], blue: [-6, 8, 0] }, grain: 16, vignette: 16 }],
  ['Teal & orange', { contrast: 12, hsl: { orange: [-4, 18, 6], yellow: [-12, 0, 0], aqua: [8, 22, 0], blue: [-10, 16, -6] }, curve: [[0, 0], [64, 56], [128, 128], [192, 204], [255, 255]], vignette: 25 }],
  ['Matte fade', { contrast: -10, saturation: -15, curve: [[0, 34], [64, 76], [128, 130], [192, 190], [255, 236]], grain: 12 }],
  ['Noir grain', { grayscale: true, contrast: 22, curve: [[0, 0], [64, 48], [128, 126], [192, 210], [255, 255]], grain: 35, vignette: 40 }],
  ['Golden hour', { warmth: 30, saturation: 12, hsl: { orange: [0, 15, 8], red: [6, 0, 0] }, curve: [[0, 10], [64, 72], [128, 138], [192, 204], [255, 250]], vignette: 20, grain: 8 }],
  ['Cine night', { warmth: -20, contrast: 15, hsl: { blue: [0, 20, -10], orange: [0, 12, 4] }, curve: [[0, 8], [64, 50], [128, 124], [192, 200], [255, 250]], grain: 22, vignette: 35 }],
];

// ---------- the editor sheet ----------
export async function openPhotoTools(target, startTab = 'crop') {
  const pf = PF(); const o = target || pf.active();
  if (!o || o.type !== 'image') return toast('Select a photo first');
  const geo0 = (() => { try { return o.pfGeo ? JSON.parse(o.pfGeo) : null; } catch (_) { return null; } })() || structuredClone(IDENTITY_GEO);
  const geo = structuredClone(geo0);
  let filt = (() => { try { return JSON.parse(o.pfFilter || '{}') || {}; } catch (_) { return {}; } })();
  const geoBaseURL = o.pfGeoBase || o.pfBase || o.getSrc();
  const baseImg = await loadImg(geoBaseURL);
  const PREV = 900; const pk = Math.min(1, PREV / Math.max(baseImg.width, baseImg.height));
  const small = document.createElement('canvas'); small.width = Math.round(baseImg.width * pk); small.height = Math.round(baseImg.height * pk); small.getContext('2d').drawImage(baseImg, 0, 0, small.width, small.height);
  let tab = startTab, aspect = 0;
  const view = el('canvas', { class: 'pt-view' }); const vctx = view.getContext('2d');
  const stage = el('div', { class: 'pt-stage' }, view);
  const cropBox = el('div', { class: 'pt-crop hidden' }, ...['tl', 'tr', 'bl', 'br'].map((c) => el('span', { class: 'pt-h ' + c, 'data-h': c })));
  stage.append(cropBox);
  const tabs = el('div', { class: 'seg pt-tabs' }, ...[['crop', 'Crop'], ['persp', 'Perspective'], ['curves', 'Curves'], ['hsl', 'HSL'], ['film', 'Presets']].map(([k, l]) => el('button', { 'data-tab': k, text: l, onclick: () => { tab = k; draw(); } })));
  const ctl = el('div', { class: 'pt-ctl' });
  let geoPreview = null; // canvas after straighten+perspective (before crop)
  const refreshGeo = () => { geoPreview = geoCanvas(small, { ...geo, crop: { x: 0, y: 0, w: 1, h: 1 } }); };
  refreshGeo();
  function render() {
    const showCrop = tab === 'crop';
    const src = showCrop ? geoPreview : geoCanvas(small, geo);
    const out = tab === 'crop' || tab === 'persp' ? src : filterCanvas(src, filt);
    const maxW = Math.min(window.innerWidth - 48, 520), maxH = Math.min(window.innerHeight * 0.42, 460);
    const s = Math.min(maxW / out.width, maxH / out.height);
    view.width = out.width; view.height = out.height; view.style.width = Math.round(out.width * s) + 'px'; view.style.height = Math.round(out.height * s) + 'px';
    vctx.drawImage(out, 0, 0);
    if (tab === 'persp') { vctx.strokeStyle = 'rgba(255,255,255,.35)'; vctx.lineWidth = Math.max(1, out.width / 400); for (let i = 1; i < 4; i++) { vctx.beginPath(); vctx.moveTo(out.width * i / 4, 0); vctx.lineTo(out.width * i / 4, out.height); vctx.moveTo(0, out.height * i / 4); vctx.lineTo(out.width, out.height * i / 4); vctx.stroke(); } }
    cropBox.classList.toggle('hidden', !showCrop);
    if (showCrop) { const r = geo.crop; Object.assign(cropBox.style, { left: `calc(50% - ${view.style.width} / 2 + ${r.x * 100}% * 0)`, width: '' });
      const vw = parseFloat(view.style.width), vh = parseFloat(view.style.height); const off = (stage.clientWidth - vw) / 2;
      Object.assign(cropBox.style, { left: off + r.x * vw + 'px', top: r.y * vh + 'px', width: r.w * vw + 'px', height: r.h * vh + 'px' }); }
  }
  function slider(label, min, max, val, on, step = 1) {
    const v = el('span', { class: 'val', text: String(val) });
    const inp = el('input', { type: 'range', min, max, step, value: val, 'aria-label': label });
    inp.addEventListener('input', () => { v.textContent = inp.value; on(Number(inp.value)); });
    return el('div', { class: 'slider-row' }, el('span', { class: 'lbl', text: label }), inp, v);
  }
  function setAspect(a) {
    aspect = a; if (!a) return render();
    const W = geoPreview.width, H = geoPreview.height; const r = geo.crop; let w = r.w, h = (r.w * W / a) / H;
    if (h > 1) { h = 1; w = (a * H) / W; } if (w > 1) { w = 1; h = (W / a) / H; }
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2; geo.crop = { x: clamp01(cx - w / 2, 1 - w), y: clamp01(cy - h / 2, 1 - h), w, h }; render();
  }
  function draw() {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    ctl.replaceChildren();
    if (tab === 'crop') ctl.append(
      el('div', { class: 'chips' }, ...[['Free', 0], ['1:1', 1], ['4:5', 0.8], ['9:16', 9 / 16], ['16:9', 16 / 9], ['3:2', 1.5]].map(([l, a]) => el('button', { class: 'chip rip' + (a === aspect ? ' on' : ''), 'data-aspect': l, text: l, onclick: (e) => { ctl.querySelectorAll('[data-aspect]').forEach((c) => c.classList.remove('on')); e.currentTarget.classList.add('on'); setAspect(a); } }))),
      slider('Straighten', -45, 45, geo.rot, (v) => { geo.rot = v; refreshGeo(); render(); }, 0.5),
      el('button', { class: 'btn-ghost rip', text: 'Reset crop', onclick: () => { geo.crop = { x: 0, y: 0, w: 1, h: 1 }; geo.rot = 0; aspect = 0; refreshGeo(); draw(); } }));
    else if (tab === 'persp') ctl.append(
      slider('Vertical', -100, 100, geo.pv, (v) => { geo.pv = v; refreshGeo(); render(); }),
      slider('Horizontal', -100, 100, geo.ph, (v) => { geo.ph = v; refreshGeo(); render(); }),
      el('p', { class: 'note', text: 'Straighten leaning buildings or a tilted shot. The photo is zoomed slightly so no empty edges appear.' }));
    else if (tab === 'curves') ctl.append(curvesEditor(filt, (c) => { filt = { ...filt, curve: c }; if (!c) delete filt.curve; render(); }));
    else if (tab === 'hsl') ctl.append(hslEditor(filt, (h) => { filt = { ...filt, hsl: h }; if (!h) delete filt.hsl; render(); }));
    else if (tab === 'film') ctl.append(
      el('div', { class: 'chips wrap' }, ...FILM_PRESETS.map(([l, f]) => el('button', { class: 'chip rip', 'data-film': l, text: l, onclick: () => { haptic(); filt = structuredClone(f); draw(); } }))),
      slider('Grain', 0, 100, filt.grain || 0, (v) => { filt.grain = v; if (!v) delete filt.grain; render(); }),
      slider('Vignette', 0, 100, filt.vignette || 0, (v) => { filt.vignette = v; if (!v) delete filt.vignette; render(); }),
      slider('Warmth', -100, 100, filt.warmth || 0, (v) => { filt.warmth = v; if (!v) delete filt.warmth; render(); }));
    requestAnimationFrame(render);
  }
  // crop interaction
  let drag = null;
  cropBox.addEventListener('pointerdown', (e) => { e.preventDefault(); cropBox.setPointerCapture(e.pointerId); drag = { h: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, r: { ...geo.crop } }; });
  cropBox.addEventListener('pointermove', (e) => {
    if (!drag) return; const vw = parseFloat(view.style.width), vh = parseFloat(view.style.height);
    const dx = (e.clientX - drag.x) / vw, dy = (e.clientY - drag.y) / vh; const r = { ...drag.r }; const MIN = 0.08;
    if (drag.h === 'move') { r.x = clamp01(r.x + dx, 1 - r.w); r.y = clamp01(r.y + dy, 1 - r.h); }
    else {
      let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
      if (drag.h.includes('l')) x0 = Math.min(x1 - MIN, Math.max(0, x0 + dx)); if (drag.h.includes('r')) x1 = Math.max(x0 + MIN, Math.min(1, x1 + dx));
      if (drag.h.includes('t')) y0 = Math.min(y1 - MIN, Math.max(0, y0 + dy)); if (drag.h.includes('b')) y1 = Math.max(y0 + MIN, Math.min(1, y1 + dy));
      if (aspect) { const W = geoPreview.width, H = geoPreview.height; const w = x1 - x0; let h = (w * W / aspect) / H; if (drag.h.includes('t')) y0 = Math.max(0, y1 - h); else y1 = Math.min(1, y0 + h); h = y1 - y0; const w2 = (h * H * aspect) / W; if (drag.h.includes('l')) x0 = x1 - w2; else x1 = x0 + w2; }
      Object.assign(r, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    geo.crop = r; render();
  });
  cropBox.addEventListener('pointerup', () => { drag = null; });
  const body = el('div', { class: 'pt' }, tabs, stage, ctl);
  draw();
  const v = await sheet({ title: 'Edit photo', body, onOpen: (box) => box.classList.add('sheet-tall'), actions: [{ label: 'Cancel', value: null, kind: 'btn-ghost' }, { label: 'Reset all', value: 'reset', kind: 'btn-secondary' }, { label: 'Apply', value: 'apply', kind: 'btn-accent' }] });
  if (!v) return false;
  if (v === 'reset') { await applyEdits(o, structuredClone(IDENTITY_GEO), {}, geoBaseURL); return true; }
  await applyEdits(o, geo, filt, geoBaseURL);
  return true;
}
const clamp01 = (v, max = 1) => Math.max(0, Math.min(max, v));

export async function applyEdits(o, geo, filt, geoBaseURL) {
  const pf = PF();
  const geoChanged = JSON.stringify(geo) !== (o.pfGeo || JSON.stringify(IDENTITY_GEO));
  const pt = progressTask('Applying photo edits…');
  try {
    await pf.history.batch(async () => {
      if (geoChanged) {
        const base = geoBaseURL || o.pfGeoBase || o.pfBase || o.getSrc();
        const img = await loadImg(base);
        const center = o.getCenterPoint(); const dispW = o.getScaledWidth(), dispFrac = o.width;
        if (isIdentityGeo(geo)) {
          await pf.setImageSrc(o, base); o.set({ width: img.width, height: img.height, pfGeo: null, pfGeoBase: null, pfBase: base });
        } else {
          const c = geoCanvas(img, geo); pt.set(0.4);
          const url = URL.createObjectURL(await canvasToBlob(c, o.pfAlpha ? 'image/png' : 'image/jpeg', 0.94));
          await pf.setImageSrc(o, url); o.set({ width: c.width, height: c.height, pfGeo: JSON.stringify(geo), pfGeoBase: base, pfBase: url, cropX: 0, cropY: 0 });
        }
        if (o.pfMask) { o.set('pfMask', null); o._pfMaskEl = null; toast('The layer mask was cleared because the photo was cropped'); }
        void dispW; void dispFrac; o.setPositionByOrigin(center, 'center', 'center'); o.setCoords();
      }
      const f = Object.fromEntries(Object.entries(filt || {}).filter(([, val]) => val !== undefined && val !== null));
      if (!isIdentityFilter(f) || o.pfFilter) await pf.applyFilter(o, f);
      pt.set(1);
    });
    pf.canvas.requestRenderAll(); pf.refreshLayers(); haptic('confirm');
  } catch (e) { toast('Photo edit failed: ' + e.message, 'error'); }
  finally { pt.done(); busy(); }
}

function curvesEditor(filt, onChange) {
  const pts = filt.curve ? filt.curve.map((p) => p.slice()) : [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]];
  const cv = el('canvas', { class: 'pt-curve', width: 256, height: 256, 'aria-label': 'Tone curve' }); const x = cv.getContext('2d');
  const redraw = () => {
    x.clearRect(0, 0, 256, 256); x.fillStyle = '#11141b'; x.fillRect(0, 0, 256, 256); x.strokeStyle = 'rgba(255,255,255,.12)';
    for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, 256); x.moveTo(0, i * 64); x.lineTo(256, i * 64); x.stroke(); }
    const lut = curveLUT(pts); x.strokeStyle = '#f59e0b'; x.lineWidth = 2; x.beginPath(); for (let i = 0; i < 256; i++) { const y = 255 - lut[i]; i ? x.lineTo(i, y) : x.moveTo(i, y); } x.stroke();
    x.fillStyle = '#fff'; pts.forEach(([px, py]) => { x.beginPath(); x.arc(px, 255 - py, 6, 0, 7); x.fill(); });
  };
  let idx = -1;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 255, 255 - ((e.clientY - r.top) / r.height) * 255]; };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); const [px, py] = pos(e); let best = 1e9; pts.forEach((p, i) => { const d = Math.hypot(p[0] - px, p[1] - py); if (d < best) { best = d; idx = i; } }); });
  cv.addEventListener('pointermove', (e) => { if (idx < 0) return; const [px, py] = pos(e); const lo = idx ? pts[idx - 1][0] + 4 : 0, hi = idx < pts.length - 1 ? pts[idx + 1][0] - 4 : 255;
    pts[idx] = [idx === 0 ? 0 : idx === pts.length - 1 ? 255 : Math.max(lo, Math.min(hi, px)), Math.max(0, Math.min(255, py))]; redraw(); onChange(pts.map((p) => [Math.round(p[0]), Math.round(p[1])])); });
  cv.addEventListener('pointerup', () => { idx = -1; });
  redraw();
  return el('div', { class: 'col-gap' }, cv, el('div', { class: 'row' },
    el('button', { class: 'chip rip', text: 'S-curve', onclick: () => { [[0, 0], [64, 48], [128, 128], [192, 208], [255, 255]].forEach((p, i) => { pts[i] = p; }); redraw(); onChange(pts.map((p) => p.slice())); } }),
    el('button', { class: 'chip rip', text: 'Fade', onclick: () => { [[0, 36], [64, 78], [128, 130], [192, 190], [255, 238]].forEach((p, i) => { pts[i] = p; }); redraw(); onChange(pts.map((p) => p.slice())); } }),
    el('button', { class: 'chip rip', text: 'Reset', onclick: () => { [[0, 0], [64, 64], [128, 128], [192, 192], [255, 255]].forEach((p, i) => { pts[i] = p; }); redraw(); onChange(null); } })),
    el('p', { class: 'note', text: 'Drag the points: left = shadows, right = highlights.' }));
}
function hslEditor(filt, onChange) {
  const hsl = structuredClone(filt.hsl || {}); let band = 'orange';
  const COL = { red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', aqua: '#06b6d4', blue: '#3b82f6', purple: '#a855f7' };
  const box = el('div', { class: 'col-gap' });
  const draw = () => {
    const v = hsl[band] || [0, 0, 0];
    const mk = (label, i) => { const val = el('span', { class: 'val', text: String(v[i]) }); const inp = el('input', { type: 'range', min: -100, max: 100, value: v[i], 'aria-label': label });
      inp.addEventListener('input', () => { val.textContent = inp.value; const cur = hsl[band] || [0, 0, 0]; cur[i] = Number(inp.value); hsl[band] = cur; if (!cur.some(Boolean)) delete hsl[band]; onChange(Object.keys(hsl).length ? structuredClone(hsl) : null); });
      return el('div', { class: 'slider-row' }, el('span', { class: 'lbl', text: label }), inp, val); };
    box.replaceChildren(el('div', { class: 'chips' }, ...HSL_BANDS.map(([k]) => el('button', { class: 'hsl-dot rip' + (k === band ? ' on' : ''), 'data-band': k, style: `background:${COL[k]}`, 'aria-label': k, onclick: () => { band = k; draw(); } }))),
      mk('Hue', 0), mk('Saturation', 1), mk('Luminance', 2));
  };
  draw(); return box;
}
