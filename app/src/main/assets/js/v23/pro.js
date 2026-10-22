// PosterForge 2.3 pro tools: precision inspector + nudge, snap grid, history panel, gradient & pattern fills.
import { el, sheet, toast } from '../ui.js';
import { haptic } from '../native.js';
const PF = () => window.PF;
const rec = () => { PF().canvas.requestRenderAll(); PF().history.record(); };
const editable = (o) => o && !o.locked;

// ---------------- inspector ----------------
export function setGeometry(o, { x, y, w, h, angle }) {
  if (!editable(o)) return false;
  if (angle != null && isFinite(angle)) o.rotate(((Number(angle) % 360) + 360) % 360);
  const dim = o._getNonTransformedDimensions ? o._getNonTransformedDimensions() : { x: o.width, y: o.height };
  if (w != null && w > 0) o.scaleX = Number(w) / dim.x;
  if (h != null && h > 0) o.scaleY = Number(h) / dim.y;
  o.setCoords();
  const r = o.getBoundingRect(true, true);
  if (x != null && isFinite(x)) o.left += Number(x) - r.left;
  if (y != null && isFinite(y)) o.top += Number(y) - r.top;
  o.setCoords(); rec(); PF().canvas.fire('object:modified', { target: o });
  return true;
}
export function nudge(o, dx, dy) {
  if (!editable(o)) return false;
  o.left += dx; o.top += dy; o.setCoords(); PF().canvas.requestRenderAll(); PF().history.recordSoon(500); return true;
}
export function openInspector() {
  const pf = PF(); const o = pf.active();
  if (!o) { toast('Select an item first'); return; }
  let step = 1;
  const r0 = o.getBoundingRect(true, true);
  const field = (id, label, val) => el('label', {}, label, el('input', { type: 'number', id, inputmode: 'decimal', value: String(Math.round(val * 10) / 10) }));
  const grid = el('div', { class: 'v23-insp' }, field('insX', 'X', r0.left), field('insY', 'Y', r0.top), field('insW', 'W', o.getScaledWidth()), field('insH', 'H', o.getScaledHeight()), field('insR', '°', o.angle || 0));
  const val = (id) => { const v = document.getElementById(id).value; return v === '' ? null : Number(v); };
  const sync = () => { const r = o.getBoundingRect(true, true); const set = (id, v) => { const i = document.getElementById(id); if (i && document.activeElement !== i) i.value = String(Math.round(v * 10) / 10); };
    set('insX', r.left); set('insY', r.top); set('insW', o.getScaledWidth()); set('insH', o.getScaledHeight()); set('insR', o.angle || 0); };
  grid.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => {
    const ratio = o.getScaledHeight() / o.getScaledWidth();
    const g = { x: val('insX'), y: val('insY'), angle: val('insR') };
    if (i.id === 'insW') { g.w = val('insW'); if (document.getElementById('insLock')?.classList.contains('on')) g.h = g.w * ratio; }
    if (i.id === 'insH') { g.h = val('insH'); if (document.getElementById('insLock')?.classList.contains('on')) g.w = g.h / ratio; }
    setGeometry(o, g); sync(); haptic('tick');
  }));
  const nb = (txt, dx, dy, id) => el('button', { id, text: txt, 'aria-label': id, onclick: () => { nudge(o, dx * step, dy * step); sync(); haptic('tick'); } });
  const pad = el('div', { class: 'v23-nudge' }, el('span'), nb('↑', 0, -1, 'nudgeUp'), el('span'), nb('←', -1, 0, 'nudgeLeft'),
    el('button', { id: 'nudgeStep', text: '1px', onclick: (e) => { step = step === 1 ? 10 : 1; e.target.textContent = step + 'px'; } }), nb('→', 1, 0, 'nudgeRight'), el('span'), nb('↓', 0, 1, 'nudgeDown'), el('span'));
  const al = (k, t) => el('button', { 'data-al': k, text: t, onclick: () => { pf.alignTo(k); sync(); haptic('snap'); } });
  const body = el('div', {}, grid,
    el('div', { class: 'v23-row' }, el('button', { id: 'insLock', class: 'on', text: '🔗 Keep proportions', onclick: (e) => e.currentTarget.classList.toggle('on') })),
    el('div', { class: 'v23-sec', text: 'Nudge' }), pad,
    el('div', { class: 'v23-sec', text: 'Align to page' }),
    el('div', { class: 'v23-row' }, al('left', '⇤ Left'), al('hcenter', '↔ Centre'), al('right', 'Right ⇥'), al('top', '⤒ Top'), al('vcenter', '↕ Middle'), al('bottom', 'Bottom ⤓')),
    o.type === 'activeSelection' ? el('div', { class: 'v23-row' }, el('button', { text: 'Space evenly ↔', onclick: () => pf.distribute('h') }), el('button', { text: 'Space evenly ↕', onclick: () => pf.distribute('v') })) : null);
  return sheet({ title: 'Position & size', body, actions: [{ label: 'Done', value: true, kind: 'btn-accent' }] });
}

// ---------------- snap grid ----------------
export const grid = { on: localStorage.getItem('pf.grid.on') === '1', size: Number(localStorage.getItem('pf.grid.size') || 54) };
export function setGrid(on, size) {
  grid.on = !!on; if (size) grid.size = size;
  localStorage.setItem('pf.grid.on', grid.on ? '1' : '0'); localStorage.setItem('pf.grid.size', String(grid.size));
  PF().canvas.requestRenderAll();
}
export function installGrid() {
  const c = PF().canvas; let last = '';
  c.on('object:moving', (e) => {
    if (!grid.on) return; const o = e.target; if (!o) return;
    const r = o.getBoundingRect(true, true), g = grid.size;
    const nx = Math.round(r.left / g) * g, ny = Math.round(r.top / g) * g;
    o.left += nx - r.left; o.top += ny - r.top; o.setCoords();
    const k = nx + ',' + ny; if (k !== last) { last = k; haptic('snap'); }
  });
  c.on('after:render', () => {
    if (!grid.on || !c.contextTop) return;
    const ctx = c.getContext(); const vt = c.viewportTransform; const { W, H } = PF().state; const g = grid.size;
    ctx.save(); ctx.transform(vt[0], vt[1], vt[2], vt[3], vt[4], vt[5]);
    ctx.strokeStyle = 'rgba(120,170,255,.28)'; ctx.lineWidth = 1 / (vt[0] || 1); ctx.beginPath();
    for (let x = g; x < W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = g; y < H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke(); ctx.restore();
  });
}
export function openGridSheet() {
  const sizes = [27, 54, 108, 135];
  const body = el('div', {},
    el('div', { class: 'v23-row' }, el('button', { id: 'gridToggle', class: grid.on ? 'on' : '', text: grid.on ? 'Grid on' : 'Grid off', onclick: (e) => { setGrid(!grid.on); e.target.classList.toggle('on', grid.on); e.target.textContent = grid.on ? 'Grid on' : 'Grid off'; haptic('tick'); } })),
    el('div', { class: 'v23-sec', text: 'Cell size' }),
    el('div', { class: 'v23-row', id: 'gridSizes' }, ...sizes.map((s) => el('button', { class: s === grid.size ? 'on' : '', 'data-size': String(s), text: s + ' px', onclick: (e) => { setGrid(true, s); e.target.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); document.getElementById('gridToggle').classList.add('on'); document.getElementById('gridToggle').textContent = 'Grid on'; } }))),
    el('p', { class: 'note', style: 'margin-top:12px', text: 'Items snap to the grid while you drag. The grid never shows in exports.' }));
  return sheet({ title: 'Snap grid', body, actions: [{ label: 'Done', value: true, kind: 'btn-accent' }] });
}

// ---------------- history panel ----------------
function summary(json) { try { const s = JSON.parse(json); const objs = (s.canvas || s).objects || s.objects || []; return { n: objs.length, names: objs.map((o) => o.name || o.type) }; } catch (_) { return { n: 0, names: [] }; } }
export function historySteps() {
  const h = PF().history; const all = [...h.undoStack, ...[...h.redoStack].reverse()]; const cur = h.undoStack.length - 1;
  let prev = null;
  return all.map((s, i) => {
    const m = summary(s); let label = 'Start';
    if (prev) { if (m.n > prev.n) label = 'Added ' + (m.names.find((x) => !prev.names.includes(x)) || m.names[m.names.length - 1] || 'item'); else if (m.n < prev.n) label = 'Removed ' + (prev.names.find((x) => !m.names.includes(x)) || 'item'); else label = 'Edited'; }
    prev = m; return { i, label, cur: i === cur, future: i > cur, count: m.n };
  });
}
export async function jumpTo(i) {
  const h = PF().history; let cur = h.undoStack.length - 1;
  while (cur > i && h.canUndo) { await h.undo(); cur--; }
  while (cur < i && h.canRedo) { await h.redo(); cur++; }
  PF().canvas.requestRenderAll();
}
export function openHistory() {
  const list = el('div', { class: 'v23-hist', id: 'histList' });
  const draw = () => list.replaceChildren(...historySteps().reverse().map((s) => el('button', { class: s.cur ? 'cur' : s.future ? 'fut' : '', 'data-step': String(s.i),
    onclick: async () => { haptic('tick'); await jumpTo(s.i); draw(); } }, el('b', { text: (s.i + 1) + '' }), el('span', { text: s.label }), el('i', { text: s.count + ' layers' }))));
  draw();
  return sheet({ title: 'History', body: el('div', {}, el('p', { class: 'note', style: 'margin-bottom:10px', text: 'Tap a step to go back to it. Newer steps stay until you make a new change.' }), list), actions: [{ label: 'Done', value: true, kind: 'btn-accent' }] });
}

// ---------------- fills ----------------
export const GRADIENTS = [['Sunset', '#ff7a45', '#ffc768'], ['Ocean', '#0ea5e9', '#6366f1'], ['Mint', '#34d399', '#06b6d4'], ['Rose', '#f472b6', '#a855f7'], ['Gold', '#fde68a', '#b45309'], ['Night', '#1e293b', '#6d28d9'], ['Fire', '#ef4444', '#f59e0b'], ['Silver', '#f8fafc', '#64748b']];
export const PATTERNS = ['dots', 'stripes', 'checks', 'grid', 'diagonal', 'waves', 'zigzag', 'halftone'];
export function patternURL(kind, fg = '#ffffff', bg = '#111827', s = 32) {
  const c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, s, s); x.fillStyle = fg; x.strokeStyle = fg; x.lineWidth = s / 8;
  if (kind === 'dots') { x.beginPath(); x.arc(s / 2, s / 2, s / 6, 0, 7); x.fill(); }
  else if (kind === 'halftone') { x.beginPath(); x.arc(s / 4, s / 4, s / 9, 0, 7); x.arc(3 * s / 4, 3 * s / 4, s / 5, 0, 7); x.fill(); }
  else if (kind === 'stripes') x.fillRect(0, 0, s / 2, s);
  else if (kind === 'checks') { x.fillRect(0, 0, s / 2, s / 2); x.fillRect(s / 2, s / 2, s / 2, s / 2); }
  else if (kind === 'grid') { x.lineWidth = s / 16; x.strokeRect(0, 0, s, s); }
  else if (kind === 'diagonal') { x.beginPath(); x.moveTo(-s / 4, s / 4); x.lineTo(s / 4, -s / 4); x.moveTo(0, s); x.lineTo(s, 0); x.moveTo(3 * s / 4, s + s / 4); x.lineTo(s + s / 4, 3 * s / 4); x.stroke(); }
  else if (kind === 'waves') { x.beginPath(); x.moveTo(0, s / 2); x.bezierCurveTo(s / 4, s / 4, s / 4, s / 4, s / 2, s / 2); x.bezierCurveTo(3 * s / 4, 3 * s / 4, 3 * s / 4, 3 * s / 4, s, s / 2); x.stroke(); }
  else if (kind === 'zigzag') { x.beginPath(); x.moveTo(0, 3 * s / 4); x.lineTo(s / 2, s / 4); x.lineTo(s, 3 * s / 4); x.stroke(); }
  return c.toDataURL('image/png');
}
const fillable = (o) => editable(o) && o.type !== 'image' && o.type !== 'activeSelection' && o.type !== 'group';
export function applyGradient(o, c1, c2, angle = 90) {
  if (!fillable(o)) return false;
  const r = (angle * Math.PI) / 180, dx = Math.cos(r) / 2, dy = Math.sin(r) / 2;
  const w = o.width, h = o.height;
  o.set('fill', new fabric.Gradient({ type: 'linear', coords: { x1: (0.5 - dx) * w - (o.type.includes('text') ? 0 : 0), y1: (0.5 - dy) * h, x2: (0.5 + dx) * w, y2: (0.5 + dy) * h }, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] }));
  o.set('pfFill', JSON.stringify({ kind: 'gradient', c1, c2, angle })); o.dirty = true; rec(); return true;
}
export function applyPattern(o, kind, fg, bg) {
  if (!fillable(o)) return Promise.resolve(false);
  return new Promise((res) => { const img = new Image(); img.onload = () => {
    o.set('fill', new fabric.Pattern({ source: img, repeat: 'repeat' })); o.set('pfFill', JSON.stringify({ kind: 'pattern', pattern: kind, fg, bg })); o.dirty = true; rec(); res(true); };
    img.onerror = () => res(false); img.src = patternURL(kind, fg, bg); });
}
export function openFills() {
  const o = PF().active();
  if (!fillable(o)) { toast('Select a shape or text to fill'); return; }
  let fg = '#ffffff', bg = typeof o.fill === 'string' ? o.fill : '#111827', angle = 90;
  const gBox = el('div', { class: 'v23-fills', id: 'fillGradients' }, ...GRADIENTS.map(([n, a, b]) => el('button', { 'data-grad': n, title: n, 'aria-label': n, style: `background:linear-gradient(135deg,${a},${b})`, onclick: () => { applyGradient(o, a, b, angle); haptic('tick'); } })));
  const pBox = el('div', { class: 'v23-fills', id: 'fillPatterns' });
  const drawP = () => pBox.replaceChildren(...PATTERNS.map((k) => el('button', { 'data-pattern': k, 'aria-label': k, title: k, style: `background-image:url(${patternURL(k, fg, bg, 24)});background-size:24px`, onclick: () => { applyPattern(o, k, fg, bg); haptic('tick'); } })));
  drawP();
  const col = (v, f) => { const i = el('input', { type: 'color', value: v }); i.oninput = () => { f(i.value); drawP(); }; return i; };
  const ang = el('input', { type: 'range', min: 0, max: 359, value: 90, id: 'fillAngle' }); ang.oninput = () => { angle = Number(ang.value); };
  const body = el('div', {}, el('div', { class: 'v23-sec', text: 'Gradient' }), gBox,
    el('div', { class: 'slider-row', style: 'margin-top:8px' }, el('span', { class: 'lbl', text: 'Angle' }), ang),
    el('div', { class: 'v23-sec', text: 'Pattern' }), el('div', { class: 'v23-row' }, el('span', { class: 'note', text: 'Ink' }), col(fg, (v) => { fg = v; }), el('span', { class: 'note', text: 'Paper' }), col(bg, (v) => { bg = v; })), pBox,
    el('div', { class: 'v23-row' }, el('button', { id: 'fillSolid', text: 'Back to solid colour', onclick: () => { o.set({ fill: bg, pfFill: null }); o.dirty = true; rec(); } })));
  return sheet({ title: 'Fill', body, actions: [{ label: 'Done', value: true, kind: 'btn-accent' }] });
}
