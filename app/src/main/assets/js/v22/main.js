// PosterForge 2.2 shell: pop-out frame, PNG saving + My stickers, collage presets, new templates, ratio bar,
// "Send text behind subject". Loaded after v21/main.js.
import { el, toast, menuSheet } from '../ui.js';
import { haptic } from '../native.js';
import * as popout from './popout.js';
import * as stickers from './stickers.js';
import * as collage from './collage.js';
import { addTemplates, installTextExtras, threeStrip, textBehind, ML_LETTERING } from './templates22.js';
import { ratioBar, applyRatio, RATIOS, ratioSize, photoRatio } from './ratio.js';
import { sendBehindSubject } from './behind.js';
import { renderTemplates, hideHome } from '../v2/home.js';

const $ = (id) => document.getElementById(id);
const PF = window.PF;
document.body.classList.add('v22');
PF.PROPS.push('pfPopout', 'pfBreak', 'pfPopWin', 'pfLeafW', 'pfCell', 'pfCollage', 'pfCollageDecor', 'pfDecorTop', 'pfShadow2', 'pfBehind');
installTextExtras();
addTemplates();
popout.installPopout();
collage.installCollage();
// cell photos and pop-out layers hit-test by pixel (their boxes are bigger than what is visible)
PF.canvas.on('object:added', (e) => { const o = e.target; if (o && (o.pfCell != null && o.type === 'image' || o.pfRole === 'popPhoto' || o.pfRole === 'popSubject')) o.perPixelTargetFind = true;
  if (o && o.pfLeafW && o.width && Math.abs(o.getScaledWidth() - o.pfLeafW) > 2 && o.scaleX === 1) { o.scale(o.pfLeafW / o.width); o.setCoords(); } });
try { renderTemplates(); } catch (_) {}

// ---- context strip: Pop-out / Save pop-out PNG / Swap photo (images), Behind subject (text) ----
const strip = $('ctxStrip');
const ctxBtn = (id, emoji, label, kind, fn) => el('button', { class: 'ctx rip hidden', id, 'data-v22': kind, onclick: () => { haptic(); fn(PF.active()); } }, el('span', { class: 'ctx-emoji', text: emoji }), el('span', { text: label }));
const bPop = ctxBtn('btnPopout', '🖼', 'Pop-out', 'photo', (o) => popout.popoutFromPhoto(o));
const bPopSave = ctxBtn('btnPopoutPNG', '💾', 'Save pop-out PNG', 'popout', (o) => popout.savePopoutPNG(o.pfPopout));
const bSwap = ctxBtn('btnSwapPhoto', '🔄', 'Swap photo', 'cell', (o) => collage.swapPhoto(o));
const bCl = ctxBtn('btnCollageCtl', '▦', 'Gap & corners', 'cell', () => collage.collageControls());
const bBehind = ctxBtn('btnBehind', '⤵', 'Behind subject', 'text', (o) => sendBehindSubject(o));
($('btnLift') || strip.firstElementChild).after(bPop, bPopSave, bSwap, bCl);
strip.append(bBehind);
function syncCtx() {
  const o = PF.active(); const img = o && o.type === 'image';
  const vis = { photo: img && o.pfCell == null && !o.pfPopout && o.pfRole !== 'subject', popout: !!(o && o.pfPopout), cell: !!(o && o.pfCell != null && img), text: !!(o && ['text', 'i-text', 'textbox'].includes(o.type)) };
  strip.querySelectorAll('[data-v22]').forEach((b) => b.classList.toggle('hidden', !vis[b.dataset.v22]));
}
for (const ev of ['selection:created', 'selection:updated', 'selection:cleared', 'object:modified']) PF.canvas.on(ev, () => setTimeout(syncCtx, 0));

// ---- photos pane: Collage + Stickers tiles ----
const tiles = $('pane-photos')?.querySelector('.tiles');
tiles?.append(el('button', { class: 'tile rip', id: 'btnCollage', onclick: () => { haptic(); collage.openCollages(); } }, el('span', { class: 'tile-emoji', text: '▦' }), el('span', { text: 'Collage' })),
  el('button', { class: 'tile rip', id: 'btnStickers', onclick: () => { haptic(); stickers.openStickers(); } }, el('span', { class: 'tile-emoji', text: '🏷' }), el('span', { text: 'My stickers' })));

// ---- size pane: ratio bar on top ----
const sizePane = $('pane-size');
if (sizePane) new MutationObserver(() => { if (!$('ratioBar')) sizePane.prepend(el('h3', { class: 'small', text: 'Aspect ratio' }), ratioBar()); }).observe(sizePane, { childList: true });

// ---- home: collage + pop-out shortcuts ----
const homeQuick = $('homeQuick');
if (homeQuick) {
  const row = el('div', { class: 'home-22', id: 'home22' },
    el('button', { class: 'home-22-btn rip', id: 'homeCollage', onclick: () => { haptic(); collage.openCollages(); } }, el('span', { text: '▦' }), el('b', { text: 'Collage' }), el('small', { text: 'Grids, strips, polaroids, film, shapes' })),
    el('button', { class: 'home-22-btn rip', id: 'homePopout', onclick: () => { haptic(); document.querySelector('[data-template="popout-frame-post"]')?.click(); } }, el('span', { text: '🖼' }), el('b', { text: 'Pop-out frame' }), el('small', { text: 'Subject breaks out of the photo' })));
  homeQuick.after(row);
}

// ---- menu items (added to the 2.1 menu through window.PF22.menu) ----
async function menu22() {
  const v = await menuSheet('Create', [
    { label: '▦  Collage', value: 'collage' }, { label: '🖼  Pop-out on this photo', value: 'pop' }, { label: '💾  Save pop-out as PNG', value: 'popsave' },
    { label: '🏷  My stickers', value: 'stickers' }, { label: '📏  Aspect ratio', value: 'ratio' }, { label: '⤵  Send text behind subject', value: 'behind' }]);
  if (v === 'collage') collage.openCollages();
  else if (v === 'pop') { const o = PF.active() || PF.canvas.getObjects().find((x) => x.type === 'image'); popout.popoutFromPhoto(o); }
  else if (v === 'popsave') { const p = PF.canvas.getObjects().find((x) => x.pfPopout && x.pfRole === 'popSubject'); if (p) popout.savePopoutPNG(p.pfPopout); else toast('No pop-out on this poster'); }
  else if (v === 'stickers') stickers.openStickers();
  else if (v === 'ratio') { const { sheet } = await import('../ui.js'); sheet({ title: 'Aspect ratio', body: ratioBar('ratioSheetBar'), actions: [{ label: 'Done', value: null, kind: 'btn-accent' }] }); }
  else if (v === 'behind') sendBehindSubject();
}
void hideHome;
window.PF22 = { popout, stickers, collage, menu: menu22, ratioBar, applyRatio, RATIOS, ratioSize, photoRatio, sendBehindSubject, threeStrip, textBehind, ML_LETTERING, ready: true };
