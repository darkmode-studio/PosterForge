// 2.1 smart text colours (photo palette, WCAG contrast filter, harmonies, quote palettes, saved palettes) and auto text contrast.
/* global fabric */
import { el, sheet, toast, promptSheet } from '../ui.js';
import { haptic } from '../native.js';
import { sampleUnder, photoPalette, suggest, HARMONIES, QUOTE_PALETTES, worstContrast, parseHex, luminance } from './color.js';

const PF = () => window.PF;
const PAL_KEY = 'pf.palettes';
export const savedPalettes = () => { try { return JSON.parse(localStorage.getItem(PAL_KEY) || '[]'); } catch (_) { return []; } };
export function savePalette(p) { const l = savedPalettes().filter((x) => x.name !== p.name); l.unshift(p); localStorage.setItem(PAL_KEY, JSON.stringify(l.slice(0, 30))); }
export function deletePalette(name) { localStorage.setItem(PAL_KEY, JSON.stringify(savedPalettes().filter((x) => x.name !== name))); }

const texts = () => PF().canvas.getObjects().filter((o) => PF().isText(o) && o.visible !== false);
/** main = the selected text (else the biggest); secondary = the other texts that are smaller (author, counter, subtitle). */
export function mainAndSecondary(sel) {
  const all = texts(); if (!all.length) return { main: null, second: [] };
  const size = (o) => (o.fontSize || 0) * Math.abs(o.scaleY || 1);
  const main = sel && PF().isText(sel) ? sel : all.slice().sort((a, b) => size(b) - size(a))[0];
  return { main, second: all.filter((o) => o !== main && (size(o) <= size(main) || o.pfRole === 'counter')) };
}
function setFill(o, hex) { o.set({ fill: hex, pfFillMode: 'solid', pfTexture: null }); o.dirty = true; }
export function applyPair(main, second, sel) {
  const pf = PF(); const t = mainAndSecondary(sel || pf.active()); if (!t.main) return toast('Add some text first');
  setFill(t.main, main); t.second.forEach((o) => setFill(o, second || main));
  if (t.main.pfAutoContrast) autoContrast(t.main, { keepFill: true });
  pf.canvas.requestRenderAll(); pf.history.record(); haptic('confirm');
  return t;
}

export async function openSmartColours(target) {
  const pf = PF(); const o = target || pf.active();
  const main = o && pf.isText(o) ? o : mainAndSecondary(null).main;
  if (!main) return toast('Add or select some text first');
  let mode = 'complementary'; let showAll = false;
  const sample = sampleUnder(pf.canvas, main);
  const pal = photoPalette(pf.canvas, main);
  const body = el('div', { class: 'sc-body', id: 'smartColours' });
  const swatch = (hex, label, onClick, extra = '') => el('button', { class: 'sc-sw rip ' + extra, style: `--c:${hex}`, 'data-hex': hex, title: label, 'aria-label': label, onclick: onClick },
    el('span', { class: 'sc-dot' }), el('small', { text: label }));
  const applyMain = (hex) => { setFill(main, hex); pf.canvas.requestRenderAll(); pf.history.record(); haptic(); draw(); };
  function draw() {
    body.textContent = '';
    if (pal.length) body.append(el('h3', { text: 'From your photo' }), el('div', { class: 'sc-row', id: 'scPhoto' }, ...pal.map((h) => swatch(h, h.toUpperCase(), () => applyMain(h)))));
    body.append(el('div', { class: 'seg wrap', id: 'scModes' }, ...HARMONIES.map(([k, l]) => el('button', { class: k === mode ? 'on' : '', 'data-mode': k, text: l, onclick: () => { mode = k; draw(); } }))));
    const sug = suggest(sample, pal, mode, 3);
    const ok = sug.filter((x) => x.ok); const hidden = sug.length - ok.length;
    body.append(el('h3', { text: 'Readable on this spot' }),
      el('div', { class: 'sc-row', id: 'scSuggest' }, ...(showAll ? sug : ok).map((x) => swatch(x.hex, `${x.cr.toFixed(1)}:1`, () => applyMain(x.hex), x.ok ? '' : 'fail'))),
      el('p', { class: 'note', id: 'scHiddenNote', text: hidden ? `${hidden} colours hidden (contrast under 3:1 against the photo behind the text).` : 'Every suggestion passes the 3:1 contrast check.' },
        hidden ? el('button', { class: 'link', text: showAll ? ' Hide them' : ' Show them', onclick: () => { showAll = !showAll; draw(); } }) : null));
    const pairBtn = (p, saved) => el('button', { class: 'sc-pair rip', 'data-pal': p.name, onclick: () => { applyPair(p.main, p.second, main); draw(); },
      oncontextmenu: saved ? async (e) => { e.preventDefault(); deletePalette(p.name); toast('Palette deleted'); draw(); } : null },
      el('span', { class: 'sc-pv', style: `background:${p.bg || p.second};color:${p.main}`, text: 'Aa' }), el('span', { class: 'sc-pv2', style: `background:${p.second}` }), el('small', { text: p.name }));
    body.append(el('h3', { text: 'Quote palettes · main + second colour' }), el('div', { class: 'sc-row', id: 'scPalettes' }, ...QUOTE_PALETTES.map((p) => pairBtn(p))));
    const mine = savedPalettes();
    body.append(el('div', { class: 'row-between' }, el('h3', { text: 'My palettes' }), el('button', { class: 'btn-tonal rip', id: 'scSave', text: 'Save current pair', onclick: async () => {
      const t = mainAndSecondary(main); const m = typeof t.main.fill === 'string' ? t.main.fill : '#ffffff'; const s = t.second.find((x) => typeof x.fill === 'string')?.fill || m;
      const n = await promptSheet('Palette name', { value: 'My palette ' + (savedPalettes().length + 1), okLabel: 'Save' }); if (!n) return;
      savePalette({ name: n.trim().slice(0, 30), main: m, second: s, bg: sample ? sample.avg : '#000000' }); window.PFBrand?.addColours?.([m, s]); toast('Palette saved (also in Brand kit)'); draw(); } })),
      mine.length ? el('div', { class: 'sc-row', id: 'scMine' }, ...mine.map((p) => pairBtn(p, true))) : el('p', { class: 'note', text: 'Saved palettes appear here. Long-press one to delete it.' }));
    const cur = typeof main.fill === 'string' ? main.fill : null;
    if (cur && sample) body.append(el('p', { class: 'note', id: 'scCurrent', text: `Current text colour: ${worstContrast(cur, sample).toFixed(1)}:1 against the spot behind it (aim for 3:1 or more for big text, 4.5:1 for small).` }));
  }
  draw();
  await sheet({ title: 'Smart text colours', body, actions: [{ label: 'Done', value: true, kind: 'btn-accent' }] });
}

// ---------- auto text contrast ----------
/** Decides and applies light/dark text, a soft shadow or a scrim. Returns the decision. */
export function autoContrast(o, { keepFill = false } = {}) {
  const pf = PF(); if (!pf.isText(o)) return null;
  const s = sampleUnder(pf.canvas, o); if (!s) return null;
  // undo what auto contrast added before
  if (o.pfAutoFx === 'shadow' || o.pfAutoFx === 'scrim') o.set({ shadow: o.pfGlow ? o.shadow : null });
  if (o.pfAutoFx === 'scrim') o.set('textBackgroundColor', '');
  let fill = typeof o.fill === 'string' ? o.fill : '#ffffff';
  if (!keepFill || !parseHex(fill)) {
    const w = worstContrast('#ffffff', s), b = worstContrast('#111111', s);
    fill = w >= b ? '#ffffff' : '#111111';
    if (typeof o.fill === 'string' || !o.fill) o.set({ fill, pfFillMode: 'solid' });
  }
  const light = luminance(parseHex(fill)) > 0.4;
  const cr = worstContrast(fill, s);
  let fx = 'none';
  if (cr < 3 || s.busy > 0.55) { fx = 'scrim'; o.set('textBackgroundColor', light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)'); }
  else if (cr < 4.5 || s.busy > 0.3) { fx = 'shadow'; if (!o.pfGlow) o.set('shadow', new fabric.Shadow({ color: light ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.6)', blur: Math.max(8, (o.fontSize || 60) * 0.25), offsetX: 0, offsetY: 2 })); }
  o.set({ pfAutoFx: fx }); o.dirty = true; pf.canvas.requestRenderAll();
  return { fill, fx, contrast: cr, busy: s.busy };
}
export function setAutoContrast(o, on) {
  const pf = PF(); if (!pf.isText(o)) return null;
  let r = null;
  if (on) { o.set('pfAutoContrast', true); r = autoContrast(o); }
  else { if (o.pfAutoFx === 'scrim') o.set('textBackgroundColor', ''); if (o.pfAutoFx && o.pfAutoFx !== 'none' && !o.pfGlow) o.set('shadow', null); o.set({ pfAutoContrast: false, pfAutoFx: null }); o.dirty = true; pf.canvas.requestRenderAll(); }
  pf.history.record(); return r;
}
// keep it live while moving things around
let t = null;
export function installAutoContrast() {
  const pf = PF();
  const rerun = () => { clearTimeout(t); t = setTimeout(() => { const list = pf.canvas.getObjects().filter((x) => x.pfAutoContrast); if (!list.length) return; list.forEach((x) => autoContrast(x));
    const h = pf.history; if (h.undoStack.length) h.undoStack[h.undoStack.length - 1] = h.serialize(); /* amend the move step */ }, 120); };
  pf.canvas.on('object:modified', rerun);
  window.addEventListener('pf:photo-changed', rerun);
}
