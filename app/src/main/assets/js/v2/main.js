// PosterForge 2.0 shell: wires the v2 modules into the editor (home, pages pill, context tools, quick sliders, menus, back).
import './textfx.js';
import { el, menuSheet, closeTopSheet, sheetOpen } from '../ui.js';
import { haptic } from '../native.js';
import { loadUserFonts, openFontPicker } from './fonts.js';
import { buildTypoPane, upgradeFontPane, syncTypo, syncFontPane } from './typo.js';
import { openPagesSheet, pageCount, updateCounters, goTo } from './pages.js';
import { exportSheetV2 } from './export.js';
import { openPhotoTools } from './photo.js';
import { backupSheet } from './backup.js';
import { buildHome, showHome, hideHome, isHomeOpen, runOnboarding, aboutSheet, newPosterFlow } from './home.js';

const $ = (id) => document.getElementById(id);
const PF = window.PF;
const NOHOME = /nohome/.test(location.hash + location.search);
const svg = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
document.body.classList.add('v2');

// ---- top bar: home + page pill ----
const homeBtn = el('button', { class: 'fab rip', id: 'btnHome', 'aria-label': 'Home', title: 'Home', onclick: () => { haptic(); PF.saveProject && PF.scheduleAutosave(); showHome(); } }, svg('i-home'));
const pagePill = el('button', { class: 'fab page-pill rip', id: 'btnPages', 'aria-label': 'Pages', title: 'Pages (carousel)', onclick: () => { haptic(); openPagesSheet(); } }, svg('i-pages'), el('span', { id: 'pageLabel', text: '1' }));
const prevBtn = el('button', { class: 'fab mini rip hidden', id: 'btnPrevPage', 'aria-label': 'Previous page', onclick: () => goTo(PF.state.page - 1) }, '‹');
const nextBtn = el('button', { class: 'fab mini rip hidden', id: 'btnNextPage', 'aria-label': 'Next page', onclick: () => goTo(PF.state.page + 1) }, '›');
const left = el('div', { class: 'top-left' }, homeBtn, $('btnMenu'));
$('topbar').prepend(left);
$('topbar').insertBefore(el('div', { class: 'top-mid' }, prevBtn, pagePill, nextBtn), $('topbar').querySelector('.top-actions'));
function updatePill() {
  const n = pageCount(); $('pageLabel').textContent = n > 1 ? `${PF.state.page + 1}/${n}` : 'Page';
  prevBtn.classList.toggle('hidden', n < 2 || PF.state.page === 0); nextBtn.classList.toggle('hidden', n < 2 || PF.state.page >= n - 1);
  pagePill.classList.toggle('multi', n > 1);
}
window.addEventListener('pf:pages', () => { updatePill(); updateCounters(); });

// ---- context strip additions ----
const strip = $('ctxStrip');
const fontBtn = strip.querySelector('[data-ctx="font"]');
const fxBtn = el('button', { class: 'ctx rip', 'data-ctx': 'typo', 'data-textonly': '1', id: 'btnTypo' }, svg('i-fx'), el('span', { text: 'Effects' }));
fxBtn.onclick = () => { haptic(); if (PF.getCurrentPane() === 'typo') PF.closePanel(); else { PF.openPane('typo'); syncTypo(); } };
fontBtn.after(fxBtn);
const sizeBtn = el('button', { class: 'ctx rip', 'data-quick': 'size', id: 'btnQuickSize' }, svg('i-size'), el('span', { text: 'Size' }));
fxBtn.after(sizeBtn);
const photoBtn = el('button', { class: 'ctx rip', 'data-show': 'image', 'data-action': 'photo', id: 'btnPhotoTools' }, svg('i-crop'), el('span', { text: 'Edit photo' }));
photoBtn.onclick = () => { haptic(); openPhotoTools(); };
strip.querySelector('[data-ctx="adjust"]').before(photoBtn);
// font pane opens the full picker directly from the strip on long-press; tap keeps the compact pane
fontBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); openFontPicker(); });

// ---- on-canvas quick slider ----
const quick = el('div', { class: 'quick hidden', id: 'quickSlider', role: 'group' },
  el('span', { class: 'quick-l', id: 'quickLabel' }), el('input', { type: 'range', id: 'quickRange', min: 0, max: 100 }), el('span', { class: 'quick-v', id: 'quickVal' }),
  el('button', { class: 'icon-sm rip', id: 'quickClose', 'aria-label': 'Close slider', text: '✓' }));
document.body.append(quick);
let quickKind = null;
function openQuick(kind) {
  const o = PF.active(); if (!o) return; quickKind = kind; const r = $('quickRange');
  if (kind === 'size') {
    if (PF.isText(o)) { r.min = 8; r.max = Math.round(PF.state.W * 0.3); r.value = Math.round(o.fontSize); $('quickLabel').textContent = 'Text size'; }
    else { r.min = 5; r.max = 400; r.value = Math.round((o.scaleX || 1) * 100); $('quickLabel').textContent = 'Scale %'; }
  }
  $('quickVal').textContent = r.value; quick.classList.remove('hidden'); quick.classList.add('in'); sizeBtn.classList.add('active');
}
function closeQuick() { if (quick.classList.contains('hidden')) return false; quick.classList.add('hidden'); sizeBtn.classList.remove('active'); quickKind = null; return true; }
sizeBtn.onclick = () => { haptic(); if (quickKind) closeQuick(); else openQuick('size'); };
$('quickClose').onclick = closeQuick;
$('quickRange').addEventListener('input', () => {
  const o = PF.active(); if (!o) return; const v = Number($('quickRange').value); $('quickVal').textContent = v;
  const c = o.getCenterPoint();
  if (PF.isText(o)) { o.set('fontSize', v); o.initDimensions(); } else { const k = v / 100; o.set({ scaleX: k * Math.sign(o.scaleX || 1), scaleY: k * Math.sign(o.scaleY || 1) }); }
  o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); PF.canvas.requestRenderAll();
});
$('quickRange').addEventListener('change', () => PF.history.record());
PF.canvas.on('selection:cleared', closeQuick);
PF.canvas.on('selection:updated', closeQuick);

// ---- panes ----
upgradeFontPane(); buildTypoPane();
const sync = () => { syncTypo(); syncFontPane(); };
PF.canvas.on('selection:created', () => { haptic(); sync(); });
PF.canvas.on('selection:updated', sync);
PF.canvas.on('object:modified', sync);

// ---- export, menu, back ----
PF.exportSheetLegacy = PF.exportSheet; PF.exportSheet = exportSheetV2;
$('btnExport').onclick = () => { haptic(); exportSheetV2(); };
$('btnMenu').onclick = async () => {
  const s = PF.state;
  const v = await menuSheet('PosterForge', [
    { label: '🏠  Home', value: 'home' }, { label: '📄  New poster', value: 'new' }, { label: '📂  Open project', value: 'open' }, { label: '💾  Save project', value: 'save' }, { label: '🗂  Save a copy', value: 'copy' }, 'hr',
    { label: `🎞  Pages / carousel (${pageCount()})`, value: 'pages' }, { label: `📐  Artboard size (${s.W}×${s.H})`, value: 'size' }, { label: '🎨  Background colour', value: 'bg' }, { label: '🔤  Fonts & My Fonts', value: 'fonts' }, 'hr',
    { label: '⬇️  Export (PNG, JPG, PDF, SVG)', value: 'export' }, { label: '🛟  Backup & restore', value: 'backup' }, { label: '🔍  Fit poster to screen', value: 'fit' },
    { label: '⚙️  Settings & API key', value: 'settings' }, { label: 'ℹ️  About & licences', value: 'about' }, { label: '❔  Quick guide', value: 'guide' },
  ]);
  ({ home: showHome, new: () => newPosterFlow(), open: PF.openProjectsSheet, save: () => PF.saveProject(false), copy: () => PF.saveProject(true), pages: openPagesSheet, size: PF.artboardSheet, bg: PF.backgroundSheet,
    fonts: () => openFontPicker(), export: exportSheetV2, backup: backupSheet, fit: () => { s.zoom = 1; s.panX = s.panY = 0; PF.layout(); }, settings: PF.settingsSheet, about: aboutSheet, guide: () => runOnboarding(true) })[v]?.();
};
const back0 = window.pfHandleBack;
window.pfHandleBack = () => {
  const ob = $('onboard'); if (ob) { ob.querySelector('#obSkip')?.click(); return true; }
  if (sheetOpen() && closeTopSheet()) return true;
  if (closeQuick()) return true;
  if (isHomeOpen()) return false; // let Android exit (double-press)
  if (back0()) return true;
  showHome(); return true;
};

// ---- boot ----
buildHome(); updatePill();
(async function boot2() {
  for (let i = 0; i < 400 && !PF.ready; i++) await new Promise((r) => setTimeout(r, 25));
  await loadUserFonts().catch((e) => console.warn('user fonts', e));
  updatePill(); updateCounters();
  if (!NOHOME) { showHome(); runOnboarding(); }
  window.PF.v2Ready = true;
})();
window.PFv2 = { showHome, hideHome, isHomeOpen, openQuick, closeQuick, updatePill };
