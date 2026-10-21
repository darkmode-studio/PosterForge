// 2.1 subject lift (long-press a photo, like iOS): on-device ML Kit Subject Segmentation through the native bridge,
// lifted into a new layer with a glow; Copy (system clipboard), Paste as layer, Save transparent PNG, Share,
// Sticker outline, and an edge refine brush. Paste images from the clipboard.
/* global fabric */
import { el, sheet, toast, menuSheet, progressTask } from '../ui.js';
import { N, haptic, nativeJob, sendBlob, hasJobs } from '../native.js';

const PF = () => window.PF;
const liftSource = new WeakMap(); // lifted layer -> { canvas: original pixels for the same box } (session only)
let lastCopy = null; // in-app clipboard (fallback when the system clipboard is not reachable)

export const LIFT_MESSAGES = {
  no_play_services: 'Subject lift needs Google Play services, which this phone does not have. You can still use Cutout (plain backgrounds).',
  model_downloading: 'The subject model is downloading through Google Play services (about 5–10 MB, needs internet once). Try again in a minute.',
  no_subject: 'No clear subject found in this photo. Try a photo with a person, pet or object in front.',
  unavailable: 'Subject lift is not available on this phone right now.',
  browser: 'Subject lift runs on your phone in the Android app (needs Google Play services).',
  bad_image: 'This photo could not be read.',
};
const canvasToBlob = (c, type = 'image/png', q) => new Promise((r) => c.toBlob(r, type, q));
function elementCanvas(img, maxSide = 2048) {
  const e = img.getElement(); const W = e.naturalWidth || e.width, H = e.naturalHeight || e.height;
  const k = Math.min(1, maxSide / Math.max(W, H)); const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
  c.getContext('2d').drawImage(e, 0, 0, c.width, c.height); return { c, W, H };
}
const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image load failed')); i.src = url; });

/** Places the lifted PNG exactly over the source photo. r = { url, x, y, w, h, srcW, srcH } in the sent image's pixels. */
export async function placeLifted(src, r) {
  const pf = PF(); const e = src.getElement(); const elW = e.naturalWidth || e.width; const f = elW / r.srcW;
  const lx = (r.x + r.w / 2) * f - (src.cropX || 0) - src.width / 2, ly = (r.y + r.h / 2) * f - (src.cropY || 0) - src.height / 2;
  const p = fabric.util.transformPoint(new fabric.Point(lx, ly), src.calcTransformMatrix());
  const im = await loadImg(r.url);
  const o = new fabric.Image(im, { originX: 'center', originY: 'center', left: p.x, top: p.y, scaleX: src.scaleX * f, scaleY: src.scaleY * f, angle: src.angle, flipX: src.flipX, flipY: src.flipY, name: 'Subject', pfRole: 'subject' });
  const idx = pf.canvas.getObjects().indexOf(src);
  pf.canvas.insertAt(o, idx + 1);
  return o;
}
export function glow(o) {
  const pf = PF(); const sx = o.scaleX, sy = o.scaleY; const keep = o.shadow;
  return new Promise((done) => fabric.util.animate({ startValue: 0, endValue: 1, duration: 950, easing: fabric.util.ease.easeOutQuad,
    onChange: (v) => { const a = Math.sin(v * Math.PI); o.set({ shadow: new fabric.Shadow({ color: `rgba(255,255,255,${0.95 * a})`, blur: 50 * a, offsetX: 0, offsetY: 0 }), scaleX: sx * (1 + 0.04 * a), scaleY: sy * (1 + 0.04 * a) }); pf.canvas.requestRenderAll(); },
    onComplete: () => { o.set({ shadow: keep || null, scaleX: sx, scaleY: sy }); o.setCoords(); pf.canvas.requestRenderAll(); done(); } }));
}

export async function liftSubject(src) {
  const pf = PF(); if (!src || src.type !== 'image') return null;
  const n = N();
  if (!n || !hasJobs()) { toast(LIFT_MESSAGES.browser, 'error', 4200); return null; }
  try { const info = JSON.parse(n.subjectInfo?.() || '{}'); if (info.playServices === false) { toast(LIFT_MESSAGES.no_play_services, 'error', 5000); return null; } } catch (_) {}
  haptic('heavy');
  const shimmer = el('div', { class: 'lift-shimmer', id: 'liftShimmer' }); document.body.append(shimmer);
  const pt = progressTask('Lifting subject…');
  try {
    const { c } = elementCanvas(src, 2048);
    const r = await nativeJob('subject', await canvasToBlob(c), { maxSide: 2048 }, { onProgress: pt.set });
    if (!r.ok) { toast(LIFT_MESSAGES[r.code] || r.error || 'Subject lift failed', 'error', 5000); return null; }
    const o = await pf.history.batch(async () => {
      const lay = await placeLifted(src, r);
      const sc = document.createElement('canvas'); sc.width = r.w; sc.height = r.h; sc.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      liftSource.set(lay, { canvas: sc });
      pf.canvas.setActiveObject(lay); return lay;
    });
    pt.done?.(); shimmer.remove(); await glow(o); haptic('confirm');
    liftMenu(o);
    return o;
  } catch (e) { toast('Subject lift failed: ' + (e.message || e), 'error'); return null; }
  finally { try { pt.done?.(); pt.close?.(); } catch (_) {} shimmer.remove(); }
}

export async function layerPNG(o) { const { c } = elementCanvas(o, 4096); return canvasToBlob(c); }
export async function copyImage(o) {
  const blob = await layerPNG(o); lastCopy = blob;
  if (N()) { const r = await sendBlob(blob, 'posterforge-subject.png', 'image/png', 'copy'); if (r.ok) { toast('Copied: paste it in any app'); return r; } toast('Copied inside PosterForge (system clipboard failed: ' + (r.error || '') + ')'); return r; }
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Copied'); } catch (_) { toast('Copied inside PosterForge'); }
  return { ok: true };
}
/** Paste an image from the system clipboard (Android) or the in-app clipboard as a new layer. */
export async function pasteImage() {
  const pf = PF(); let url = null;
  const n = N();
  if (n && n.clipboardImage) {
    const r = await new Promise((res) => { const t = 'cb' + Math.random().toString(36).slice(2); const prev = window.__pfNativeCb;
      const to = setTimeout(() => res({ ok: false, error: 'Timed out' }), 20000);
      window.__pfNativeCb = (tok, json) => { if (tok === t) { clearTimeout(to); window.__pfNativeCb = prev; try { res(JSON.parse(json)); } catch (e) { res({ ok: false, error: String(e) }); } } else prev(tok, json); };
      n.clipboardImage(t); });
    if (r.ok) url = r.url; else if (!lastCopy) { toast(r.code === 'empty' || r.code === 'not_image' ? 'There is no image on the clipboard' : (r.error || 'Paste failed'), 'error'); return null; }
  } else if (!lastCopy && navigator.clipboard?.read) {
    try { for (const it of await navigator.clipboard.read()) { const t = it.types.find((x) => x.startsWith('image/')); if (t) { url = URL.createObjectURL(await it.getType(t)); break; } } } catch (_) {}
  }
  if (!url && lastCopy) url = URL.createObjectURL(lastCopy);
  if (!url) { toast('There is no image on the clipboard', 'error'); return null; }
  // keep pasted images in the project (data URL) like imported photos
  const im = await loadImg(url); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0);
  const o = await pf.addImageFromURL(c.toDataURL('image/png'), 'Pasted image', { width: 0.5 });
  o.set('pfAlpha', true); pf.canvas.add(o); pf.canvas.setActiveObject(o); pf.canvas.requestRenderAll();
  pf.history.record(); haptic('confirm'); toast('Pasted as a new layer'); return o;
}
export async function saveImage(o, action = 'save') {
  const r = await sendBlob(await layerPNG(o), `posterforge-subject-${Date.now()}.png`, 'image/png', action);
  if (r.ok && action === 'save') toast('Saved transparent PNG to ' + (r.where || 'Gallery')); else if (!r.ok) toast(r.error || 'Failed', 'error');
  return r;
}
/** White die-cut sticker border (+ soft shadow) baked around the alpha shape. */
export async function stickerOutline(o, { size = 0.025, color = '#ffffff' } = {}) {
  const pf = PF(); const { c } = elementCanvas(o, 3000);
  const r = Math.max(4, Math.round(Math.max(c.width, c.height) * size)); const pad = r + 4;
  const sil = document.createElement('canvas'); sil.width = c.width; sil.height = c.height; const sx = sil.getContext('2d');
  sx.drawImage(c, 0, 0); sx.globalCompositeOperation = 'source-in'; sx.fillStyle = color; sx.fillRect(0, 0, sil.width, sil.height);
  const out = document.createElement('canvas'); out.width = c.width + pad * 2; out.height = c.height + pad * 2; const ox = out.getContext('2d');
  for (let a = 0; a < 32; a++) { const t = (a / 32) * Math.PI * 2; ox.drawImage(sil, pad + Math.cos(t) * r, pad + Math.sin(t) * r); }
  ox.drawImage(sil, pad, pad); ox.drawImage(c, pad, pad);
  const k = (o.getElement().naturalWidth || o.width) / c.width; const cx = o.getCenterPoint();
  await new Promise((res) => o.setSrc(out.toDataURL('image/png'), res));
  o.set({ scaleX: o.scaleX * k, scaleY: o.scaleY * k, pfSticker: true, shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: 18, offsetX: 0, offsetY: 6 }) });
  o.setPositionByOrigin(cx, 'center', 'center'); o.setCoords(); pf.canvas.requestRenderAll(); pf.history.record();
  return o;
}

/** Full-screen refine brush: Erase / Restore (restore uses the original photo pixels from this session). */
export function refineEdges(o) {
  const pf = PF(); const src = liftSource.get(o);
  const { c } = elementCanvas(o, 2048); const W = c.width, H = c.height;
  const orig = src ? (() => { const x = document.createElement('canvas'); x.width = W; x.height = H; x.getContext('2d').drawImage(src.canvas, 0, 0, W, H); return x; })() : null;
  let mode = 'erase', size = Math.round(Math.max(W, H) * 0.04);
  const view = el('canvas', { class: 'refine-canvas', id: 'refineCanvas' }); view.width = W; view.height = H;
  const vctx = view.getContext('2d'); vctx.drawImage(c, 0, 0);
  const sizeI = el('input', { type: 'range', min: 4, max: Math.round(Math.max(W, H) * 0.15), value: size, id: 'refineSize', oninput: () => (size = Number(sizeI.value)) });
  const modeSeg = el('div', { class: 'seg', id: 'refineMode' }, ...[['erase', 'Erase'], ['restore', 'Restore']].map(([k, l]) => el('button', { class: k === mode ? 'on' : '', 'data-mode': k, text: l, disabled: k === 'restore' && !orig,
    onclick: (e) => { mode = k; modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === k)); e.stopPropagation(); } })));
  const dab = (x, y) => {
    if (mode === 'erase') { vctx.save(); vctx.globalCompositeOperation = 'destination-out'; vctx.beginPath(); vctx.arc(x, y, size / 2, 0, Math.PI * 2); vctx.fill(); vctx.restore(); }
    else if (orig) { vctx.save(); vctx.beginPath(); vctx.arc(x, y, size / 2, 0, Math.PI * 2); vctx.clip(); vctx.clearRect(x - size, y - size, size * 2, size * 2); vctx.drawImage(orig, 0, 0); vctx.restore(); }
  };
  const pos = (e) => { const b = view.getBoundingClientRect(); return [(e.clientX - b.left) * W / b.width, (e.clientY - b.top) * H / b.height]; };
  let down = false, last = null;
  view.addEventListener('pointerdown', (e) => { down = true; view.setPointerCapture?.(e.pointerId); last = pos(e); dab(...last); });
  view.addEventListener('pointermove', (e) => { if (!down) return; const p = pos(e); const d = Math.hypot(p[0] - last[0], p[1] - last[1]); const steps = Math.max(1, Math.ceil(d / (size / 4)));
    for (let i = 1; i <= steps; i++) dab(last[0] + (p[0] - last[0]) * i / steps, last[1] + (p[1] - last[1]) * i / steps); last = p; });
  ['pointerup', 'pointercancel'].forEach((t) => view.addEventListener(t, () => { down = false; }));
  const body = el('div', { class: 'refine-body' }, el('div', { class: 'refine-wrap checker' }, view), modeSeg, el('div', { class: 'slider-row' }, el('span', { class: 'lbl', text: 'Brush' }), sizeI),
    el('p', { class: 'note', text: orig ? 'Erase removes leftover background; Restore paints the original photo back.' : 'Restore is only available right after a lift (the original pixels are kept for this session).' }));
  return sheet({ title: 'Refine edges', body, actions: [{ label: 'Cancel', value: false, kind: 'btn-ghost' }, { label: 'Apply', value: true, kind: 'btn-accent' }] }).then(async (ok) => {
    if (!ok) return false;
    const k = (o.getElement().naturalWidth || o.width) / W; const cx = o.getCenterPoint();
    await new Promise((res) => o.setSrc(view.toDataURL('image/png'), res));
    o.set({ scaleX: o.scaleX * k, scaleY: o.scaleY * k }); o.setPositionByOrigin(cx, 'center', 'center'); o.setCoords();
    if (orig) liftSource.set(o, { canvas: orig });
    pf.canvas.requestRenderAll(); pf.history.record(); return true;
  });
}

export async function liftMenu(o) {
  const v = await menuSheet('Subject lifted', [
    { label: '📋  Copy', value: 'copy' }, { label: '📥  Paste as layer', value: 'paste' }, { label: '💾  Save transparent PNG', value: 'save' },
    { label: '📤  Share', value: 'share' }, { label: '🏷  Sticker outline', value: 'sticker' }, { label: '🖌  Refine edges', value: 'refine' }]);
  if (v === 'copy') await copyImage(o);
  else if (v === 'paste') await pasteImage();
  else if (v === 'save') await saveImage(o, 'save');
  else if (v === 'share') await saveImage(o, 'share');
  else if (v === 'sticker') await stickerOutline(o);
  else if (v === 'refine') await refineEdges(o);
  return v;
}
export function installLift() {
  window.PFLift = (img) => (img.pfRole === 'subject' ? liftMenu(img) : liftSubject(img));
}
