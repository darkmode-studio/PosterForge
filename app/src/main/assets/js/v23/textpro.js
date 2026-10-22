// PosterForge 2.3 advanced text: up to 3 extra outlines, 3D extrude, auto-fit to box.
// (Render core first drafted by Gemini, reviewed and rewritten.)
import { el, sheet, toast } from '../ui.js';
import { haptic } from '../native.js';
const PF = () => window.PF;
const parse = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch (_) { return null; } };
export const strokesOf = (o) => (parse(o.pfStrokes) || []).filter((s) => s && s.c && Number(s.w) > 0).slice(0, 3);
export const extrudeOf = (o) => { const e = parse(o.pfExtrude); return e && Number(e.depth) > 0 ? { depth: Math.min(60, Number(e.depth)), angle: Number(e.angle) || 0, color: e.color || '#000000' } : null; };
const hasFx = (o) => !!(o && (o.pfStrokes || o.pfExtrude));

let installed = false;
export function installTextPro() {
  if (installed) return; installed = true;
  for (const p of ['pfStrokes', 'pfExtrude', 'pfAutoFit', 'pfFitH']) if (!PF().PROPS.includes(p)) PF().PROPS.push(p);
  const T = fabric.Text.prototype; const orig = T._render;
  T._render = function (ctx) {
    if (this.__pfFx) return orig.call(this, ctx);
    const ex = extrudeOf(this), st = strokesOf(this);
    if (!ex && !st.length) return orig.call(this, ctx);
    const keep = { fill: this.fill, stroke: this.stroke, strokeWidth: this.strokeWidth, paintFirst: this.paintFirst, shadow: this.shadow, textBackgroundColor: this.textBackgroundColor };
    this.__pfFx = true;
    try {
      this.shadow = null; this.textBackgroundColor = '';
      if (ex) {
        const a = (ex.angle * Math.PI) / 180, sx = Math.cos(a), sy = Math.sin(a);
        this.fill = ex.color; this.stroke = st.length ? st[0].c : keep.stroke; this.strokeWidth = st.length ? st[0].w * 2 + (keep.strokeWidth || 0) : keep.strokeWidth;
        for (let i = ex.depth; i >= 1; i--) { ctx.save(); ctx.translate(sx * i, sy * i); if (i === ex.depth && keep.shadow) { this.shadow = keep.shadow; } orig.call(this, ctx); this.shadow = null; ctx.restore(); }
      }
      if (st.length) {
        this.fill = 'transparent'; this.paintFirst = 'stroke';
        for (let i = 0; i < st.length; i++) {
          const outer = st.slice(i).reduce((s, x) => s + x.w * 2, 0);
          this.stroke = st[i].c; this.strokeWidth = outer + (keep.strokeWidth || 0); orig.call(this, ctx);
        }
      }
    } finally { Object.assign(this, keep); this.__pfFx = false; }
    if (ex) this.shadow = null;
    try { orig.call(this, ctx); } finally { this.shadow = keep.shadow; }
  };
  // effects draw outside the text box, so skip the object cache (it would clip them)
  const sc = T.shouldCache; T.shouldCache = function () { return hasFx(this) ? (this.ownCaching = false) : sc.call(this); };
  const c = PF().canvas;
  c.on('object:modified', (e) => { const o = e.target; if (o && o.type === 'textbox' && o.pfAutoFit) { if (o.scaleY !== 1 || o.scaleX !== 1) { o.set({ width: o.width * o.scaleX, pfFitH: o.height * o.scaleY, scaleX: 1, scaleY: 1 }); } autoFit(o); PF().history.recordSoon(200); } });
  c.on('text:changed', (e) => { const o = e.target; if (o && o.type === 'textbox' && o.pfAutoFit) autoFit(o); });
}

/** Largest font size (8..600) at which the text box's lines fit its width and pfFitH height without breaking words. */
export function autoFit(o) {
  if (!o || o.type !== 'textbox' || !o.text) return false;
  if (!o.pfFitH) o.pfFitH = o.height;
  const H = o.pfFitH; let lo = 8, hi = 600, best = 8;
  const words = o.text.split(/\s+/).length;
  const fits = () => { o.initDimensions(); const lines = o._textLines ? o._textLines.length : 1; return o.height <= H && (o.dynamicMinWidth || 0) <= o.width + 0.5 && lines <= Math.max(words, o.text.split('\n').length); };
  while (lo <= hi) { const mid = (lo + hi) >> 1; o.set('fontSize', mid); if (fits()) { best = mid; lo = mid + 1; } else hi = mid - 1; }
  o.set('fontSize', best); o.initDimensions(); o.setCoords(); o.dirty = true; PF().canvas.requestRenderAll();
  return best;
}
const changed = (o) => { o.dirty = true; o.setCoords(); PF().canvas.requestRenderAll(); PF().history.recordSoon(250); };
export function setStrokes(o, arr) { if (!o || o.locked) return; o.set('pfStrokes', arr && arr.length ? JSON.stringify(arr.slice(0, 3)) : null); changed(o); }
export function setExtrude(o, e) { if (!o || o.locked) return; o.set('pfExtrude', e && e.depth > 0 ? JSON.stringify(e) : null); changed(o); }
export function setAutoFit(o, on) { if (!o || o.type !== 'textbox' || o.locked) return false; o.set({ pfAutoFit: !!on, pfFitH: on ? (o.pfFitH || o.height * (o.scaleY || 1)) : null }); if (on) autoFit(o); changed(o); return true; }

const PRESETS = [
  ['Sticker', { strokes: [{ w: 10, c: '#ffffff' }, { w: 4, c: '#111111' }] }],
  ['Retro 3D', { extrude: { depth: 14, angle: 45, color: '#7c2d12' }, strokes: [{ w: 3, c: '#111111' }] }],
  ['Neon double', { strokes: [{ w: 6, c: '#f0abfc' }, { w: 3, c: '#a21caf' }] }],
  ['Block shadow', { extrude: { depth: 10, angle: 60, color: '#111827' } }],
  ['Comic', { extrude: { depth: 8, angle: 30, color: '#111111' }, strokes: [{ w: 5, c: '#111111' }] }],
];

export function openTextPro(o = PF().active()) {
  if (!o || !PF().isText(o)) { toast('Select some text first'); return null; }
  if (o.locked) { toast('This text is locked'); return null; }
  let strokes = strokesOf(o).map((s) => ({ ...s }));
  let ex = extrudeOf(o) || { depth: 0, angle: 45, color: '#000000' };
  const sList = el('div', { class: 'col-gap', id: 'tpStrokes' });
  const drawS = () => sList.replaceChildren(...strokes.map((s, i) => {
    const c = el('input', { type: 'color', value: s.c }); c.oninput = () => { s.c = c.value; setStrokes(o, strokes); };
    const r = el('input', { type: 'range', min: 1, max: 30, value: s.w }); r.oninput = () => { s.w = Number(r.value); setStrokes(o, strokes); };
    return el('div', { class: 'slider-row' }, c, r, el('button', { class: 'chip small', text: '✕', 'aria-label': 'Remove outline', onclick: () => { strokes.splice(i, 1); setStrokes(o, strokes); drawS(); } }));
  }));
  drawS();
  const range = (id, min, max, val, fn) => { const r = el('input', { type: 'range', id, min, max, value: val }); r.oninput = () => fn(Number(r.value)); return r; };
  const exCol = el('input', { type: 'color', id: 'tpExtrudeColor', value: ex.color }); exCol.oninput = () => { ex.color = exCol.value; setExtrude(o, ex); };
  const presets = el('div', { class: 'v23-row', id: 'tpPresets' }, ...PRESETS.map(([n, p]) => el('button', { 'data-preset': n, text: n, onclick: () => {
    strokes = (p.strokes || []).map((s) => ({ ...s })); ex = { ...(p.extrude || { depth: 0, angle: 45, color: ex.color }) };
    setStrokes(o, strokes); setExtrude(o, ex); drawS(); document.getElementById('tpExtrudeDepth').value = ex.depth; document.getElementById('tpExtrudeAngle').value = ex.angle; exCol.value = ex.color; haptic('tick'); } })),
    el('button', { text: 'None', 'data-preset': 'none', onclick: () => { strokes = []; ex.depth = 0; setStrokes(o, []); setExtrude(o, null); drawS(); document.getElementById('tpExtrudeDepth').value = 0; } }));
  const box = o.type === 'textbox';
  const body = el('div', {},
    el('div', { class: 'v23-sec', text: 'Quick looks' }), presets,
    el('div', { class: 'v23-sec', text: 'Extra outlines' }), sList,
    el('div', { class: 'v23-row' }, el('button', { id: 'tpAddStroke', text: '+ Add outline', onclick: () => { if (strokes.length >= 3) { toast('Up to 3 extra outlines'); return; } strokes.push({ w: 4, c: strokes.length ? '#000000' : '#ffffff' }); setStrokes(o, strokes); drawS(); haptic('tick'); } })),
    el('div', { class: 'v23-sec', text: '3D extrude' }),
    el('div', { class: 'slider-row' }, el('span', { class: 'lbl', text: 'Depth' }), range('tpExtrudeDepth', 0, 60, ex.depth, (v) => { ex.depth = v; setExtrude(o, ex); })),
    el('div', { class: 'slider-row' }, el('span', { class: 'lbl', text: 'Angle' }), range('tpExtrudeAngle', 0, 359, ex.angle, (v) => { ex.angle = v; setExtrude(o, ex); })),
    el('div', { class: 'slider-row' }, el('span', { class: 'lbl', text: 'Colour' }), exCol),
    el('div', { class: 'v23-sec', text: 'Auto-fit' }),
    box ? el('div', { class: 'v23-row' }, el('button', { id: 'tpAutoFit', class: o.pfAutoFit ? 'on' : '', text: o.pfAutoFit ? 'Auto-fit on' : 'Auto-fit off', onclick: (e) => { setAutoFit(o, !o.pfAutoFit); e.target.classList.toggle('on', !!o.pfAutoFit); e.target.textContent = o.pfAutoFit ? 'Auto-fit on' : 'Auto-fit off'; haptic('tick'); } }))
      : el('p', { class: 'note', text: 'Auto-fit works on text boxes (Add body text). Headlines keep their own size.' }),
    el('p', { class: 'note', style: 'margin-top:8px', text: 'Auto-fit picks the biggest size that fits the box when you type or resize it.' }));
  return sheet({ title: 'Text effects pro', body, actions: [{ label: 'Done', value: true, kind: 'btn-accent' }] });
}
