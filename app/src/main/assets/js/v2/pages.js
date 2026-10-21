// Carousel mode: multi-page projects, automatic page counters, page thumbnails.
/* global fabric */
import { el, sheet, toast, confirmSheet } from '../ui.js';
import { haptic } from '../native.js';

const PF = () => window.PF;
const st = () => PF().state;
export const pageCount = () => (st().pages ? st().pages.length : 1);
const liveJSON = () => JSON.parse(PF().serialize()).canvas;
export function snapshot() { const s = st(); if (s.pages) s.pages[s.page] = liveJSON(); }
function ensurePages() { const s = st(); if (!s.pages) { s.pages = [liveJSON()]; s.page = 0; } }
const fmtCounter = (fmt, n, total) => (fmt || '{n}/{total}').replace('{n}', n).replace('{total}', total);
/** Rewrites every counter object on every page (and the live canvas). */
export function updateCounters() {
  const s = st(); const total = pageCount(); let changed = false;
  const fix = (o, n) => { if (o.pfRole === 'counter') { const t = fmtCounter(o.pfCounterFmt, n, total); if (o.text !== t) { if (o.set) { o.set('text', t); o.initDimensions?.(); o.setCoords?.(); } else o.text = t; changed = true; } } (o.objects || o._objects || []).forEach((c) => fix(c, n)); };
  if (s.pages) s.pages.forEach((p, i) => { if (i !== s.page) (p.objects || []).forEach((o) => fix(o, i + 1)); });
  PF().canvas.getObjects().forEach((o) => fix(o, s.page + 1));
  if (changed) PF().canvas.requestRenderAll();
  return changed;
}
export async function goTo(i, { silent = false } = {}) {
  const pf = PF(); const s = st(); if (!s.pages || i === s.page || i < 0 || i >= s.pages.length) return;
  snapshot(); s.page = i;
  await pf.history.mute(() => pf.restore({ v: 1, w: s.w || s.W, h: s.h || s.H, canvas: s.pages[i] }));
  updateCounters(); pf.history.reset(); window.dispatchEvent(new Event('pf:pages'));
  if (!silent) haptic();
}
export async function addPage({ duplicate = false } = {}) {
  const pf = PF(); ensurePages(); snapshot(); const s = st();
  const cur = s.pages[s.page];
  const fresh = duplicate ? JSON.parse(JSON.stringify(cur)) : { version: cur.version, objects: (cur.objects || []).filter((o) => o.pfRole === 'bg' || o.pfRole === 'counter' || o.name === 'Film grain').map((o) => JSON.parse(JSON.stringify(o))), background: cur.background };
  s.pages.splice(s.page + 1, 0, fresh);
  await pf.history.mute(async () => { s.page = s.page + 1; await pf.restore({ v: 1, w: s.W, h: s.H, canvas: s.pages[s.page] }); });
  updateCounters(); pf.history.reset(); pf.scheduleAutosave(); window.dispatchEvent(new Event('pf:pages'));
  if (!(fresh.objects || []).some((o) => o.pfRole === 'counter') && s.pages.length === 2) toast('Tip: add a page counter from Pages → Add counter');
}
export async function deletePage(i) {
  const pf = PF(); const s = st(); if (!s.pages || s.pages.length < 2) return toast('A poster needs at least one page');
  snapshot(); s.pages.splice(i, 1); s.page = Math.min(s.page > i ? s.page - 1 : s.page, s.pages.length - 1);
  await pf.history.mute(() => pf.restore({ v: 1, w: s.W, h: s.H, canvas: s.pages[s.page] }));
  if (s.pages.length === 1) s.pages = null;
  updateCounters(); pf.history.reset(); pf.scheduleAutosave(); window.dispatchEvent(new Event('pf:pages'));
}
export function movePage(i, dir) {
  const s = st(); if (!s.pages) return; const j = i + dir; if (j < 0 || j >= s.pages.length) return;
  snapshot(); [s.pages[i], s.pages[j]] = [s.pages[j], s.pages[i]];
  if (s.page === i) s.page = j; else if (s.page === j) s.page = i;
  updateCounters(); PF().scheduleAutosave(); window.dispatchEvent(new Event('pf:pages'));
}
export function addCounter() {
  const pf = PF(); const s = st();
  if (pf.canvas.getObjects().some((o) => o.pfRole === 'counter')) return toast('This page already has a counter');
  const t = new fabric.Text('1/1', { left: s.W - 70, top: 70, originX: 'center', originY: 'center', fontFamily: 'Cormorant Garamond', fontSize: Math.round(s.W * 0.028), fill: '#f4efe6', charSpacing: 60, name: 'Page counter', pfRole: 'counter', pfCounterFmt: '{n}/{total}' });
  pf.canvas.add(t);
  // put the same counter on every other page too
  snapshot(); if (s.pages) s.pages.forEach((p, i) => { if (i !== s.page && !(p.objects || []).some((o) => o.pfRole === 'counter')) p.objects.push(t.toObject(pf.PROPS)); });
  updateCounters(); pf.canvas.setActiveObject(t); pf.canvas.requestRenderAll(); pf.history.record();
}
export async function pageThumb(json, maxSide = 200) {
  const s = st(); const k = maxSide / Math.max(s.W, s.H);
  const c = document.createElement('canvas'); const sc = new fabric.StaticCanvas(c, { width: Math.round(s.W * k), height: Math.round(s.H * k), enableRetinaScaling: false, renderOnAddRemove: false });
  await PF().ensureFonts(json);
  await new Promise((r) => sc.loadFromJSON(json, r)); sc.getObjects().forEach((o) => { if (o.initDimensions) o.initDimensions(); });
  sc.setViewportTransform([k, 0, 0, k, 0, 0]); sc.renderAll(); const url = c.toDataURL('image/jpeg', 0.75); sc.dispose(); return url;
}
export async function openPagesSheet() {
  ensurePages(); snapshot();
  const grid = el('div', { class: 'pages-grid' });
  const draw = async (close) => {
    const s = st(); grid.replaceChildren();
    const pages = s.pages || [liveJSON()];
    for (let i = 0; i < pages.length; i++) {
      const img = el('img', { alt: `Page ${i + 1}` });
      const card = el('div', { class: 'page-card' + (i === s.page ? ' on' : ''), 'data-page': String(i) },
        el('button', { class: 'page-thumb rip', onclick: async () => { await goTo(i); close(true); } }, img, el('span', { class: 'page-no', text: String(i + 1) })),
        el('div', { class: 'page-acts' },
          el('button', { class: 'icon-sm rip', 'aria-label': 'Move left', text: '‹', onclick: () => { movePage(i, -1); draw(close); } }),
          el('button', { class: 'icon-sm rip', 'aria-label': 'Delete page', text: '✕', onclick: async () => { if (await confirmSheet('Delete page?', `Page ${i + 1} will be removed.`, 'Delete', true)) { await deletePage(i); if (!st().pages) close(true); else draw(close); } } }),
          el('button', { class: 'icon-sm rip', 'aria-label': 'Move right', text: '›', onclick: () => { movePage(i, 1); draw(close); } })));
      grid.append(card);
      pageThumb(pages[i]).then((u) => { img.src = u; }).catch(() => {});
    }
  };
  const body = el('div', { class: 'col-gap' }, grid, el('div', { class: 'row wrap' },
    el('button', { class: 'btn-tonal rip', id: 'btnAddPage', text: '＋ Blank page', onclick: async () => { await addPage(); closeRef(true); } }),
    el('button', { class: 'btn-tonal rip', id: 'btnDupPage', text: 'Duplicate page', onclick: async () => { await addPage({ duplicate: true }); closeRef(true); } }),
    el('button', { class: 'btn-tonal rip', id: 'btnAddCounter', text: 'Add counter (1/N)', onclick: () => { addCounter(); closeRef(true); } })),
    el('p', { class: 'note', text: 'Carousel: every page exports at once from Export → All pages. Counters like 1/10 update automatically.' }));
  let closeRef = () => {};
  await sheet({ title: `Pages (${pageCount()})`, body, onOpen: (_, close) => { closeRef = close; draw(close); }, actions: [{ label: 'Done', value: true, kind: 'btn-accent' }] });
  if (st().pages && st().pages.length === 1) st().pages = null;
  window.dispatchEvent(new Event('pf:pages'));
}
window.PFPages = { goTo, addPage, deletePage, movePage, addCounter, updateCounters, snapshot, pageCount, openPagesSheet, pageThumb };
