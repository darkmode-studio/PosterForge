// PosterForge 2.1 shell: Story Styles + quick bar, subject lift, canvas sizes, smart colours, quote quick-start,
// brand kit, auto contrast and text on a custom path. Loaded after v2/main.js.
import { el, menuSheet, toast, sheetOpen, closeTopSheet } from '../ui.js';
import { haptic } from '../native.js';
import { buildStoryUI, STORY_STYLES, applyStoryStyle, setBox, setOutline } from './story.js';
import { installLift, liftSubject, pasteImage, copyImage, stickerOutline, refineEdges, saveImage, placeLifted, LIFT_MESSAGES } from './lift.js';
import { openSizes, installGuides, setSafeZone, exportPanorama, panoramaCount, ALL_SIZES, SIZE_GROUPS, toPx, savedSizes, saveSize } from './sizes.js';
import { openSmartColours, applyPair, installAutoContrast, setAutoContrast, autoContrast, savedPalettes, savePalette } from './smartcolor.js';
import * as color from './color.js';
import { quoteQuickStart, quoteGallery, fillTemplate, wrapQuote } from './quickstart.js';
import { openBrandKit, getKit, setKit, applyKitToBuilt, applyKitToCanvas, addColours, setLogo, getLogo } from './brand.js';
import { installPathChip, drawPathMode, applyPath } from './textpath.js';
import { exportSheetV2 } from '../v2/export.js';
import { openPagesSheet, pageCount } from '../v2/pages.js';
import { backupSheet } from '../v2/backup.js';
import { showHome, runOnboarding, aboutSheet, newPosterFlow, renderTemplates } from '../v2/home.js';
import { openFontPicker } from '../v2/fonts.js';

const $ = (id) => document.getElementById(id);
const PF = window.PF;
document.body.classList.add('v21');
const BRAND_AUTO = 'pf.brandOnTemplates';
window.PFBrand = { getKit, setKit, applyKitToBuilt, applyKitToCanvas, addColours, setLogo, getLogo, autoOn: () => localStorage.getItem(BRAND_AUTO) === '1' };
window.PFSizes = { openSizes, setSafeZone, exportPanorama, panoramaCount };

// ---- text: story styles + quick bar ----
const story = buildStoryUI();
installPathChip();
installAutoContrast();
installLift();
installGuides();
new MutationObserver(() => window.dispatchEvent(new Event('pf:pane'))).observe($('panel'), { attributes: true, attributeFilter: ['class'] });

// ---- photos pane: paste + lift tip ----
const photos = $('pane-photos');
if (photos) {
  photos.querySelector('.tiles')?.append(el('button', { class: 'tile rip', id: 'btnPasteImage', onclick: () => { haptic(); pasteImage(); } }, el('span', { class: 'tile-emoji', text: '📋' }), el('span', { text: 'Paste' })));
  photos.append(el('p', { class: 'note', id: 'liftTip', text: 'Tip: long-press a photo on the poster to lift its subject (on-device, needs Google Play services).' }));
}
// image context: Lift subject button
const strip = $('ctxStrip');
const liftBtn = el('button', { class: 'ctx rip', 'data-show': 'image', id: 'btnLift', onclick: () => { const o = PF.active(); if (o && o.type === 'image') window.PFLift(o); } }, el('span', { class: 'ctx-emoji', text: '✨' }), el('span', { text: 'Lift subject' }));
strip.querySelector('[data-action="cutout"]')?.before(liftBtn);

// ---- home: quote quick-start, brand kit, all sizes ----
const homeScroll = $('homeScroll');
if (homeScroll) {
  const qs = el('button', { class: 'home-qs rip', id: 'homeQuick', onclick: () => { haptic(); quoteQuickStart(); } },
    el('span', { class: 'home-new-plus', text: '❝' }), el('span', { class: 'home-new-l' }, el('b', { text: 'Quote quick-start' }), el('small', { text: 'Type a quote · see it in every template' })));
  $('homeNew').after(qs);
  $('homeNew').onclick = async () => { const r = await openSizes({ mode: 'new' }); if (r) { await newPosterFlow(r.w, r.h); if (r.item?.safe) setSafeZone(r.item.safe); } };
  $('homeSizes').append(el('button', { class: 'size-chip rip', id: 'homeMoreSizes', onclick: () => $('homeNew').click() }, el('span', { class: 'size-shape more', text: '…' }), el('span', { text: 'All sizes' })));
  const tplHead = $('tplCats').previousElementSibling;
  const bk = el('button', { class: 'chip small rip' + (window.PFBrand.autoOn() ? ' on' : ''), id: 'brandToggle', text: '◆ Brand kit on templates', onclick: () => {
    const on = !window.PFBrand.autoOn(); localStorage.setItem(BRAND_AUTO, on ? '1' : '0'); bk.classList.toggle('on', on); haptic(); toast(on ? 'Templates open with your brand colours, fonts and logo' : 'Brand kit off for templates'); } });
  tplHead.append(el('button', { class: 'chip small rip', id: 'homeBrandKit', text: 'Edit kit', onclick: () => openBrandKit() }), bk);
}

// ---- menu (2.0 menu + 2.1 items) ----
$('btnMenu').onclick = async () => {
  const s = PF.state; const pano = panoramaCount();
  const v = await menuSheet('PosterForge', [
    { label: '🏠  Home', value: 'home' }, { label: '📄  New poster', value: 'new' }, { label: '❝  Quote quick-start', value: 'quick' }, { label: '📂  Open project', value: 'open' }, { label: '💾  Save project', value: 'save' }, { label: '🗂  Save a copy', value: 'copy' }, 'hr',
    { label: `🎞  Pages / carousel (${pageCount()})`, value: 'pages' }, { label: `📐  Canvas size (${s.W}×${s.H})`, value: 'size' }, { label: '🎨  Background colour', value: 'bg' },
    { label: '🔤  Fonts & My Fonts', value: 'fonts' }, { label: '🌈  Smart text colours', value: 'colours' }, { label: '◆  Brand kit', value: 'brand' }, { label: '📋  Paste image', value: 'paste' }, { label: '✦  Collage, pop-out, stickers, ratio…', value: 'create22' },
    { label: s.safeZone ? '🛡  Hide safe zone' : '🛡  Show Story/Reel safe zone', value: 'safe' }, 'hr',
    { label: '⬇️  Export (PNG, JPG, PDF, SVG)', value: 'export' }, ...(pano ? [{ label: `🧩  Export panorama slides (${pano})`, value: 'pano' }] : []), { label: '🛟  Backup & restore', value: 'backup' }, { label: '🔍  Fit poster to screen', value: 'fit' },
    { label: '⚙️  Settings & API key', value: 'settings' }, { label: 'ℹ️  About & licences', value: 'about' }, { label: '❔  Quick guide', value: 'guide' },
  ]);
  ({ home: showHome, new: () => $('homeNew').click(), quick: () => quoteQuickStart(), open: PF.openProjectsSheet, save: () => PF.saveProject(false), copy: () => PF.saveProject(true), pages: openPagesSheet, size: () => openSizes(), bg: PF.backgroundSheet,
    fonts: () => openFontPicker(), colours: () => openSmartColours(), brand: () => openBrandKit(), paste: () => pasteImage(), create22: () => window.PF22?.menu(),
    safe: async () => { if (s.safeZone) setSafeZone(null); else { const k = await menuSheet('Safe zone', [{ label: 'Story (profile bar + reply box)', value: 'story' }, { label: 'Reel (caption + buttons)', value: 'reel' }, { label: 'Reel cover (grid crops)', value: 'cover' }]); if (k) setSafeZone(k); } },
    export: exportSheetV2, pano: () => exportPanorama(), backup: backupSheet, fit: () => { s.zoom = 1; s.panX = s.panY = 0; PF.layout(); }, settings: PF.settingsSheet, about: aboutSheet, guide: () => runOnboarding(true) })[v]?.();
};
PF.artboardSheet = () => openSizes();
// export sheet gets a panorama shortcut
window.addEventListener('pf:export-open', () => {});

// ---- back: close the quick-start gallery / path drawing first ----
const back1 = window.pfHandleBack;
window.pfHandleBack = () => {
  const qs = $('quickStart'); if (qs && !sheetOpen()) { qs.pfClose(); return true; }
  const pd = $('pathCancel'); if (pd) { pd.click(); return true; }
  const sb = $('storyStyles'); if (sb && !sb.classList.contains('hidden') && !sheetOpen()) { sb.classList.add('hidden'); return true; }
  return back1();
};
void closeTopSheet; void renderTemplates;

window.PF21 = { STORY_STYLES, applyStoryStyle, setBox, setOutline, story, liftSubject, pasteImage, copyImage, stickerOutline, refineEdges, saveImage, placeLifted, LIFT_MESSAGES,
  openSizes, setSafeZone, exportPanorama, panoramaCount, ALL_SIZES, SIZE_GROUPS, toPx, savedSizes, saveSize,
  openSmartColours, applyPair, setAutoContrast, autoContrast, savedPalettes, savePalette, color,
  quoteQuickStart, quoteGallery, fillTemplate, wrapQuote, openBrandKit, getKit, setKit, applyKitToBuilt, applyKitToCanvas,
  drawPathMode, applyPath, ready: true };
