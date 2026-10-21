// Typography pane: spacing, curved text / text on a path, gradient & photo fills, glow, saved text styles; B / I with real faces.
/* global fabric */
import { el, toast, promptSheet, confirmSheet } from '../ui.js';
import { haptic } from '../native.js';
import { fontEntry, hasFace, boldWeightFor } from '../tools.js';
import { setWarp, gradientFill, textureFill, glowShadow } from './textfx.js';
import { openFontPicker, favs } from './fonts.js';

const PF = () => window.PF;
const $ = (id) => document.getElementById(id);
const STYLE_KEY = 'pf.textStyles';
export const BUILTIN_STYLES = [
  { name: 'Cinematic yellow', fontFamily: 'Bebas Neue', fontWeight: 400, fill: '#ffd400', charSpacing: 40, lineHeight: 1.0, shadow: { color: 'rgba(0,0,0,0.75)', blur: 18, offsetX: 0, offsetY: 4 } },
  { name: 'Serif hook', fontFamily: 'DM Serif Display', fontWeight: 400, fill: '#ffffff', charSpacing: -10, lineHeight: 1.02, shadow: { color: 'rgba(0,0,0,0.35)', blur: 24, offsetX: 0, offsetY: 2 } },
  { name: 'Film quote', fontFamily: 'Cormorant Garamond', fontWeight: 400, fontStyle: 'italic', fill: '#f4efe6', charSpacing: 20, lineHeight: 1.3 },
  { name: 'Neon glow', fontFamily: 'Monoton', fontWeight: 400, fill: '#ffffff', pfGlow: '#ff2bd6', shadow: { color: '#ff2bd6', blur: 30, offsetX: 0, offsetY: 0 } },
  { name: 'Sunset gradient', fontFamily: 'Anton', fontWeight: 400, pfFillMode: 'gradient', gradient: ['#ffb347', '#ff4e8a', 90], charSpacing: 10 },
  { name: 'Outline pop', fontFamily: 'Poppins', fontWeight: 700, fill: '#ffffff', stroke: '#ff3b5c', strokeWidth: 6, charSpacing: 0, lineHeight: 1.05 },
  { name: 'Gold serif', fontFamily: 'Playfair Display', fontWeight: 700, pfFillMode: 'gradient', gradient: ['#f6e27a', '#b8860b', 90], lineHeight: 1.1, shadow: { color: 'rgba(0,0,0,0.5)', blur: 12, offsetX: 0, offsetY: 3 } },
  { name: 'Malayalam bold', fontFamily: 'Baloo Chettan 2', fontWeight: 700, fill: '#ffffff', lineHeight: 1.25, stroke: '#111827', strokeWidth: 4 },
];
export const savedStyles = () => { try { return JSON.parse(localStorage.getItem(STYLE_KEY) || '[]'); } catch (_) { return []; } };
export function captureStyle(o, name) {
  const st = { name, fontFamily: o.fontFamily, fontWeight: o.fontWeight, fontStyle: o.fontStyle, charSpacing: o.charSpacing || 0, lineHeight: o.lineHeight,
    stroke: o.stroke || null, strokeWidth: o.strokeWidth || 0, textAlign: o.textAlign, pfGlow: o.pfGlow || null, pfWarp: o.pfWarp || null, pfWarpAmt: o.pfWarpAmt || 0,
    shadow: o.shadow ? { color: o.shadow.color, blur: o.shadow.blur, offsetX: o.shadow.offsetX, offsetY: o.shadow.offsetY } : null, pfFillMode: o.pfFillMode || 'solid' };
  if (typeof o.fill === 'string') st.fill = o.fill;
  else if (o.fill && o.fill.colorStops) { const cs = o.fill.colorStops; const c = o.fill.coords; st.gradient = [cs[0].color, cs[cs.length - 1].color, Math.round(Math.atan2(c.y2 - c.y1, c.x2 - c.x1) * 180 / Math.PI)]; st.pfFillMode = 'gradient'; }
  return st;
}
export function saveStyle(st) { const l = savedStyles().filter((x) => x.name !== st.name); l.unshift(st); localStorage.setItem(STYLE_KEY, JSON.stringify(l.slice(0, 40))); }
export function deleteStyle(name) { localStorage.setItem(STYLE_KEY, JSON.stringify(savedStyles().filter((x) => x.name !== name))); }
export async function applyStyle(o, st) {
  const pf = PF();
  const ml = /[\u0D00-\u0D7F]/.test(o.text);
  const fam = st.fontFamily && fontEntry(st.fontFamily) && !(ml && !fontEntry(st.fontFamily).ml) ? st.fontFamily : o.fontFamily;
  await document.fonts.load(`${st.fontStyle === 'italic' ? 'italic ' : ''}${st.fontWeight || 400} 40px "${fam}"`, o.text).catch(() => null);
  fabric.util.clearFabricFontCache(fam);
  const c = o.getCenterPoint();
  o.set({ fontFamily: fam, fontWeight: st.fontWeight || o.fontWeight, fontStyle: st.fontStyle || 'normal', charSpacing: st.charSpacing || 0, lineHeight: st.lineHeight || o.lineHeight,
    stroke: st.stroke || null, strokeWidth: st.strokeWidth || 0, paintFirst: 'stroke', strokeLineJoin: 'round', pfGlow: st.pfGlow || null,
    shadow: st.shadow ? new fabric.Shadow(st.shadow) : null, pfFillMode: st.pfFillMode || 'solid' });
  if (st.textAlign) o.set('textAlign', st.textAlign);
  o.initDimensions();
  if (st.gradient) o.set('fill', gradientFill(o, st.gradient[0], st.gradient[1], st.gradient[2]));
  else if (st.fill) o.set('fill', st.fill);
  if (st.pfWarp !== undefined) setWarp(o, st.pfWarp || 'none', st.pfWarpAmt || 0);
  if (ml && fam !== st.fontFamily && st.fontFamily) toast(`${st.fontFamily} has no Malayalam letters, kept ${fam}`);
  o.initDimensions(); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); o.dirty = true; pf.canvas.requestRenderAll(); pf.history.record();
}

function slider(id, label, min, max, step, val) {
  return el('div', { class: 'slider-row' }, el('span', { class: 'lbl', text: label }), el('input', { type: 'range', id, min, max, step, value: val }), el('span', { class: 'val', id: id + 'Val', text: String(val) }));
}
function live(id, fn, fmt = (v) => v) {
  const inp = $(id); let t = null;
  inp.addEventListener('input', () => { const o = PF().active(); $(id + 'Val').textContent = fmt(inp.value); if (!PF().isText(o)) return; fn(o, Number(inp.value)); o.dirty = true; PF().canvas.requestRenderAll(); });
  inp.addEventListener('change', () => { clearTimeout(t); t = setTimeout(() => PF().history.record(), 50); });
}
export function buildTypoPane() {
  const pane = el('div', { class: 'pane', id: 'pane-typo' });
  pane.append(
    slider('tyLetter', 'Letter spacing', -150, 800, 5, 0),
    slider('tyLine', 'Line spacing', 60, 250, 1, 112),
    el('h3', { text: 'Shape' }),
    el('div', { class: 'chips', id: 'tyWarp' }, ...[['none', 'Straight'], ['arc', 'Arc'], ['wave', 'Wave'], ['circle', 'Circle']].map(([k, l]) => el('button', { class: 'chip rip', 'data-warp': k, text: l }))),
    slider('tyBend', 'Bend', -100, 100, 1, 0),
    el('h3', { text: 'Fill' }),
    el('div', { class: 'chips', id: 'tyFill' }, ...[['solid', 'Solid'], ['gradient', 'Gradient'], ['photo', 'Photo texture']].map(([k, l]) => el('button', { class: 'chip rip', 'data-fill': k, text: l }))),
    el('div', { class: 'row', id: 'tyGradRow' }, el('input', { type: 'color', id: 'tyG1', value: '#ffb347', 'aria-label': 'Gradient start' }), el('input', { type: 'color', id: 'tyG2', value: '#ff4e8a', 'aria-label': 'Gradient end' }),
      el('div', { class: 'chips', id: 'tyGradPresets' }, ...[['#ffb347', '#ff4e8a'], ['#00c6ff', '#0072ff'], ['#f7ff00', '#db36a4'], ['#fceabb', '#f8b500'], ['#ffffff', '#9aa3b2']].map(([a, b]) => el('button', { class: 'grad-sw rip', style: `background:linear-gradient(90deg,${a},${b})`, 'data-g': a + ',' + b, 'aria-label': 'Gradient preset' })))),
    slider('tyGAngle', 'Angle', 0, 360, 5, 90),
    el('label', { class: 'btn-tonal rip file-btn', id: 'tyTexBtn' }, 'Pick photo for texture', el('input', { type: 'file', id: 'tyTexture', accept: 'image/*' })),
    el('h3', { text: 'Glow' }),
    el('div', { class: 'row' }, el('button', { class: 'chip rip', id: 'tyGlowBtn', text: 'Glow off' }), el('input', { type: 'color', id: 'tyGlowColor', value: '#ff2bd6', 'aria-label': 'Glow colour' })),
    slider('tyGlow', 'Glow size', 2, 80, 1, 28),
    el('p', { class: 'note', text: 'Glow uses the text’s shadow slot (turning glow on replaces a drop shadow). Outline is in the Outline tool.' }),
    el('div', { class: 'row-between' }, el('h3', { text: 'Text styles' }), el('button', { class: 'btn-tonal rip', id: 'tySaveStyle', text: 'Save this style' })),
    el('div', { class: 'style-grid', id: 'tyStyles' }));
  document.querySelector('.panel-body').append(pane);
  const pf = PF();
  pf.PANE_TITLES.typo = 'Text effects'; pf.CTX_PANES.push('typo');
  live('tyLetter', (o, v) => { o.set('charSpacing', v); reflow(o); });
  live('tyLine', (o, v) => { o.set('lineHeight', v / 100); reflow(o); }, (v) => (v / 100).toFixed(2));
  live('tyBend', (o, v) => { setWarp(o, o.pfWarp || 'arc', v); syncTypo(); });
  pane.querySelectorAll('[data-warp]').forEach((b) => { b.onclick = () => { const o = pf.active(); if (!pf.isText(o)) return; haptic();
    const k = b.dataset.warp; const amt = k === 'none' ? 0 : (Number(o.pfWarpAmt) || (k === 'circle' ? 100 : 45)); setWarp(o, k, amt); pf.canvas.requestRenderAll(); pf.history.record(); syncTypo(); }; });
  pane.querySelectorAll('[data-fill]').forEach((b) => { b.onclick = () => setFillMode(b.dataset.fill); });
  const grad = () => { const o = pf.active(); if (!pf.isText(o)) return; o.set({ fill: gradientFill(o, $('tyG1').value, $('tyG2').value, Number($('tyGAngle').value)), pfFillMode: 'gradient' }); o.dirty = true; pf.canvas.requestRenderAll(); };
  ['tyG1', 'tyG2'].forEach((id) => { $(id).addEventListener('input', grad); $(id).addEventListener('change', () => pf.history.record()); });
  $('tyGAngle').addEventListener('input', () => { $('tyGAngleVal').textContent = $('tyGAngle').value; grad(); }); $('tyGAngle').addEventListener('change', () => pf.history.record());
  pane.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => { const [a, c] = b.dataset.g.split(','); $('tyG1').value = a; $('tyG2').value = c; grad(); pf.history.record(); syncTypo(); }; });
  $('tyTexture').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await setTexture(f); });
  $('tyGlowBtn').onclick = () => { const o = pf.active(); if (!pf.isText(o)) return; haptic();
    if (o.pfGlow) o.set({ pfGlow: null, shadow: null }); else o.set({ pfGlow: $('tyGlowColor').value, shadow: glowShadow($('tyGlowColor').value, Number($('tyGlow').value)) });
    o.dirty = true; pf.canvas.requestRenderAll(); pf.history.record(); syncTypo(); };
  const glowLive = () => { const o = pf.active(); if (!pf.isText(o) || !o.pfGlow) return; o.set({ pfGlow: $('tyGlowColor').value, shadow: glowShadow($('tyGlowColor').value, Number($('tyGlow').value)) }); o.dirty = true; pf.canvas.requestRenderAll(); };
  $('tyGlow').addEventListener('input', () => { $('tyGlowVal').textContent = $('tyGlow').value; glowLive(); }); $('tyGlow').addEventListener('change', () => pf.history.record());
  $('tyGlowColor').addEventListener('input', glowLive); $('tyGlowColor').addEventListener('change', () => pf.history.record());
  $('tySaveStyle').onclick = async () => { const o = pf.active(); if (!pf.isText(o)) return; const n = await promptSheet('Save text style', { value: `${o.fontFamily} style`, okLabel: 'Save' }); if (!n || !n.trim()) return; saveStyle(captureStyle(o, n.trim().slice(0, 40))); toast('Style saved'); renderStyles(); };
  renderStyles();
}
function reflow(o) { const c = o.getCenterPoint(); o.initDimensions(); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); }
function setFillMode(mode) {
  const pf = PF(); const o = pf.active(); if (!pf.isText(o)) return; haptic();
  if (mode === 'solid') { o.set({ fill: typeof o.fill === 'string' ? o.fill : '#ffffff', pfFillMode: 'solid', pfTexture: null }); }
  else if (mode === 'gradient') o.set({ fill: gradientFill(o, $('tyG1').value, $('tyG2').value, Number($('tyGAngle').value)), pfFillMode: 'gradient', pfTexture: null });
  else if (mode === 'photo') { o.set('pfFillMode', 'photo'); $('tyTexture').click(); }
  o.dirty = true; pf.canvas.requestRenderAll(); if (mode !== 'photo') pf.history.record(); syncTypo();
}
export async function setTexture(fileOrUrl, target) {
  const pf = PF(); const o = target || pf.active(); if (!pf.isText(o)) return;
  let url = typeof fileOrUrl === 'string' ? fileOrUrl : null;
  if (!url) { // downscale to keep projects small; data URL so it survives save/backup
    const bmp = await createImageBitmap(fileOrUrl); const k = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    url = c.toDataURL('image/jpeg', 0.85);
  }
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  o.set({ fill: textureFill(o, img), pfFillMode: 'photo', pfTexture: 1 }); o.dirty = true; pf.canvas.requestRenderAll(); pf.history.record(); syncTypo();
}
function renderStyles() {
  const box = $('tyStyles'); if (!box) return; const pf = PF();
  const mk = (st, user) => {
    let timer = null;
    const b = el('button', { class: 'style-chip rip', 'data-style': st.name, onclick: () => { const o = pf.active(); if (pf.isText(o)) { haptic(); applyStyle(o, st).then(syncTypo); } } },
      el('span', { class: 'style-chip-s', style: `font-family:'${st.fontFamily}';font-weight:${st.fontWeight || 400};font-style:${st.fontStyle || 'normal'};color:${st.fill || (st.gradient ? st.gradient[0] : '#fff')}`, text: /Malayalam/.test(st.name) ? 'അക്ഷരം' : 'Aa' }),
      el('span', { class: 'style-chip-l', text: st.name + (user ? '' : '') }));
    if (user) {
      b.addEventListener('pointerdown', () => { timer = setTimeout(async () => { if (await confirmSheet('Delete style?', `“${st.name}” will be removed.`, 'Delete', true)) { deleteStyle(st.name); renderStyles(); } }, 600); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(timer)));
    }
    return b;
  };
  box.replaceChildren(...savedStyles().map((s) => mk(s, true)), ...BUILTIN_STYLES.map((s) => mk(s, false)));
}
export function syncTypo() {
  const pf = PF(); const o = pf.active(); if (!pf.isText(o) || !$('tyLetter')) return;
  $('tyLetter').value = o.charSpacing || 0; $('tyLetterVal').textContent = o.charSpacing || 0;
  $('tyLine').value = Math.round((o.lineHeight || 1.16) * 100); $('tyLineVal').textContent = (o.lineHeight || 1.16).toFixed(2);
  const w = o.pfWarp || 'none'; document.querySelectorAll('#tyWarp .chip').forEach((c) => c.classList.toggle('on', c.dataset.warp === w));
  $('tyBend').value = o.pfWarpAmt || 0; $('tyBendVal').textContent = o.pfWarpAmt || 0; $('tyBend').closest('.slider-row').classList.toggle('hidden', w === 'none');
  const fm = o.pfFillMode || (typeof o.fill === 'string' ? 'solid' : o.fill && o.fill.colorStops ? 'gradient' : 'photo');
  document.querySelectorAll('#tyFill .chip').forEach((c) => c.classList.toggle('on', c.dataset.fill === fm));
  $('tyGradRow').classList.toggle('hidden', fm !== 'gradient'); $('tyGAngle').closest('.slider-row').classList.toggle('hidden', fm !== 'gradient'); $('tyTexBtn').classList.toggle('hidden', fm !== 'photo');
  $('tyGlowBtn').textContent = o.pfGlow ? 'Glow on' : 'Glow off'; $('tyGlowBtn').classList.toggle('on', !!o.pfGlow);
  if (o.pfGlow) $('tyGlowColor').value = o.pfGlow;
  syncFontPane();
}

// ---- font pane upgrades: font button, favourites row, real B / I ----
export function upgradeFontPane() {
  const pane = $('pane-font'); const pf = PF();
  $('fontGroups').classList.add('hidden'); $('fontChips').classList.add('hidden');
  const btn = el('button', { class: 'font-btn rip', id: 'btnFontPicker', onclick: () => openFontPicker() },
    el('span', { class: 'font-btn-name', id: 'fontBtnName', text: 'Font' }), el('span', { class: 'font-btn-sub', text: 'Browse all fonts ›' }));
  const favRow = el('div', { class: 'chips', id: 'fontFavRow' });
  pane.prepend(btn, favRow);
  const ib = el('button', { id: 'btnItalic', class: 'chip rip', style: 'font-style:italic;font-family:serif;font-weight:700', text: 'I', 'aria-label': 'Italic' });
  $('btnBold').after(ib);
  ib.onclick = async () => {
    const o = pf.active(); if (!pf.isText(o)) return; haptic();
    const it = o.fontStyle !== 'italic'; const w = Number(o.fontWeight) || 400;
    await document.fonts.load(`${it ? 'italic ' : ''}${w} 40px "${o.fontFamily}"`, o.text).catch(() => null);
    fabric.util.clearFabricFontCache(o.fontFamily);
    if (it && !hasFace(o.fontFamily, w, true)) toast('No italic file in this font: using a slanted (synthetic) version');
    reflowSet(o, { fontStyle: it ? 'italic' : 'normal' }); pf.history.record(); syncFontPane();
  };
  void boldWeightFor;
}
function reflowSet(o, props) { const c = o.getCenterPoint(); o.set(props); o.initDimensions(); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); o.dirty = true; PF().canvas.requestRenderAll(); }
export function syncFontPane() {
  const pf = PF(); const o = pf.active(); if (!pf.isText(o) || !$('fontBtnName')) return;
  const e = fontEntry(o.fontFamily);
  $('fontBtnName').textContent = (e && (e.label || e.family)) || o.fontFamily + ' (missing)';
  $('fontBtnName').style.fontFamily = `'${o.fontFamily}'`;
  $('btnItalic')?.classList.toggle('on', o.fontStyle === 'italic');
  const fv = [...favs()].slice(0, 12);
  $('fontFavRow').replaceChildren(...fv.filter((f) => fontEntry(f)).map((f) => el('button', { class: 'chip rip' + (o.fontFamily === f ? ' on' : ''), style: `font-family:'${f}'`, text: '★ ' + (fontEntry(f).label || f),
    onclick: async () => { const x = pf.active(); if (pf.isText(x)) { await pf.setFont(x, f); syncFontPane(); } } })));
}
