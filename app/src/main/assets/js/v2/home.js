// Home screen (recent projects, template gallery, New poster), first-run guide and About & licences.
/* global fabric */
import { el, sheet, toast, busy, confirmSheet, menuSheet } from '../ui.js';
import { haptic, N } from '../native.js';
import { getAllPosterProjects, getPosterProject, deletePosterProject, getMeta, setMeta } from '../db.js';
import { FONT_CATALOG } from '../tools.js';
import { TEMPLATES, TEMPLATE_CATS, SIZE_LABEL } from './templates.js';
import { pageCount } from './pages.js';

const PF = () => window.PF;
const $ = (id) => document.getElementById(id);
const THUMB_V = 'v3';
let tplCat = 'All', tplSize = 'all';
const thumbMem = new Map();

export function isHomeOpen() { return !$('home').classList.contains('hidden'); }
export function showHome() { const h = $('home'); h.classList.remove('hidden', 'leaving'); document.body.classList.add('at-home'); renderRecent(); renderTemplates(); }
export function hideHome() { const h = $('home'); if (h.classList.contains('hidden')) return; h.classList.add('leaving'); document.body.classList.remove('at-home'); setTimeout(() => { h.classList.add('hidden'); h.classList.remove('leaving'); PF().layout(); }, 220); }

export function buildHome() {
  const home = el('section', { class: 'home hidden', id: 'home', 'aria-label': 'Home' },
    el('header', { class: 'home-top' },
      el('div', { class: 'brand' }, el('span', { class: 'brand-mark', text: 'P' }), el('span', { class: 'brand-name', text: 'PosterForge' })),
      el('div', { class: 'home-acts' },
        el('button', { class: 'fab rip', id: 'homeBackup', 'aria-label': 'Backup & restore', onclick: () => window.PFBackup.backupSheet() }, svg('i-export'), el('span', { text: 'Backup' })),
        el('button', { class: 'fab rip', id: 'homeMenu', 'aria-label': 'More', onclick: homeMenu }, svg('i-more')))),
    el('div', { class: 'home-scroll', id: 'homeScroll' },
      el('button', { class: 'home-new rip', id: 'homeNew', onclick: () => newPosterFlow() }, el('span', { class: 'home-new-plus', text: '+' }), el('span', { class: 'home-new-l' }, el('b', { text: 'New poster' }), el('small', { text: 'Blank canvas · choose a size' }))),
      el('div', { class: 'size-row', id: 'homeSizes' }, ...[['Post 4:5', 1080, 1350], ['Story 9:16', 1080, 1920], ['Square', 1080, 1080], ['Landscape', 1920, 1080], ['A4', 1240, 1754]].map(([l, w, h]) =>
        el('button', { class: 'size-chip rip', 'data-w': String(w), 'data-h': String(h), onclick: () => newPosterFlow(w, h) }, el('span', { class: 'size-shape', style: `aspect-ratio:${w}/${h}` }), el('span', { text: l })))),
      el('div', { class: 'home-h' }, el('h2', { text: 'Recent' }), el('span', { class: 'note', id: 'recentCount' })),
      el('div', { class: 'recent-row', id: 'recentRow' }),
      el('div', { class: 'home-h' }, el('h2', { text: 'Quote templates' }), el('span', { class: 'note', text: `${TEMPLATES.length} editable` })),
      el('div', { class: 'chips', id: 'tplCats' }), el('div', { class: 'chips', id: 'tplSizes' }),
      el('div', { class: 'tpl-grid', id: 'tplGrid' }),
      el('p', { class: 'note home-foot', text: 'Template photos are generated placeholders: tap the photo layer or use Photos → Background to put in your own.' })));
  document.body.append(home);
  window.addEventListener('pf:projects', () => { if (isHomeOpen()) renderRecent(); });
}
const svg = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };

async function homeMenu() {
  const v = await menuSheet('PosterForge', [{ label: 'Backup & restore', value: 'backup' }, { label: 'Fonts & My Fonts', value: 'fonts' }, { label: 'Show the quick guide', value: 'guide' }, { label: 'Settings & API key', value: 'settings' }, { label: 'About & licences', value: 'about' }]);
  ({ backup: () => window.PFBackup.backupSheet(), fonts: () => window.PFFonts.openFontPicker({ filter: 'My Fonts' }), guide: () => runOnboarding(true), settings: () => PF().settingsSheet(), about: aboutSheet })[v]?.();
}
async function draftIsUnsaved() {
  const pf = PF(); if (pf.state.projectId) return false;
  return pf.canvas.getObjects().length > 0 || pageCount() > 1;
}
async function confirmReplace() {
  if (!(await draftIsUnsaved())) return true;
  const v = await sheet({ title: 'Replace your current draft?', message: 'The poster you were editing is not saved as a project.', actions: [
    { label: 'Cancel', value: null, kind: 'btn-ghost' }, { label: 'Save it first', value: 'save', kind: 'btn-secondary' }, { label: 'Replace', value: 'replace', kind: 'btn-danger' }] });
  if (v === 'save') { await PF().saveProject(false); return !!PF().state.projectId; }
  return v === 'replace';
}
export async function newPosterFlow(w, h) {
  const pf = PF();
  if (!w) { const v = await menuSheet('New poster size', pf.presets.map((p) => ({ label: `${p.label}  ·  ${p.w}×${p.h}`, value: p.w + 'x' + p.h }))); if (!v) return; [w, h] = v.split('x').map(Number); }
  if (!(await confirmReplace())) return;
  await pf.history.mute(async () => { pf.canvas.clear(); pf.canvas.setBackgroundColor('#0d1117'); pf.state.pages = null; pf.state.page = 0; await pf.restoreProject({ v: 1, w, h, canvas: { version: '5.3.0', objects: [], background: '#0d1117' } }); });
  pf.state.projectId = null; pf.state.projectName = ''; pf.state.zoom = 1; pf.state.panX = pf.state.panY = 0;
  pf.history.reset(); hideHome(); haptic('confirm'); window.dispatchEvent(new Event('pf:pages'));
  setTimeout(() => pf.openPane('text'), 260);
}
export async function openTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id); if (!t) return;
  const b = t.build(); if (window.PFBrand?.autoOn?.()) await window.PFBrand.applyKitToBuilt(b);
  return openBuilt(b, t.name);
}
/** Opens an already-built template { w, h, pages } (used by templates, quote quick-start and the brand kit). */
export async function openBuilt(built, name) {
  const t = { name };
  if (!(await confirmReplace())) return false;
  const pf = PF(); busy('Opening template…');
  try {
    const b = built; const st = b.pages.length > 1 ? { v: 2, w: b.w, h: b.h, page: 0, pages: b.pages, canvas: b.pages[0] } : { v: 1, w: b.w, h: b.h, canvas: b.pages[0] };
    await pf.history.mute(() => pf.restoreProject(st));
    pf.state.projectId = null; pf.state.projectName = t.name; pf.state.zoom = 1; pf.state.panX = pf.state.panY = 0;
    window.PFPages.updateCounters(); pf.history.reset(); pf.layout(); hideHome(); haptic('confirm');
    toast(b.pages.length > 1 ? `${b.pages.length}-page carousel: tap the page pill at the top to switch pages` : 'Double-tap the text to write your own words');
    return true;
  } catch (e) { toast('Template failed: ' + e.message, 'error'); return false; } finally { busy(); }
}
async function openProject(id) {
  if (!(await confirmReplace())) return;
  const pf = PF(); const p = await getPosterProject(id); if (!p) return;
  busy('Opening…');
  try { await pf.history.mute(() => pf.restoreProject(p.state)); window.PFFonts.checkMissing(p.state); pf.state.projectId = p.id; pf.state.projectName = p.name; pf.state.zoom = 1; pf.state.panX = pf.state.panY = 0; pf.layout(); pf.history.reset(); hideHome(); }
  catch (e) { toast('Could not open: ' + e.message, 'error'); } finally { busy(); }
}
export async function renderRecent() {
  const row = $('recentRow'); if (!row) return;
  const items = await getAllPosterProjects().catch(() => []);
  const draft = await getMeta('draft').catch(() => null);
  const pf = PF();
  const cards = [];
  const hasDraft = pf.canvas.getObjects().length > 0 || (draft && draft.state && ((draft.state.canvas && (draft.state.canvas.objects || []).length) || draft.state.pages));
  if (hasDraft) {
    const img = el('img', { alt: '' });
    cards.push(el('button', { class: 'recent-card draft rip', id: 'homeContinue', onclick: () => { hideHome(); haptic(); } }, el('div', { class: 'rc-img' }, img), el('div', { class: 'rc-meta' }, el('b', { text: 'Continue editing' }), el('small', { text: pf.state.projectName || 'Current draft' }))));
    pf.thumbnail().then((u) => { img.src = u; }).catch(() => {});
  }
  for (const p of items) {
    const card = el('div', { class: 'recent-card rip', 'data-project': p.id, role: 'button', onclick: () => openProject(p.id) },
      el('div', { class: 'rc-img' }, el('img', { src: p.thumb || '', alt: '' }), p.pages > 1 ? el('span', { class: 'rc-badge', text: `${p.pages} pages` }) : null),
      el('div', { class: 'rc-meta' }, el('b', { text: p.name }), el('small', { text: new Date(p.updated).toLocaleDateString() })),
      el('button', { class: 'rc-more rip', 'aria-label': 'Project options', text: '⋮', onclick: async (e) => { e.stopPropagation();
        const v = await menuSheet(p.name, [{ label: 'Open', value: 'open' }, { label: 'Delete', value: 'del' }]);
        if (v === 'open') openProject(p.id);
        if (v === 'del' && await confirmSheet('Delete project?', `“${p.name}” will be removed from this phone.`, 'Delete', true)) { await deletePosterProject(p.id); renderRecent(); } } }));
    cards.push(card);
  }
  if (!cards.length) cards.push(el('div', { class: 'recent-empty', text: 'Your saved posters appear here. Start with a template below.' }));
  row.replaceChildren(...cards);
  $('recentCount').textContent = items.length ? `${items.length} saved` : '';
}
const tio = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { tio.unobserve(en.target); fillThumb(en.target); } }), { rootMargin: '300px' }) : null;
async function fillThumb(card) {
  const id = card.dataset.template; const img = card.querySelector('img');
  try { img.src = await templateThumb(id); card.classList.add('ready'); } catch (e) { console.warn('thumb', id, e); }
}
let thumbChain = Promise.resolve();
export function templateThumb(id) {
  if (thumbMem.has(id)) return Promise.resolve(thumbMem.get(id));
  const job = thumbChain.then(async () => {
    const key = `tpl:${id}:${THUMB_V}`; const cached = await getMeta(key).catch(() => null);
    if (cached) { thumbMem.set(id, cached); return cached; }
    const t = TEMPLATES.find((x) => x.id === id); const b = t.build(); const k = 360 / Math.max(b.w, b.h);
    const c = document.createElement('canvas'); const sc = new fabric.StaticCanvas(c, { width: Math.round(b.w * k), height: Math.round(b.h * k), enableRetinaScaling: false, renderOnAddRemove: false });
    await PF().ensureFonts(b.pages[0]);
    await new Promise((r) => sc.loadFromJSON(b.pages[0], r)); sc.getObjects().forEach((o) => o.initDimensions && o.initDimensions());
    sc.setViewportTransform([k, 0, 0, k, 0, 0]); sc.renderAll(); const url = c.toDataURL('image/webp', 0.8); sc.dispose();
    thumbMem.set(id, url); setMeta(key, url).catch(() => {}); return url;
  });
  thumbChain = job.catch(() => {});
  return job;
}
export function renderTemplates() {
  const cats = $('tplCats'), sizes = $('tplSizes'), grid = $('tplGrid'); if (!grid) return;
  cats.replaceChildren(...TEMPLATE_CATS.map((c) => el('button', { class: 'chip rip' + (c === tplCat ? ' on' : ''), 'data-cat': c, text: c, onclick: () => { tplCat = c; renderTemplates(); } })));
  sizes.replaceChildren(...[['all', 'All sizes'], ['post', SIZE_LABEL.post], ['story', SIZE_LABEL.story], ['square', SIZE_LABEL.square]].map(([k, l]) => el('button', { class: 'chip small rip' + (k === tplSize ? ' on' : ''), 'data-size': k, text: l, onclick: () => { tplSize = k; renderTemplates(); } })));
  const list = TEMPLATES.filter((t) => (tplCat === 'All' || t.cat === tplCat) && (tplSize === 'all' || t.size === tplSize));
  grid.replaceChildren(...list.map((t) => {
    const card = el('button', { class: 'tpl-card rip', 'data-template': t.id, onclick: () => openTemplate(t.id), 'aria-label': t.name },
      el('div', { class: 'tpl-img', style: `aspect-ratio:${t.size === 'story' ? '9/16' : t.size === 'square' ? '1/1' : '4/5'}` }, el('img', { alt: '' })),
      el('div', { class: 'tpl-meta' }, el('b', { text: t.name }), el('small', { text: `${SIZE_LABEL[t.size]}${t.build().pages.length > 1 ? ' · ' + t.build().pages.length + ' pages' : ''}` })));
    if (thumbMem.has(t.id)) { card.querySelector('img').src = thumbMem.get(t.id); card.classList.add('ready'); } else if (tio) tio.observe(card); else fillThumb(card);
    return card;
  }));
}

// ---------- first-run guide ----------
const GUIDE = [
  { t: 'Welcome to PosterForge 2', d: 'Make quote posters, stories and carousels in English and Malayalam. Everything works offline.', i: 'i-elements' },
  { t: 'Start from a template', d: 'Pick a quote template on the home screen, then double-tap any text to write your own words.', i: 'i-photo' },
  { t: 'Tap to select, tools slide up', d: 'Select text or a photo and its tools appear at the bottom: fonts, effects, curved text, colour, photo edits and more.', i: 'i-font' },
  { t: 'Carousel & export', d: 'Use the page pill at the top for multi-page carousels. Export saves every page at once, or a print PDF with bleed.', i: 'i-export' },
];
export function runOnboarding(force = false) {
  if (!force && localStorage.getItem('pf.onboarded')) return false;
  let i = 0;
  const dots = el('div', { class: 'ob-dots' });
  const card = el('div', { class: 'ob-card' });
  const ov = el('div', { class: 'onboard', id: 'onboard', role: 'dialog', 'aria-label': 'Quick guide' }, card);
  const done = () => { localStorage.setItem('pf.onboarded', '1'); ov.classList.add('leaving'); setTimeout(() => ov.remove(), 220); };
  const draw = () => {
    const g = GUIDE[i];
    dots.replaceChildren(...GUIDE.map((_, k) => el('span', { class: k === i ? 'on' : '' })));
    card.replaceChildren(el('div', { class: 'ob-icon' }, svg(g.i)), el('h2', { text: g.t }), el('p', { text: g.d }), dots,
      el('div', { class: 'ob-acts' }, el('button', { class: 'btn-ghost rip', id: 'obSkip', text: 'Skip', onclick: done }),
        el('button', { class: 'btn-accent rip', id: 'obNext', text: i === GUIDE.length - 1 ? 'Get started' : 'Next', onclick: () => { haptic(); if (i === GUIDE.length - 1) done(); else { i++; card.classList.remove('in'); void card.offsetWidth; card.classList.add('in'); draw(); } } })));
  };
  draw(); card.classList.add('in'); document.body.append(ov);
  return true;
}

// ---------- about & licences ----------
export async function aboutSheet() {
  const n = N();
  const en = FONT_CATALOG.filter((f) => f.bundled && !f.ml).length, ml = FONT_CATALOG.filter((f) => f.bundled && f.ml).length, mine = FONT_CATALOG.filter((f) => f.user).length;
  const lic = {}; FONT_CATALOG.filter((f) => f.bundled).forEach((f) => { lic[f.license] = (lic[f.license] || 0) + 1; });
  const list = el('div', { class: 'lic-list', id: 'licList' }, ...FONT_CATALOG.filter((f) => f.bundled).map((f) => el('button', { class: 'lic-row rip', 'data-lic': f.family,
    onclick: async () => { const txt = await (await fetch(f.licenseFile)).text().catch(() => 'Licence text unavailable'); sheet({ title: `${f.family} · ${f.license}`, body: el('pre', { class: 'lic-text', text: txt }), actions: [{ label: 'Close', value: null, kind: 'btn-ghost' }] }); } },
    el('span', { class: 'lic-fam', text: f.family }), el('span', { class: 'lic-meta', text: `${f.license} · ${f.source.replace(/ \(.*\)/, '')}${f.modified ? ' · subset' : ' · unmodified'}` }))));
  const body = el('div', { class: 'col-gap' },
    el('p', { class: 'msg', text: `PosterForge ${n ? n.appVersion() : '2.0.0 (web)'}` }),
    el('p', { class: 'note', text: `${en + ml} bundled font families: ${en} English and ${ml} Malayalam${mine ? `, plus ${mine} imported by you` : ''}. Licences: ${Object.entries(lic).map(([k, v]) => `${k} ${v}`).join(', ')}. Fonts marked “subset” were reduced to the letters PosterForge uses (allowed by their licence; no Reserved Font Name). Fonts with a Reserved Font Name are shipped unmodified. Tap a font to read its licence.` }),
    el('p', { class: 'note', text: 'Libraries: Fabric.js 5.3.1 (MIT), ImageTracer 1.2.6 (Unlicense), opentype.js 1.3.4 (MIT). Template photos are generated placeholders made for PosterForge.' }),
    list);
  await sheet({ title: 'About & licences', body, onOpen: (b) => b.classList.add('sheet-tall'), actions: [{ label: 'Close', value: null, kind: 'btn-ghost' }] });
}
