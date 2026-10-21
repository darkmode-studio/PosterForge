// 2.2 collage presets (ported in spirit from Collage Studio): grids 2/3/4/6/9 with gap + corner sliders, story strips,
// magazine hero, polaroid scatter with tape, film strip with sprocket holes, shape collages (heart, circle, letters)
// and a carousel panorama. Every cell is a photo clipped by an absolute clip shape: tap an empty cell to add a photo,
// "Swap photo" to replace it, drag / pinch inside the cell to pan / zoom, and drag the dividers to resize.
/* global fabric */
import { el, sheet, toast, closeTopSheet, progressTask, promptSheet } from '../ui.js';
import { hideHome } from '../v2/home.js';
import { haptic } from '../native.js';

const PF = () => window.PF;
const T = (d, w, k) => ({ d, w, k: k || w.map(() => null) });
const story = [1080, 1920], post = [1080, 1350], square = [1080, 1080];
export const LAYOUTS = [
  { id: 'grid2', name: 'Grid 2', group: 'Grids', kind: 'tree', size: post, root: T('row', [1, 1]) },
  { id: 'grid3', name: 'Grid 3', group: 'Grids', kind: 'tree', size: post, root: T('col', [1.2, 1], [null, T('row', [1, 1])]) },
  { id: 'grid4', name: 'Grid 4', group: 'Grids', kind: 'tree', size: post, root: T('col', [1, 1], [T('row', [1, 1]), T('row', [1, 1])]) },
  { id: 'grid6', name: 'Grid 6', group: 'Grids', kind: 'tree', size: post, root: T('col', [1, 1, 1], [T('row', [1, 1]), T('row', [1, 1]), T('row', [1, 1])]) },
  { id: 'grid9', name: 'Grid 9', group: 'Grids', kind: 'tree', size: square, root: T('col', [1, 1, 1], [T('row', [1, 1, 1]), T('row', [1, 1, 1]), T('row', [1, 1, 1])]) },
  { id: 'strip2', name: 'Story strip 2', group: 'Story strips', kind: 'tree', size: story, root: T('col', [1, 1]), bg: '#000000' },
  { id: 'strip3', name: 'Story strip 3', group: 'Story strips', kind: 'tree', size: story, root: T('col', [1, 1, 1]), bg: '#000000' },
  { id: 'magazine', name: 'Magazine hero', group: 'Editorial', kind: 'tree', size: post, root: T('row', [2, 1], [null, T('col', [1, 1, 1])]) },
  { id: 'polaroid', name: 'Polaroid scatter', group: 'Editorial', kind: 'free', size: post, bg: '#d8ccb6', noGap: true },
  { id: 'film', name: 'Film strip', group: 'Editorial', kind: 'free', size: story, bg: '#efe9dc', noGap: true },
  { id: 'heart', name: 'Heart', group: 'Shapes', kind: 'mask', size: square, shape: 'heart', n: 7 },
  { id: 'circle', name: 'Circle', group: 'Shapes', kind: 'mask', size: square, shape: 'circle', n: 6 },
  { id: 'letters', name: 'Letters', group: 'Shapes', kind: 'letters', size: [1620, 1080], text: 'LOVE' },
  { id: 'panorama', name: 'Carousel panorama', group: 'Carousel', kind: 'tree', size: [3240, 1350], root: T('row', [1400, 820, 960], [null, T('col', [1, 1]), null]) },
];
export const layoutById = (id) => LAYOUTS.find((l) => l.id === id);
const clone = (x) => JSON.parse(JSON.stringify(x));

/** Cell rectangles (+ dividers) of a tree layout. Weights live in the (cloned) tree. */
export function treeCells(root, W, H, gap) {
  const cells = [], divs = [];
  const walk = (n, x, y, w, h, path) => {
    if (!n) { cells.push({ x, y, w, h }); return; }
    const horiz = n.d === 'row'; const total = n.w.reduce((a, b) => a + b, 0); const span = (horiz ? w : h) - gap * (n.w.length - 1);
    let p = horiz ? x : y;
    n.w.forEach((wt, i) => {
      const s = span * wt / total;
      if (horiz) walk(n.k[i], p, y, s, h, [...path, i]); else walk(n.k[i], x, p, w, s, [...path, i]);
      p += s;
      if (i < n.w.length - 1) divs.push({ path, i, horiz, x: horiz ? p + gap / 2 : x + w / 2, y: horiz ? y + h / 2 : p + gap / 2, len: horiz ? h : w, span, total });
      p += gap;
    });
  };
  walk(root, gap, gap, W - gap * 2, H - gap * 2, []);
  return { cells, divs };
}
/** Heart / circle mosaic: grid cells whose centre lies inside the shape. */
export function maskCells(shape, n, W, H, gap) {
  const m = W * 0.06; const cs = (Math.min(W, H) - m * 2) / n; const out = [];
  const inside = (u, v) => { // u,v in -1..1
    if (shape === 'circle') return u * u + v * v <= 1.0;
    const x = u * 1.25, y = -v * 1.25 + 0.25; const a = x * x + y * y - 1; return a * a * a - x * x * y * y * y <= 0;
  };
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const cx = m + cs * (c + 0.5), cy = m + cs * (r + 0.5);
    if (inside((cx - W / 2) / (cs * n / 2), (cy - H / 2) / (cs * n / 2))) out.push({ x: cx - cs / 2 + gap / 2, y: cy - cs / 2 + gap / 2, w: cs - gap, h: cs - gap });
  }
  return out;
}
function freeCells(id, W, H) {
  if (id === 'polaroid') return [[310, 360, 400, -8], [770, 400, 380, 6], [330, 880, 380, 5], [760, 930, 410, -5]].map(([cx, cy, s, a]) => ({ cx, cy, w: s, h: s, angle: a }));
  if (id === 'film') { const x = 250, w = W - 500, h = 400; return [0, 1, 2, 3].map((i) => ({ x, y: 150 + i * 430, w, h })); }
  return [];
}
function freeDecor(id, W, H, cells, cid) {
  const d = (o) => ({ version: '5.3.0', pfCollageDecor: cid, selectable: false, evented: false, locked: true, hasControls: false, ...o });
  if (id === 'polaroid') {
    const out = [d({ type: 'rect', left: 0, top: 0, width: W, height: H, strokeWidth: 0, fill: { type: 'pattern', source: 'img/v22/paper-ivory.webp', repeat: 'repeat' }, opacity: 0.55, name: 'Paper', pfRole: 'bg' })];
    cells.forEach((c, i) => {
      out.push(d({ type: 'rect', originX: 'center', originY: 'center', left: c.cx, top: c.cy + 40, width: c.w + 56, height: c.h + 160, angle: c.angle, fill: '#fbfaf6', strokeWidth: 0,
        shadow: { color: 'rgba(0,0,0,0.28)', blur: 24, offsetX: 4, offsetY: 10 }, name: 'Polaroid' }));
      const a = (c.angle * Math.PI) / 180; const ty = c.cy - c.h / 2 - 28 - 10;
      out.push(d({ type: 'image', originX: 'center', originY: 'center', src: 'img/v22/tape.webp', crossOrigin: null, left: c.cx + Math.sin(a) * (c.cy - ty), top: ty + (1 - Math.cos(a)) * 0, angle: c.angle + (i % 2 ? 7 : -9), scaleX: 0.75, scaleY: 0.75, opacity: 0.92, name: 'Tape', pfDecorTop: true }));
    });
    return out;
  }
  if (id === 'film') {
    const sx = 150, sw = W - 300; const out = [d({ type: 'rect', left: sx, top: 0, width: sw, height: H, fill: '#141210', strokeWidth: 0, name: 'Film strip', shadow: { color: 'rgba(0,0,0,0.3)', blur: 30, offsetX: 0, offsetY: 8 } })];
    for (let y = 26; y < H; y += 74) for (const x of [sx + 28, sx + sw - 28 - 30]) out.push(d({ type: 'rect', left: x, top: y, width: 30, height: 42, rx: 6, ry: 6, fill: '#efe9dc', strokeWidth: 0, name: 'Sprocket hole' }));
    cells.forEach((c, i) => out.push(d({ type: 'text', left: c.x + 6, top: c.y + c.h + 4, text: `▸ ${12 + i}A`, fontFamily: 'Space Mono', fontSize: 20, fill: '#f0a020', name: 'Frame number', pfDecorTop: true })));
    out.push(d({ type: 'text', originX: 'center', left: W / 2, top: H - 36, text: 'PF 400  ·  SAFETY FILM', fontFamily: 'Space Mono', fontSize: 18, fill: '#f0a020', charSpacing: 200, name: 'Film label', pfDecorTop: true }));
    return out;
  }
  return [];
}
function letterCells(text, W, H) {
  const t = String(text || 'LOVE').toUpperCase().slice(0, 8); const n = t.length; const fs = Math.min(H * 0.9, (W * 0.94) / (n * 0.55));
  const out = []; const tw = fs * 0.5 * n; let x = (W - tw) / 2 + fs * 0.25;
  for (const ch of t) { out.push({ ch, cx: x, cy: H / 2, fs }); x += fs * 0.5; }
  return out;
}
/** Clip JSON for a cell (absolute). */
function clipFor(cell, radius) {
  if (cell.ch) return { type: 'text', version: '5.3.0', originX: 'center', originY: 'center', left: cell.cx, top: cell.cy, text: cell.ch, fontFamily: 'Anton', fontSize: cell.fs, fill: '#000', absolutePositioned: true, textAlign: 'center' };
  if (cell.angle != null) return { type: 'rect', version: '5.3.0', originX: 'center', originY: 'center', left: cell.cx, top: cell.cy, width: cell.w, height: cell.h, angle: cell.angle, fill: '#000', strokeWidth: 0, absolutePositioned: true };
  const r = Math.min(radius, cell.w / 2, cell.h / 2);
  return { type: 'rect', version: '5.3.0', originX: 'left', originY: 'top', left: cell.x, top: cell.y, width: cell.w, height: cell.h, rx: r, ry: r, fill: '#000', strokeWidth: 0, absolutePositioned: true };
}
const cellBox = (c) => (c.ch ? { x: c.cx - c.fs * 0.27, y: c.cy - c.fs * 0.5, w: c.fs * 0.54, h: c.fs } : c.angle != null ? { x: c.cx - c.w * 0.62, y: c.cy - c.h * 0.62, w: c.w * 1.24, h: c.h * 1.24 } : c);

/** All cells of a collage meta {layout, gap, radius, root?, text?} for artboard W×H. */
export function cellsOf(meta, W, H) {
  const L = layoutById(meta.layout);
  if (L.kind === 'tree') return treeCells(meta.root, W, H, meta.gap);
  if (L.kind === 'mask') return { cells: maskCells(L.shape, L.n, W, H, Math.max(4, meta.gap)), divs: [] };
  if (L.kind === 'letters') return { cells: letterCells(meta.text || L.text, W, H), divs: [] };
  return { cells: freeCells(L.id, W, H), divs: [] };
}

const placeholderJSON = (cell, i, meta, radius) => {
  const b = cellBox(cell);
  const base = { version: '5.3.0', pfCell: i, pfCollage: JSON.stringify(meta), name: `Empty cell ${i + 1}`, hasControls: false, lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true, hoverCursor: 'pointer' };
  if (cell.ch) return { ...clipFor(cell), absolutePositioned: false, fill: '#cfc8ba', ...base };
  if (cell.angle != null) return { ...clipFor(cell), absolutePositioned: false, fill: '#cfc8ba', ...base };
  return { type: 'rect', left: b.x, top: b.y, width: b.w, height: b.h, rx: Math.min(radius, b.w / 2), ry: Math.min(radius, b.h / 2), fill: '#cfc8ba', strokeWidth: 0, ...base };
};
const metaOf = (o) => { try { return JSON.parse(o.pfCollage); } catch (_) { return null; } };
export const cellObjects = (id) => PF().canvas.getObjects().filter((o) => o.pfCell != null && metaOf(o)?.id === id).sort((a, b) => a.pfCell - b.pfCell);
export const collageIds = () => [...new Set(PF().canvas.getObjects().filter((o) => o.pfCell != null).map((o) => metaOf(o)?.id))].filter(Boolean);

/** Creates a collage on a fresh artboard of the layout's size. urls fill the cells in order (cycled for shape mosaics). */
export async function buildCollage(layoutId, urls = [], { gap, radius = 0, text } = {}) {
  const pf = PF(); const L = layoutById(layoutId); if (!L) throw new Error('Unknown collage ' + layoutId);
  const [W, H] = L.size; const id = 'c' + Date.now().toString(36);
  const meta = { id, layout: L.id, gap: gap ?? (L.noGap ? 0 : L.kind === 'tree' ? Math.round(W / 1080 * 16) : 10), radius, root: L.root ? clone(L.root) : undefined, text: text || L.text };
  const { cells } = cellsOf(meta, W, H);
  const decor = L.kind === 'free' ? freeDecor(L.id, W, H, cells, id) : [];
  const json = [...decor.filter((d) => !d.pfDecorTop), ...cells.map((c, i) => placeholderJSON(c, i, meta, radius)), ...decor.filter((d) => d.pfDecorTop)];
  await pf.history.batch(async () => {
    await pf.setArtboard(W, H, false);
    pf.canvas.clear(); pf.canvas.setBackgroundColor(L.bg || '#ffffff');
    const objs = await new Promise((r) => fabric.util.enlivenObjects(json, r));
    objs.forEach((o) => pf.canvas.add(o)); pf.enforceLocks(objs);
  });
  pf.state.projectName = L.name; pf.state.zoom = 1; pf.state.panX = pf.state.panY = 0; pf.layout();
  if (urls.length) await fillCells(id, urls, 0, { cycle: L.kind === 'mask' || L.kind === 'letters' });
  pf.canvas.requestRenderAll(); pf.refreshLayers(); return id;
}
const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image load failed')); i.src = url; });
/** Scale/centre `img` so it covers the box. */
function cover(img, b, keep = false) {
  const k = Math.max(b.w / img.width, b.h / img.height);
  if (keep) { // keep the user's zoom/pan if the photo still covers the box
    const s = Math.max(img.scaleX, k); img.set({ scaleX: s, scaleY: s }); clampInside(img, b); return;
  }
  img.set({ originX: 'center', originY: 'center', scaleX: k, scaleY: k, left: b.x + b.w / 2, top: b.y + b.h / 2, angle: 0 }); img.setCoords();
}
function clampInside(img, b) {
  const w = img.width * img.scaleX, h = img.height * img.scaleY;
  const cx = Math.min(b.x + w / 2, Math.max(b.x + b.w - w / 2, img.left)), cy = Math.min(b.y + h / 2, Math.max(b.y + b.h - h / 2, img.top));
  img.set({ left: cx, top: cy }); img.setCoords();
}
async function cellImage(url, cell, i, meta) {
  const im = await loadImg(url);
  const o = new fabric.Image(im, { name: `Cell ${i + 1} photo`, pfCell: i, pfCollage: JSON.stringify(meta), perPixelTargetFind: true, lockRotation: true, hasControls: false, lockScalingFlip: true });
  const b = cellBox(cell); cover(o, b);
  if (cell.angle != null) o.set({ angle: cell.angle });
  const [c] = await new Promise((r) => fabric.util.enlivenObjects([clipFor(cell, meta.radius)], r)); o.clipPath = c;
  return o;
}
/** Fills cells starting at `start` (empty ones first) with urls. Replaces the placeholder at the same z-index. */
export async function fillCells(id, urls, start = 0, { cycle = false, replace = false } = {}) {
  const pf = PF(); const objs = cellObjects(id); if (!objs.length) return 0;
  const meta = metaOf(objs[0]); const { cells } = cellsOf(meta, pf.state.W, pf.state.H);
  let targets = objs.filter((o) => o.pfCell >= start && (replace || o.type !== 'image'));
  if (!targets.length && !replace) targets = objs.filter((o) => o.pfCell >= start);
  const n = cycle ? targets.length : Math.min(targets.length, urls.length);
  await pf.history.batch(async () => {
    for (let j = 0; j < n; j++) {
      const t = targets[j]; const im = await cellImage(urls[j % urls.length], cells[t.pfCell], t.pfCell, meta);
      const idx = pf.canvas.getObjects().indexOf(t); pf.canvas.remove(t); pf.canvas.insertAt(im, idx);
    }
  });
  pf.canvas.requestRenderAll(); pf.refreshLayers(); return n;
}
/** Re-lays out a collage after a gap / corner / divider change (keeps each photo's zoom and pan when it still covers). */
export function relayout(id, patch = {}) {
  const pf = PF(); const objs = cellObjects(id); if (!objs.length) return null;
  const meta = { ...metaOf(objs[0]), ...patch }; const { cells } = cellsOf(meta, pf.state.W, pf.state.H); const ms = JSON.stringify(meta);
  for (const o of objs) {
    const c = cells[o.pfCell]; if (!c) continue; o.set('pfCollage', ms);
    if (o.type === 'image') {
      fabric.util.enlivenObjects([clipFor(c, meta.radius)], ([cl]) => { o.clipPath = cl; o.dirty = true; pf.canvas.requestRenderAll(); });
      if (c.angle == null && !c.ch) cover(o, cellBox(c), true);
    } else if (!c.ch && c.angle == null) { const r = Math.min(meta.radius, c.w / 2, c.h / 2); o.set({ left: c.x, top: c.y, width: c.w, height: c.h, rx: r, ry: r }); o.setCoords(); }
  }
  pf.canvas.requestRenderAll(); return meta;
}
/** Drags divider d (from cellsOf) by `delta` world px: moves weight between its two neighbours. */
export function moveDivider(id, d, delta) {
  const objs = cellObjects(id); const meta = metaOf(objs[0]); let n = meta.root; for (const i of d.path) n = n.k[i];
  const unit = d.total / d.span; const a = n.w[d.i], b = n.w[d.i + 1]; const min = d.total * 0.08;
  const dw = Math.max(-(a - min), Math.min(b - min, delta * unit));
  n.w[d.i] = a + dw; n.w[d.i + 1] = b - dw;
  return relayout(id, { root: meta.root });
}
export async function zoomCell(o, factor, px, py) {
  const meta = metaOf(o); const pf = PF(); const { cells } = cellsOf(meta, pf.state.W, pf.state.H); const b = cellBox(cells[o.pfCell]);
  const min = Math.max(b.w / o.width, b.h / o.height); const s = Math.max(min, Math.min(min * 8, o.scaleX * factor));
  const cx = px ?? o.left, cy = py ?? o.top; const r = s / o.scaleX;
  o.set({ scaleX: s, scaleY: s, left: cx + (o.left - cx) * r, top: cy + (o.top - cy) * r }); if (cells[o.pfCell].angle == null) clampInside(o, b); o.setCoords(); pf.canvas.requestRenderAll();
}

// ---------- interaction: tap empty cell, swap, clamp pan, pinch, divider handles ----------
let pendingCell = null;
function pickPhotos(onFiles, multiple = true) {
  let inp = document.getElementById('collageInput');
  if (!inp) { inp = el('input', { type: 'file', accept: 'image/*', id: 'collageInput', class: 'hidden' }); document.body.append(inp); }
  inp.multiple = multiple; inp.value = '';
  inp.onchange = async () => { const fs = [...inp.files]; inp.value = ''; if (fs.length) await onFiles(fs); };
  inp.click();
}
async function filesToURLs(files) {
  const pf = PF(); const out = [];
  for (const f of files) { const o = await pf.importPhoto(f, { label: 'Adding photo…' }); out.push(o.getSrc()); }
  return out;
}
export function addPhotosTo(id, start = 0) { pendingCell = { id, start }; pickPhotos(async (fs) => { const urls = await filesToURLs(fs); await fillCells(id, urls, start, { cycle: false }); pendingCell = null; }); }
export function swapPhoto(o) {
  const meta = metaOf(o); if (!meta) return;
  pickPhotos(async ([f]) => { const [u] = await filesToURLs([f]); await fillCells(meta.id, [u], o.pfCell, { replace: true }); }, false);
}
const divsOf = (id) => { const objs = cellObjects(id); if (!objs.length) return []; const meta = metaOf(objs[0]); if (layoutById(meta.layout).kind !== 'tree') return []; return cellsOf(meta, PF().state.W, PF().state.H).divs; };
function drawOverlay(ctx) {
  const pf = PF(); const ids = collageIds(); if (!ids.length) return;
  const v = pf.canvas.viewportTransform; ctx.save(); ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
  for (const id of ids) {
    for (const o of cellObjects(id)) if (o.type !== 'image') { const b = o.getBoundingRect(true, true); ctx.fillStyle = 'rgba(60,52,40,0.65)'; ctx.font = `${Math.max(16, Math.min(46, b.width * 0.12))}px Poppins`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('＋', b.left + b.width / 2, b.top + b.height / 2); }
    for (const d of divsOf(id)) {
      const r = 18 / v[0]; ctx.fillStyle = 'rgba(255,78,138,0.92)'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3 / v[0];
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(d.x - (d.horiz ? r * 0.6 : r * 1.6), d.y - (d.horiz ? r * 1.6 : r * 0.6), d.horiz ? r * 1.2 : r * 3.2, d.horiz ? r * 3.2 : r * 1.2, r * 0.6); else ctx.rect(d.x - r, d.y - r, r * 2, r * 2);
      ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}
export function installCollage() {
  const pf = PF(); const c = pf.canvas;
  c.on('after:render', (e) => drawOverlay(e.ctx || c.contextContainer));
  c.on('mouse:up', (e) => { const t = e.target; if (!t || t.pfCell == null || t.type === 'image' || e.isClick === false) return; const m = metaOf(t); if (m && !drag) addPhotosTo(m.id, t.pfCell); });
  c.on('object:moving', (e) => { const o = e.target; if (!o || o.pfCell == null || o.type !== 'image') return; const m = metaOf(o); const cl = cellsOf(m, pf.state.W, pf.state.H).cells[o.pfCell]; if (cl && cl.angle == null && !cl.ch) clampInside(o, cellBox(cl)); });
  // divider drag
  const up = c.upperCanvasEl; let drag = null;
  const world = (ev) => { const r = up.getBoundingClientRect(); const v = c.viewportTransform; return { x: ((ev.clientX - r.left) * (c.width / r.width) - v[4]) / v[0], y: ((ev.clientY - r.top) * (c.height / r.height) - v[5]) / v[3] }; };
  const onDown = (ev) => {
    if (drag) return; const p = world(ev); const tol = 34 / c.viewportTransform[0];
    for (const id of collageIds()) for (const d of divsOf(id)) if (Math.abs(p.x - d.x) < tol && Math.abs(p.y - d.y) < tol * 1.6) { ev.stopImmediatePropagation(); ev.preventDefault(); drag = { id, d, last: d.horiz ? p.x : p.y }; return; }
  };
  const onMove = (ev) => { if (!drag) return; ev.stopImmediatePropagation(); ev.preventDefault(); const p = world(ev); const v = drag.d.horiz ? p.x : p.y; moveDivider(drag.id, drag.d, v - drag.last); drag.last = v;
    drag.d = divsOf(drag.id).find((x) => JSON.stringify(x.path) === JSON.stringify(drag.d.path) && x.i === drag.d.i) || drag.d; };
  const onUp = (ev) => { if (!drag) return; ev.stopImmediatePropagation(); drag = null; pf.history.record(); setTimeout(() => {}, 0); };
  for (const t of ['pointerdown', 'mousedown']) up.parentElement.addEventListener(t, onDown, { capture: true, passive: false });
  up.parentElement.addEventListener('touchstart', (e) => { if (e.touches.length === 1) onDown(Object.assign(e, { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY })); }, { capture: true, passive: false });
  for (const t of ['pointermove', 'mousemove']) window.addEventListener(t, onMove, { capture: true, passive: false });
  for (const t of ['pointerup', 'mouseup']) window.addEventListener(t, onUp, { capture: true });
  // two-finger pinch on a selected cell photo zooms the photo inside its cell (instead of the whole poster)
  let pin = null; const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) || 1;
  window.addEventListener('touchstart', (e) => { const a = c.getActiveObject(); if (e.touches.length !== 2 || !a || a.pfCell == null || a.type !== 'image') return; e.stopImmediatePropagation(); e.preventDefault(); c._currentTransform = null; pin = { o: a, d: dist(e) }; }, { capture: true, passive: false });
  window.addEventListener('touchmove', (e) => { if (!pin || e.touches.length !== 2) return; e.stopImmediatePropagation(); e.preventDefault(); const d = dist(e); zoomCell(pin.o, d / pin.d); pin.d = d; }, { capture: true, passive: false });
  window.addEventListener('touchend', (e) => { if (!pin) return; e.stopImmediatePropagation(); if (e.touches.length < 2) { pin = null; pf.history.record(); } }, { capture: true });
}

// ---------- picker UI ----------
function preview(L) {
  const [W, H] = L.size; const k = 64 / Math.max(W, H); const cv = el('canvas', { class: 'cl-prev' }); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  const x = cv.getContext('2d'); x.fillStyle = L.bg === '#000000' ? '#000' : '#f4f1ea'; x.fillRect(0, 0, cv.width, cv.height);
  const meta = { layout: L.id, gap: L.kind === 'tree' ? Math.round(W / 1080 * 16) : 10, radius: 0, root: L.root, text: L.text };
  const { cells } = cellsOf(meta, W, H); x.fillStyle = '#ff4e8a';
  for (const c of cells) {
    x.save();
    if (c.ch) { x.font = `${c.fs * k}px Anton, Impact, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(c.ch, c.cx * k, c.cy * k); }
    else if (c.angle != null) { x.translate(c.cx * k, c.cy * k); x.rotate(c.angle * Math.PI / 180); x.fillStyle = '#fff'; x.fillRect(-c.w * k / 2 - 2, -c.h * k / 2 - 2, c.w * k + 4, c.h * k + 10); x.fillStyle = '#ff4e8a'; x.fillRect(-c.w * k / 2, -c.h * k / 2, c.w * k, c.h * k); }
    else x.fillRect(c.x * k, c.y * k, c.w * k, c.h * k);
    x.restore();
  }
  if (L.id === 'film') { x.fillStyle = '#141210'; x.fillRect(150 * k, 0, (W - 300) * k, H * k); x.fillStyle = '#ff4e8a'; for (const c of cells) x.fillRect(c.x * k, c.y * k, c.w * k, c.h * k); }
  return cv;
}
export async function openCollages() {
  const groups = [...new Set(LAYOUTS.map((l) => l.group))];
  const body = el('div', { class: 'col cl-body', id: 'collagePicker' }, ...groups.flatMap((g) => [el('h3', { text: g }), el('div', { class: 'cl-grid' },
    ...LAYOUTS.filter((l) => l.group === g).map((L) => el('button', { class: 'cl-card rip', 'data-layout': L.id, onclick: async () => {
      haptic(); closeTopSheet(); let text;
      if (L.kind === 'letters') { text = await promptSheet('Letters', { value: 'LOVE', placeholder: 'Up to 8 letters' }); if (text == null) return; }
      const id = await buildCollage(L.id, [], { text }); hideHome(); toast('Tap a cell to add photos · drag the pink handles to resize'); addPhotosTo(id, 0);
    } }, preview(L), el('small', { text: L.name }))))]));
  return sheet({ title: 'Collage', body, actions: [{ label: 'Close', value: null, kind: 'btn-ghost' }] });
}
export function collageControls() {
  const a = PF().canvas.getActiveObject(); const id = a && a.pfCell != null ? metaOf(a)?.id : collageIds()[0]; if (!id) { toast('No collage on this poster'); return null; }
  const meta = metaOf(cellObjects(id)[0]); const L = layoutById(meta.layout);
  const row = (label, key, max) => { const i = el('input', { type: 'range', min: 0, max, value: meta[key], id: 'cl' + key, oninput: () => relayout(id, { [key]: Number(i.value) }), onchange: () => PF().history.record() });
    return el('div', { class: 'slider-row' }, el('span', { class: 'lbl', text: label }), i); };
  const body = el('div', { class: 'col' }, L.noGap ? el('p', { class: 'note', text: 'This layout has fixed frames; drag inside a photo to pan it.' }) : row('Gap', 'gap', 80), row('Corners', 'radius', 160),
    el('button', { class: 'btn-tonal rip', text: 'Add photos to empty cells', onclick: () => { closeTopSheet(); addPhotosTo(id, 0); } }));
  return sheet({ title: 'Collage', body, actions: [{ label: 'Done', value: null, kind: 'btn-accent' }] });
}
void progressTask;
