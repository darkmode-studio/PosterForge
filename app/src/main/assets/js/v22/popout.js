// 2.2 Pop-out frame (no AI): ivory paper, the photo in a white-bordered frame with a soft shadow, and the lifted subject
// aligned exactly on top: clipped to the frame window above a draggable "break line" and free below it.
// Plus a soft contact shadow, leaf stickers and editorial text. Built as plain Fabric JSON so the same code makes the
// one-tap template and the "Pop-out" action on any photo.
/* global fabric */
import { toast, progressTask } from '../ui.js';
import { haptic, sendBlob } from '../native.js';

const PF = () => window.PF;
export const LEAVES = ['leaf-monstera', 'leaf-branch', 'leaf-eucalyptus', 'leaf-fern', 'leaf-olive'].map((n) => `img/v22/${n}.webp`);
export const PAPER = 'img/v22/paper-ivory.webp';

/** Frame geometry for an artboard: window (photo area), border and the default break line (world px). */
export function popoutLayout(W, H) {
  const ww = Math.round(W * 0.72), wh = Math.round(Math.min(H * 0.58, ww * (H > W * 1.5 ? 1.45 : 1.0)));
  const x = Math.round((W - ww) / 2), y = Math.round(H * (H > W * 1.5 ? 0.2 : 0.17));
  const border = Math.round(W * 0.022);
  return { win: { x, y, w: ww, h: wh }, border, breakY: Math.round(y + wh * 0.88) };
}
const rectClip = (r, extra = {}) => ({ type: 'rect', version: '5.3.0', originX: 'left', originY: 'top', left: r.x, top: r.y, width: r.w, height: r.h, fill: '#000000', strokeWidth: 0, absolutePositioned: true, ...extra });
/** Union clip: the frame window, plus everything below the break line. */
export function subjectClip(win, breakY, W, H) {
  const a = new fabric.Rect({ left: win.x, top: win.y, width: win.w, height: win.h, fill: '#000', strokeWidth: 0 });
  const b = new fabric.Rect({ left: -W, top: breakY, width: W * 3, height: H * 2, fill: '#000', strokeWidth: 0 });
  const g = new fabric.Group([a, b], { absolutePositioned: true });
  return { ...g.toObject(), absolutePositioned: true };
}
const txt = (text, p) => ({ type: 'text', version: '5.3.0', originX: 'center', originY: 'center', text, fill: '#3b3428', textAlign: 'center', lineHeight: 1.15, fontWeight: 400, name: text.split('\n')[0].slice(0, 24), ...p });

/**
 * Pop-out objects (JSON). photo/subject: Fabric image JSON already positioned (same transform family);
 * sb = subject's bottom-centre in world px (for the contact shadow) and its width.
 */
export function popoutObjects({ W, H, id, photo, subject, sb, words = {}, leaves = [0, 1], breakY }) {
  const L = popoutLayout(W, H); const { win, border } = L; const by = breakY ?? L.breakY;
  const k = W / 1080;
  const meta = (o, role) => ({ ...o, pfPopout: id, pfRole: role });
  const paper = meta({ type: 'rect', version: '5.3.0', left: 0, top: 0, width: W, height: H, strokeWidth: 0, fill: { type: 'pattern', source: PAPER, repeat: 'repeat' },
    name: 'Ivory paper', selectable: false, evented: false, locked: true, hasControls: false }, 'bg');
  const frame = meta({ type: 'rect', version: '5.3.0', left: win.x - border, top: win.y - border, width: win.w + border * 2, height: win.h + border * 2, fill: '#fffdf8', strokeWidth: 0,
    shadow: { color: 'rgba(40,30,20,0.30)', blur: 38 * k, offsetX: 0, offsetY: 16 * k }, name: 'Frame', locked: true, selectable: false, evented: false, hasControls: false,
    lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true }, 'popFrame');
  const ph = meta({ ...photo, clipPath: rectClip(win), name: 'Photo in frame', perPixelTargetFind: true }, 'popPhoto');
  const sub = meta({ ...subject, clipPath: subjectClip(win, by, W, H), name: 'Subject (pop-out)', pfBreak: by, pfPopWin: JSON.stringify(win), perPixelTargetFind: true }, 'popSubject');
  const R = Math.max(40, sb.w * 0.42);
  const shadow = meta({ type: 'ellipse', version: '5.3.0', originX: 'center', originY: 'center', left: sb.x, top: sb.y + 4 * k, rx: R, ry: R, scaleY: 0.13, strokeWidth: 0, opacity: 0.9,
    fill: { type: 'radial', gradientUnits: 'pixels', coords: { x1: R, y1: R, r1: 0, x2: R, y2: R, r2: R }, colorStops: [{ offset: 0, color: 'rgba(30,22,14,0.55)' }, { offset: 0.55, color: 'rgba(30,22,14,0.22)' }, { offset: 1, color: 'rgba(30,22,14,0)' }] },
    name: 'Contact shadow' }, 'popShadow');
  const leafPos = [
    { left: win.x - border * 0.4, top: win.y + win.h * 0.04, angle: -28, w: W * 0.34, flipX: false },
    { left: win.x + win.w + border * 0.6, top: win.y + win.h * 0.97, angle: 152, w: W * 0.36, flipX: true },
  ];
  const leafObjs = leaves.slice(0, 2).map((li, i) => meta({ type: 'image', version: '5.3.0', originX: 'center', originY: 'center', src: LEAVES[li % LEAVES.length], crossOrigin: null,
    left: leafPos[i].left, top: leafPos[i].top, angle: leafPos[i].angle, flipX: leafPos[i].flipX, pfLeafW: leafPos[i].w, name: 'Leaf sticker', pfAlpha: true }, 'popLeaf'));
  const title = txt(words.title ?? 'THE QUIET ESCAPE', { left: W / 2, top: win.y - border - 62 * k, fontFamily: 'Cinzel', fontSize: 34 * k, charSpacing: 420, fill: '#3b3428', pfPopout: id });
  const note = txt(words.note ?? 'where the sky keeps its promises', { left: W / 2, top: Math.min(H - 150 * k, win.y + win.h + border + 70 * k), fontFamily: 'Cormorant Garamond', fontStyle: 'italic', fontSize: 40 * k, fill: '#4a4034', pfPopout: id });
  const script = txt(words.script ?? 'with love', { left: W * 0.74, top: Math.min(H - 70 * k, win.y + win.h + border + 150 * k), angle: -7, fontFamily: 'Great Vibes', fontSize: 64 * k, fill: '#7a5a3a', pfPopout: id });
  const counter = txt(words.counter ?? '01 / 05', { left: W - 80 * k, top: 64 * k, fontFamily: 'Cormorant Garamond', fontSize: 28 * k, charSpacing: 120, fill: '#5a5044', pfRole: 'pageNo', pfPopout: id, name: 'Page number' });
  return [paper, frame, ph, ...leafObjs, shadow, sub, title, note, script, counter];
}

/** Image JSON at a centre / scale. */
const imgJSON = (src, w, h, cx, cy, s, extra = {}) => ({ type: 'image', version: '5.3.0', originX: 'center', originY: 'center', left: cx, top: cy, width: w, height: h, scaleX: s, scaleY: s, src, crossOrigin: null, ...extra });

/** One-tap template: bundled balloon photo + its aligned cutout (same pixel grid). */
export function popoutTemplatePage(W, H, { photo = 'img/v22/balloon-sky-photo.webp', subject = 'img/v22/balloon-sky-subject.webp', bottom = [560, 1204], top = 250, words } = {}) {
  const L = popoutLayout(W, H); const { win } = L;
  // the window shows the photo from y=top down to just above the basket, so the basket hangs out of the frame
  const s = win.h / (bottom[1] - 120 - top);
  const cx = win.x + win.w / 2 + (540 - bottom[0]) * s * 0.2, cy = win.y - top * s + 1350 * s / 2;
  const ph = imgJSON(photo, 1080, 1350, cx, cy, s);
  const sub = imgJSON(subject, 1080, 1350, cx, cy, s, { pfAlpha: true });
  const sb = { x: cx + (bottom[0] - 540) * s, y: cy + (bottom[1] - 675) * s, w: 150 * s };
  return { version: '5.3.0', background: '#f3eddf', objects: popoutObjects({ W, H, id: 'pop1', photo: ph, subject: sub, sb, words }) };
}

// ---------- live: pop-out on any photo ----------
function alphaBottom(img) {
  const e = img.getElement(); const w = e.naturalWidth || e.width, h = e.naturalHeight || e.height; const k = Math.min(1, 300 / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k)); const x = c.getContext('2d'); x.drawImage(e, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data; let by = -1, sx = 0, n = 0, x0 = c.width, x1 = 0;
  for (let yy = c.height - 1; yy >= 0 && by < 0; yy--) for (let xx = 0; xx < c.width; xx++) if (d[(yy * c.width + xx) * 4 + 3] > 40) { by = yy; }
  if (by < 0) by = c.height - 1;
  for (let yy = Math.max(0, by - Math.round(c.height * 0.06)); yy <= by; yy++) for (let xx = 0; xx < c.width; xx++) if (d[(yy * c.width + xx) * 4 + 3] > 40) { sx += xx; n++; x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); }
  return { x: (n ? sx / n : c.width / 2) / k - w / 2, y: (by + 1) / k - h / 2, w: Math.max(1, x1 - x0) / k };
}
const M = fabric.util;
/** Turns the canvas into a pop-out of `photo` (lifts the subject first when none is given). Undoable. */
export async function popoutFromPhoto(photo, { subject = null, words } = {}) {
  const pf = PF(); if (!photo || photo.type !== 'image') { toast('Select a photo first'); return null; }
  const objs0 = pf.canvas.getObjects(); const above = objs0[objs0.indexOf(photo) + 1];
  let sub = subject || (above && above.pfRole === 'subject' ? above : null);
  if (!sub) { sub = await window.PF21.liftSubject(photo, { menu: false }); if (!sub) return null; }
  const pt = progressTask('Building the pop-out…');
  try {
    const { W, H } = pf.state; const L = popoutLayout(W, H); const { win } = L;
    // new photo transform: cover the window; the subject keeps its exact placement relative to the photo
    const oldP = photo.calcTransformMatrix(); const rel = M.multiplyTransformMatrices(M.invertTransform(oldP), sub.calcTransformMatrix());
    const k = Math.max(win.w / photo.width, win.h / photo.height) * 1.04;
    const sgn = (v) => (v ? -1 : 1);
    const newP = M.composeMatrix({ translateX: win.x + win.w / 2, translateY: win.y + win.h / 2, scaleX: k * sgn(photo.flipX), scaleY: k * sgn(photo.flipY), angle: 0 });
    const sM = M.qrDecompose(M.multiplyTransformMatrices(newP, rel));
    const pj = photo.toObject(pf.PROPS); const sj = sub.toObject(pf.PROPS);
    Object.assign(pj, { originX: 'center', originY: 'center', left: win.x + win.w / 2, top: win.y + win.h / 2, scaleX: k, scaleY: k, angle: 0, skewX: 0, skewY: 0, locked: false, selectable: true, evented: true,
      lockMovementX: false, lockMovementY: false, lockScalingX: false, lockScalingY: false, lockRotation: false, hasControls: true, clipPath: undefined });
    Object.assign(sj, { originX: 'center', originY: 'center', left: sM.translateX, top: sM.translateY, scaleX: Math.abs(sM.scaleX), scaleY: Math.abs(sM.scaleY), angle: sM.angle, skewX: 0, skewY: 0, locked: false, clipPath: undefined, shadow: null });
    const ab = alphaBottom(sub); const sm = M.multiplyTransformMatrices(newP, rel);
    const p = M.transformPoint(new fabric.Point(ab.x, ab.y), sm);
    const sb = { x: p.x, y: p.y, w: ab.w * Math.abs(sM.scaleX) };
    const id = 'pop' + Date.now().toString(36);
    const json = popoutObjects({ W, H, id, photo: pj, subject: sj, sb, words, leaves: [Math.floor(Math.random() * 5), Math.floor(Math.random() * 5)] });
    const objs = await new Promise((r) => fabric.util.enlivenObjects(json, r));
    await fitLeaves(objs);
    await pf.history.batch(() => {
      pf.canvas.discardActiveObject();
      pf.canvas.remove(photo); pf.canvas.remove(sub);
      objs.forEach((o, i) => pf.canvas.insertAt(o, i));
      pf.enforceLocks(objs);
      pf.canvas.setActiveObject(objs.find((o) => o.pfRole === 'popSubject'));
    });
    pf.canvas.requestRenderAll(); pf.refreshLayers(); haptic('confirm');
    toast('Pop-out ready: drag the dashed break line to choose where the subject breaks out');
    return objs;
  } finally { pt.done?.(); }
}
/** leaf stickers are sized by width after load */
export async function fitLeaves(objs) { for (const o of objs) if (o.pfLeafW && o.width) { o.scale(o.pfLeafW / o.width); o.setCoords(); } }

// ---------- break line: overlay + drag ----------
const popSubjects = () => PF().canvas.getObjects().filter((o) => o.pfRole === 'popSubject');
export function setBreak(sub, y) {
  const pf = PF(); const win = JSON.parse(sub.pfPopWin); const { W, H } = pf.state;
  y = Math.max(win.y + 10, Math.min(win.y + win.h + 400, Math.round(y)));
  sub.set('pfBreak', y);
  fabric.util.enlivenObjects([subjectClip(win, y, W, H)], ([c]) => { sub.clipPath = c; sub.dirty = true; pf.canvas.requestRenderAll(); });
  return y;
}
function drawBreak(ctx) {
  const pf = PF(); const a = pf.canvas.getActiveObject(); if (!a || !a.pfPopout || pf.state.exporting) return;
  const sub = popSubjects().find((s) => s.pfPopout === a.pfPopout); if (!sub) return;
  const v = pf.canvas.viewportTransform; const win = JSON.parse(sub.pfPopWin); const y = sub.pfBreak;
  ctx.save(); ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
  ctx.setLineDash([16 / v[0], 10 / v[0]]); ctx.lineWidth = 3 / v[0]; ctx.strokeStyle = 'rgba(255,78,138,0.95)';
  ctx.beginPath(); ctx.moveTo(win.x - 30, y); ctx.lineTo(win.x + win.w + 30, y); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ff4e8a'; ctx.beginPath(); ctx.arc(win.x + win.w + 30, y, 22 / v[0], 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = `${22 / v[0]}px Poppins`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('⇕', win.x + win.w + 30, y);
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,78,138,0.95)'; ctx.font = `${20 / v[0]}px Poppins`; ctx.fillText('break line', win.x - 26, y - 18 / v[0]);
  ctx.restore();
}
export function installPopout() {
  const pf = PF(); const c = pf.canvas;
  c.on('after:render', (e) => drawBreak(e.ctx || c.contextContainer));
  const up = c.upperCanvasEl; let drag = null;
  const world = (ev) => { const r = up.getBoundingClientRect(); const v = c.viewportTransform; return { x: ((ev.clientX - r.left) * (c.width / r.width) - v[4]) / v[0], y: ((ev.clientY - r.top) * (c.height / r.height) - v[5]) / v[3] }; };
  const onDown = (ev) => {
    const a = c.getActiveObject(); if (!a || !a.pfPopout) return;
    const sub = popSubjects().find((s) => s.pfPopout === a.pfPopout); if (!sub) return;
    const p = world(ev); const win = JSON.parse(sub.pfPopWin); const tol = 30 / c.viewportTransform[0];
    if (Math.abs(p.y - sub.pfBreak) < tol && p.x > win.x - 60 && p.x < win.x + win.w + 60) {
      ev.stopImmediatePropagation(); ev.preventDefault(); drag = { sub, dy: sub.pfBreak - p.y, keep: a };
    }
  };
  const onMove = (ev) => { if (!drag) return; ev.stopImmediatePropagation(); ev.preventDefault(); setBreak(drag.sub, world(ev).y + drag.dy); };
  const onUp = (ev) => { if (!drag) return; ev.stopImmediatePropagation(); const k = drag.keep; drag = null; c.setActiveObject(k); c.requestRenderAll(); pf.history.record(); };
  for (const [t, f] of [['pointerdown', onDown], ['mousedown', onDown], ['touchstart', (e) => e.touches.length === 1 && onDown(Object.assign(e, { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY }))]]) up.parentElement.addEventListener(t, f, { capture: true, passive: false });
  window.addEventListener('pointermove', onMove, { capture: true, passive: false }); window.addEventListener('mousemove', onMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onUp, { capture: true }); window.addEventListener('mouseup', onUp, { capture: true });
  // the subject and its contact shadow follow the photo when it is moved / scaled inside the frame
  let follow = null;
  c.on('before:transform', (e) => {
    const t = e.transform?.target; if (!t || t.pfRole !== 'popPhoto') { follow = null; return; }
    const inv = M.invertTransform(t.calcTransformMatrix());
    follow = c.getObjects().filter((o) => o.pfPopout === t.pfPopout && (o.pfRole === 'popSubject' || o.pfRole === 'popShadow')).map((o) => ({ o, rel: M.multiplyTransformMatrices(inv, o.calcTransformMatrix()) }));
  });
  const apply = (e) => { const t = e.target; if (!follow || !t || t.pfRole !== 'popPhoto') return; const m = t.calcTransformMatrix();
    for (const f of follow) { const d = M.qrDecompose(M.multiplyTransformMatrices(m, f.rel)); f.o.set({ left: d.translateX, top: d.translateY, scaleX: d.scaleX, scaleY: d.scaleY, angle: d.angle, originX: 'center', originY: 'center' }); f.o.setCoords(); } };
  c.on('object:moving', apply); c.on('object:scaling', apply); c.on('object:rotating', apply);
}

// ---------- PNG of the pop-out (frame + photo + subject + shadow + stickers, transparent) ----------
export async function popoutPNG(id, scale = 1) {
  const pf = PF(); const s = JSON.parse(pf.serialize());
  const objs = s.canvas.objects.filter((o) => o.pfPopout === (id || o.pfPopout) && o.pfRole && o.pfRole !== 'bg' && o.type !== 'text' && o.type !== 'i-text' && o.type !== 'textbox');
  if (!objs.length) throw new Error('No pop-out on this poster');
  await pf.ensureFonts({ objects: objs });
  const el2 = document.createElement('canvas'); const sc = new fabric.StaticCanvas(el2, { width: 10, height: 10, enableRetinaScaling: false, renderOnAddRemove: false });
  await new Promise((r) => sc.loadFromJSON({ version: '5.3.0', objects: objs, background: '' }, r));
  await pf.prepareMasks(sc.getObjects());
  // bounds: frame box + subject/leaf/shadow boxes, with room for the frame shadow
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const o of sc.getObjects()) {
    o.setCoords(); let b = o.getBoundingRect(true, true);
    if (o.clipPath && o.pfRole === 'popPhoto') { const c = o.clipPath; b = { left: c.left, top: c.top, width: c.width, height: c.height }; }
    if (o.pfRole === 'popSubject') { const w = JSON.parse(o.pfPopWin); const yb = Math.max(o.pfBreak, b.top); b = { left: Math.max(b.left, Math.min(b.left, w.x)), top: Math.max(b.top, w.y), width: b.width, height: Math.max(0, b.top + b.height - Math.max(b.top, w.y)) }; void yb; }
    x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.left + b.width); y1 = Math.max(y1, b.top + b.height);
  }
  const pad = 50; x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const w = Math.round((x1 - x0) * scale), h = Math.round((y1 - y0) * scale);
  sc.setDimensions({ width: w, height: h }); sc.setViewportTransform([scale, 0, 0, scale, -x0 * scale, -y0 * scale]); sc.renderAll();
  // crop to the visible pixels (+ a little room for the soft shadows)
  const src = sc.lowerCanvasEl; const d = src.getContext('2d').getImageData(0, 0, w, h).data; let a0 = w, b0 = h, a1 = -1, b1 = -1;
  for (let yy = 0; yy < h; yy += 2) for (let xx = 0; xx < w; xx += 2) if (d[(yy * w + xx) * 4 + 3] > 6) { if (xx < a0) a0 = xx; if (xx > a1) a1 = xx; if (yy < b0) b0 = yy; if (yy > b1) b1 = yy; }
  const out = document.createElement('canvas'); const cw = Math.max(1, Math.min(w, a1 + 4) - Math.max(0, a0 - 4)), ch = Math.max(1, Math.min(h, b1 + 4) - Math.max(0, b0 - 4));
  out.width = cw; out.height = ch; out.getContext('2d').drawImage(src, -Math.max(0, a0 - 4), -Math.max(0, b0 - 4));
  const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
  sc.dispose();
  return { blob, w: cw, h: ch };
}
export async function savePopoutPNG(id) {
  const pt = progressTask('Saving pop-out PNG…');
  try {
    const { blob, w, h } = await popoutPNG(id, 1);
    const name = `posterforge-popout-${Date.now()}.png`;
    const r = await sendBlob(blob, name, 'image/png', 'save');
    await window.PF22?.stickers.add(blob, 'Pop-out');
    if (r.ok) toast(`Saved transparent PNG (${w}×${h}) · added to My stickers`); else toast(r.error || 'Save failed', 'error');
    return { ...r, w, h };
  } finally { pt.done?.(); }
}
