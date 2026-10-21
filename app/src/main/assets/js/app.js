import { saveVectorAsset, getAllVectorAssets, deleteVectorAsset, savePosterProject, getAllPosterProjects, getPosterProject,
  deletePosterProject, setMeta, getMeta, saveOriginal, getOriginal } from './db.js';
import { WORK_SIDE, processImage, urlToBlob, isIdentityFilter } from './imaging.js';
import { LATIN_ONLY, fontEntry, hasFace, boldWeightFor, LOCAL_FONTS, FONT_FAMILIES, FONT_CATALOG, FONT_GROUPS, MALAYALAM_FONTS, MALAYALAM_RE, loadAllFonts, registerFonts, sanitizeSVG, svgToDataURL, fileToImage, imageToCanvas,
  canvasToBlob, traceImageFileToSVG, cutoutCanvas, extractPalette, convertFabricTextToVector } from './tools.js';
import { History } from './history.js';
import { el, sheet, confirmSheet, promptSheet, menuSheet, closeTopSheet, toast, busy, actionToast, progressTask } from './ui.js';
import { hasNative, N, sendBlob, gemini, haptic, geminiModels, defaultModels, memoryInfo, hasNativeExport, nativeExport } from './native.js';

const $ = (id) => document.getElementById(id);
const PROPS = ['name', 'locked', 'pfRole', 'lockMovementX', 'lockMovementY', 'lockScalingX', 'lockScalingY', 'lockRotation', 'hasControls', 'visible',
  'pfOrig', 'pfOrigW', 'pfOrigH', 'pfBase', 'pfFilter', 'pfAlpha', 'pfMask', 'pfFrame', 'pfClipBase', 'pfClipZ', 'pfClipX', 'pfClipY',
  'pfWarp', 'pfWarpAmt', 'pfFillMode', 'pfGlow', 'pfGeo', 'pfCounterFmt', 'pfTexture', 'pfFontLabel', 'pfGeoBase',
  'pfPath', 'pfAnim', 'pfBox', 'pfBoxText', 'pfOutline', 'pfStory', 'pfAutoContrast', 'pfAutoFx', 'pfSticker'];
registerFonts();
/** Font families referenced by a serialised fabric canvas (recurses into groups). */
function usedFamilies(c) {
  const out = new Set(); const visit = (o) => { if (o.fontFamily && LOCAL_FONTS[o.fontFamily]) out.add(o.fontFamily); (o.objects || []).forEach(visit); };
  (c.objects || []).forEach(visit); return [...out];
}
async function ensureFonts(c) { const f = usedFamilies(c); if (f.length) { await loadAllFonts(f); f.forEach((x) => fabric.util.clearFabricFontCache(x)); } }
const PRESETS = [
  { label: 'Portrait 4:5 (Instagram)', w: 1080, h: 1350 }, { label: 'Square 1:1', w: 1080, h: 1080 },
  { label: 'Story 9:16', w: 1080, h: 1920 }, { label: 'Landscape 16:9', w: 1920, h: 1080 }, { label: 'A4 portrait (150 dpi)', w: 1240, h: 1754 },
];

const state = { W: 1080, H: 1350, fit: 1, zoom: 1, panX: 0, panY: 0, projectId: null, projectName: '', ready: false,
  exportScale: Number(localStorage.getItem('pf.exportScale') || 2) };

// ---------- Fabric setup ----------
// Fabric measures text glyph-by-glyph, which over-measures shaped scripts (Malayalam conjuncts are narrower than
// their parts). Re-measure such lines as a whole string so centring/right alignment and the selection box are exact.
(function patchComplexScriptMeasure() {
  const orig = fabric.Text.prototype._measureLine;
  const mctx = document.createElement('canvas').getContext('2d');
  fabric.Text.prototype._measureLine = function (lineIndex) {
    const r = orig.call(this, lineIndex);
    const line = (this._textLines[lineIndex] || []).join('');
    if (!MALAYALAM_RE.test(line) || this.charSpacing || !this.isEmptyStyles(lineIndex) || !r.width) return r;
    mctx.font = this._getFontDeclaration();
    const real = mctx.measureText(line).width;
    const k = real / r.width;
    const bounds = this.__charBounds[lineIndex] || [];
    bounds.forEach((b) => { b.left *= k; b.width *= k; b.kernedWidth *= k; });
    r.width = real;
    return r;
  };
})();
Object.assign(fabric.Object.prototype, {
  transparentCorners: false, cornerColor: '#f59e0b', cornerStrokeColor: '#111', borderColor: '#f59e0b', cornerStyle: 'circle',
  cornerSize: 14, touchCornerSize: 34, padding: 4, borderScaleFactor: 2, snapAngle: 45, snapThreshold: 4,
});
const canvas = new fabric.Canvas('posterCanvas', {
  width: 540, height: 675, backgroundColor: '#0d1117', preserveObjectStacking: true, selection: true, selectionColor: 'rgba(245,158,11,0.12)', selectionBorderColor: '#f59e0b',
  enableRetinaScaling: true, allowTouchScrolling: false, stopContextMenu: true, fireRightClick: false,
});

// ---------- layer masks on photos ----------
// pfMask is a PNG data URL (alpha = visibility) in the photo's own space. It is composited onto the image element at
// draw time, so the photo itself is never altered (hide/reveal is fully reversible) and it scales to any export size.
function loadMask(o) {
  if (!o.pfMask) return Promise.resolve();
  if (o._pfMaskSrc === o.pfMask && o._pfMaskEl) return Promise.resolve();
  if (o._pfMaskLoading && o._pfMaskLoading.src === o.pfMask) return o._pfMaskLoading.p;
  const src = o.pfMask;
  const p = new Promise((res) => {
    const im = new Image();
    im.onload = () => {
      if (o.pfMask === src) {
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0);
        o._pfMaskEl = c; o._pfMaskSrc = src; o._pfMaskStamp = (o._pfMaskStamp || 0) + 1; o.dirty = true; if (o.group) o.group.dirty = true;
        o.canvas?.requestRenderAll();
      }
      res();
    };
    im.onerror = () => res();
    im.src = src;
  });
  o._pfMaskLoading = { src, p };
  return p;
}
function forEachImage(objs, fn) { const v = (o) => { if (o.type === 'image') fn(o); (o._objects || []).forEach(v); }; objs.forEach(v); }
async function prepareMasks(objs) { const ps = []; forEachImage(objs, (o) => { if (o.pfMask) ps.push(loadMask(o)); }); await Promise.all(ps); }
(function patchMaskedImages() {
  const orig = fabric.Image.prototype._renderFill;
  fabric.Image.prototype._renderFill = function (ctx) {
    if (!this.pfMask) return orig.call(this, ctx);
    if (this._pfMaskSrc !== this.pfMask || !this._pfMaskEl) { loadMask(this); if (!this._pfMaskEl) return; } // never flash hidden areas
    const el = this._element; if (!el) return;
    const key = this._pfMaskStamp + '|' + (el.naturalWidth || el.width);
    if (!this._pfMasked || this._pfMaskedEl !== el || this._pfMaskedKey !== key) {
      const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
      const c = this._pfMasked && this._pfMasked.width === w && this._pfMasked.height === h ? this._pfMasked : document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d'); x.clearRect(0, 0, w, h); x.globalCompositeOperation = 'source-over'; x.drawImage(el, 0, 0);
      x.globalCompositeOperation = 'destination-in'; x.drawImage(this._pfMaskEl, 0, 0, w, h); x.globalCompositeOperation = 'source-over';
      this._pfMasked = c; this._pfMaskedEl = el; this._pfMaskedKey = key;
    }
    this._element = this._pfMasked;
    try { orig.call(this, ctx); } finally { this._element = el; }
  };
})();

// ---------- images: blob URLs in memory/history, data URLs when stored ----------
const blobData = new Map(); // blob: URL -> data: URL (filled lazily)
function walkImages(json, fn) {
  const visit = (o) => { if (!o) return; if (o.type === 'image') { if (o.src) o.src = fn(o.src) ?? o.src; if (o.pfBase) o.pfBase = fn(o.pfBase) ?? o.pfBase; if (o.pfGeoBase) o.pfGeoBase = fn(o.pfGeoBase) ?? o.pfGeoBase; } (o.objects || []).forEach(visit); if (o.clipPath) visit(o.clipPath); };
  (json.objects || []).forEach(visit);
  if (json.backgroundImage) visit(json.backgroundImage);
}
async function dataURLsFor(json) {
  const need = [];
  walkImages(json, (s) => { if (s.startsWith('blob:') && !blobData.has(s)) need.push(s); });
  for (const u of need) {
    const b = await (await fetch(u)).blob();
    blobData.set(u, await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }));
  }
  walkImages(json, (s) => (s.startsWith('blob:') ? blobData.get(s) : s));
  return json;
}
async function blobURLsFor(json) {
  const list = [];
  walkImages(json, (s) => { if (s.startsWith('data:')) list.push(s); });
  const map = new Map();
  for (const s of list) {
    if (map.has(s)) continue;
    const u = URL.createObjectURL(await (await fetch(s)).blob());
    blobData.set(u, s); map.set(s, u);
  }
  walkImages(json, (s) => map.get(s));
  return json;
}
async function blobURLFromCanvas(c, type = 'image/png', q) { return URL.createObjectURL(await canvasToBlob(c, type, q)); }

// ---------- state & history ----------
const serialize = () => JSON.stringify({ v: 1, w: state.W, h: state.H, canvas: canvas.toJSON(PROPS) });
// Carousel: state.pages holds every page's canvas JSON (the live page is re-read from the canvas when saving).
state.pages = null; state.page = 0;
function projectState() {
  const cur = JSON.parse(serialize());
  if (!state.pages || state.pages.length < 2) return cur;
  const pages = state.pages.map((p, i) => (i === state.page ? cur.canvas : p));
  return { v: 2, w: state.W, h: state.H, page: state.page, pages, canvas: cur.canvas };
}
async function projectStateForStorage() {
  const s = projectState();
  if (s.pages) { s.pages = s.pages.map((p) => JSON.parse(JSON.stringify(p))); for (const p of s.pages) await dataURLsFor(p); s.canvas = s.pages[s.page]; }
  else await dataURLsFor(s.canvas);
  return s;
}
async function restoreProject(st) {
  const s = typeof st === 'string' ? JSON.parse(st) : st;
  if (s.v === 2 && Array.isArray(s.pages) && s.pages.length) {
    state.pages = s.pages.slice(); state.page = Math.min(s.page || 0, s.pages.length - 1);
    await restore({ v: 1, w: s.w, h: s.h, canvas: state.pages[state.page] });
  } else { state.pages = null; state.page = 0; await restore(s); }
  window.dispatchEvent(new Event('pf:pages'));
}
async function restore(str) {
  const s = typeof str === 'string' ? JSON.parse(str) : str;
  state.W = s.w; state.H = s.h;
  await blobURLsFor(s.canvas);
  await ensureFonts(s.canvas);
  await new Promise((r) => canvas.loadFromJSON(s.canvas, r));
  await prepareMasks(canvas.getObjects());
  canvas.getObjects().forEach((o) => { if (o.type === 'text' || o.type === 'i-text') o.initDimensions(); o.setCoords(); });
  layout();
  canvas.requestRenderAll();
  refreshLayers(); syncEditPanel();
}
const history = new History({ serialize, restore, onChange: () => { $('btnUndo').disabled = !history.canUndo; $('btnRedo').disabled = !history.canRedo; scheduleAutosave(); } });

canvas.on('object:added', () => { if (!history.muted) { history.record(); refreshLayers(); } });
canvas.on('object:removed', () => { if (!history.muted) { history.record(); refreshLayers(); } });
canvas.on('object:modified', () => { history.record(); refreshLayers(); syncEditPanel(); });
canvas.on('selection:created', () => { fontGroup = null; refreshLayers(); syncEditPanel(); });
canvas.on('selection:updated', () => { fontGroup = null; refreshLayers(); syncEditPanel(); });
canvas.on('selection:cleared', () => { refreshLayers(); syncEditPanel(); });

$('btnUndo').onclick = () => { haptic(); history.undo(); };
$('btnRedo').onclick = () => { haptic(); history.redo(); };

let autosaveTimer = null;
function scheduleAutosave() {
  if (!state.ready) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    try {
      const s = await projectStateForStorage();
      await setMeta('draft', { state: s, projectId: state.projectId, projectName: state.projectName, saved: Date.now() });
    } catch (e) { console.warn('autosave', e); }
  }, 1500);
}

// ---------- viewport: fit the free area, pinch zoom & pan ----------
const wrapper = $('canvasWrapper');
function freeRect() {
  const tb = $('topbar').getBoundingClientRect();
  let bottom = $('toolbar').getBoundingClientRect().top;
  const ctx = $('ctxStrip'); if (!ctx.classList.contains('hidden')) bottom = Math.min(bottom, ctx.getBoundingClientRect().top);
  if (panelOpen()) bottom = Math.min(bottom, $('panel').getBoundingClientRect().top);
  const top = tb.bottom + 8;
  bottom -= 8;
  return { left: 8, top, width: Math.max(60, window.innerWidth - 16), height: Math.max(60, bottom - top) };
}
function layout() {
  const f = freeRect();
  state.fit = Math.min(f.width / state.W, f.height / state.H);
  const s = Math.min(state.fit * state.zoom, 2600 / Math.max(state.W, state.H) * 1.0);
  const cw = Math.round(state.W * s), ch = Math.round(state.H * s);
  canvas.setDimensions({ width: cw, height: ch });
  canvas.setViewportTransform([s, 0, 0, s, 0, 0]);
  const cx = f.left + f.width / 2 + state.panX, cy = f.top + f.height / 2 + state.panY;
  wrapper.style.transform = `translate(${Math.round(cx - cw / 2)}px, ${Math.round(cy - ch / 2)}px)`;
  wrapper.dataset.scale = s;
  canvas.calcOffset();
  canvas.requestRenderAll();
  const chip = $('zoomChip');
  chip.classList.toggle('hidden', Math.abs(state.zoom - 1) < 0.01 && !state.panX && !state.panY);
  chip.textContent = Math.round(state.zoom * 100) + '%  · Fit';
  chip.style.top = (f.top + 2) + 'px';
}
window.addEventListener('resize', () => layout());
$('zoomChip').onclick = () => { state.zoom = 1; state.panX = 0; state.panY = 0; layout(); };

(function pinch() {
  const stage = $('canvasContainer');
  let g = null;
  const pts = (e) => [...e.touches].slice(0, 2).map((t) => ({ x: t.clientX, y: t.clientY }));
  const mid = (a) => ({ x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 });
  const dist = (a) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length < 2) return;
    e.stopPropagation(); e.preventDefault();
    canvas._currentTransform = null; // cancel any one-finger drag fabric started
    const p = pts(e); const f = freeRect();
    g = { d0: dist(p), m0: mid(p), zoom0: state.zoom, pan0: { x: state.panX, y: state.panY }, c0: { x: f.left + f.width / 2 + state.panX, y: f.top + f.height / 2 + state.panY }, f };
  }, { capture: true, passive: false });
  stage.addEventListener('touchmove', (e) => {
    if (!g) return;
    e.stopPropagation(); e.preventDefault();
    if (e.touches.length < 2) return;
    const p = pts(e); const m = mid(p);
    const zoom = Math.max(0.4, Math.min(6, g.zoom0 * dist(p) / g.d0));
    const r = zoom / g.zoom0;
    const c = { x: m.x - (g.m0.x - g.c0.x) * r, y: m.y - (g.m0.y - g.c0.y) * r };
    g.zoom = zoom; g.pan = { x: c.x - (g.f.left + g.f.width / 2), y: c.y - (g.f.top + g.f.height / 2) };
    const s0 = Number(wrapper.dataset.scale);
    const sNew = state.fit * zoom;
    const cw = state.W * s0, ch = state.H * s0;
    wrapper.style.transform = `translate(${c.x - (cw * sNew / s0) / 2}px, ${c.y - (ch * sNew / s0) / 2}px) scale(${sNew / s0})`;
  }, { capture: true, passive: false });
  const end = (e) => {
    if (!g) return;
    e.stopPropagation();
    if (e.touches.length) return; // wait for every finger to lift
    if (g.zoom) { state.zoom = g.zoom; state.panX = g.pan.x; state.panY = g.pan.y; }
    g = null; layout();
  };
  stage.addEventListener('touchend', end, { capture: true });
  stage.addEventListener('touchcancel', end, { capture: true });
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    state.zoom = Math.max(0.4, Math.min(6, state.zoom * (e.deltaY < 0 ? 1.1 : 0.9))); layout();
  }, { passive: false });
})();

// ---------- toolbar, contextual strip & compact panel ----------
const panel = $('panel');
const PANE_TITLES = { text: 'Text', photos: 'Photos', shapes: 'Shapes', elements: 'Elements', ai: 'AI tools', layers: 'Layers', background: 'Background', size: 'Size',
  font: 'Font', color: 'Colour', align: 'Align & arrange', opacity: 'Opacity', outline: 'Outline', shadow: 'Shadow', position: 'Position & size',
  blend: 'Blend mode', adjust: 'Adjust photo', mask: 'Layer mask', clip: 'Photo in frame' };
PANE_TITLES.elements = 'Icons & library'; PANE_TITLES.background = 'Canvas';
const TOOL_PANES = new Set(['text', 'photos', 'shapes', 'elements', 'ai', 'layers', 'background', 'size']);
const CTX_PANES = ['font', 'color', 'align', 'opacity', 'outline', 'shadow', 'position', 'blend', 'adjust', 'mask', 'clip'];
let currentPane = null;
const panelOpen = () => panel.classList.contains('open');
function panelBottomGap() { return window.innerHeight - panel.getBoundingClientRect().bottom; }
function openPane(name) {
  currentPane = name;
  if (name === 'background') buildBackgroundPane();
  if (name === 'size') buildSizePane();
  if (name === 'layers') refreshLayers();
  if (name === 'elements') renderLibrary();
  if (name === 'position') syncPosition();
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === name));
  document.querySelectorAll('.ctx').forEach((b) => b.classList.toggle('active', b.dataset.ctx === name));
  $('panelTitle').textContent = PANE_TITLES[name] || '';
  panel.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
  if (name !== 'mask') setMaskPaint(false);
  updateContext(); syncProPanels();
  setTimeout(layoutPanelAware, 270);
}
function closePanel() {
  currentPane = null;
  panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('.tool,.ctx').forEach((b) => b.classList.remove('active'));
  setMaskPaint(false);
  updateContext();
  setTimeout(layoutPanelAware, 270);
}
// The canvas refits to the space left above whatever is open at the bottom.
function layoutPanelAware() { layout(); }
document.querySelectorAll('.tool').forEach((b) => { b.onclick = () => { haptic(); if (currentPane === b.dataset.tool) closePanel(); else openPane(b.dataset.tool); }; });
document.querySelectorAll('.ctx[data-ctx]').forEach((b) => { b.onclick = () => { haptic(); if (currentPane === b.dataset.ctx) closePanel(); else openPane(b.dataset.ctx); }; });
$('panelClose').onclick = closePanel;
(function panelSwipe() {
  const h = panel.querySelector('.panel-head'); let y0 = null;
  h.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; y0 = e.clientY; });
  h.addEventListener('pointerup', (e) => { if (y0 != null && e.clientY - y0 > 40) closePanel(); y0 = null; });
})();
let ctxHold = false; // set while an edit briefly drops/re-creates the selection, so the open pane stays put
// The selection strip and a toolbar panel are never shown together: an open tool panel hides the strip.
function updateContext() {
  if (ctxHold) return;
  const o = active();
  const strip = $('ctxStrip');
  const toolOpen = !!currentPane && TOOL_PANES.has(currentPane);
  const show = !!o && !toolOpen;
  const was = !strip.classList.contains('hidden');
  strip.classList.toggle('hidden', !show);
  document.body.classList.toggle('has-ctx', show);
  if (o) {
    const multi = o.type === 'activeSelection';
    const clipg = o.pfRole === 'clip';
    const vis = { multi, group: o.type === 'group' && !clipg, clippable: !!clippablePair(o), clipgroup: clipg, image: o.type === 'image', single: !multi };
    strip.querySelectorAll('[data-show]').forEach((b) => b.classList.toggle('hidden', !vis[b.dataset.show]));
    strip.querySelectorAll('[data-textonly]').forEach((b) => b.classList.toggle('hidden', !isText(o)));
    strip.querySelector('[data-ctx="position"]').classList.toggle('hidden', multi);
  }
  if (!o && CTX_PANES.includes(currentPane)) closePanel();
  else if (o && currentPane === 'font' && !isText(o)) closePanel();
  else if (o && ['adjust', 'mask'].includes(currentPane) && o.type !== 'image') closePanel();
  else if (o && currentPane === 'clip' && o.pfRole !== 'clip') closePanel();
  if (was !== show) { setTimeout(layout, 30); if (show) strip.scrollLeft = 0; }
  stripFades();
}
function stripFades() {
  const s = $('ctxStrip');
  s.classList.toggle('fade-l', s.scrollLeft > 4);
  s.classList.toggle('fade-r', s.scrollLeft + s.clientWidth < s.scrollWidth - 4);
}
$('ctxStrip').addEventListener('scroll', stripFades, { passive: true });
// Selecting something on the canvas while a tool panel is open swaps that panel for the selection strip (Layers stays open).
const swapToolPane = () => { if (currentPane && TOOL_PANES.has(currentPane) && currentPane !== 'layers' && !ctxHold) closePanel(); else updateContext(); };
canvas.on('selection:created', swapToolPane);
window.addEventListener('resize', stripFades);

// ---------- insets & back ----------
window.pfSetInsets = (t, b, l, r) => {
  const s = document.documentElement.style;
  s.setProperty('--sat', t + 'px'); s.setProperty('--sab', b + 'px'); s.setProperty('--sal', l + 'px'); s.setProperty('--sar', r + 'px');
  setTimeout(layout, 30);
};
window.pfHandleBack = () => {
  if (closeTopSheet()) return true;
  if (panelOpen()) { closePanel(); return true; }
  if (selectMode) { setSelectMode(false); return true; }
  if (canvas.getActiveObject()) { canvas.discardActiveObject(); canvas.requestRenderAll(); return true; }
  return false;
};

// ---------- helpers ----------
const active = () => canvas.getActiveObject();
const isText = (o) => o && (o.type === 'text' || o.type === 'i-text' || o.type === 'textbox');
const center = () => ({ left: state.W / 2, top: state.H / 2, originX: 'center', originY: 'center' });
const clampFont = (px) => Math.round(Math.max(14, Math.min(px, state.W * 0.14)));
function fitInside(o, frac = 0.9) {
  o.setCoords();
  const br = o.getBoundingRect(true, true);
  const k = Math.min(1, (state.W * frac) / br.width, (state.H * frac) / br.height);
  if (k < 1) o.set({ scaleX: o.scaleX * k, scaleY: o.scaleY * k });
  o.setCoords();
}
function makeText(text, opts = {}) {
  const ml = MALAYALAM_RE.test(text);
  let fontFamily = opts.fontFamily || (ml ? 'Manjari' : 'Montserrat');
  if (ml && LATIN_ONLY.has(fontFamily)) fontFamily = 'Manjari';
  const t = new fabric.Text(text, {
    ...center(), fontFamily, fontWeight: opts.fontWeight || 700, fontSize: clampFont(opts.fontSize || state.W * 0.08),
    fill: opts.fill || '#ffffff', textAlign: opts.textAlign || 'center', lineHeight: 1.12, name: opts.name || text.split('\n')[0].slice(0, 24),
    ...(opts.left != null ? { left: opts.left } : {}), ...(opts.top != null ? { top: opts.top } : {}),
  });
  t.initDimensions();
  fitInside(t, 0.92);
  return t;
}
async function addSVG(svgString, name, opts = {}) {
  let clean;
  try { clean = sanitizeSVG(svgString); } catch (e) { toast('That vector could not be used: ' + e.message, 'error'); return null; }
  const obj = await new Promise((resolve) => fabric.loadSVGFromString(clean, (objs, o) => resolve(objs.length ? fabric.util.groupSVGElements(objs, o) : null)));
  if (!obj) { toast('The SVG was empty', 'error'); return null; }
  obj.set({ ...center(), name: name || 'Vector' });
  obj.scaleToWidth(opts.width || state.W * 0.45);
  fitInside(obj, 0.9);
  canvas.add(obj); canvas.setActiveObject(obj); canvas.requestRenderAll();
  return obj;
}
async function addImageFromURL(url, name, { cover = false, width = 0.6, role } = {}) {
  const img = await new Promise((r) => fabric.Image.fromURL(url, r));
  if (cover) img.scale(Math.max(state.W / img.width, state.H / img.height));
  else img.scaleToWidth(state.W * width);
  img.set({ ...center(), name: name || 'Photo' });
  if (role) img.set({ pfRole: role });
  fitInside(img, cover ? 10 : 0.95);
  return img;
}
function setLocked(o, l) {
  o.set({ locked: l, lockMovementX: l, lockMovementY: l, lockScalingX: l, lockScalingY: l, lockRotation: l, hasControls: !l });
}

// ---------- layers ----------
const thumbCache = new WeakMap();
function thumbFor(o) {
  const key = JSON.stringify([o.type, o.fill, o.stroke, o.text, o.width, o.height, o.scaleX, o.scaleY, o.angle, o.flipX, o.opacity, o.fontFamily, o.getSrc ? o.getSrc() : '', (o._objects || []).length]);
  const c = thumbCache.get(o);
  if (c && c.key === key) return c.url;
  let url = '';
  try {
    const br = o.getBoundingRect(true, true);
    const m = Math.min(1, 88 / Math.max(1, br.width, br.height));
    const vis = o.visible; o.visible = true;
    url = o.toDataURL({ format: 'png', multiplier: m, enableRetinaScaling: false });
    o.visible = vis;
  } catch (_) {}
  thumbCache.set(o, { key, url });
  return url;
}
const svgIcon = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
const iconBtn = (id, label, fn, cls = '') => el('button', { class: 'layer-btn rip ' + cls, 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); fn(); } }, svgIcon(id));
const typeLabel = (o) => ({ text: 'Text', image: o.pfRole === 'bg' ? 'Background photo' : 'Photo', rect: 'Shape', circle: 'Shape', triangle: 'Shape', path: 'Vector', group: o.pfRole === 'clip' ? 'Photo in frame' : o.pfRole === 'group' ? 'Group' : 'Vector group' })[o.type] || o.type;
let multiSelect = false;
$('btnMultiSelect').onclick = () => {
  multiSelect = !multiSelect; $('btnMultiSelect').classList.toggle('on', multiSelect);
  toast(multiSelect ? 'Tap layers to add them to the selection' : 'Single selection');
};
function selectFromLayer(o) {
  const a = active();
  if (multiSelect && a && a !== o) {
    const set = a.type === 'activeSelection' ? a.getObjects().slice() : [a];
    const i = set.indexOf(o); if (i >= 0) set.splice(i, 1); else set.push(o);
    canvas.discardActiveObject();
    if (set.length === 1) canvas.setActiveObject(set[0]);
    else if (set.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(set, { canvas }));
  } else canvas.setActiveObject(o);
  canvas.requestRenderAll(); refreshLayers(); updateContext(); syncEditPanel();
}
function deleteObjects(list) {
  if (!list.length) return;
  canvas.discardActiveObject();
  history.batch(() => list.forEach((o) => canvas.remove(o)));
  canvas.requestRenderAll(); refreshLayers();
  actionToast(list.length > 1 ? `Deleted ${list.length} items` : `Deleted “${String(list[0].name || typeLabel(list[0])).slice(0, 24)}”`, 'Undo', () => history.undo());
}
function duplicateObj(o) {
  return new Promise((r) => o.clone((c) => {
    c.set({ left: c.left + 30, top: c.top + 30, name: (o.name || typeLabel(o)) + ' copy' });
    if (c.type === 'activeSelection') { c.canvas = canvas; c.forEachObject((k) => canvas.add(k)); c.setCoords(); }
    else canvas.add(c);
    canvas.setActiveObject(c); canvas.requestRenderAll(); r(c);
  }, PROPS));
}
async function renameObj(o) {
  const v = await promptSheet('Rename layer', { value: o.name || '', okLabel: 'Rename' });
  if (v == null || !v.trim()) return;
  o.set('name', v.trim().slice(0, 40)); history.record(); refreshLayers();
}
async function layerMenu(o) {
  const v = await menuSheet(String(o.name || typeLabel(o)).slice(0, 40), [
    { label: 'Rename', value: 'rename' }, { label: 'Duplicate', value: 'dup' }, { label: 'Bring to front', value: 'front' }, { label: 'Send to back', value: 'back' },
    { label: o.locked ? 'Unlock' : 'Lock', value: 'lock' }, 'hr', { label: 'Delete', value: 'del' }]);
  if (v === 'rename') renameObj(o);
  else if (v === 'dup') duplicateObj(o).then(refreshLayers);
  else if (v === 'front') { canvas.bringToFront(o); history.record(); refreshLayers(); }
  else if (v === 'back') { canvas.sendToBack(o); history.record(); refreshLayers(); }
  else if (v === 'lock') { setLocked(o, !o.locked); canvas.requestRenderAll(); history.record(); refreshLayers(); }
  else if (v === 'del') deleteObjects([o]);
}
function refreshLayers() {
  const list = $('layerList');
  if (!list || currentPane !== 'layers') return; // only rebuilt while visible (thumbnails are not free)
  list.replaceChildren();
  const objs = canvas.getObjects();
  if (!objs.length) { list.append(el('li', { class: 'empty', text: 'Nothing on the poster yet. Add text, photos or shapes from the toolbar.' })); return; }
  const a = active();
  const selected = a ? (a.type === 'activeSelection' ? a.getObjects() : [a]) : [];
  [...objs].reverse().forEach((o) => {
    const name = String(o.name || o.text || typeLabel(o)).replace(/\s+/g, ' ').slice(0, 40);
    const row = el('div', { class: 'layer-row' },
      iconBtn('i-grip', 'Drag to reorder', () => {}, 'grip'),
      el('img', { class: 'layer-thumb', src: thumbFor(o), alt: '' }),
      el('div', { class: 'layer-name' }, el('span', { text: name }), el('small', { text: typeLabel(o) + (o.globalCompositeOperation && o.globalCompositeOperation !== 'source-over' ? ' · ' + blendLabel(o.globalCompositeOperation) : '') + (o.pfMask ? ' · masked' : '') + (o.locked ? ' · locked' : '') + (o.visible === false ? ' · hidden' : '') })),
      iconBtn(o.visible === false ? 'i-eyeoff' : 'i-eye', o.visible === false ? 'Show' : 'Hide', () => { o.set('visible', o.visible === false); if (!o.visible) canvas.discardActiveObject(); canvas.requestRenderAll(); history.record(); refreshLayers(); }, o.visible === false ? '' : ''),
      iconBtn(o.locked ? 'i-lock' : 'i-unlock', o.locked ? 'Unlock' : 'Lock', () => { setLocked(o, !o.locked); canvas.requestRenderAll(); history.record(); refreshLayers(); }, o.locked ? 'on' : ''),
      iconBtn('i-trash', 'Delete', () => deleteObjects([o]), 'del'),
      iconBtn('i-more', 'More', () => layerMenu(o)));
    const li = el('li', { class: 'layer-item' + (selected.includes(o) ? ' active' : '') }, el('span', { class: 'del-hint', text: 'Delete' }), row);
    li._obj = o;
    row.addEventListener('click', () => selectFromLayer(o));
    // swipe left to delete
    let sx = null, dx = 0;
    row.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; sx = e.clientX; dx = 0; });
    row.addEventListener('pointermove', (e) => { if (sx == null) return; dx = Math.min(0, e.clientX - sx); if (dx < -8) { li.classList.add('swiping'); row.style.transition = 'none'; row.style.transform = `translateX(${dx}px)`; } });
    const endSwipe = () => { if (sx == null) return; sx = null; row.style.transition = ''; if (dx < -110) { row.style.transform = 'translateX(-110%)'; setTimeout(() => deleteObjects([o]), 160); } else { row.style.transform = ''; setTimeout(() => li.classList.remove('swiping'), 220); } };
    row.addEventListener('pointerup', endSwipe); row.addEventListener('pointercancel', endSwipe); row.addEventListener('pointerleave', endSwipe);
    // drag to reorder with the grip
    const grip = row.querySelector('.grip');
    grip.addEventListener('pointerdown', (e) => startLayerDrag(e, li));
    list.append(li);
  });
}
function startLayerDrag(e, li) {
  e.preventDefault(); e.stopPropagation();
  const list = $('layerList'); const items = [...list.children];
  const startY = e.clientY; const h = li.getBoundingClientRect().height + 8;
  const from = items.indexOf(li); let to = from;
  li.classList.add('dragging');
  try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
  const move = (ev) => {
    const dy = ev.clientY - startY;
    li.style.transform = `translateY(${dy}px)`;
    to = Math.max(0, Math.min(items.length - 1, from + Math.round(dy / h)));
    items.forEach((it, i) => { if (it === li) return; let shift = 0; if (from < to && i > from && i <= to) shift = -h; if (from > to && i < from && i >= to) shift = h; it.style.transform = shift ? `translateY(${shift}px)` : ''; });
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    items.forEach((it) => (it.style.transform = '')); li.classList.remove('dragging');
    if (to !== from) { const n = canvas.getObjects().length; canvas.moveTo(li._obj, n - 1 - to); canvas.requestRenderAll(); history.record(); }
    refreshLayers();
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
}
function reorderLayer(fromIdxTop, toIdxTop) { // used by tests: indexes counted from the top of the list
  const objs = canvas.getObjects(); const n = objs.length; const o = objs[n - 1 - fromIdxTop];
  canvas.moveTo(o, n - 1 - toIdxTop); canvas.requestRenderAll(); history.record(); refreshLayers();
}
// ---------- edit panel ----------
const toHex = (c) => {
  if (typeof c !== 'string') return null;
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('').toLowerCase();
  try { return '#' + new fabric.Color(c).toHex().toLowerCase(); } catch (_) { return null; }
};
function firstFill(o) { if (!o) return null; if (o._objects) { for (const k of o._objects) { const h = toHex(k.fill); if (h) return h; } return null; } return toHex(o.fill); }
function syncEditPanel() {
  const o = active();
  updateContext();
  if (!o) return;
  if (isText(o)) {
    renderFontPicker();
    $('fontSizeRange').value = Math.round(o.fontSize); $('fontSizeVal').textContent = Math.round(o.fontSize) + 'px';
    const bold = Number(o.fontWeight) >= 600 || o.fontWeight === 'bold';
    $('btnBold').classList.toggle('on', bold);
    document.querySelectorAll('#alignSeg button').forEach((b) => b.classList.toggle('on', b.dataset.align === o.textAlign));
  }
  const f = firstFill(o); if (f) { $('objectColorPicker').value = f; document.querySelectorAll('#fillSwatches .swatch').forEach((s) => s.classList.toggle('on', s.dataset.c === f)); }
  const sc = toHex(o.stroke); if (sc) $('strokeColorPicker').value = sc;
  $('strokeRange').value = o.strokeWidth || 0; $('strokeVal').textContent = (o.strokeWidth || 0) + 'px';
  $('opacityRange').value = Math.round((o.opacity ?? 1) * 100); $('opacityVal').textContent = Math.round((o.opacity ?? 1) * 100) + '%';
  if (o.shadow) { $('shadowBlur').value = o.shadow.blur; $('shadowOffset').value = Math.round(Math.hypot(o.shadow.offsetX || 0, o.shadow.offsetY || 0));
    $('shadowAngle').value = Math.round(((Math.atan2(o.shadow.offsetY || 0, o.shadow.offsetX || 0) * 180) / Math.PI + 360) % 360) || 90;
    const m = String(o.shadow.color || '').match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/);
    if (m) { $('shadowColor').value = '#' + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join(''); $('shadowOpacity').value = Math.round((m[4] ? Number(m[4]) : 1) * 100); }
    else if (/^#/.test(o.shadow.color || '')) $('shadowColor').value = o.shadow.color.slice(0, 7); }
  $('shadowAngleVal').textContent = $('shadowAngle').value + '°'; $('shadowOpacityVal').textContent = $('shadowOpacity').value + '%';
  $('shadowBlurVal').textContent = $('shadowBlur').value; $('shadowOffsetVal').textContent = $('shadowOffset').value;
  $('btnLockObj').textContent = o.locked ? 'Unlock' : 'Lock';
  if (currentPane === 'position') syncPosition();
}
function applyFill(o, color) {
  if (o._objects) o._objects.forEach((k) => { if (k.fill && k.fill !== 'none' && typeof k.fill === 'string') k.set('fill', color); });
  else o.set('fill', color);
  o.dirty = true;
}
function liveEdit(inputId, apply, { onEnd } = {}) {
  const inp = $(inputId);
  inp.addEventListener('input', () => { const o = active(); if (!o) return; apply(o, inp.value); canvas.requestRenderAll(); syncLabels(o); history.recordSoon(500); });
  inp.addEventListener('change', () => { if (!active()) return; history.record(); onEnd && onEnd(); });
}
function syncLabels(o) {
  $('opacityVal').textContent = Math.round((o.opacity ?? 1) * 100) + '%';
  $('strokeVal').textContent = (o.strokeWidth || 0) + 'px';
  if (isText(o)) $('fontSizeVal').textContent = Math.round(o.fontSize) + 'px';
}
liveEdit('objectColorPicker', (o, v) => applyFill(o, v));
const PALETTE = ['#ffffff', '#111827', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6', '#22c55e', '#fde68a', '#7f1d1d', '#0b1f3a'];
PALETTE.forEach((c) => $('fillSwatches').append(el('div', { class: 'swatch', 'data-c': c, style: `background:${c}`, role: 'button', 'aria-label': c,
  onclick: () => { const o = active(); if (!o) return; applyFill(o, c); canvas.requestRenderAll(); history.record(); syncEditPanel(); } })));
liveEdit('strokeColorPicker', (o, v) => { o.set('stroke', v); if (!o.strokeWidth) { o.set('strokeWidth', 2); $('strokeRange').value = 2; } o.dirty = true; });
liveEdit('strokeRange', (o, v) => { o.set({ strokeWidth: Number(v), stroke: o.stroke || $('strokeColorPicker').value, paintFirst: 'stroke', strokeLineJoin: 'round' }); o.setCoords(); });
liveEdit('opacityRange', (o, v) => o.set('opacity', Number(v) / 100));
liveEdit('fontSizeRange', (o, v) => { if (isText(o)) { o.set('fontSize', Number(v)); o.initDimensions(); o.setCoords(); } });

async function setFont(o, family) {
  if (MALAYALAM_RE.test(o.text) && LATIN_ONLY.has(family)) { toast(`${family} has no Malayalam letters. Pick one from the Malayalam group.`, 'error'); return; }
  await document.fonts.load(`${o.fontWeight} 40px "${family}"`, o.text);
  fabric.util.clearFabricFontCache(family);
  o.set('fontFamily', family); o.initDimensions(); o.setCoords(); canvas.requestRenderAll(); history.record(); refreshLayers(); syncEditPanel();
}
// Font picker: group tabs + live previews of the selected text in each font.
let fontGroup = null;
function previewText(o) {
  const t = (isText(o) ? o.text : '').replace(/\s+/g, ' ').trim();
  const ml = MALAYALAM_RE.test(t);
  return { ml, text: t ? [...t].slice(0, 18).join('') : 'Aa കേരളം' };
}
function renderFontPicker() {
  const o = active(); const { ml, text } = previewText(o);
  const cur = isText(o) ? FONT_CATALOG.find((f) => f.family === o.fontFamily) : null;
  if (!fontGroup) fontGroup = ml ? 'Malayalam' : (cur ? cur.group : 'Sans');
  const tabs = $('fontGroups'); tabs.innerHTML = '';
  FONT_GROUPS.forEach((g) => tabs.append(el('button', { class: 'chip rip' + (g === fontGroup ? ' on' : ''), 'data-group': g, text: g,
    onclick: () => { fontGroup = g; renderFontPicker(); } })));
  const box = $('fontChips'); box.innerHTML = '';
  FONT_CATALOG.filter((f) => f.group === fontGroup).forEach((f) => {
    const blocked = ml && !f.ml;
    box.append(el('button', { class: 'font-card rip' + (cur && cur.family === f.family ? ' on' : '') + (blocked ? ' off' : ''), 'data-font': f.family,
      title: blocked ? 'No Malayalam letters in this font' : f.family,
      onclick: () => { const x = active(); if (isText(x)) setFont(x, f.family); } },
      el('span', { class: 'fc-prev', style: `font-family:'${f.family}';font-weight:${isText(o) && Number(o.fontWeight) >= 600 && f.files[700] ? 700 : 400}`, text: blocked ? 'Aa' : (f.ml && !ml && !text.trim() ? 'അക്ഷരം' : text) }),
      el('span', { class: 'fc-name', text: f.family + (f.files[700] ? '' : ' · 1 weight') })));
  });
}
$('btnBold').onclick = async () => {
  const o = active(); if (!isText(o)) return;
  const bold = !(Number(o.fontWeight) >= 600 || o.fontWeight === 'bold');
  const w = bold ? boldWeightFor(o.fontFamily) : 400;
  await document.fonts.load(`${o.fontStyle === 'italic' ? 'italic ' : ''}${w} 40px "${o.fontFamily}"`, o.text);
  fabric.util.clearFabricFontCache(o.fontFamily);
  if (bold && !hasFace(o.fontFamily, w, o.fontStyle === 'italic')) toast('No bold file in this font: using synthetic bold');
  o.set('fontWeight', w); o.initDimensions(); o.setCoords(); canvas.requestRenderAll(); history.record(); syncEditPanel();
};
document.querySelectorAll('#alignSeg button').forEach((b) => { b.onclick = () => { const o = active(); if (!isText(o)) return; o.set('textAlign', b.dataset.align); o.dirty = true; canvas.requestRenderAll(); history.record(); syncEditPanel(); }; });

async function editText(o) {
  const v = await promptSheet('Edit text', { value: o.text, multiline: true, okLabel: 'Apply', message: 'Malayalam and English both work. New lines are kept.' });
  if (v == null || !v.trim() || v === o.text) return;
  if (MALAYALAM_RE.test(v) && LATIN_ONLY.has(o.fontFamily)) { o.set('fontFamily', 'Manjari'); toast('Switched to Manjari for Malayalam'); }
  await document.fonts.load(`${o.fontWeight} 40px "${o.fontFamily}"`, v);
  o.set({ text: v, name: v.split('\n')[0].slice(0, 24) }); o.initDimensions(); o.setCoords(); canvas.requestRenderAll(); history.record(); refreshLayers();
}
$('btnEditText').onclick = () => { const o = active(); if (isText(o)) editText(o); };
let lastTap = { t: 0, target: null };
canvas.on('mouse:down', (e) => {
  const now = Date.now();
  if (e.target && e.target === lastTap.target && now - lastTap.t < 380 && isText(e.target) && !e.target.locked) { lastTap = { t: 0, target: null }; editText(e.target); return; }
  lastTap = { t: now, target: e.target };
});

$('btnTextToVector').onclick = async () => {
  const o = active(); if (!isText(o)) return toast('Select a text layer');
  busy(MALAYALAM_RE.test(o.text) ? 'Shaping and tracing Malayalam…' : 'Building outlines…');
  try {
    const v = await convertFabricTextToVector(o);
    await history.batch(async () => { const i = canvas.getObjects().indexOf(o); canvas.remove(o); canvas.insertAt(v, i); canvas.setActiveObject(v); });
    canvas.requestRenderAll(); toast('Converted to outlines. Undo to get the editable text back.');
  } catch (e) { toast('Could not convert: ' + e.message, 'error'); } finally { busy(); }
};
// ---------- align, distribute, position, snapping ----------
let alignRel = 'artboard';
document.querySelectorAll('#alignRel .chip').forEach((b) => { b.onclick = () => { alignRel = b.dataset.rel; document.querySelectorAll('#alignRel .chip').forEach((x) => x.classList.toggle('on', x === b)); }; });
function selectedObjects() { const a = active(); if (!a) return []; return a.type === 'activeSelection' ? a.getObjects().slice() : [a]; }
/** Runs fn on absolute object coordinates (dissolving any multi-selection first), then restores the selection. */
function withAbsolute(fn) {
  const objs = selectedObjects(); if (!objs.length) return;
  ctxHold = true;
  try {
    canvas.discardActiveObject();
    objs.forEach((o) => o.setCoords());
    fn(objs);
    objs.forEach((o) => o.setCoords());
    if (objs.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(objs, { canvas })); else canvas.setActiveObject(objs[0]);
  } finally { ctxHold = false; }
  canvas.requestRenderAll(); history.record(); syncEditPanel();
}
function alignTo(mode) {
  withAbsolute((objs) => {
    const brs = objs.map((o) => o.getBoundingRect(true, true));
    let T = { left: 0, top: 0, right: state.W, bottom: state.H };
    if (alignRel === 'selection' && objs.length > 1) T = { left: Math.min(...brs.map((b) => b.left)), top: Math.min(...brs.map((b) => b.top)), right: Math.max(...brs.map((b) => b.left + b.width)), bottom: Math.max(...brs.map((b) => b.top + b.height)) };
    objs.forEach((o, i) => {
      const b = brs[i]; let dx = 0, dy = 0;
      if (mode === 'left') dx = T.left - b.left;
      if (mode === 'right') dx = T.right - (b.left + b.width);
      if (mode === 'hcenter') dx = (T.left + T.right) / 2 - (b.left + b.width / 2);
      if (mode === 'top') dy = T.top - b.top;
      if (mode === 'bottom') dy = T.bottom - (b.top + b.height);
      if (mode === 'vcenter') dy = (T.top + T.bottom) / 2 - (b.top + b.height / 2);
      o.set({ left: o.left + dx, top: o.top + dy });
    });
  });
}
function distribute(axis) {
  const objs = selectedObjects();
  if (objs.length < 3) return toast('Select 3 or more items to space them evenly (Layers → Select several, or drag a box)');
  withAbsolute((list) => {
    const items = list.map((o) => ({ o, b: o.getBoundingRect(true, true) }));
    const pos = (it) => (axis === 'h' ? it.b.left : it.b.top), size = (it) => (axis === 'h' ? it.b.width : it.b.height);
    items.sort((p, q) => pos(p) - pos(q));
    const start = pos(items[0]), end = pos(items[items.length - 1]) + size(items[items.length - 1]);
    const gap = (end - start - items.reduce((s, it) => s + size(it), 0)) / (items.length - 1);
    let cur = start;
    items.forEach((it) => { const d = cur - pos(it); if (axis === 'h') it.o.set('left', it.o.left + d); else it.o.set('top', it.o.top + d); cur += size(it) + gap; });
  });
}
document.querySelectorAll('[data-alignto]').forEach((b) => { b.onclick = () => alignTo(b.dataset.alignto); });
document.querySelectorAll('[data-distribute]').forEach((b) => { b.onclick = () => distribute(b.dataset.distribute); });

function syncPosition() {
  const o = active(); if (!o || o.type === 'activeSelection') return;
  o.setCoords();
  const br = o.getBoundingRect(true, true);
  $('posX').value = Math.round(br.left); $('posY').value = Math.round(br.top);
  $('posW').value = Math.round(o.getScaledWidth()); $('posH').value = Math.round(o.getScaledHeight());
  const ang = Math.round(((o.angle % 360) + 540) % 360 - 180);
  $('rotRange').value = ang; $('rotInput').value = ang;
}
function applyPosition(field) {
  const o = active(); if (!o || o.type === 'activeSelection') return;
  const v = Number($(field).value); if (!Number.isFinite(v)) return;
  if (field === 'posX' || field === 'posY') {
    const br = o.getBoundingRect(true, true);
    if (field === 'posX') o.set('left', o.left + (v - br.left)); else o.set('top', o.top + (v - br.top));
  } else {
    if (v < 1) return;
    const keep = $('lockRatio').checked;
    const c = o.getCenterPoint();
    const nd = o._getNonTransformedDimensions(); // width/height incl. stroke, like getScaledWidth()
    if (field === 'posW') { const k = v / nd.x; if (keep) o.set({ scaleY: o.scaleY * (k / o.scaleX) }); o.set('scaleX', k); }
    else { const k = v / nd.y; if (keep) o.set({ scaleX: o.scaleX * (k / o.scaleY) }); o.set('scaleY', k); }
    o.setPositionByOrigin(c, 'center', 'center');
  }
  o.setCoords(); canvas.requestRenderAll(); history.record(); syncPosition();
}
['posX', 'posY', 'posW', 'posH'].forEach((id) => $(id).addEventListener('change', () => applyPosition(id)));
function setRotation(deg, final) {
  const o = active(); if (!o) return;
  const c = o.getCenterPoint();
  o.rotate(Number(deg)); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); canvas.requestRenderAll();
  $('rotRange').value = deg; $('rotInput').value = deg;
  if (final) history.record(); else history.recordSoon(500);
}
$('rotRange').addEventListener('input', () => setRotation($('rotRange').value, false));
$('rotRange').addEventListener('change', () => setRotation($('rotRange').value, true));
$('rotInput').addEventListener('change', () => setRotation(Math.max(-180, Math.min(180, Number($('rotInput').value) || 0)), true));
$('btnFlip').onclick = () => { const o = active(); if (!o) return; o.set('flipX', !o.flipX); canvas.requestRenderAll(); history.record(); };
$('btnFront').onclick = () => { const o = active(); if (!o) return; canvas.bringToFront(o); history.record(); };
$('btnBack').onclick = () => { const o = active(); if (!o) return; canvas.sendToBack(o); history.record(); };
$('btnLockObj').onclick = () => { const o = active(); if (!o) return; setLocked(o, !o.locked); canvas.requestRenderAll(); history.record(); syncEditPanel(); };

const shadowOf = () => {
  const hex = ($('shadowColor')?.value || '#000000').slice(1); const a = Number($('shadowOpacity')?.value ?? 60) / 100;
  const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)); const ang = (Number($('shadowAngle')?.value ?? 90) * Math.PI) / 180; const d = Number($('shadowOffset').value);
  return new fabric.Shadow({ color: `rgba(${rgb.join(',')},${a})`, blur: Number($('shadowBlur').value), offsetX: Math.round(Math.cos(ang) * d), offsetY: Math.round(Math.sin(ang) * d) });
};
$('btnShadow').onclick = () => { const o = active(); if (!o) return; o.set('shadow', o.shadow ? null : shadowOf()); o.dirty = true; canvas.requestRenderAll(); history.record(); };
['shadowBlur', 'shadowOffset', 'shadowAngle', 'shadowOpacity', 'shadowColor'].forEach((id) => {
  $(id).addEventListener('input', () => { const o = active(); const vl = $(id + 'Val'); if (vl) vl.textContent = $(id).value + ({ shadowAngle: '°', shadowOpacity: '%' }[id] || ''); if (!o) return; o.set('shadow', shadowOf()); o.dirty = true; canvas.requestRenderAll(); history.recordSoon(500); });
  $(id).addEventListener('change', () => history.record());
});
$('btnDuplicate').onclick = () => { const o = active(); if (o) duplicateObj(o); };
$('btnDelete').onclick = () => deleteObjects(selectedObjects());

// Smart snapping: page edges/centre, safe margins, other items' edges/centres, and equal spacing between items.
const guides = { x: [], y: [], spans: [], moving: false };
const safeMargin = () => Math.round(Math.min(state.W, state.H) * 0.05);
function equalSpacing(b, rects, axis, th) {
  const P = axis === 'x' ? ['left', 'width', 'top', 'height'] : ['top', 'height', 'left', 'width'];
  const lo = (r) => r[P[0]], hi = (r) => r[P[0]] + r[P[1]], plo = (r) => r[P[2]], phi = (r) => r[P[2]] + r[P[3]];
  const size = b[P[1]];
  const row = rects.filter((r) => plo(r) < phi(b) && phi(r) > plo(b));
  const L = row.filter((r) => hi(r) <= lo(b) + th).sort((p, q) => hi(q) - hi(p))[0];
  const R = row.filter((r) => lo(r) >= hi(b) - th).sort((p, q) => lo(p) - lo(q))[0];
  const cands = [];
  if (L && R) { const g = (lo(R) - hi(L) - size) / 2; if (g > 0) { const t = hi(L) + g; cands.push({ d: t - lo(b), gap: g, spans: [[hi(L), t], [t + size, lo(R)]] }); } }
  const sorted = row.slice().sort((p, q) => lo(p) - lo(q));
  for (let i = 0; i < sorted.length - 1; i++) {
    const A = sorted[i], B = sorted[i + 1], g = lo(B) - hi(A);
    if (g <= 1) continue;
    if (L && L !== A) { const t = hi(L) + g; cands.push({ d: t - lo(b), gap: g, spans: [[hi(A), lo(B)], [hi(L), t]] }); }
    if (R && R !== B) { const t = lo(R) - g - size; cands.push({ d: t - lo(b), gap: g, spans: [[hi(A), lo(B)], [t + size, lo(R)]] }); }
  }
  let best = null;
  for (const c of cands) if (Math.abs(c.d) < th && (!best || Math.abs(c.d) < Math.abs(best.d))) best = c;
  if (!best) return null;
  const at = plo(b) + b[P[3]] / 2;
  return { d: best.d, spans: best.spans.map(([p, q]) => ({ axis, a: p, b: q, at, gap: Math.round(best.gap) })) };
}
canvas.on('object:moving', (e) => {
  guides.x = []; guides.y = []; guides.spans = []; guides.moving = true;
  if (!$('snapToggle').checked) return;
  const o = e.target; o.setCoords();
  const th = 6 / (canvas.getZoom() || 1);
  const xs = [0, state.W / 2, state.W], ys = [0, state.H / 2, state.H];
  if ($('safeToggle').checked) { const m = safeMargin(); xs.push(m, state.W - m); ys.push(m, state.H - m); }
  const others = canvas.getObjects().filter((k) => k !== o && k.visible !== false && !(o.type === 'activeSelection' && o.contains(k))).map((k) => k.getBoundingRect(true, true));
  others.forEach((r) => { xs.push(r.left, r.left + r.width / 2, r.left + r.width); ys.push(r.top, r.top + r.height / 2, r.top + r.height); });
  const edge = (lo, size, cands) => { let best = null; [lo, lo + size / 2, lo + size].forEach((m) => cands.forEach((v) => { const d = v - m; if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v }; })); return best; };
  let b = o.getBoundingRect(true, true);
  const ex = edge(b.left, b.width, xs), sx = equalSpacing(b, others, 'x', th);
  if (sx && (!ex || Math.abs(sx.d) <= Math.abs(ex.d))) { o.set('left', o.left + sx.d); guides.spans.push(...sx.spans); if (ex && Math.abs(ex.d - sx.d) < 0.5) guides.x = [ex.v]; }
  else if (ex) { o.set('left', o.left + ex.d); guides.x = [ex.v]; }
  o.setCoords(); b = o.getBoundingRect(true, true);
  const ey = edge(b.top, b.height, ys), sy = equalSpacing(b, others, 'y', th);
  if (sy && (!ey || Math.abs(sy.d) <= Math.abs(ey.d))) { o.set('top', o.top + sy.d); guides.spans.push(...sy.spans); if (ey && Math.abs(ey.d - sy.d) < 0.5) guides.y = [ey.v]; }
  else if (ey) { o.set('top', o.top + ey.d); guides.y = [ey.v]; }
  o.setCoords();
});
canvas.on('mouse:up', () => { if (guides.moving || guides.x.length || guides.y.length || guides.spans.length) { guides.x = []; guides.y = []; guides.spans = []; guides.moving = false; canvas.requestRenderAll(); } });
canvas.on('after:render', () => {
  const showSafe = $('safeShow').checked || (guides.moving && $('safeToggle').checked);
  if (!guides.x.length && !guides.y.length && !guides.spans.length && !showSafe) return;
  const ctx = canvas.getContext(); const v = canvas.viewportTransform; const z = v[0];
  const X = (x) => x * z + v[4], Y = (y) => y * z + v[5];
  ctx.save(); ctx.lineWidth = 1;
  if (showSafe) { const m = safeMargin(); ctx.strokeStyle = 'rgba(56,189,248,.8)'; ctx.setLineDash([6, 4]); ctx.strokeRect(X(m) + 0.5, Y(m) + 0.5, (state.W - 2 * m) * z, (state.H - 2 * m) * z); }
  ctx.strokeStyle = '#ec4899'; ctx.setLineDash([4, 3]);
  guides.x.forEach((x) => { ctx.beginPath(); ctx.moveTo(X(x) + 0.5, Y(0)); ctx.lineTo(X(x) + 0.5, Y(state.H)); ctx.stroke(); });
  guides.y.forEach((y) => { ctx.beginPath(); ctx.moveTo(X(0), Y(y) + 0.5); ctx.lineTo(X(state.W), Y(y) + 0.5); ctx.stroke(); });
  ctx.setLineDash([]); ctx.fillStyle = '#ec4899'; ctx.font = '600 10px Poppins, sans-serif'; ctx.textAlign = 'center';
  guides.spans.forEach((sp) => {
    ctx.beginPath();
    if (sp.axis === 'x') { const y = Y(sp.at); ctx.moveTo(X(sp.a), y); ctx.lineTo(X(sp.b), y); ctx.moveTo(X(sp.a), y - 5); ctx.lineTo(X(sp.a), y + 5); ctx.moveTo(X(sp.b), y - 5); ctx.lineTo(X(sp.b), y + 5); ctx.stroke(); ctx.fillText(String(sp.gap), (X(sp.a) + X(sp.b)) / 2, y - 6); }
    else { const x = X(sp.at); ctx.moveTo(x, Y(sp.a)); ctx.lineTo(x, Y(sp.b)); ctx.moveTo(x - 5, Y(sp.a)); ctx.lineTo(x + 5, Y(sp.a)); ctx.moveTo(x - 5, Y(sp.b)); ctx.lineTo(x + 5, Y(sp.b)); ctx.stroke(); ctx.fillText(String(sp.gap), x + 14, (Y(sp.a) + Y(sp.b)) / 2 + 3); }
  });
  ctx.restore();
});
['safeShow', 'safeToggle'].forEach((id) => $(id).addEventListener('change', () => canvas.requestRenderAll()));
window.__pfGuides = guides;

// ---------- multi-select: select mode (top bar) or long-press ----------
let selectMode = false;
canvas.selectionKey = ['shiftKey', 'pfMulti'];
const canvasWrap = canvas.upperCanvasEl.parentNode;
['mousedown', 'touchstart', 'pointerdown'].forEach((t) => canvasWrap.addEventListener(t, (e) => { if (selectMode) e.pfMulti = true; }, true));
function setSelectMode(on) {
  selectMode = !!on; $('btnSelectMode').classList.toggle('on', selectMode);
  document.getElementById('selectBanner')?.remove();
  if (selectMode) document.body.append(el('div', { class: 'select-banner', id: 'selectBanner' }, el('span', { text: 'Select mode: tap items to add or remove' }), el('button', { text: 'Done', onclick: () => setSelectMode(false) })));
}
$('btnSelectMode').onclick = () => { haptic(); setSelectMode(!selectMode); };
let longPress = null;
canvasWrap.addEventListener('pointerdown', (e) => {
  if (maskPaint.on || !e.isPrimary) return;
  if (longPress) clearTimeout(longPress.t);
  const sx = e.clientX, sy = e.clientY;
  const prev = active(); // captured before Fabric replaces the selection on this press
  longPress = { sx, sy, t: setTimeout(() => {
    longPress = null;
    const target = canvas.findTarget(e, false); if (!target) return;
    haptic('heavy');
    // 2.1: long-press a single photo (not in select mode) = lift the subject, like iOS
    if (!selectMode && target.type === 'image' && !(prev && prev !== target) && window.PFLift) { window.PFLift(target); return; }
    const a = prev && canvas.getObjects().includes(prev) || (prev && prev.type === 'activeSelection') ? prev : active();
    if (!selectMode) setSelectMode(true);
    if (a && a !== target) {
      const set = a.type === 'activeSelection' ? a.getObjects().slice() : [a];
      if (!set.includes(target)) set.push(target);
      canvas.discardActiveObject(); canvas.setActiveObject(new fabric.ActiveSelection(set, { canvas }));
    } else canvas.setActiveObject(target);
    canvas.requestRenderAll(); refreshLayers(); syncEditPanel();
  }, 520) };
}, true);
canvasWrap.addEventListener('pointermove', (e) => { if (longPress && Math.hypot(e.clientX - longPress.sx, e.clientY - longPress.sy) > 10) { clearTimeout(longPress.t); longPress = null; } }, true);
['pointerup', 'pointercancel'].forEach((t) => canvasWrap.addEventListener(t, () => { if (longPress) { clearTimeout(longPress.t); longPress = null; } }, true));

// ---------- groups ----------
const cloneObj = (o) => new Promise((r) => o.clone(r, PROPS));
async function groupSel() {
  const a = active(); if (!a || a.type !== 'activeSelection') return toast('Select two or more items first');
  const objs = canvas.getObjects(); const top = Math.max(...a.getObjects().map((o) => objs.indexOf(o))); const n = a.size();
  let g;
  await history.batch(() => { g = a.toGroup(); g.set({ name: 'Group', pfRole: 'group' }); canvas.moveTo(g, top - n + 1); canvas.setActiveObject(g); });
  canvas.requestRenderAll(); refreshLayers(); syncEditPanel(); return g;
}
async function ungroupSel() {
  const g = active(); if (!g || g.type !== 'group' || g.pfRole === 'clip') return;
  const idx = canvas.getObjects().indexOf(g);
  await history.batch(() => { const sel = g.toActiveSelection(); sel.getObjects().forEach((o, i) => canvas.moveTo(o, idx + i)); canvas.setActiveObject(sel); });
  canvas.requestRenderAll(); refreshLayers(); syncEditPanel();
}
$('btnGroup').onclick = () => groupSel();
$('btnUngroup').onclick = () => ungroupSel();

// ---------- clipping: photo inside a shape or text ----------
const FRAME_TYPES = new Set(['rect', 'circle', 'ellipse', 'triangle', 'polygon', 'path', 'text', 'i-text', 'textbox', 'group']);
function clippablePair(o) {
  if (!o || o.type !== 'activeSelection') return null;
  const objs = o.getObjects(); if (objs.length !== 2) return null;
  const photo = objs.find((x) => x.type === 'image');
  const frame = objs.find((x) => x !== photo && FRAME_TYPES.has(x.type) && x.pfRole !== 'clip');
  return photo && frame ? { photo, frame } : null;
}
async function clipPhoto() {
  const pair = clippablePair(active());
  if (!pair) return toast('Select one photo and one shape or text (Select mode or long-press)');
  const { photo, frame } = pair;
  let g;
  ctxHold = true;
  try {
    await history.batch(async () => {
      canvas.discardActiveObject();
      const objs = canvas.getObjects(); const idx = Math.min(objs.indexOf(frame), objs.indexOf(photo));
      const frameJSON = JSON.stringify(frame.toObject(PROPS));
      frame.setCoords(); const fb = frame.getBoundingRect(true, true); const fc = frame.getCenterPoint();
      const clip = await cloneObj(frame);
      const k = Math.max(fb.width / photo.width, fb.height / photo.height); // cover the frame's box, centred
      photo.set({ angle: 0, skewX: 0, skewY: 0, scaleX: k, scaleY: k }); photo.setPositionByOrigin(fc, 'center', 'center'); photo.setCoords();
      canvas.remove(photo); canvas.remove(frame);
      g = new fabric.Group([photo], { name: `${String(photo.name || 'Photo').slice(0, 20)} in ${String(frame.name || typeLabel(frame)).slice(0, 20)}`, pfRole: 'clip' });
      const gc = g.getCenterPoint();
      clip.set({ fill: '#000000', stroke: null, strokeWidth: 0, shadow: null, opacity: 1, globalCompositeOperation: 'source-over', visible: true, clipPath: undefined, pfMask: null });
      clip.setPositionByOrigin(new fabric.Point(fc.x - gc.x, fc.y - gc.y), 'center', 'center');
      g.clipPath = clip;
      const inner = g.getObjects()[0];
      g.set({ pfFrame: frameJSON, pfClipBase: JSON.stringify({ s: inner.scaleX, l: inner.left, t: inner.top, fw: fb.width, fh: fb.height }), pfClipZ: 100, pfClipX: 0, pfClipY: 0 });
      canvas.insertAt(g, idx);
      canvas.setActiveObject(g);
    });
  } finally { ctxHold = false; }
  canvas.requestRenderAll(); refreshLayers(); syncEditPanel(); haptic('confirm');
  return g;
}
function applyClipAdjust(final) {
  const g = active(); if (!g || g.pfRole !== 'clip') return;
  g.set({ pfClipZ: Number($('clipZoom').value), pfClipX: Number($('clipX').value), pfClipY: Number($('clipY').value) });
  const b = JSON.parse(g.pfClipBase || '{}'); const p = g.getObjects()[0]; if (!p || !b.s) return;
  const sc = b.s * g.pfClipZ / 100;
  const mx = Math.max(0, (p.width * sc - b.fw) / 2), my = Math.max(0, (p.height * sc - b.fh) / 2);
  p.set({ scaleX: sc, scaleY: sc, left: b.l + (g.pfClipX / 100) * mx, top: b.t + (g.pfClipY / 100) * my }); p.setCoords();
  g.dirty = true; canvas.requestRenderAll();
  $('clipZoomVal').textContent = g.pfClipZ + '%'; $('clipXVal').textContent = g.pfClipX; $('clipYVal').textContent = g.pfClipY;
  if (final) history.record(); else history.recordSoon(500);
}
['clipZoom', 'clipX', 'clipY'].forEach((id) => { $(id).addEventListener('input', () => applyClipAdjust(false)); $(id).addEventListener('change', () => applyClipAdjust(true)); });
async function unclip() {
  const g = active(); if (!g || g.pfRole !== 'clip') return;
  ctxHold = true;
  try {
    await history.batch(async () => {
      const idx = canvas.getObjects().indexOf(g);
      const m = g.calcTransformMatrix(); const d = fabric.util.qrDecompose(m);
      const c = g.clipPath; const pt = fabric.util.transformPoint(c.getCenterPoint(), m);
      canvas.discardActiveObject();
      const photo = g.getObjects()[0];
      g._restoreObjectsState(); canvas.remove(g); photo.group = undefined; photo.setCoords();
      const [frame] = await new Promise((r) => fabric.util.enlivenObjects([JSON.parse(g.pfFrame)], r));
      frame.set({ angle: (c.angle || 0) + d.angle, scaleX: (frame.scaleX || 1) * d.scaleX, scaleY: (frame.scaleY || 1) * d.scaleY });
      frame.setPositionByOrigin(pt, 'center', 'center'); frame.setCoords();
      canvas.insertAt(photo, idx); canvas.insertAt(frame, idx + 1);
      canvas.setActiveObject(photo);
    });
  } finally { ctxHold = false; }
  canvas.requestRenderAll(); refreshLayers(); syncEditPanel();
}
$('btnClip').onclick = () => clipPhoto();
$('btnUnclip').onclick = () => unclip();

// ---------- blend modes ----------
const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'],
  ['color-dodge', 'Colour dodge'], ['color-burn', 'Colour burn'], ['hard-light', 'Hard light'], ['soft-light', 'Soft light'], ['difference', 'Difference'],
  ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Colour'], ['luminosity', 'Luminosity']];
const blendLabel = (m) => (BLENDS.find((b) => b[0] === m) || [m, m])[1];
BLENDS.forEach(([m, label]) => $('blendGrid').append(el('button', { class: 'chip rip', 'data-blend': m, text: label, onclick: () => setBlend(m) })));
function setBlend(mode) {
  const objs = selectedObjects(); if (!objs.length) return;
  objs.forEach((o) => { o.set('globalCompositeOperation', mode); o.dirty = true; });
  canvas.requestRenderAll(); history.record(); refreshLayers(); syncProPanels();
}

// ---------- photo adjustments (native, background thread) ----------
const FILTER_SLIDERS = { brightness: 'fBrightness', contrast: 'fContrast', saturation: 'fSaturation', warmth: 'fWarmth', blur: 'fBlur', vignette: 'fVignette' };
const FILTER_PRESETS = [['Original', {}], ['Vivid', { contrast: 15, saturation: 35 }], ['B&W', { grayscale: true, contrast: 10 }], ['Sepia', { sepia: true }],
  ['Warm', { warmth: 25, saturation: 10 }], ['Cool', { warmth: -25 }], ['Fade', { contrast: -25, brightness: 8, saturation: -20 }], ['Dream', { blur: 2, brightness: 6, vignette: 30 }]];
const filterOf = (o) => { try { return JSON.parse((o && o.pfFilter) || '{}') || {}; } catch (_) { return {}; } };
let filterFlags = {};
function readFilterSliders() { const cur = filterOf(active()); const f = { ...filterFlags }; for (const k of ['curve', 'hsl', 'grain']) if (cur[k]) f[k] = cur[k]; for (const [k, id] of Object.entries(FILTER_SLIDERS)) { const v = Number($(id).value); if (v) f[k] = v; } return f; }
function setImageSrc(o, url) {
  return new Promise((res) => { const w = o.width, h = o.height; o.setSrc(url, () => { o.set({ width: w, height: h }); o.dirty = true; if (o.group) o.group.dirty = true; o.setCoords(); canvas.requestRenderAll(); res(); }); });
}
let filterRun = null;
async function applyFilter(o, f) {
  if (!o || o.type !== 'image') return false;
  filterRun?.abort(); const ac = new AbortController(); filterRun = ac;
  if (!o.pfBase) o.pfBase = o.getSrc();
  const base = o.pfBase;
  try {
    if (isIdentityFilter(f)) { await setImageSrc(o, base); o.set({ pfFilter: null, pfBase: null }); history.record(); return true; }
    const pt = progressTask('Adjusting photo…', { onCancel: () => ac.abort() });
    try {
      const e2 = o._element;
      const r = await processImage('filter', await urlToBlob(base), { maxSide: Math.max(e2.naturalWidth || e2.width, e2.naturalHeight || e2.height), filter: f, format: o.pfAlpha ? 'png' : 'jpeg' }, { onProgress: pt.set, signal: ac.signal });
      if (ac.signal.aborted) return false;
      if (!r.ok) { toast('Adjust failed: ' + r.error, 'error'); return false; }
      await setImageSrc(o, r.url); o.set('pfFilter', JSON.stringify(f)); history.record();
      return true;
    } finally { pt.done(); }
  } finally { if (filterRun === ac) filterRun = null; }
}
FILTER_PRESETS.forEach(([label, f]) => $('filterPresets').append(el('button', { class: 'chip rip', 'data-preset': label, text: label, onclick: () => {
  filterFlags = {}; if (f.grayscale) filterFlags.grayscale = true; if (f.sepia) filterFlags.sepia = true;
  for (const [k, id] of Object.entries(FILTER_SLIDERS)) { $(id).value = f[k] || 0; $(id + 'Val').textContent = f[k] || 0; }
  document.querySelectorAll('#filterPresets .chip').forEach((c) => c.classList.toggle('on', c.dataset.preset === label));
  if (label === 'Original' && active()) active().pfFilter = null;
  applyFilter(active(), readFilterSliders());
} })));
Object.values(FILTER_SLIDERS).forEach((id) => {
  $(id).addEventListener('input', () => { $(id + 'Val').textContent = $(id).value; });
  $(id).addEventListener('change', () => applyFilter(active(), readFilterSliders()));
});

// ---------- layer masks: brush + gradient ----------
const maskPaint = { on: false, mode: 'hide', down: false, last: null, target: null };
function ensureMask(o) {
  if (o._pfMaskEl && o.pfMask && o._pfMaskSrc === o.pfMask) return o._pfMaskEl;
  const e2 = o._element; const w = e2.naturalWidth || e2.width, h = e2.naturalHeight || e2.height;
  const k = Math.min(1, 1024 / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  o._pfMaskEl = c; o.pfMask = c.toDataURL('image/png'); o._pfMaskSrc = o.pfMask; o._pfMaskStamp = (o._pfMaskStamp || 0) + 1;
  return c;
}
function maskChanged(o, commit) {
  o._pfMaskStamp = (o._pfMaskStamp || 0) + 1; o.dirty = true; if (o.group) o.group.dirty = true; canvas.requestRenderAll();
  if (commit) { o.pfMask = o._pfMaskEl.toDataURL('image/png'); o._pfMaskSrc = o.pfMask; history.record(); refreshLayers(); }
}
function maskDab(o, p, size, soft, mode) {
  const m = ensureMask(o); const x = m.getContext('2d');
  const inv = fabric.util.invertTransform(o.calcTransformMatrix());
  const l = fabric.util.transformPoint(new fabric.Point(p.x, p.y), inv);
  const u = (l.x / o.width + 0.5) * m.width, v = (l.y / o.height + 0.5) * m.height;
  const sc = Math.abs(fabric.util.qrDecompose(o.calcTransformMatrix()).scaleX) || 1;
  const r = Math.max(1, (size / 2) / (sc * o.width) * m.width);
  const g = x.createRadialGradient(u, v, r * (1 - soft) * 0.999, u, v, r);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.globalCompositeOperation = mode === 'hide' ? 'destination-out' : 'source-over';
  x.fillStyle = g; x.beginPath(); x.arc(u, v, r, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = 'source-over';
  return r;
}
function maskStroke(o, from, to, size, soft, mode) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y); const step = Math.max(1, size / 6);
  for (let t = step; t <= dist; t += step) maskDab(o, { x: from.x + (to.x - from.x) * t / dist, y: from.y + (to.y - from.y) * t / dist }, size, soft, mode);
  maskDab(o, to, size, soft, mode);
}
function setMaskPaint(on) {
  const o = active();
  if (on && (!o || o.type !== 'image')) { toast('Select a photo to paint its mask'); on = false; }
  maskPaint.on = !!on; maskPaint.target = on ? o : null;
  canvas.skipTargetFind = maskPaint.on; canvas.selection = !maskPaint.on;
  const b = document.getElementById('btnMaskPaint'); if (b) { b.classList.toggle('on', maskPaint.on); b.textContent = maskPaint.on ? 'Paint: on' : 'Paint: off'; }
}
// While painting a mask, taps never clear or change the selection.
const shouldClear0 = canvas._shouldClearSelection.bind(canvas);
canvas._shouldClearSelection = (e, t) => (maskPaint.on ? false : shouldClear0(e, t));
const scenePoint = (opt) => opt.absolutePointer || canvas.getPointer(opt.e);
canvas.on('mouse:down', (opt) => { if (!maskPaint.on || !maskPaint.target) return; maskPaint.down = true; const p = scenePoint(opt); maskPaint.last = p; maskDab(maskPaint.target, p, Number($('maskSize').value), Number($('maskSoft').value) / 100, maskPaint.mode); maskChanged(maskPaint.target, false); });
canvas.on('mouse:move', (opt) => { if (!maskPaint.on || !maskPaint.down) return; const p = scenePoint(opt); maskStroke(maskPaint.target, maskPaint.last, p, Number($('maskSize').value), Number($('maskSoft').value) / 100, maskPaint.mode); maskPaint.last = p; maskChanged(maskPaint.target, false); });
canvas.on('mouse:up', () => { if (!maskPaint.on || !maskPaint.down) return; maskPaint.down = false; maskChanged(maskPaint.target, true); });
document.querySelectorAll('#maskBrushMode [data-mode]').forEach((b) => { b.onclick = () => { maskPaint.mode = b.dataset.mode; document.querySelectorAll('#maskBrushMode [data-mode]').forEach((x) => x.classList.toggle('on', x === b)); if (!maskPaint.on) setMaskPaint(true); }; });
$('btnMaskPaint').onclick = () => setMaskPaint(!maskPaint.on);
['maskSize', 'maskSoft'].forEach((id) => $(id).addEventListener('input', () => { $(id + 'Val').textContent = $(id).value; }));
function maskGradient(o, dir) {
  if (!o || o.type !== 'image') return;
  const m = ensureMask(o); const x = m.getContext('2d'); const w = m.width, h = m.height;
  x.clearRect(0, 0, w, h);
  let g;
  if (dir === 'radial') g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) / 2);
  else { const [x0, y0, x1, y1] = { down: [0, 0, 0, h], up: [0, h, 0, 0], right: [0, 0, w, 0], left: [w, 0, 0, 0] }[dir]; g = x.createLinearGradient(x0, y0, x1, y1); }
  g.addColorStop(0, 'rgba(255,255,255,1)'); if (dir !== 'radial') g.addColorStop(0.35, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  maskChanged(o, true);
}
function maskInvert(o) {
  if (!o || o.type !== 'image') return;
  const m = ensureMask(o); const x = m.getContext('2d'); const id = x.getImageData(0, 0, m.width, m.height); const d = id.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255 - d[i + 3]; }
  x.putImageData(id, 0, 0); maskChanged(o, true);
}
function maskClear(o) { if (!o || !o.pfMask) return; o.set('pfMask', null); o._pfMaskEl = null; o._pfMaskSrc = null; o.dirty = true; if (o.group) o.group.dirty = true; canvas.requestRenderAll(); history.record(); refreshLayers(); }
document.querySelectorAll('#maskGradients [data-grad]').forEach((b) => { b.onclick = () => maskGradient(active(), b.dataset.grad); });
$('btnMaskInvert').onclick = () => maskInvert(active());
$('btnMaskClear').onclick = () => maskClear(active());

function syncProPanels() {
  const o = active(); if (!o) return;
  const objs = selectedObjects();
  const gco = objs.length === 1 ? (objs[0].globalCompositeOperation || 'source-over') : null;
  document.querySelectorAll('#blendGrid .chip').forEach((c) => c.classList.toggle('on', c.dataset.blend === gco));
  if (o.type === 'image' && currentPane === 'adjust') {
    const f = filterOf(o); filterFlags = {}; if (f.grayscale) filterFlags.grayscale = true; if (f.sepia) filterFlags.sepia = true;
    for (const [k, id] of Object.entries(FILTER_SLIDERS)) { $(id).value = f[k] || 0; $(id + 'Val').textContent = f[k] || 0; }
    document.querySelectorAll('#filterPresets .chip').forEach((c) => c.classList.toggle('on', c.dataset.preset === 'Original' && isIdentityFilter(f)));
  }
  if (o.pfRole === 'clip') { $('clipZoom').value = o.pfClipZ || 100; $('clipX').value = o.pfClipX || 0; $('clipY').value = o.pfClipY || 0; $('clipZoomVal').textContent = (o.pfClipZ || 100) + '%'; $('clipXVal').textContent = o.pfClipX || 0; $('clipYVal').textContent = o.pfClipY || 0; }
}
canvas.on('selection:cleared', () => setMaskPaint(false));
canvas.on('selection:updated', () => { if (maskPaint.on && active() !== maskPaint.target) setMaskPaint(false); });

// ---------- cutout of a selected photo (native) ----------
$('btnCutoutSel').onclick = async () => {
  const o = active(); if (!o || o.type !== 'image') return;
  await cutoutSheet(await urlToBlob(o.getSrc()), o.name || 'Photo', o);
};

// ---------- add ----------
$('btnAddHeading').onclick = async () => {
  const v = await promptSheet('Add heading', { multiline: true, placeholder: 'Type in English or Malayalam', okLabel: 'Add' });
  if (!v || !v.trim()) return;
  await document.fonts.load(`700 40px "${MALAYALAM_RE.test(v) ? 'Manjari' : 'Montserrat'}"`, v);
  const t = makeText(v.trim(), { fontSize: state.W * 0.09 }); canvas.add(t); canvas.setActiveObject(t); canvas.requestRenderAll(); closePanel();
};
$('btnAddText').onclick = async () => {
  const v = await promptSheet('Add body text', { multiline: true, placeholder: 'Details, date, venue…', okLabel: 'Add' });
  if (!v || !v.trim()) return;
  const t = makeText(v.trim(), { fontSize: state.W * 0.04, fontWeight: 400, fontFamily: MALAYALAM_RE.test(v) ? 'Manjari' : 'Poppins' });
  canvas.add(t); canvas.setActiveObject(t); canvas.requestRenderAll();
};
$('btnAddSub').onclick = async () => {
  const v = await promptSheet('Add subheading', { multiline: true, placeholder: 'Type in English or Malayalam', okLabel: 'Add' });
  if (!v || !v.trim()) return;
  const t = makeText(v.trim(), { fontSize: state.W * 0.055, fontFamily: MALAYALAM_RE.test(v) ? 'Manjari' : 'Poppins' }); canvas.add(t); canvas.setActiveObject(t); canvas.requestRenderAll(); closePanel();
};
$('btnAddMl').onclick = async () => {
  const v = await promptSheet('Malayalam heading', { multiline: true, value: 'മലയാളം', okLabel: 'Add' });
  if (!v || !v.trim()) return;
  await document.fonts.load('700 40px "Manjari"', v);
  const t = makeText(v.trim(), { fontSize: state.W * 0.085, fontFamily: 'Manjari' }); canvas.add(t); canvas.setActiveObject(t); canvas.requestRenderAll(); closePanel();
};
const shapeColor = () => $('shapeColorPicker').value;
const addShape = (o) => { canvas.add(o); canvas.setActiveObject(o); canvas.requestRenderAll(); };
$('btnAddRect').onclick = () => addShape(new fabric.Rect({ ...center(), width: state.W * 0.4, height: state.W * 0.15, rx: 16, ry: 16, fill: shapeColor(), name: 'Rectangle' }));
$('btnAddCircle').onclick = () => addShape(new fabric.Circle({ ...center(), radius: state.W * 0.12, fill: shapeColor(), name: 'Circle' }));
$('btnAddTriangle').onclick = () => addShape(new fabric.Triangle({ ...center(), width: state.W * 0.25, height: state.W * 0.22, fill: shapeColor(), name: 'Triangle' }));
$('btnAddLine').onclick = () => addShape(new fabric.Rect({ ...center(), width: state.W * 0.5, height: 6, fill: shapeColor(), name: 'Line' }));
$('btnAddBadge').onclick = () => addSVG(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,5 64,36 98,36 70,57 81,91 50,70 19,91 30,57 2,36 36,36" fill="${shapeColor()}"/></svg>`, 'Star badge', { width: state.W * 0.3 });

const onFile = (id, fn) => { $(id).addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await fn(f); } catch (err) { busy(); toast(err.message || String(err), 'error'); } }); };
// Photos are decoded (natively when possible, off the UI thread) to a working size; the full-resolution original is kept
// in IndexedDB and swapped in only when an export needs more pixels than the working copy has.
async function importPhoto(f, { maxSide = WORK_SIDE, label = 'Importing photo…', name } = {}) {
  const pt = progressTask(label);
  try {
    const png = /png|webp|gif/i.test(f.type || '');
    const r = await processImage('decode', f, { maxSide, format: png ? 'png' : 'jpeg', quality: 92 }, { onProgress: pt.set });
    if (!r.ok) throw new Error(r.error || 'Could not read photo');
    const o = await addImageFromURL(r.url, name ?? (f.name || 'Photo').replace(/\.[^.]+$/, ''));
    if (png) o.set('pfAlpha', true);
    if (r.origW > r.w || r.origH > r.h) {
      const id = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { await saveOriginal({ id, blob: f, w: r.origW, h: r.origH, created: Date.now() }); o.set({ pfOrig: id, pfOrigW: r.origW, pfOrigH: r.origH }); } catch (_) {}
    }
    return o;
  } finally { pt.done(); }
}
onFile('imageUploadInput', async (f) => {
  const o = await importPhoto(f);
  canvas.add(o); canvas.setActiveObject(o); canvas.requestRenderAll();
});
onFile('bgImageInput', async (f) => {
  const o = await importPhoto(f, { maxSide: 2400, name: 'Background photo' });
  o.set({ pfRole: 'bg' }); o.scale(Math.max(state.W / o.width, state.H / o.height)); o.set(center()); o.setCoords();
  setLocked(o, true);
  await history.batch(() => { canvas.add(o); canvas.sendToBack(o); });
  canvas.requestRenderAll(); toast('Background photo added and locked (unlock it in Layers)');
});
async function traceBlob(blob, colors = 8) {
  const ac = new AbortController();
  const pt = progressTask('Tracing to vector…', { onCancel: () => ac.abort() });
  try {
    const r = await processImage('trace', blob, { maxSide: 1024, colors }, { onProgress: pt.set, signal: ac.signal });
    if (ac.signal.aborted) return null;
    if (!r.ok) throw new Error(r.error || 'Trace failed');
    return r.svg;
  } finally { pt.done(); }
}
onFile('vectorTraceInput', async (f) => {
  const svg = await traceBlob(f, 8); if (!svg) return;
  await addSVG(svg, 'Trace: ' + f.name.slice(0, 16));
});
async function cutoutSheet(blob, name, replace) {
  let tol = 45, feather = 12, cur = null, seq = 0;
  const preview = el('div', { class: 'preview-box' });
  const tolLabel = el('label', { class: 'small' }); const featherLabel = el('label', { class: 'small' });
  const tolR = el('input', { type: 'range', min: '5', max: '140', value: String(tol) });
  const fR = el('input', { type: 'range', min: '0', max: '40', value: String(feather) });
  const info = el('p', { class: 'note', text: 'Working…' });
  let pending = null;
  const run = () => {
    clearTimeout(pending);
    pending = setTimeout(async () => {
      const my = ++seq;
      const r = await processImage('cutout', blob, { maxSide: 640, tolerance: tol, feather: feather * 640 / 1600 });
      if (my !== seq || !r.ok) return;
      if (cur) URL.revokeObjectURL(cur.url); cur = r;
      tolLabel.textContent = `Tolerance ${tol}`; featherLabel.textContent = `Edge softness ${feather}`;
      info.textContent = `Removed ${Math.round(r.removedRatio * 100)}% (background ≈ ${r.bgColor}). Best for plain or studio backgrounds.`;
      preview.replaceChildren(el('img', { src: r.url, alt: 'Cutout preview', style: 'width:100%;display:block' }));
    }, 80);
  };
  tolR.oninput = () => { tol = Number(tolR.value); run(); };
  fR.oninput = () => { feather = Number(fR.value); run(); };
  run();
  const body = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, preview, tolLabel, tolR, featherLabel, fR, info);
  const ok = await sheet({ title: 'Cutout (plain backgrounds)', body, actions: [{ label: 'Cancel', value: false, kind: 'btn-ghost' }, { label: replace ? 'Apply' : 'Add to poster', value: true, kind: 'btn-accent' }] });
  seq++;
  if (cur) URL.revokeObjectURL(cur.url);
  if (!ok) return null;
  const ac = new AbortController();
  const pt = progressTask('Removing background…', { onCancel: () => ac.abort() });
  let r;
  try { r = await processImage('cutout', blob, { maxSide: WORK_SIDE, tolerance: tol, feather }, { onProgress: pt.set, signal: ac.signal }); } finally { pt.done(); }
  if (ac.signal.aborted) return null;
  if (!r.ok) { toast('Cutout failed: ' + r.error, 'error'); return null; }
  if (replace) {
    const w = replace.getScaledWidth();
    await new Promise((res) => replace.setSrc(r.url, res));
    replace.scaleToWidth(w);
    replace.set({ pfAlpha: true, pfBase: null, pfFilter: null, pfOrig: null, pfOrigW: null, pfOrigH: null, pfMask: null }); replace._pfMaskEl = null;
    replace.setCoords(); canvas.requestRenderAll(); history.record(); refreshLayers();
    return replace;
  }
  const o = await addImageFromURL(r.url, 'Cutout: ' + String(name).slice(0, 16), { width: 0.55 });
  o.set('pfAlpha', true);
  canvas.add(o); canvas.setActiveObject(o); canvas.requestRenderAll();
  return o;
}
onFile('cutoutUploadInput', (f) => cutoutSheet(f, f.name));

// ---------- vector library ----------
function objectToOwnSVG(o) {
  // Bounding box of the object itself, so the saved vector is tight and keeps its size when reused
  o.setCoords();
  const br = o.getBoundingRect(true, true);
  const pad = 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${(br.left - pad).toFixed(2)} ${(br.top - pad).toFixed(2)} ${(br.width + pad * 2).toFixed(2)} ${(br.height + pad * 2).toFixed(2)}" width="${Math.round(br.width + pad * 2)}" height="${Math.round(br.height + pad * 2)}">${o.toSVG()}</svg>`;
}
async function renderLibrary() {
  const grid = $('savedLibraryGrid');
  const items = await getAllVectorAssets().catch(() => []);
  grid.replaceChildren();
  if (!items.length) { grid.append(el('p', { class: 'empty', text: 'Saved vectors appear here.' })); return; }
  for (const it of items) {
    let svg; try { svg = sanitizeSVG(it.svg); } catch (_) { continue; }
    let pressTimer = null;
    const card = el('div', { class: 'library-card', role: 'button' }, el('img', { src: svgToDataURL(svg), alt: '' }), el('span', { text: it.name }));
    card.addEventListener('click', () => { if (pressTimer === 'fired') return; addSVG(svg, it.name, { width: state.W * 0.4 }); });
    card.addEventListener('contextmenu', (e) => e.preventDefault());
    card.addEventListener('pointerdown', () => { pressTimer = setTimeout(async () => { pressTimer = 'fired'; if (await confirmSheet('Delete vector?', `Remove “${it.name}” from your library?`, 'Delete', true)) { await deleteVectorAsset(it.id); renderLibrary(); } setTimeout(() => (pressTimer = null), 50); }, 650); });
    card.addEventListener('pointerup', () => { if (pressTimer !== 'fired') clearTimeout(pressTimer); });
    card.addEventListener('pointerleave', () => { if (pressTimer !== 'fired') clearTimeout(pressTimer); });
    grid.append(card);
  }
}
$('btnSaveToLibrary').onclick = async () => {
  const o = active(); if (!o) return toast('Select something on the poster first');
  let svg; try { svg = sanitizeSVG(objectToOwnSVG(o)); } catch (e) { return toast('Cannot save: ' + e.message, 'error'); }
  const name = await promptSheet('Save to library', { value: o.name || 'Vector', okLabel: 'Save' });
  if (!name || !name.trim()) return;
  await saveVectorAsset(name.trim().slice(0, 40), svg); renderLibrary(); toast('Saved to library');
};

// ---------- export ----------
// Swap working copies for stored originals where the export draws a photo larger than its working copy.
async function useOriginals(json, scale) {
  const imgs = []; const visit = (o, k) => { if (!o) return; const kk = k * Math.abs(o.scaleX || 1); if (o.type === 'image' && o.pfOrig) imgs.push([o, kk]); (o.objects || []).forEach((c) => visit(c, kk)); };
  json.objects.forEach((o) => visit(o, scale));
  let swapped = 0;
  for (const [o, k] of imgs) {
    const need = o.width * k; if (need <= o.width * 1.05) continue;
    const rec = await getOriginal(o.pfOrig).catch(() => null); if (!rec || !rec.blob) continue;
    const maxSide = Math.min(Math.max(rec.w, rec.h), Math.ceil(Math.max(o.width, o.height) * k / Math.abs(o.scaleX || 1) * Math.abs(o.scaleX || 1)));
    const f = (() => { try { return JSON.parse(o.pfFilter || '{}'); } catch (_) { return {}; } })();
    let srcBlob = rec.blob;
    if (o.pfGeo && window.PFGeo) { const g = await window.PFGeo.applyToBlob(srcBlob, JSON.parse(o.pfGeo), Math.min(Math.max(rec.w, rec.h), maxSide * 1.5), !!o.pfAlpha); if (g) srcBlob = g; }
    const r = await processImage(isIdentityFilter(f) ? 'decode' : 'filter', srcBlob, { maxSide, filter: f, blurScale: maxSide / Math.max(o.width, o.height), format: o.pfAlpha ? 'png' : 'jpeg', quality: 95 });
    if (!r.ok) continue;
    const ratio = r.w / o.width;
    o.src = r.url; o.scaleX = (o.scaleX || 1) / ratio; o.scaleY = (o.scaleY || 1) / ratio; o.width = r.w; o.height = r.h;
    o.cropX = (o.cropX || 0) * ratio; o.cropY = (o.cropY || 0) * ratio; o._pfTemp = true;
    swapped++;
  }
  return swapped;
}
async function renderStatic(scale, { forSVG = false, originals = !forSVG, height, top = 0, transparent = false } = {}) {
  const s = JSON.parse(serialize());
  if (transparent) { s.canvas.background = ''; delete s.canvas.backgroundImage; s.canvas.objects = s.canvas.objects.filter((o) => o.pfRole !== 'bg'); }
  if (forSVG) await dataURLsFor(s.canvas);
  const temps = [];
  if (originals) { await useOriginals(s.canvas, scale); const v = (o) => { if (o._pfTemp) temps.push(o.src); (o.objects || []).forEach(v); }; s.canvas.objects.forEach(v); }
  await ensureFonts(s.canvas);
  const el2 = document.createElement('canvas');
  const sc = new fabric.StaticCanvas(el2, { width: Math.round(state.W * scale), height: height ?? Math.round(state.H * scale), enableRetinaScaling: false, renderOnAddRemove: false });
  await new Promise((r) => sc.loadFromJSON(s.canvas, r));
  await prepareMasks(sc.getObjects());
  sc.getObjects().forEach((o) => { if (isText(o)) o.initDimensions(); });
  sc.setViewportTransform([scale, 0, 0, scale, 0, -top]);
  sc.renderAll();
  sc.pfTemps = temps;
  const dispose = sc.dispose.bind(sc); sc.dispose = () => { temps.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} }); return dispose(); };
  return sc;
}
// Memory budget: the largest output (in pixels) this device can safely assemble.
function exportBudget() {
  const m = memoryInfo();
  if (m && m.maxExportPixels) return m.maxExportPixels;
  const dm = navigator.deviceMemory || 4;
  return Math.max(4e6, Math.min(80e6, dm * 1e7));
}
const fitsBudget = (scale) => state.W * scale * state.H * scale <= exportBudget();
async function exportPNGBlob(scale = state.exportScale, type = 'image/png', quality = 0.95, { transparent = false } = {}) {
  const sc = await renderStatic(scale, { transparent });
  const blob = await canvasToBlob(sc.lowerCanvasEl, type, quality);
  sc.dispose();
  return blob;
}
// Large exports: the poster is rendered in horizontal tiles and stitched/encoded natively on a background thread.
async function exportTiled({ scale, mime, name, action, onProgress, quality = 95, transparent = false }) {
  const W = Math.round(state.W * scale), H = Math.round(state.H * scale);
  const tileH = Math.max(64, Math.min(H, Math.floor(4e6 / W)));
  return nativeExport({ w: W, h: H, mime, quality, name, action, tileH, onProgress,
    renderTile: async (y, h) => { const sc = await renderStatic(scale, { top: y, height: h, transparent }); const b = await canvasToBlob(sc.lowerCanvasEl, 'image/png'); sc.dispose(); return b; } });
}

async function fontFaceCSS(families) {
  let css = '';
  const b64 = (buf) => { let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(bin); };
  for (const fam of families) {
    const e = fontEntry(fam); if (!e) continue;
    for (const f of e.faces) {
      const buf = f.buffer ? new Uint8Array(f.buffer) : new Uint8Array(await (await fetch(f.url)).arrayBuffer());
      css += `@font-face{font-family:'${fam.replace(/'/g, '')}';font-weight:${f.variable ? f.w + ' ' + f.w2 : f.w};font-style:${f.italic ? 'italic' : 'normal'};src:url(data:font/ttf;base64,${b64(buf)}) format('truetype');}`;
    }
  }
  return css;
}
async function exportSVGBlob() {
  const sc = await renderStatic(1, { forSVG: true });
  const fams = new Set();
  const visit = (o) => { if (isText(o)) fams.add(o.fontFamily); (o._objects || []).forEach(visit); };
  sc.getObjects().forEach(visit);
  let svg = sc.toSVG({ viewBox: { x: 0, y: 0, width: state.W, height: state.H }, width: state.W, height: state.H });
  sc.dispose();
  if (fams.size) svg = svg.replace(/(<svg[^>]*>)/, `$1<style>${await fontFaceCSS([...fams])}</style>`);
  return new Blob([svg], { type: 'image/svg+xml' });
}
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
async function doExport(kind, action, scale) {
  canvas.discardActiveObject(); canvas.requestRenderAll();
  if (kind !== 'svg' && !fitsBudget(scale)) { toast('That size is too large for this device’s memory', 'error'); return { ok: false, error: 'budget' }; }
  const name = `PosterForge_${stamp()}.${kind}`;
  const mime = kind === 'svg' ? 'image/svg+xml' : kind === 'jpg' ? 'image/jpeg' : 'image/png';
  const pt = progressTask(kind === 'svg' ? 'Building SVG…' : `Exporting ${Math.round(state.W * scale)} × ${Math.round(state.H * scale)}…`);
  try {
    if (kind !== 'svg' && hasNativeExport()) {
      const r = await exportTiled({ scale, mime, name, action, onProgress: pt.set });
      if (!r.ok) toast('Export failed: ' + r.error, 'error'); else if (action === 'save') haptic('confirm');
      return r;
    }
    pt.set(0.2);
    const blob = kind === 'svg' ? await exportSVGBlob() : await exportPNGBlob(scale, mime);
    pt.set(0.8);
    const r = await sendBlob(blob, name, mime, action);
    if (!r.ok) toast('Export failed: ' + r.error, 'error');
    else if (action === 'save') { haptic('confirm'); if (!hasNative()) toast('Saved: ' + name); }
    return r;
  } catch (e) { toast('Export failed: ' + e.message, 'error'); return { ok: false, error: e.message }; }
  finally { pt.done(); }
}
async function exportSheet() {
  let scale = state.exportScale, kind = 'png';
  if (!fitsBudget(scale)) scale = [3, 2, 1].find((s) => fitsBudget(s)) || 1;
  const seg = el('div', { class: 'seg' }); const kindSeg = el('div', { class: 'seg' });
  const dims = el('p', { class: 'note' });
  const draw = () => {
    seg.replaceChildren(...[1, 2, 3, 4].map((s) => { const ok = fitsBudget(s); return el('button', { class: s === scale ? 'on' : '', 'data-scale': String(s), disabled: ok ? undefined : 'true', title: ok ? '' : 'Too large for this device', text: `${s}×  ${state.W * s}×${state.H * s}`, onclick: () => { if (ok) { scale = s; draw(); } } }); }));
    kindSeg.replaceChildren(...[['png', 'PNG'], ['jpg', 'JPG'], ['svg', 'SVG (vector)']].map(([k, l]) => el('button', { class: k === kind ? 'on' : '', text: l, onclick: () => { kind = k; draw(); } })));
    const capped = [1, 2, 3, 4].some((s) => !fitsBudget(s));
    dims.textContent = kind === 'svg' ? `SVG keeps shapes and text as vectors (${state.W}×${state.H} viewBox). Used fonts are embedded.` : `Output ${state.W * scale} × ${state.H * scale} px. Saved to Pictures/PosterForge.` + (capped ? ' Larger sizes are limited by this device’s memory.' : '');
    seg.classList.toggle('hidden', kind === 'svg');
  };
  draw();
  const body = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, el('label', { class: 'small', text: 'Format' }), kindSeg, el('label', { class: 'small', text: 'Size' }), seg, dims);
  const a = await sheet({ title: 'Export', body, actions: [{ label: 'Share', value: 'share', kind: 'btn-secondary' }, { label: kind === 'svg' ? 'Save' : 'Save to Gallery', value: 'save', kind: 'btn-accent' }] });
  if (!a) return;
  state.exportScale = scale; localStorage.setItem('pf.exportScale', String(scale));
  await doExport(kind, a, scale);
}

$('btnExport').onclick = exportSheet;

// ---------- artboard & background ----------
async function setArtboard(w, h, scaleContent) {
  const ow = state.W, oh = state.H;
  if (w === ow && h === oh) return;
  await history.batch(() => {
    if (scaleContent) {
      const k = Math.min(w / ow, h / oh);
      canvas.getObjects().forEach((o) => {
        const c = o.getCenterPoint();
        if (o.pfRole === 'bg') {
          const kk = Math.max(w / ow, h / oh);
          o.set({ scaleX: o.scaleX * kk, scaleY: o.scaleY * kk });
          o.setPositionByOrigin(new fabric.Point(w / 2 + (c.x - ow / 2) * kk, h / 2 + (c.y - oh / 2) * kk), 'center', 'center');
        } else {
          o.set({ scaleX: o.scaleX * k, scaleY: o.scaleY * k });
          o.setPositionByOrigin(new fabric.Point(w / 2 + (c.x - ow / 2) * k, h / 2 + (c.y - oh / 2) * k), 'center', 'center');
        }
        o.setCoords();
      });
    }
    state.W = w; state.H = h;
    layout();
  });
  toast(`Artboard ${w} × ${h}`);
}
async function artboardSheet() {
  let scaleContent = true;
  const chk = el('input', { type: 'checkbox', checked: true, onchange: (e) => (scaleContent = e.target.checked) });
  const wI = el('input', { type: 'number', value: String(state.W), min: '200', max: '6000' });
  const hI = el('input', { type: 'number', value: String(state.H), min: '200', max: '6000' });
  const list = el('div', { class: 'menu-list' });
  const body = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, list,
    el('label', { class: 'small', text: 'Custom size (px)' }), el('div', { class: 'row' }, wI, el('span', { text: '×' }), hI),
    el('label', { class: 'row small' }, chk, el('span', { text: 'Scale and re-centre existing items' })));
  const v = await sheet({
    title: `Artboard size (now ${state.W} × ${state.H})`, body,
    actions: [{ label: 'Cancel', value: null, kind: 'btn-ghost' }, { label: 'Use custom', value: () => ({ w: Number(wI.value), h: Number(hI.value) }), kind: 'btn-accent' }],
    onOpen: (_, close) => PRESETS.forEach((p) => list.append(el('button', { text: `${p.label}  ·  ${p.w}×${p.h}${p.w === state.W && p.h === state.H ? '  ✓' : ''}`, onclick: () => close({ w: p.w, h: p.h }) }))),
  });
  if (!v) return;
  const w = Math.round(v.w), h = Math.round(v.h);
  if (!(w >= 200 && w <= 6000 && h >= 200 && h <= 6000)) return toast('Size must be 200–6000 px', 'error');
  await setArtboard(w, h, scaleContent);
}
async function backgroundSheet() {
  const start = toHex(canvas.backgroundColor) || '#0d1117';
  const pick = el('input', { type: 'color', value: start });
  const set = (c) => { canvas.setBackgroundColor(c, () => canvas.requestRenderAll()); history.recordSoon(500); pick.value = c; };
  pick.addEventListener('input', () => set(pick.value));
  const sw = el('div', { class: 'swatches' }, ...['#0d1117', '#ffffff', '#111827', '#7f1d1d', '#14532d', '#1e3a8a', '#f59e0b', '#fde68a', '#0f766e', '#581c87'].map((c) => el('div', { class: 'swatch', style: `background:${c}`, onclick: () => set(c) })));
  await sheet({ title: 'Background colour', body: el('div', { style: 'display:flex;flex-direction:column;gap:10px' }, el('div', { class: 'row' }, pick, el('span', { class: 'small', text: 'Custom colour' })), sw), actions: [{ label: 'Done', value: true, kind: 'btn-accent' }] });
  history.flush();
}

// ---------- projects ----------
function projectFonts(s) {
  const out = new Set(); const v = (o) => { if (o && o.fontFamily) out.add(o.fontFamily); (o && o.objects || []).forEach(v); };
  (s.pages || [s.canvas]).forEach((c) => (c.objects || []).forEach(v));
  return [...out].map((f) => ({ family: f, user: !!(fontEntry(f) && fontEntry(f).user) }));
}
async function thumbnail() {
  const sc = await renderStatic(Math.min(1, 240 / Math.max(state.W, state.H)));
  const url = sc.lowerCanvasEl.toDataURL('image/jpeg', 0.8); sc.dispose(); return url;
}
async function saveProject(asCopy = false) {
  let name = state.projectName;
  if (!name || asCopy) {
    name = await promptSheet(asCopy ? 'Save a copy' : 'Save project', { value: name ? name + ' copy' : 'Poster ' + new Date().toLocaleDateString(), okLabel: 'Save' });
    if (!name || !name.trim()) return;
    name = name.trim().slice(0, 60);
  }
  busy('Saving project…');
  try {
    const s = await projectStateForStorage();
    const id = !asCopy && state.projectId ? state.projectId : 'p' + Date.now();
    await savePosterProject({ id, name, updated: Date.now(), w: state.W, h: state.H, state: s, thumb: await thumbnail(), fonts: projectFonts(s), pages: s.pages ? s.pages.length : 1 });
    state.projectId = id; state.projectName = name; scheduleAutosave();
    toast(`Saved “${name}”`);
  } catch (e) { toast('Save failed: ' + e.message, 'error'); } finally { busy(); }
}
async function openProjectsSheet() {
  const items = await getAllPosterProjects().catch(() => []);
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  if (!items.length) list.append(el('p', { class: 'empty', text: 'No saved projects yet. Use Menu → Save project.' }));
  const id = await sheet({
    title: 'Open project', body: list, actions: [{ label: 'Close', value: null, kind: 'btn-ghost' }],
    onOpen: (_, close) => items.forEach((p) => {
      const row = el('div', { class: 'project-row' }, el('img', { src: p.thumb || '', alt: '' }),
        el('div', { class: 'meta' }, el('div', { text: p.name }), el('small', { text: `${p.w}×${p.h} · ${new Date(p.updated).toLocaleString()}` })),
        el('button', { class: 'btn-accent', text: 'Open', onclick: () => close(p.id) }),
        el('button', { class: 'btn-ghost', text: '🗑', 'aria-label': 'Delete', onclick: async () => { if (await confirmSheet('Delete project?', `“${p.name}” will be removed from this phone.`, 'Delete', true)) { await deletePosterProject(p.id); row.remove(); } } }));
      list.append(row);
    }),
  });
  if (!id) return;
  const p = await getPosterProject(id); if (!p) return;
  busy('Opening…');
  try { await history.mute(() => restoreProject(p.state)); window.PFFonts?.checkMissing(p.state); state.projectId = p.id; state.projectName = p.name; state.zoom = 1; state.panX = state.panY = 0; layout(); history.reset(); toast(`Opened “${p.name}”`); }
  catch (e) { toast('Could not open: ' + e.message, 'error'); } finally { busy(); }
}
async function newPoster() {
  if (canvas.getObjects().length && !(await confirmSheet('Start a new poster?', 'The current poster stays in its saved project (if saved). Unsaved changes can still be undone afterwards.', 'New poster'))) return;
  await history.batch(() => { canvas.clear(); canvas.setBackgroundColor('#0d1117'); });
  state.pages = null; state.page = 0; window.dispatchEvent(new Event('pf:pages'));
  state.projectId = null; state.projectName = ''; canvas.requestRenderAll();
}

// ---------- background & size panes ----------
function buildBackgroundPane() {
  const pane = $('pane-background');
  const cur = toHex(canvas.backgroundColor) || '#0d1117';
  const pick = el('input', { type: 'color', value: cur, 'aria-label': 'Background colour' });
  const set = (c, final) => { canvas.setBackgroundColor(c, () => canvas.requestRenderAll()); pick.value = c; pane.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x.dataset.c === c)); if (final) history.record(); else history.recordSoon(500); };
  pick.addEventListener('input', () => set(pick.value, false));
  pick.addEventListener('change', () => history.record());
  const sw = el('div', { class: 'swatches' }, ...['#0d1117', '#ffffff', '#111827', '#0b1f3a', '#7f1d1d', '#14532d', '#1e3a8a', '#f59e0b', '#fde68a', '#0f766e', '#581c87', '#ec4899'].map((c) =>
    el('div', { class: 'swatch' + (c === cur ? ' on' : ''), 'data-c': c, style: `background:${c}`, role: 'button', onclick: () => set(c, true) })));
  const bgPhoto = canvas.getObjects().find((o) => o.pfRole === 'bg');
  pane.replaceChildren(sw, el('div', { class: 'row' }, pick, el('span', { class: 'note', text: 'Custom colour' })),
    el('div', { class: 'row' }, el('button', { class: 'btn-tonal rip', text: 'Background photo', onclick: () => $('bgImageInput').click() }),
      bgPhoto ? el('button', { class: 'btn-danger rip', text: 'Remove photo', onclick: () => { deleteObjects([bgPhoto]); buildBackgroundPane(); } }) : null));
}
function buildSizePane() {
  const pane = $('pane-size');
  let scaleContent = true;
  const list = el('div', { class: 'menu-list' }, ...PRESETS.map((p) => el('button', { class: 'rip', onclick: () => setArtboard(p.w, p.h, scaleContent).then(buildSizePane) },
    el('span', { style: `display:inline-block;width:${Math.round(22 * p.w / Math.max(p.w, p.h))}px;height:${Math.round(22 * p.h / Math.max(p.w, p.h))}px;border:2px solid ${p.w === state.W && p.h === state.H ? 'var(--accent)' : '#6b7280'};border-radius:3px;flex:none` }),
    el('span', { style: 'flex:1', text: p.label }), el('span', { class: 'note', text: `${p.w}×${p.h}` }))));
  const wI = el('input', { type: 'number', value: String(state.W), min: '200', max: '6000', 'aria-label': 'Width' });
  const hI = el('input', { type: 'number', value: String(state.H), min: '200', max: '6000', 'aria-label': 'Height' });
  const chk = el('input', { type: 'checkbox', checked: true, onchange: (e) => (scaleContent = e.target.checked) });
  pane.replaceChildren(el('button', { class: 'btn-accent rip', id: 'btnAllSizes', style: 'width:100%;margin-bottom:8px', text: 'All sizes · Instagram, YouTube, WhatsApp, print, custom', onclick: () => window.PFSizes?.openSizes().then(() => buildSizePane()) }),
    list, el('div', { class: 'row' }, wI, el('span', { text: '×' }), hI,
    el('button', { class: 'btn-filled rip', text: 'Apply', onclick: () => { const w = Math.round(+wI.value), h = Math.round(+hI.value); if (!(w >= 200 && w <= 6000 && h >= 200 && h <= 6000)) return toast('Size must be 200–6000 px', 'error'); setArtboard(w, h, scaleContent).then(buildSizePane); } })),
    el('label', { class: 'row note' }, chk, el('span', { text: 'Scale and re-centre existing items' })));
}

// ---------- settings ----------
const RETIRED_MODEL_RE = /^gemini-(1\.|2\.0|pro$|pro-vision)/;
function currentModel() { const m = localStorage.getItem('pf.model') || ''; return RETIRED_MODEL_RE.test(m) ? '' : m; }
async function settingsSheet() {
  const n = N();
  const keyInput = el('input', { type: 'password', placeholder: n && n.hasApiKey() ? `Stored: ${n.apiKeyHint()} (paste to replace)` : 'Paste your Gemini API key', autocomplete: 'off' });
  const auto = 'Automatic (newest Flash, with fallback)';
  const model = el('select', { 'aria-label': 'Model' });
  const fill = (ids) => {
    const cur = currentModel();
    model.replaceChildren(el('option', { value: '', text: auto }), ...[...new Set([...ids, ...(cur ? [cur] : [])])].map((m) => el('option', { value: m, text: m })));
    model.value = cur;
  };
  fill(defaultModels());
  const custom = el('input', { type: 'text', placeholder: 'Or type a model id, e.g. gemini-3.8-flash', autocomplete: 'off', spellcheck: false });
  const status = el('p', { class: 'note', text: 'If a model is retired, PosterForge switches to a working one automatically and remembers it.' });
  const refresh = el('button', { class: 'btn-tonal rip', text: 'Load models from Google', onclick: async () => {
    if (!n || !n.hasApiKey()) return toast('Save a key first');
    status.textContent = 'Loading models…';
    const r = await geminiModels();
    if (!r.ok) { status.textContent = 'Could not load models: ' + r.error; return; }
    const ids = r.models.map((m) => m.id).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    fill(ids); status.textContent = `${ids.length} text models available to this key.`;
  } });
  const body = el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
    el('label', { class: 'small', text: 'Gemini API key (stored encrypted on this phone, sent only to Google)' }), keyInput,
    el('p', { class: 'note', text: n ? (n.hasApiKey() ? 'A key is saved.' : 'No key saved yet.') : 'Key storage needs the Android app.' }),
    el('label', { class: 'small', text: 'Model' }), model, custom, refresh, status,
    el('p', { class: 'note', text: `PosterForge ${n ? n.appVersion() : 'web'} · Works offline except AI. Fonts: ${FONT_FAMILIES.length} families bundled under the SIL Open Font License (Permanent Marker: Apache 2.0); licence texts are in the app assets. Libraries: Fabric.js (MIT), ImageTracer (Unlicense), opentype.js (MIT).` }));
  const v = await sheet({ title: 'Settings', body, actions: [
    { label: 'Remove key', value: 'clear', kind: 'btn-danger' }, { label: 'Close', value: null, kind: 'btn-ghost' }, { label: 'Save', value: 'save', kind: 'btn-accent' }] });
  const typed = custom.value.trim().toLowerCase().replace(/^models\//, '');
  if (typed && !/^[a-z0-9][a-z0-9.\-]{2,60}$/.test(typed)) toast('That model id looks invalid', 'error');
  else localStorage.setItem('pf.model', typed || model.value);
  if (v === 'save' && keyInput.value.trim()) {
    if (!n) return toast('Key storage needs the Android app', 'error');
    n.setApiKey(keyInput.value.trim()); toast('Key saved (encrypted)');
  } else if (v === 'clear' && n) {
    if (await confirmSheet('Remove API key?', 'AI tools will stop working until you add a key again.', 'Remove', true)) { n.clearApiKey(); toast('Key removed'); }
  }
  updateKeyNote();
}
function updateKeyNote() { const n = N(); $('aiKeyNote').classList.toggle('hidden', !!(n && n.hasApiKey())); }

$('btnMenu').onclick = async () => {
  const v = await menuSheet('PosterForge', [
    { label: '📄  New poster', value: 'new' }, { label: '📂  Open project', value: 'open' }, { label: '💾  Save project', value: 'save' }, { label: '🗂  Save a copy', value: 'copy' }, 'hr',
    { label: `📐  Artboard size (${state.W}×${state.H})`, value: 'size' }, { label: '🎨  Background colour', value: 'bg' }, 'hr',
    { label: '⬇️  Export PNG / JPG / SVG', value: 'export' }, { label: '🔍  Fit poster to screen', value: 'fit' }, { label: '⚙️  Settings & API key', value: 'settings' },
  ]);
  ({ new: newPoster, open: openProjectsSheet, save: () => saveProject(false), copy: () => saveProject(true), size: artboardSheet, bg: backgroundSheet,
    export: exportSheet, fit: () => { state.zoom = 1; state.panX = state.panY = 0; layout(); }, settings: settingsSheet })[v]?.();
};

// ---------- AI ----------
async function ask(parts, { json = false } = {}) {
  if (!hasNative()) { toast('AI tools need the Android app', 'error'); return null; }
  if (!N().hasApiKey()) { toast('Add your Gemini API key first'); settingsSheet(); return null; }
  const body = { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.8, ...(json ? { responseMimeType: 'application/json' } : {}) } };
  const r = await gemini(body, currentModel());
  if (r.ok && r.fellBackFrom) { localStorage.setItem('pf.model', r.model); toast(`${r.fellBackFrom} is unavailable, so ${r.model} was used and saved as your model.`, '', 5000); }
  if (!r.ok) { toast(r.error === 'NO_KEY' ? 'Add your Gemini API key first' : 'Gemini: ' + r.error, 'error'); return null; }
  return r.text;
}
function parseJSON(text) {
  if (!text) return null;
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch (_) { const m = t.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch (__) { return null; } }
}
const safeColor = (c, d) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()) ? c.trim() : d);
const frac = (v, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n > 1 ? n / 100 : n)) : d; };

function buildFromLayout(L) {
  const out = [];
  for (const e of (Array.isArray(L.elements) ? L.elements : []).slice(0, 24)) {
    const x = frac(e.x, 0.5) * state.W, y = frac(e.y, 0.5) * state.H;
    if (e.type === 'text' && typeof e.text === 'string' && e.text.trim()) {
      const fam = FONT_FAMILIES.includes(e.font) ? e.font : undefined;
      const size = (Number(e.size) || 60) * (state.W / 1080);
      const t = makeText(e.text.trim().slice(0, 200), { fontFamily: fam, fontSize: size, fontWeight: e.bold === false ? 400 : 700,
        fill: safeColor(e.color, '#ffffff'), textAlign: ['left', 'center', 'right'].includes(e.align) ? e.align : 'center', left: x, top: y });
      out.push(t);
    } else if (e.type === 'rect' || e.type === 'circle') {
      const w = frac(e.w, 0.3) * state.W, h = frac(e.h, 0.1) * state.H;
      const common = { left: x, top: y, originX: 'center', originY: 'center', fill: safeColor(e.color, '#f59e0b'), opacity: Math.max(0.05, Math.min(1, Number(e.opacity) || 1)) };
      out.push(e.type === 'rect' ? new fabric.Rect({ ...common, width: Math.max(4, w), height: Math.max(4, h), rx: Number(e.radius) || 0, ry: Number(e.radius) || 0, name: 'AI shape' })
        : new fabric.Circle({ ...common, radius: Math.max(4, w / 2), name: 'AI circle' }));
    }
  }
  return out;
}
$('btnGeneratePoster').onclick = async () => {
  const idea = $('aiPosterPrompt').value.trim();
  if (!idea) return toast('Describe the poster first');
  const lang = { en: 'English', ml: 'Malayalam (Unicode)', both: 'a Malayalam headline with English details' }[$('aiPosterLang').value];
  const prompt = `You design social media posters. Artboard ${state.W}x${state.H}px. Style: ${$('aiPosterStyle').value}. Language: ${lang}.
Brief: ${idea}
Return JSON only: {"background":"#hex","elements":[{"type":"text","text":"...","font":"Montserrat|Poppins|Bebas Neue|Manjari|Chilanka","size":number,"bold":true,"color":"#hex","align":"center","x":0-1,"y":0-1},{"type":"rect"|"circle","x":0-1,"y":0-1,"w":0-1,"h":0-1,"color":"#hex","opacity":0-1,"radius":number}]}
Rules: x,y are the element CENTRE as fractions of the artboard. size is in px for a 1080px-wide artboard: headline 90-150, subheading 44-70, details 28-40. Use \\n for line breaks; keep lines short. Malayalam text must use Manjari or Chilanka. 3-8 elements, shapes first (behind text). High contrast.`;
  busy('Designing with Gemini…');
  const text = await ask([{ text: prompt }], { json: true });
  busy();
  const L = parseJSON(text);
  if (!L || !Array.isArray(L.elements)) { if (text) toast('Gemini returned an unusable layout. Try again.', 'error'); return; }
  const objs = buildFromLayout(L);
  if (!objs.length) return toast('The layout had no usable elements', 'error');
  const hasContent = canvas.getObjects().length > 0;
  let mode = 'add';
  if (hasContent) {
    mode = await sheet({ title: 'Apply AI layout?', message: `Gemini made ${objs.length} elements. What should happen to your current poster?`, actions: [
      { label: 'Cancel', value: null, kind: 'btn-ghost' }, { label: 'Add on top', value: 'add', kind: 'btn-secondary' },
      { label: 'Replace (keep photos)', value: 'keep', kind: 'btn-secondary' }, { label: 'Replace all', value: 'all', kind: 'btn-danger' }] });
    if (!mode) return;
  }
  await history.batch(async () => {
    if (mode === 'all') { canvas.clear(); }
    if (mode === 'keep') canvas.getObjects().filter((o) => o.type !== 'image').forEach((o) => canvas.remove(o));
    if (mode !== 'add' || !hasContent) canvas.setBackgroundColor(safeColor(L.background, '#0d1117'));
    await loadAllFonts();
    objs.forEach((o) => { if (isText(o)) { o.initDimensions(); fitInside(o, 0.92); } canvas.add(o); });
  });
  canvas.requestRenderAll(); toast('Layout added. Undo removes it in one step.');
};

let mood = 'Bold & energetic';
document.querySelectorAll('#moodSeg button').forEach((b) => { b.onclick = () => { mood = b.dataset.mood; document.querySelectorAll('#moodSeg button').forEach((x) => x.classList.toggle('on', x === b)); }; });
$('btnAssistLayout').onclick = async () => {
  const objs = canvas.getObjects();
  if (!objs.length) return toast('Add some text or shapes first');
  const summary = objs.map((o, i) => { const c = o.getCenterPoint(); return { i, type: o.type, text: isText(o) ? o.text.slice(0, 80) : undefined, size: isText(o) ? Math.round(o.fontSize * o.scaleY * 1080 / state.W) : undefined, font: o.fontFamily, color: typeof o.fill === 'string' ? o.fill : undefined, x: +(c.x / state.W).toFixed(3), y: +(c.y / state.H).toFixed(3), locked: !!o.locked }; });
  const prompt = `Improve the visual hierarchy of this poster (${state.W}x${state.H}). Mood: ${mood}. Elements: ${JSON.stringify(summary)}
Return JSON only: {"background":"#hex or null","changes":[{"i":index,"x":0-1,"y":0-1,"size":px for 1080 width (text only),"color":"#hex","font":"Montserrat|Poppins|Bebas Neue|Manjari|Chilanka","bold":true}]}
Keep text inside the artboard, never change locked elements, keep Malayalam text in Manjari or Chilanka, headline 90-150, details 28-40.`;
  busy('Optimising layout…');
  const L = parseJSON(await ask([{ text: prompt }], { json: true }));
  busy();
  if (!L || !Array.isArray(L.changes)) return;
  await history.batch(async () => {
    if (L.background) canvas.setBackgroundColor(safeColor(L.background, canvas.backgroundColor));
    for (const ch of L.changes.slice(0, 40)) {
      const o = objs[Number(ch.i)]; if (!o || o.locked) continue;
      if (isText(o)) {
        if (FONT_FAMILIES.includes(ch.font) && !(MALAYALAM_RE.test(o.text) && LATIN_ONLY.has(ch.font))) o.set('fontFamily', ch.font);
        if (ch.size) o.set({ fontSize: clampFont(Number(ch.size) * state.W / 1080 / (o.scaleY || 1)) });
        if (typeof ch.bold === 'boolean') o.set('fontWeight', ch.bold ? 700 : 400);
      }
      if (ch.color) applyFill(o, safeColor(ch.color, o.fill));
      await loadAllFonts();
      if (isText(o)) o.initDimensions();
      const c = o.getCenterPoint();
      o.setPositionByOrigin(new fabric.Point(ch.x != null ? frac(ch.x, 0.5) * state.W : c.x, ch.y != null ? frac(ch.y, 0.5) * state.H : c.y), 'center', 'center');
      fitInside(o, 0.94);
    }
  });
  canvas.requestRenderAll(); syncEditPanel(); toast('Layout optimised. Undo to revert.');
};

$('btnGenerateVector').onclick = async () => {
  const idea = $('aiVectorPrompt').value.trim(); if (!idea) return toast('Describe the vector first');
  busy('Drawing SVG…');
  const text = await ask([{ text: `Create a clean flat vector icon/illustration: ${idea}. Return ONLY one SVG: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">…</svg>. Use simple paths, polygons, circles and solid fills. No text, no scripts, no images, no external references, no CSS.` }]);
  busy();
  if (!text) return;
  const o = await addSVG(text, 'AI: ' + idea.slice(0, 18), { width: state.W * 0.4 });
  if (o) toast('Vector added. Save it to the library from the Add tab.');
};

onFile('analyseInput', async (f) => {
  const img = await fileToImage(f);
  const palette = extractPalette(img, 6);
  const small = imageToCanvas(img, 768);
  let ai = null;
  if (hasNative() && N().hasApiKey()) {
    busy('Analysing photo…');
    const b64 = small.toDataURL('image/jpeg', 0.85).split(',')[1];
    ai = parseJSON(await ask([{ text: 'You are a poster designer. Analyse this photo for a poster. Return JSON only: {"mood":"short","headlines":["3 short English poster headlines"],"headlines_ml":["2 short Malayalam headlines"],"font":"Montserrat|Poppins|Bebas Neue|Manjari|Chilanka","tips":"one sentence on placement (where the empty space is)"}' }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }], { json: true }));
    busy();
  }
  const sw = el('div', { class: 'swatches' }, ...palette.map((c) => el('div', { class: 'swatch', style: `background:${c}`, title: c, onclick: () => {
    const o = active(); if (o) { applyFill(o, c); canvas.requestRenderAll(); history.record(); toast('Applied ' + c + ' to selection'); }
    else { canvas.setBackgroundColor(c, () => canvas.requestRenderAll()); history.record(); toast('Background set to ' + c); } } })));
  const body = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, el('div', { class: 'preview-box' }, small),
    el('label', { class: 'small', text: 'Palette (tap: colours the selection, or the background if nothing is selected)' }), sw);
  if (ai) {
    if (ai.mood) body.append(el('p', { class: 'msg', text: 'Mood: ' + ai.mood + (ai.tips ? '\n' + ai.tips : '') }));
    const heads = [...(ai.headlines || []), ...(ai.headlines_ml || [])].filter((h) => typeof h === 'string').slice(0, 6);
    if (heads.length) body.append(el('label', { class: 'small', text: 'Headline ideas (tap to add)' }), el('div', { class: 'menu-list' }, ...heads.map((h) => el('button', { text: h, onclick: async () => {
      await loadAllFonts(); const t = makeText(h, { fontFamily: FONT_FAMILIES.includes(ai.font) ? ai.font : undefined, fontSize: state.W * 0.09 }); canvas.add(t); canvas.setActiveObject(t); canvas.requestRenderAll(); toast('Headline added'); } }))));
  } else body.append(el('p', { class: 'note', text: hasNative() ? 'Add a Gemini key in Settings for headline and mood ideas.' : 'Headline ideas need the Android app with a Gemini key.' }));
  const v = await sheet({ title: 'Photo analyser', body, actions: [{ label: 'Close', value: null, kind: 'btn-ghost' }, { label: 'Use as background', value: 'bg', kind: 'btn-secondary' }, { label: 'Add photo', value: 'add', kind: 'btn-accent' }] });
  if (v) {
    const url = await blobURLFromCanvas(imageToCanvas(img, 2400), 'image/jpeg', 0.92);
    const o = await addImageFromURL(url, v === 'bg' ? 'Background photo' : 'Photo', { cover: v === 'bg', role: v === 'bg' ? 'bg' : undefined });
    if (v === 'bg') { setLocked(o, true); await history.batch(() => { canvas.add(o); canvas.sendToBack(o); }); } else { canvas.add(o); canvas.setActiveObject(o); }
    canvas.requestRenderAll();
  }
});

// ---------- boot ----------
async function boot() {
  await loadAllFonts(['Montserrat', 'Poppins', 'Manjari']);
  fabric.util.clearFabricFontCache();
  layout();
  try {
    const d = await getMeta('draft');
    if (d && d.state && d.state.canvas && ((d.state.canvas.objects || []).length || d.state.pages)) {
      await history.mute(() => restoreProject(d.state));
      state.projectId = d.projectId || null; state.projectName = d.projectName || '';
      toast('Restored your last poster');
    }
  } catch (e) { console.warn('draft restore failed', e); }
  history.reset();
  refreshLayers(); syncEditPanel(); renderLibrary(); updateKeyNote();
  state.ready = true;
}
window.PF = { canvas, history, state, serialize, restore, exportPNGBlob, exportSVGBlob, setArtboard, layout, objectToOwnSVG, openPane, closePanel, alignTo, distribute, reorderLayer, deleteObjects, renameObj, settingsSheet, currentModel, refreshLayers, buildFromLayout, saveProject,
  groupSel, ungroupSel, setSelectMode, isSelectMode: () => selectMode, clipPhoto, unclip, applyClipAdjust, setBlend, BLENDS, applyFilter, filterOf,
  maskDab, maskStroke, maskGradient, maskInvert, maskClear, setMaskPaint, maskPaint, prepareMasks, importPhoto, traceBlob, cutoutSheet, renderStatic,
  useOriginals, exportBudget, fitsBudget, exportTiled, doExport, exportSheet, updateContext, safeMargin, guides, ready: false,
  PROPS, projectState, projectStateForStorage, restoreProject, projectFonts, makeText, addImageFromURL, setFont, editText, ensureFonts, dataURLsFor, blobURLsFor, setLocked,
  syncEditPanel, thumbnail, setImageSrc, newPoster, openProjectsSheet, fitInside, artboardSheet, backgroundSheet, stamp, active, isText, clampFont, scheduleAutosave,
  getCurrentPane: () => currentPane, presets: PRESETS, PANE_TITLES, CTX_PANES, TOOL_PANES };
boot().then(() => { window.PF.ready = true; }).catch((e) => { console.error(e); toast('Startup error: ' + e.message, 'error'); window.PF.ready = true; });
