// Font picker (live preview, favourites, filters, family expansion), font import (TTF/OTF/ZIP) and My Fonts.
/* global fabric */
import { FONT_CATALOG, FONT_GROUPS, MALAYALAM_RE, addCatalogEntry, removeCatalogEntry, fontEntry, hasFace } from '../tools.js';
import { el, sheet, toast, busy, promptSheet, menuSheet, confirmSheet, closeTopSheet } from '../ui.js';
import { saveUserFont, getAllUserFonts, deleteUserFont } from '../db.js';
import { haptic } from '../native.js';
import { parseFont, unzip, weightName } from './fontfile.js';

const PF = () => window.PF;
const FAV_KEY = 'pf.favFonts';
export const favs = () => { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch (_) { return new Set(); } };
export function toggleFav(fam) { const f = favs(); f.has(fam) ? f.delete(fam) : f.add(fam); localStorage.setItem(FAV_KEY, JSON.stringify([...f])); return f.has(fam); }
const ML_SAMPLE = 'സ്നേഹം', EN_SAMPLE = 'Love the journey';
const faceLabel = (f) => `${weightName(f.w)}${f.italic ? ' Italic' : ''}`.replace('Regular Italic', 'Italic') + (f.variable ? ' (variable)' : '');

// ---------- user fonts: storage -> catalog ----------
function recordsToEntries(recs) {
  const fams = new Map();
  for (const r of recs) {
    const key = r.family; if (!fams.has(key)) fams.set(key, { family: key, label: r.label || key, group: r.group || 'Other', ml: !!r.ml, faces: [], user: true, ids: [], license: 'Imported by you', source: 'My Fonts' });
    const e = fams.get(key); e.ids.push(r.id); if (r.label) e.label = r.label; if (r.group) e.group = r.group;
    e.faces.push({ w: r.weight, italic: !!r.italic, buffer: r.data, url: 'user:' + r.id, id: r.id, fileName: r.fileName });
  }
  for (const e of fams.values()) e.faces.sort((a, b) => (a.italic - b.italic) || (a.w - b.w));
  return [...fams.values()];
}
export async function loadUserFonts() {
  const recs = await getAllUserFonts().catch(() => []);
  for (const e of recordsToEntries(recs)) addCatalogEntry(e);
  return recs.length;
}
const bundledNames = new Set(FONT_CATALOG.filter((f) => f.bundled).map((f) => f.family));

/** Imports File objects (TTF/OTF/ZIP). Returns a summary { added: [{family, weight, italic, group}], skipped: [msg] }. */
export async function importFontFiles(files) {
  const added = [], skipped = [];
  const items = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    if (/\.zip$/i.test(f.name) || new DataView(buf).getUint32(0, true) === 0x04034b50) {
      try { for (const z of await unzip(buf, (n) => /\.(ttf|otf)$/i.test(n) && !/__MACOSX/.test(n))) items.push({ name: z.name.split('/').pop(), data: z.data }); }
      catch (e) { skipped.push(`${f.name}: ${e.message}`); }
    } else items.push({ name: f.name, data: buf });
  }
  const existing = await getAllUserFonts().catch(() => []);
  for (const it of items) {
    try {
      if (it.data.byteLength > 30 * 1024 * 1024) throw new Error('larger than 30 MB');
      const info = parseFont(it.data);
      let family = info.family;
      if (bundledNames.has(family)) family = family + ' (mine)';
      // validate the browser can actually use it
      const test = new FontFace('pf-validate-' + Math.random().toString(36).slice(2), it.data); await test.load();
      const sameFam = existing.find((r) => r.family === family);
      const id = 'uf_' + family.replace(/[^a-z0-9]+/gi, '_') + '_' + info.weight + (info.italic ? 'i' : '');
      const rec = { id, family, label: sameFam?.label || family, weight: info.weight, italic: info.italic, ml: info.ml, group: sameFam?.group || info.group,
        fileName: it.name, data: it.data, added: Date.now(), detected: info.group };
      await saveUserFont(rec); existing.push(rec);
      added.push({ family, weight: info.weight, italic: info.italic, group: rec.group, ml: info.ml, file: it.name });
    } catch (e) { skipped.push(`${it.name}: ${e.message || e}`); }
  }
  // rebuild entries for the touched families
  const touched = new Set(added.map((a) => a.family));
  for (const e of recordsToEntries(existing.filter((r) => touched.has(r.family)))) addCatalogEntry(e);
  return { added, skipped };
}
async function updateFamilyRecords(family, patch) {
  const recs = (await getAllUserFonts()).filter((r) => r.family === family);
  for (const r of recs) await saveUserFont({ ...r, ...patch });
  const all = await getAllUserFonts(); for (const e of recordsToEntries(all.filter((r) => r.family === family))) addCatalogEntry(e);
}
export async function renameUserFont(family, label) { await updateFamilyRecords(family, { label }); }
export async function moveUserFont(family, group) { await updateFamilyRecords(family, { group }); }
export async function deleteUserFontFamily(family) {
  const recs = (await getAllUserFonts()).filter((r) => r.family === family);
  for (const r of recs) await deleteUserFont(r.id);
  removeCatalogEntry(family);
}

/** Missing-font check for a project state; warns and returns the missing families. */
export function missingFonts(st) {
  const out = new Set(); const v = (o) => { if (o && o.fontFamily && !fontEntry(o.fontFamily)) out.add(o.fontFamily); (o && o.objects || []).forEach(v); };
  ((st && st.pages) || [st && st.canvas]).forEach((c) => ((c && c.objects) || []).forEach(v));
  return [...out];
}
export function checkMissing(st) {
  const m = missingFonts(st);
  if (m.length) toast(`Missing font${m.length > 1 ? 's' : ''}: ${m.join(', ')}. Text uses a fallback until you import ${m.length > 1 ? 'them' : 'it'} in My Fonts.`, 'error', 6000);
  return m;
}

// ---------- picker ----------
const FILTERS = ['All', 'Favourites', 'My Fonts', ...FONT_GROUPS, 'Other'];
const labelOf = (f) => f.label || f.family;
const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((ents) => ents.forEach((en) => {
  if (!en.isIntersecting) return; const n = en.target; io.unobserve(n);
  n.querySelectorAll('[data-ff]').forEach((x) => { x.style.fontFamily = `'${x.dataset.ff}', 'Noto Sans Malayalam', sans-serif`; });
}), { rootMargin: '200px' }) : null;

export async function openFontPicker(opts = {}) {
  const pf = PF(); const o = opts.target || pf.active();
  const isTxt = !opts.pick && pf.isText(o); let picked = null;
  const orig = isTxt ? { fontFamily: o.fontFamily, fontWeight: o.fontWeight, fontStyle: o.fontStyle } : null;
  const txt = isTxt ? o.text.replace(/\s+/g, ' ').trim() : '';
  const textIsMl = MALAYALAM_RE.test(txt);
  let filter = opts.filter || (textIsMl ? 'Malayalam' : 'All'), q = '', expanded = null;
  const search = el('input', { type: 'search', class: 'fp-search', placeholder: `Search ${FONT_CATALOG.length} fonts`, 'aria-label': 'Search fonts' });
  const chips = el('div', { class: 'chips fp-filters' });
  const list = el('div', { class: 'fp-list', role: 'listbox' });
  const fileIn = el('input', { type: 'file', multiple: true, accept: '.ttf,.otf,.zip,font/ttf,font/otf,application/zip,application/x-font-ttf,application/octet-stream', class: 'hidden', 'aria-label': 'Import font files' });
  fileIn.id = 'fontImportInput';
  const importBtn = el('label', { class: 'btn-tonal rip fp-import', for: 'fontImportInput' }, '＋ Import fonts (TTF, OTF, ZIP)', fileIn);
  const preview = (f) => {
    if (txt && !(textIsMl && !f.ml) && !(filter === 'Malayalam' && !textIsMl)) return [...txt].slice(0, 28).join('');
    return f.ml ? `${ML_SAMPLE} · Aa` : EN_SAMPLE;
  };
  const apply = async (f, face) => {
    if (opts.pick) { picked = f.family; closeTopSheet(); return; }
    if (!isTxt) return;
    if (textIsMl && !f.ml) { toast(`${labelOf(f)} has no Malayalam letters`, 'error'); return; }
    const w = face ? (face.variable ? 400 : face.w) : (Number(o.fontWeight) >= 600 ? (f.faces.some((x) => x.w >= 600 || x.variable) ? Math.max(...f.faces.filter((x) => !x.italic).map((x) => (x.variable ? Math.min(700, x.w2) : x.w))) : 700) : (f.faces.some((x) => x.w === 400 && !x.italic) ? 400 : f.faces[0].w));
    const it = face ? !!face.italic : (o.fontStyle === 'italic' && f.faces.some((x) => x.italic));
    await document.fonts.load(`${it ? 'italic ' : ''}${w} 40px "${f.family}"`, o.text || 'Aa').catch(() => null);
    fabric.util.clearFabricFontCache(f.family);
    const c = o.getCenterPoint();
    o.set({ fontFamily: f.family, fontWeight: w, fontStyle: it ? 'italic' : 'normal', pfFontLabel: f.user ? labelOf(f) : null });
    o.initDimensions(); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); pf.canvas.requestRenderAll(); haptic();
    render();
  };
  function rowFor(f) {
    const fav = favs().has(f.family);
    const cur = isTxt && o.fontFamily === f.family;
    const blocked = textIsMl && !f.ml;
    const nameEl = el('span', { class: 'fp-name', 'data-ff': f.family, text: labelOf(f) });
    const prevEl = el('span', { class: 'fp-prev', 'data-ff': f.family, text: preview(f) });
    const meta = el('span', { class: 'fp-meta', text: `${f.group}${f.faces.length > 1 ? ` · ${f.faces.length} styles` : ''}${f.user ? ' · mine' : ''}${blocked ? ' · no Malayalam' : ''}` });
    const star = el('button', { class: 'fp-star rip' + (fav ? ' on' : ''), 'aria-label': fav ? 'Remove from favourites' : 'Add to favourites', text: fav ? '★' : '☆',
      onclick: (e) => { e.stopPropagation(); toggleFav(f.family); haptic(); render(); } });
    const more = f.faces.length > 1 ? el('button', { class: 'fp-exp rip', 'aria-label': 'Show styles', text: expanded === f.family ? '▴' : '▾',
      onclick: (e) => { e.stopPropagation(); expanded = expanded === f.family ? null : f.family; render(); } }) : null;
    const menu = f.user ? el('button', { class: 'fp-exp rip', 'aria-label': 'Font options', text: '⋮', onclick: (e) => { e.stopPropagation(); userFontMenu(f).then(render); } }) : null;
    const row = el('div', { class: 'fp-row rip' + (cur ? ' on' : '') + (blocked ? ' off' : ''), role: 'option', 'data-font': f.family, onclick: () => apply(f) },
      el('div', { class: 'fp-text' }, nameEl, prevEl, meta), star, more, menu);
    const wrap = el('div', { class: 'fp-item' }, row);
    if (expanded === f.family) {
      wrap.append(el('div', { class: 'fp-faces' }, ...f.faces.map((face) => el('button', {
        class: 'fp-face rip' + (cur && Number(o.fontWeight) === face.w && (o.fontStyle === 'italic') === !!face.italic ? ' on' : ''), 'data-face': `${face.w}${face.italic ? 'i' : ''}`,
        onclick: (e) => { e.stopPropagation(); apply(f, face); } },
        el('span', { class: 'fp-face-s', style: `font-family:'${f.family}';font-weight:${face.variable ? 400 : face.w};font-style:${face.italic ? 'italic' : 'normal'}`, text: f.ml ? 'സ്നേഹം Aa' : 'Aa Gg' }),
        el('span', { class: 'fp-face-l', text: faceLabel(face) })))));
    }
    if (io) io.observe(wrap); else wrap.querySelectorAll('[data-ff]').forEach((x) => { x.style.fontFamily = `'${x.dataset.ff}'`; });
    return wrap;
  }
  function render() {
    const fv = favs();
    chips.replaceChildren(...FILTERS.map((g) => el('button', { class: 'chip rip' + (g === filter ? ' on' : ''), 'data-filter': g, text: g === 'Favourites' ? `★ Favourites${fv.size ? ' ' + fv.size : ''}` : g,
      onclick: () => { filter = g; render(); list.scrollTop = 0; } })));
    const ql = q.toLowerCase();
    const items = FONT_CATALOG.filter((f) => (filter === 'All' || (filter === 'Favourites' ? fv.has(f.family) : filter === 'My Fonts' ? f.user : f.group === filter))
      && (!ql || labelOf(f).toLowerCase().includes(ql) || f.group.toLowerCase().includes(ql)))
      .sort((a, b) => (fv.has(b.family) - fv.has(a.family)) || (textIsMl ? (b.ml - a.ml) : 0));
    const top = list.scrollTop;
    list.replaceChildren(...(filter === 'My Fonts' ? [importBtn] : []), ...items.map(rowFor));
    if (!items.length) list.append(el('p', { class: 'empty', text: filter === 'My Fonts' ? 'No imported fonts yet. Import TTF/OTF files or a ZIP of a font family; they are copied into the app and work offline.' : filter === 'Favourites' ? 'Tap ☆ on any font to keep it here.' : 'No fonts match.' }));
    list.scrollTop = top;
  }
  search.addEventListener('input', () => { q = search.value.trim(); render(); });
  fileIn.addEventListener('change', async () => {
    const files = [...fileIn.files]; fileIn.value = ''; if (!files.length) return;
    busy(`Importing ${files.length} file${files.length > 1 ? 's' : ''}…`);
    try { const r = await importFontFiles(files); busy(); showImportSummary(r); filter = 'My Fonts'; render(); }
    catch (e) { busy(); toast('Import failed: ' + e.message, 'error'); }
  });
  render();
  const body = el('div', { class: 'fp' }, search, chips, list);
  const v = await sheet({ title: opts.pick ? 'Pick a font' : isTxt ? 'Fonts' : 'Fonts (select a text to apply)', body, onOpen: (box) => box.classList.add('sheet-tall'),
    actions: isTxt ? [{ label: 'Cancel', value: 'cancel', kind: 'btn-ghost' }, { label: 'Done', value: 'done', kind: 'btn-accent' }] : [{ label: 'Close', value: null, kind: 'btn-ghost' }] });
  if (opts.pick) return picked;
  if (!isTxt) return v;
  const changed = o.fontFamily !== orig.fontFamily || o.fontWeight !== orig.fontWeight || o.fontStyle !== orig.fontStyle;
  if (v !== 'done' && changed) { const c = o.getCenterPoint(); o.set(orig); o.initDimensions(); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); pf.canvas.requestRenderAll(); }
  else if (v === 'done' && changed) { pf.history.record(); pf.refreshLayers(); pf.syncEditPanel(); }
  return v;
}
function showImportSummary({ added, skipped }) {
  const fams = new Map(); added.forEach((a) => { if (!fams.has(a.family)) fams.set(a.family, []); fams.get(a.family).push(a); });
  const body = el('div', { class: 'col-gap' },
    ...[...fams.entries()].map(([fam, faces]) => el('div', { class: 'imp-row' }, el('b', { style: `font-family:'${fam}'`, text: fam }),
      el('span', { class: 'note', text: `${faces[0].ml ? 'Malayalam' : 'Latin'} · ${faces[0].group} · ${faces.map((x) => weightName(x.weight) + (x.italic ? ' Italic' : '')).join(', ')}` }))),
    ...(skipped.length ? [el('p', { class: 'note', text: 'Skipped: ' + skipped.join('; ') })] : []),
    el('p', { class: 'note', text: 'Only import fonts you are allowed to use, especially for posters you publish.' }));
  return sheet({ title: added.length ? `Imported ${added.length} font file${added.length > 1 ? 's' : ''}` : 'Nothing imported', body, actions: [{ label: 'OK', value: true, kind: 'btn-accent' }] });
}
async function userFontMenu(f) {
  const v = await menuSheet(labelOf(f), [{ label: 'Rename', value: 'rename' }, { label: `Move to category (now ${f.group})`, value: 'move' },
    { label: favs().has(f.family) ? 'Remove from favourites' : 'Add to favourites', value: 'fav' }, { label: 'Delete from My Fonts', value: 'del' }]);
  if (v === 'rename') { const n = await promptSheet('Rename font', { value: labelOf(f), okLabel: 'Rename' }); if (n && n.trim()) await renameUserFont(f.family, n.trim().slice(0, 60)); }
  else if (v === 'move') {
    const g = await menuSheet('Move to', [...FONT_GROUPS, 'Other'].map((x) => ({ label: x + (x === f.group ? '  ✓' : ''), value: x })));
    if (g) { if (g === 'Malayalam' && !f.ml) toast('This font has no Malayalam letters; it will still be listed there.'); await moveUserFont(f.family, g); }
  } else if (v === 'fav') toggleFav(f.family);
  else if (v === 'del') { if (await confirmSheet('Delete font?', `${labelOf(f)} will be removed from this phone. Posters that use it will show a fallback font.`, 'Delete', true)) await deleteUserFontFamily(f.family); }
}
export const PFFonts = { openFontPicker, importFontFiles, loadUserFonts, checkMissing, missingFonts, renameUserFont, moveUserFont, deleteUserFontFamily, toggleFav, favs, hasFace };
window.PFFonts = PFFonts;
