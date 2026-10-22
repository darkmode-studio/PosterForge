// PosterForge 2.3 shell: studio theme, five-destination dock, Tool Library, contextual pro tools, inline text bar,
// swipe-down panels, haptics, quick tour. Loaded after v22/main.js; everything here is additive.
import { el, toast, closeTopSheet, sheetOpen } from '../ui.js';
import { haptic } from '../native.js';
import { registerTool, openToolLibrary, openChecklist, runChecklist, listTools, contrastRatio } from './hub.js';
import { installTextPro, openTextPro, setStrokes, setExtrude, setAutoFit, autoFit } from './textpro.js';
import { startBrush, startEraser, startPen, stopDrawing, penAddPoint, penFinish, isDrawing } from './draw.js';
import * as pro from './pro.js';
import { installGlow } from './glow.js';
import { FILM_PRESETS, openPhotoTools } from '../v2/photo.js';
import { openCollages } from '../v22/collage.js';
import { openBrandKit } from '../v21/brand.js';
import { showHome } from '../v2/home.js';

const $ = (id) => document.getElementById(id);
const PF = window.PF;
document.body.classList.add('v23');
if (!PF.PROPS.includes('pfFill')) PF.PROPS.push('pfFill');
installTextPro();
installGlow(); // after every other render wrapper
pro.installGrid();

// ---------- more film looks (LUT-style presets; same filter maths natively and in the browser) ----------
FILM_PRESETS.push(
  ['Portra soft', { warmth: 10, contrast: -6, saturation: -8, curve: [[0, 20], [64, 74], [128, 134], [192, 198], [255, 245]], hsl: { orange: [2, -6, 6] }, grain: 10 }],
  ['Ektachrome', { contrast: 14, saturation: 18, warmth: -4, curve: [[0, 0], [64, 58], [128, 130], [192, 206], [255, 255]], hsl: { blue: [-6, 18, -4], aqua: [0, 14, 0] }, grain: 8 }],
  ['Tri-X', { grayscale: true, contrast: 30, curve: [[0, 6], [64, 44], [128, 128], [192, 214], [255, 252]], grain: 40, sharpen: 20 }],
  ['Bleach bypass', { saturation: -45, contrast: 28, curve: [[0, 0], [64, 52], [128, 132], [192, 214], [255, 255]], sharpen: 25 }],
  ['Polaroid', { warmth: 14, contrast: -14, saturation: -10, curve: [[0, 36], [64, 84], [128, 138], [192, 196], [255, 232]], hsl: { green: [-10, -10, 0], aqua: [-10, 0, 6] }, vignette: 18 }],
  ['Velvia', { saturation: 40, contrast: 16, curve: [[0, 0], [64, 54], [128, 128], [192, 206], [255, 255]], hsl: { green: [0, 18, -6], blue: [0, 16, -6] } }],
  ['Crisp', { contrast: 10, sharpen: 45 }],
);

// ---------- five-destination dock: Text, Photos, Shapes, Layers, Tools ----------
const tb = $('toolbar');
const KEEP = ['text', 'photos', 'shapes', 'layers'];
tb.querySelectorAll('.tool').forEach((b) => { if (!KEEP.includes(b.dataset.tool)) b.classList.add('v23-off'); });
const svgUse = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
const toolsBtn = el('button', { class: 'tool rip', id: 'v23ToolsBtn', 'aria-label': 'Tools', onclick: () => { haptic('tick'); PF.closePanel(); openToolLibrary(); } }, svgUse('i-adjust'), el('span', { text: 'Tools' }));
tb.append(toolsBtn);
// order: Text, Photos, Shapes, Layers, Tools
for (const k of KEEP) { const b = tb.querySelector(`.tool[data-tool="${k}"]`); if (b) tb.insertBefore(b, toolsBtn); }

// ---------- Tool Library ----------
const sel = () => PF.active();
const isTxt = () => PF.isText(sel());
const isImg = () => sel()?.type === 'image';
const isShape = () => { const o = sel(); return !!o && !o.locked && o.type !== 'image' && o.type !== 'activeSelection' && o.type !== 'group'; };
const T = (id, label, group, icon, run, keywords = [], when) => registerTool({ id, label, group, icon, run, keywords, when });
T('text', 'Add text', 'Create', '🅣', () => PF.openPane('text'), ['heading', 'quote', 'type']);
T('photo', 'Add photo', 'Create', '🖼', () => PF.openPane('photos'), ['image', 'picture', 'gallery']);
T('shapes', 'Shapes', 'Create', '⬟', () => PF.openPane('shapes'), ['rectangle', 'circle', 'star', 'line']);
T('pen', 'Pen tool', 'Create', '✒️', () => { toast('Tap to add points. Drag to curve. Tap the first point to close.'); startPen({ color: '#ffffff', fill: '#ffb547' }); }, ['vector', 'path', 'custom shape', 'bezier']);
T('brush', 'Brush & eraser', 'Create', '🖌', () => startBrush({ color: '#ffffff', width: 10 }), ['draw', 'paint', 'pencil', 'erase']);
T('icons', 'My library', 'Create', '⭐', () => PF.openPane('elements'), ['icons', 'vector', 'saved', 'elements']);
T('collage', 'Collage', 'Create', '▦', () => openCollages(), ['grid', 'layout', 'polaroid']);
T('templates', 'Templates', 'Create', '🗂', () => showHome(), ['home', 'quote', 'start']);
T('inspect', 'Position & size', 'Edit', '📐', () => pro.openInspector(), ['x', 'y', 'width', 'height', 'rotate', 'nudge', 'align', 'exact'], () => !!sel());
T('textpro', 'Text effects pro', 'Edit', '🅰', () => openTextPro(), ['outline', 'stroke', '3d', 'extrude', 'auto fit', 'sticker'], isTxt);
T('fill', 'Gradient & pattern fill', 'Edit', '🎨', () => pro.openFills(), ['gradient', 'pattern', 'dots', 'stripes', 'fill'], isShape);
T('phototools', 'Photo studio', 'Edit', '🎞', () => openPhotoTools(sel(), 'film'), ['film', 'lut', 'filter', 'curves', 'hsl', 'crop', 'perspective'], isImg);
T('adjust', 'Adjust photo', 'Edit', '☀️', () => PF.openPane('adjust'), ['brightness', 'contrast', 'sharpen', 'grain', 'vignette', 'blur'], isImg);
T('blend', 'Blend mode', 'Edit', '◑', () => PF.openPane('blend'), ['multiply', 'screen', 'overlay'], () => !!sel() && sel().type !== 'activeSelection');
T('opacity', 'Opacity', 'Edit', '◐', () => PF.openPane('opacity'), ['transparency'], () => !!sel());
T('mask', 'Photo mask', 'Edit', '◩', () => PF.openPane('mask'), ['hide', 'reveal', 'fade'], isImg);
T('group', 'Group / ungroup', 'Edit', '⧉', () => (sel()?.type === 'group' ? PF.ungroupSel() : PF.groupSel()), ['combine'], () => ['group', 'activeSelection'].includes(sel()?.type));
T('layers', 'Layers', 'Edit', '☰', () => PF.openPane('layers'), ['order', 'lock', 'hide']);
T('history', 'History', 'Edit', '🕘', () => pro.openHistory(), ['undo', 'redo', 'steps', 'back']);
T('background', 'Background', 'Canvas', '🎨', () => PF.openPane('background'), ['colour', 'color', 'canvas']);
T('size', 'Size & ratio', 'Canvas', '⤢', () => PF.openPane('size'), ['resize', 'instagram', 'story', 'aspect']);
T('grid', 'Snap grid', 'Canvas', '▦', () => pro.openGridSheet(), ['guides', 'snap', 'grid']);
T('pages', 'Pages & carousel', 'Canvas', '📑', () => window.PFPages?.openPagesSheet(), ['slides', 'carousel', 'multi']);
T('brand', 'Brand kit', 'Canvas', '💼', () => openBrandKit(), ['palette', 'logo', 'colours', 'fonts']);
T('checklist', 'Ready to publish?', 'Export', '✅', () => openChecklist(), ['check', 'safe zone', 'contrast', 'size']);
T('export', 'Export', 'Export', '⤓', () => PF.exportSheet(), ['save', 'png', 'jpg', 'webp', 'pdf', '4k', 'share']);
T('backup', 'Backup & restore', 'Export', '🗄', () => window.PFBackup?.backupSheet(), ['backup', 'restore']);
T('ai', 'AI tools', 'More', '✨', () => PF.openPane('ai'), ['gemini', 'generate']);

// ---------- contextual bar: pro tools for the selection ----------
const strip = $('ctxStrip');
const cbtn = (id, emoji, label, kind, fn) => el('button', { class: 'ctx rip v23-pro hidden', id, 'data-v23': kind, onclick: () => { haptic('tick'); fn(); } }, el('span', { class: 'ctx-emoji', text: emoji }), el('span', { text: label }));
const bInspect = cbtn('btnInspect', '📐', 'Exact', 'any', () => pro.openInspector());
const bTextPro = cbtn('btnTextPro', '🅰', 'Text pro', 'text', () => openTextPro());
const bFill = cbtn('btnFill', '🎨', 'Fill', 'shape', () => pro.openFills());
const bStudio = cbtn('btnPhotoStudio', '🎞', 'Film', 'image', () => openPhotoTools(sel(), 'film'));
strip.querySelector('#btnDuplicate')?.before(bInspect);
strip.querySelector('[data-ctx="color"]')?.after(bFill, bTextPro);
strip.querySelector('[data-ctx="adjust"]')?.before(bStudio);
function syncCtx() {
  const o = sel();
  const vis = { any: !!o && o.type !== 'activeSelection' || o?.type === 'activeSelection', text: PF.isText(o), shape: isShape() && !PF.isText(o) || PF.isText(o), image: o?.type === 'image' };
  strip.querySelectorAll('[data-v23]').forEach((b) => b.classList.toggle('hidden', !vis[b.dataset.v23]));
}
for (const ev of ['selection:created', 'selection:updated', 'selection:cleared']) PF.canvas.on(ev, () => setTimeout(syncCtx, 0));
PF.canvas.on('selection:created', () => haptic('select'));

// ---------- inline text bar (font, size, colours) inside the quick bar ----------
const qbar = $('textQuickbar');
const BRAND = () => { try { return (window.PFBrand?.getKit().colours || []).slice(0, 3); } catch (_) { return []; } };
function setSize(d) {
  const o = sel(); if (!PF.isText(o) || o.locked) return;
  const n = Math.max(6, Math.min(600, Math.round((o.fontSize || 40) + d)));
  o.set('fontSize', n); o.initDimensions?.(); o.setCoords(); o.dirty = true; PF.canvas.requestRenderAll(); PF.history.recordSoon(400); syncTbar();
}
let holdT = null;
const holdBtn = (id, txt, d) => { const b = el('button', { class: 'qb rip', id, 'aria-label': d > 0 ? 'Bigger' : 'Smaller', text: txt });
  const stop = () => { clearInterval(holdT); holdT = null; };
  b.addEventListener('pointerdown', () => { haptic('tick'); setSize(d); stop(); let k = 0; holdT = setInterval(() => setSize(d * (++k > 6 ? 4 : 1)), 120); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((e) => b.addEventListener(e, stop)); return b; };
const fontBtn = el('button', { class: 'qb rip v23-font', id: 'qbFont', 'aria-label': 'Font', onclick: () => { haptic('tick'); PF.openPane('font'); } }, el('span', { id: 'qbFontName', text: 'Font' }));
const sizeVal = el('span', { class: 'v23-size-v', id: 'qbSizeVal', text: '' });
const swHost = el('span', { id: 'qbSwatches', style: 'display:flex;gap:4px;align-items:center' });
if (qbar) {
  qbar.classList.add('v23-qb');
  qbar.querySelector('#qbAa')?.after(fontBtn, holdBtn('qbSizeDown', '−', -2), sizeVal, holdBtn('qbSizeUp', '+', 2), swHost);
}
function syncTbar() {
  const o = sel(); if (!PF.isText(o)) return;
  $('qbFontName').textContent = o.fontFamily || 'Font'; $('qbFontName').style.fontFamily = `"${o.fontFamily}"`;
  sizeVal.textContent = String(Math.round(o.fontSize || 0));
  const cols = [...new Set(['#ffffff', '#111111', ...BRAND()])].slice(0, 4);
  swHost.replaceChildren(...cols.map((c) => el('button', { class: 'sw', 'data-colour': c, 'aria-label': 'Colour ' + c, style: `background:${c}`, onclick: () => { const t = sel(); if (!PF.isText(t) || t.locked) return; t.set('fill', c); t.dirty = true; PF.canvas.requestRenderAll(); PF.history.record(); haptic('tick'); } })));
}
for (const ev of ['selection:created', 'selection:updated', 'object:modified']) PF.canvas.on(ev, () => setTimeout(syncTbar, 0));

// ---------- swipe down to close panels and sheets (spring back if not far enough) ----------
function swipeable(getBox, isHandle, close) {
  let y0 = null, box = null, dy = 0;
  document.addEventListener('pointerdown', (e) => { const b = getBox(e.target); if (!b || !isHandle(e, b)) return; box = b; y0 = e.clientY; dy = 0; }, true);
  document.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); if (dy > 4) { box.classList.add('v23-dragging'); box.style.transform = `translateY(${dy}px)`; } }, true);
  const end = () => { if (y0 == null) return; const b = box; y0 = null; b.classList.remove('v23-dragging'); b.style.transform = '';
    if (dy > 90) { haptic('tick'); close(b); } dy = 0; };
  document.addEventListener('pointerup', end, true); document.addEventListener('pointercancel', end, true);
}
swipeable((t) => t.closest?.('#panel.open'), (e, b) => !!e.target.closest('.panel-head'), () => PF.closePanel());
swipeable((t) => t.closest?.('.sheet'), (e, b) => { const r = b.getBoundingClientRect(); return e.clientY - r.top < 56 && b.scrollTop <= 0 && !e.target.closest('input,button,select,textarea'); }, () => closeTopSheet());

// ---------- home: hero line ----------
const hs = $('homeScroll');
if (hs && !$('v23Hero')) hs.prepend(el('div', { class: 'v23-hero', id: 'v23Hero' }, el('h1', { text: 'Make something iconic.' }), el('p', { text: 'Quote posters, stories and carousels — studio tools, fully offline.' })));

// ---------- first-launch quick tour ----------
const TOUR = [
  { big: '✨', t: 'Welcome to the new studio', p: 'PosterForge 2.3 has a cleaner editor, pro tools and smoother controls. Here is a 20-second tour.' },
  { big: '⬇', t: 'Five places for everything', p: 'Text, Photos, Shapes and Layers live in the dock. Everything else is under Tools, with search.', spot: '#toolbar' },
  { big: '👆', t: 'Tap anything to edit it', p: 'The bar above the dock changes with your selection: Exact position, Fill, Text pro, Film looks and more. Locked layers let taps pass through.' },
  { big: '↧', t: 'Swipe down to close', p: 'Panels and sheets close with a swipe down. Undo history is under Tools → History.' },
  { big: '✅', t: 'Check before you post', p: 'Tools → Ready to publish? checks safe zones, size and contrast. Export PNG, JPG, WebP or PDF up to 4K.', spot: '#btnExport' },
];
export function runTour(force = false) {
  if (!force && localStorage.getItem('pf.tour23')) return false;
  let i = 0; const ov = el('div', { class: 'v23-tour', id: 'v23Tour' });
  const done = () => { localStorage.setItem('pf.tour23', '1'); document.querySelectorAll('.v23-spot').forEach((x) => x.classList.remove('v23-spot')); ov.remove(); };
  const draw = () => {
    const s = TOUR[i]; document.querySelectorAll('.v23-spot').forEach((x) => x.classList.remove('v23-spot')); if (s.spot) document.querySelector(s.spot)?.classList.add('v23-spot');
    ov.replaceChildren(el('div', { class: 'v23-tour-card' }, el('div', { class: 'big', text: s.big }), el('h2', { text: s.t }), el('p', { text: s.p }),
      el('div', { class: 'v23-tour-foot' }, el('div', { class: 'v23-tour-dots' }, ...TOUR.map((_, k) => el('i', { class: k === i ? 'on' : '' }))),
        el('div', {}, el('button', { class: 'skip', id: 'tourSkip', text: 'Skip', onclick: done }), el('button', { class: 'next', id: 'tourNext', text: i === TOUR.length - 1 ? 'Start creating' : 'Next', onclick: () => { haptic('tick'); if (++i >= TOUR.length) done(); else draw(); } })))));
  };
  draw(); document.body.append(ov); return true;
}
setTimeout(() => { if (localStorage.getItem('pf.onboarded')) runTour(); }, 600);

// ---------- back button: leave drawing modes first ----------
const prevBack = window.pfHandleBack;
window.pfHandleBack = () => { if ($('v23Tour')) { $('v23Tour').remove(); localStorage.setItem('pf.tour23', '1'); return true; } if (isDrawing()) { stopDrawing(); return true; } return prevBack ? prevBack() : false; };

window.PF23 = { openToolLibrary, openChecklist, runChecklist, listTools, contrastRatio, openTextPro, setStrokes, setExtrude, setAutoFit, autoFit,
  startBrush, startEraser, startPen, stopDrawing, penAddPoint, penFinish, isDrawing, runTour, pro, syncCtx, syncTbar, FILM_PRESETS };
