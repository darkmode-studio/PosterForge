// 2.1 brand kit: colours, favourite fonts and a logo; one tap applies them to the open design or a template.
import { el, sheet, toast } from '../ui.js';
import { haptic } from '../native.js';
import { fontEntry, MALAYALAM_RE } from '../tools.js';
import { favs } from '../v2/fonts.js';
import { openFontPicker } from '../v2/fonts.js';
import { getMeta, setMeta } from '../db.js';
import { parseHex, luminance } from './color.js';

const PF = () => window.PF;
const KEY = 'pf.brandKit';
export const DEFAULT_KIT = { name: 'My brand', colours: ['#FFD60A', '#F5EFE6', '#0B4F6C'], headFont: 'Playfair Display', bodyFont: 'Montserrat', mlFont: 'Manjari', logo: null, logoPos: 'bottom-right' };
export function getKit() { try { return { ...DEFAULT_KIT, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) { return { ...DEFAULT_KIT }; } }
export function setKit(k) { const { logo, ...rest } = k; localStorage.setItem(KEY, JSON.stringify(rest)); }
export async function getLogo() { return getMeta('brand.logo').catch(() => null); }
export async function setLogo(dataURL) { return setMeta('brand.logo', dataURL); }
export function addColours(list) { const k = getKit(); for (const c of list) if (c && !k.colours.map((x) => x.toLowerCase()).includes(c.toLowerCase())) k.colours.push(c); k.colours = k.colours.slice(-10); setKit(k); }

const isText = (o) => o && (o.type === 'text' || o.type === 'textbox' || o.type === 'i-text');
/**
 * Applies the kit to a Fabric JSON page (template) or the live canvas:
 * biggest text -> heading font + colour 1, other texts -> body font + colour 2 (Malayalam text -> Malayalam font), logo added in a corner.
 */
export function applyKitToObjects(objs, kit, size) {
  const texts = objs.filter((o) => isText(o));
  const main = texts.slice().sort((a, b) => (b.fontSize || 0) * (b.scaleY || 1) - (a.fontSize || 0) * (a.scaleY || 1))[0];
  const set = (o, k, v) => (typeof o.set === 'function' ? o.set(k, v) : (o[k] = v));
  for (const o of texts) {
    const ml = MALAYALAM_RE.test(o.text || '');
    const fam = ml ? kit.mlFont : o === main ? kit.headFont : kit.bodyFont;
    if (fam && fontEntry(fam) && (!ml || fontEntry(fam).ml)) { set(o, 'fontFamily', fam); set(o, 'styles', {}); }
    const col = o === main ? kit.colours[0] : (kit.colours[1] || kit.colours[0]);
    if (col && (typeof o.fill === 'string' || !o.fill)) { set(o, 'fill', col); set(o, 'pfFillMode', 'solid'); }
  }
  return { main, size };
}
export function logoObject(dataURL, W, H, pos = 'bottom-right', img = null) {
  const side = Math.round(Math.min(W, H) * 0.14), m = Math.round(Math.min(W, H) * 0.05);
  const iw = img ? img.naturalWidth : side, ih = img ? img.naturalHeight : side; const k = side / Math.max(iw, ih);
  const x = pos.endsWith('left') ? m + iw * k / 2 : pos.endsWith('center') ? W / 2 : W - m - iw * k / 2;
  const y = pos.startsWith('top') ? m + ih * k / 2 : H - m - ih * k / 2;
  return { type: 'image', version: '5.3.0', originX: 'center', originY: 'center', left: x, top: y, width: iw, height: ih, scaleX: k, scaleY: k, src: dataURL, name: 'Brand logo', pfRole: 'logo', crossOrigin: null };
}
const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
/** Applies the kit to a built template { w, h, pages } (every page). */
export async function applyKitToBuilt(b, kit = getKit()) {
  const logo = await getLogo(); const img = logo ? await loadImg(logo).catch(() => null) : null;
  for (const p of b.pages) { applyKitToObjects(p.objects, kit); if (logo && img) { p.objects = p.objects.filter((o) => o.pfRole !== 'logo'); p.objects.push(logoObject(logo, b.w, b.h, kit.logoPos, img)); } }
  return b;
}
/** One tap: apply to the open design (current page). */
export async function applyKitToCanvas(kit = getKit()) {
  const pf = PF(); const objs = pf.canvas.getObjects();
  if (!objs.some(isText)) { toast('Add some text first'); return false; }
  await pf.history.batch(async () => {
    applyKitToObjects(objs, kit);
    const fams = [...new Set([kit.headFont, kit.bodyFont, kit.mlFont])].filter((f) => fontEntry(f));
    await Promise.all(fams.map((f) => document.fonts.load(`400 40px "${f}"`, 'Aa കേ').catch(() => null)));
    window.fabric?.util?.clearFabricFontCache?.();
    objs.filter(isText).forEach((o) => { const c = o.getCenterPoint(); o.initDimensions(); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); o.dirty = true; });
    const logo = await getLogo();
    if (logo) { pf.canvas.getObjects().filter((o) => o.pfRole === 'logo').forEach((o) => pf.canvas.remove(o)); const img = await loadImg(logo);
      const spec = logoObject(logo, pf.state.W, pf.state.H, kit.logoPos, img);
      const o = new window.fabric.Image(img, spec); pf.canvas.add(o); }
  });
  pf.canvas.requestRenderAll(); haptic('confirm'); toast('Brand kit applied'); return true;
}

export async function openBrandKit() {
  const kit = getKit(); let logo = await getLogo();
  const body = el('div', { class: 'col bk-body', id: 'brandKit' });
  const fontRow = (label, key, ml) => el('div', { class: 'row-between bk-font' }, el('span', { class: 'small', text: label }),
    el('button', { class: 'chip rip', 'data-font': key, style: `font-family:"${kit[key]}"`, text: kit[key], onclick: async () => {
      const f = await openFontPicker({ pick: true, filter: ml ? 'Malayalam' : undefined }).catch(() => null);
      const fam = typeof f === 'string' ? f : f && f.family; if (fam) { kit[key] = fam; setKit(kit); draw(); } } }));
  function draw() {
    body.textContent = '';
    const colIn = el('input', { type: 'color', id: 'bkAddColour', value: '#ff4e8a' });
    body.append(el('h3', { text: 'Colours (1st = headings, 2nd = other text)' }),
      el('div', { class: 'sc-row', id: 'bkColours' }, ...kit.colours.map((c, i) => el('button', { class: 'sc-sw rip', style: `--c:${c}`, 'data-hex': c, title: 'Tap to make it first · long-press to remove',
        onclick: () => { kit.colours.splice(i, 1); kit.colours.unshift(c); setKit(kit); draw(); }, oncontextmenu: (e) => { e.preventDefault(); kit.colours.splice(i, 1); setKit(kit); draw(); } }, el('span', { class: 'sc-dot' }), el('small', { text: c.toUpperCase() }))),
        el('label', { class: 'sc-sw add rip', title: 'Add colour' }, el('span', { class: 'sc-dot', text: '+' }), colIn)));
    colIn.addEventListener('change', () => { kit.colours.push(colIn.value); kit.colours = kit.colours.slice(-10); setKit(kit); draw(); });
    const fv = [...favs()].filter((f) => fontEntry(f));
    body.append(el('h3', { text: 'Fonts' }), fontRow('Headings', 'headFont'), fontRow('Other text', 'bodyFont'), fontRow('Malayalam', 'mlFont', true),
      el('p', { class: 'note', text: fv.length ? `Favourite fonts (★ in the font picker): ${fv.slice(0, 8).join(', ')}` : 'Star fonts in the font picker to keep your favourites at the top.' }));
    if (fv.length) body.append(el('div', { class: 'chips', id: 'bkFavs' }, ...fv.slice(0, 8).map((f) => el('button', { class: 'chip rip', style: `font-family:"${f}"`, text: f, onclick: () => { kit.headFont = f; setKit(kit); draw(); } }))));
    const fileIn = el('input', { type: 'file', accept: 'image/*', id: 'bkLogoFile', class: 'hidden' });
    fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (!f) return; const img = await loadImg(URL.createObjectURL(f)); const k = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      logo = c.toDataURL('image/png'); await setLogo(logo); draw(); });
    body.append(el('h3', { text: 'Logo' }), el('div', { class: 'row bk-logo' }, logo ? el('img', { src: logo, alt: 'Logo', class: 'bk-logo-img checker' }) : el('span', { class: 'note', text: 'No logo yet' }),
      el('button', { class: 'btn-tonal rip', id: 'bkLogoPick', text: logo ? 'Change' : 'Add logo', onclick: () => fileIn.click() }), fileIn,
      logo ? el('button', { class: 'btn-ghost rip', text: 'Remove', onclick: async () => { logo = null; await setLogo(null); draw(); } }) : null),
      el('div', { class: 'seg wrap', id: 'bkLogoPos' }, ...[['top-left', '↖'], ['top-right', '↗'], ['bottom-left', '↙'], ['bottom-center', '↓'], ['bottom-right', '↘']].map(([k, l]) =>
        el('button', { class: kit.logoPos === k ? 'on' : '', 'data-pos': k, text: l, onclick: () => { kit.logoPos = k; setKit(kit); draw(); } }))));
  }
  draw();
  const v = await sheet({ title: 'Brand kit', body, actions: [{ label: 'Close', value: null, kind: 'btn-ghost' }, { label: 'Apply to this design', value: 'apply', kind: 'btn-accent' }] });
  if (v === 'apply') return applyKitToCanvas(getKit());
  return null;
}
void parseHex; void luminance;
