// 2.1 Instagram-style text tools: Story Styles row (named chips previewed in their own free lookalike font) and the
// quick bar (Aa, colour, animation, outline, alignment, background box, auto contrast, effects).
/* global fabric */
import { el, toast } from '../ui.js';
import { haptic } from '../native.js';
import { fontEntry } from '../tools.js';
import { applyStyle, syncTypo } from '../v2/typo.js';
import { openSmartColours, setAutoContrast } from './smartcolor.js';
import { parseHex, luminance } from './color.js';

const PF = () => window.PF;
// name -> free lookalike (all bundled, OFL/Apache). `alt` is used when the first family is missing.
export const STORY_STYLES = [
  { name: 'Classic', fontFamily: 'Inter', fontWeight: 700, alt: 'Roboto' },
  { name: 'Modern', fontFamily: 'Roboto Condensed', fontWeight: 400, charSpacing: 20, alt: 'Barlow Condensed' },
  { name: 'Strong', fontFamily: 'Montserrat', fontWeight: 900, fontStyle: 'italic' },
  { name: 'Typewriter', fontFamily: 'Courier Prime', fontWeight: 400, alt: 'Special Elite' },
  { name: 'Editor', fontFamily: 'Special Elite', fontWeight: 400, alt: 'Space Mono' },
  { name: 'Meme', fontFamily: 'Comic Neue', fontWeight: 700 },
  { name: 'Elegant', fontFamily: 'Playfair Display', fontWeight: 400, fontStyle: 'italic' },
  { name: 'Signature', fontFamily: 'Dancing Script', fontWeight: 700, alt: 'Great Vibes' },
  { name: 'Directional', fontFamily: 'Archivo Black', fontWeight: 400, charSpacing: -10 },
  { name: 'Poster', fontFamily: 'Alfa Slab One', fontWeight: 400 },
  { name: 'Bubble', fontFamily: 'Fredoka', fontWeight: 700 },
  { name: 'Deco', fontFamily: 'Poiret One', fontWeight: 400, charSpacing: 60 },
  { name: 'Squeeze', fontFamily: 'Bebas Neue', fontWeight: 400, charSpacing: 30 },
].map((s) => (fontEntry(s.fontFamily) || !s.alt ? s : { ...s, fontFamily: s.alt }));

/** Applies a story style but keeps the layer's colour, outline, box and effects (like Instagram). */
export async function applyStoryStyle(o, st) {
  const pf = PF(); if (!pf.isText(o)) return;
  const keep = { fill: o.fill, stroke: o.stroke, strokeWidth: o.strokeWidth, shadow: o.shadow, pfGlow: o.pfGlow, pfFillMode: o.pfFillMode, lineHeight: o.lineHeight, textAlign: o.textAlign, pfWarp: o.pfWarp, pfWarpAmt: o.pfWarpAmt, pfPath: o.pfPath };
  await pf.history.batch(async () => { // one undo step
    await applyStyle(o, { fontFamily: st.fontFamily, fontWeight: st.fontWeight, fontStyle: st.fontStyle || 'normal', charSpacing: st.charSpacing || 0, lineHeight: keep.lineHeight });
    const c = o.getCenterPoint();
    o.set({ fill: keep.fill, stroke: keep.stroke, strokeWidth: keep.strokeWidth, shadow: keep.shadow, pfGlow: keep.pfGlow, pfFillMode: keep.pfFillMode, textAlign: keep.textAlign, pfStory: st.name });
    o.initDimensions(); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); o.dirty = true; pf.canvas.requestRenderAll();
  });
}

const ANIMS = ['none', 'fade', 'typewriter', 'slide'];
const ANIM_LABEL = { none: 'Anim off', fade: 'Fade', typewriter: 'Type', slide: 'Slide up' };
const BOXES = ['none', 'solid', 'semi'];
const ALIGNS = ['center', 'left', 'right'];
const isLight = (hex) => { const p = parseHex(hex); return p ? luminance(p) > 0.4 : true; };

export function setBox(o, mode) {
  const pf = PF(); const fill = typeof o.fill === 'string' ? o.fill : '#ffffff';
  if (o.pfBox === 'solid' && o.pfBoxText) o.set('fill', o.pfBoxText); // restore the original text colour
  if (mode === 'none') o.set({ textBackgroundColor: '', pfBox: null, pfBoxText: null });
  else if (mode === 'solid') { const base = o.pfBox === 'solid' && o.pfBoxText ? o.pfBoxText : fill; o.set({ textBackgroundColor: base, pfBox: 'solid', pfBoxText: base, fill: isLight(base) ? '#111111' : '#ffffff', pfFillMode: 'solid' }); }
  else o.set({ textBackgroundColor: isLight(fill) ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)', pfBox: 'semi', pfBoxText: null });
  if (o.pfAutoFx === 'scrim') o.set('pfAutoFx', 'none');
  o.dirty = true; pf.canvas.requestRenderAll(); pf.history.record();
}
export function setOutline(o, level) { // 0 none, 1 thin, 2 thick
  const pf = PF(); const fill = typeof o.fill === 'string' ? o.fill : '#ffffff';
  const w = [0, Math.max(2, o.fontSize * 0.04), Math.max(4, o.fontSize * 0.09)][level];
  o.set({ strokeWidth: w, stroke: w ? (isLight(fill) ? '#111111' : '#ffffff') : null, paintFirst: 'stroke', strokeLineJoin: 'round', pfOutline: level });
  const c = o.getCenterPoint(); o.initDimensions(); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); o.dirty = true; pf.canvas.requestRenderAll(); pf.history.record();
}
/** Preview of the saved animation on the canvas (the poster export is still a still image). */
export function previewAnim(o) {
  const pf = PF(); const kind = o.pfAnim || 'none'; if (kind === 'none') return;
  const op = o.opacity ?? 1, top = o.top, text = o.text;
  if (kind === 'fade') { o.set('opacity', 0); fabric.util.animate({ startValue: 0, endValue: op, duration: 700, onChange: (v) => { o.set('opacity', v); pf.canvas.requestRenderAll(); } }); }
  else if (kind === 'slide') { o.set({ opacity: 0, top: top + 60 }); fabric.util.animate({ startValue: 0, endValue: 1, duration: 600, easing: fabric.util.ease.easeOutCubic, onChange: (v) => { o.set({ opacity: op * v, top: top + 60 * (1 - v) }); pf.canvas.requestRenderAll(); }, onComplete: () => { o.set({ top, opacity: op }); o.setCoords(); } }); }
  else if (kind === 'typewriter') {
    let i = 0; const n = [...text].length; const chars = [...text]; o.__pfAnimating = true;
    const tick = () => { i++; o.set('text', chars.slice(0, i).join('')); o.dirty = true; pf.canvas.requestRenderAll(); if (i < n) setTimeout(tick, Math.max(18, 900 / n)); else { o.set('text', text); o.__pfAnimating = false; pf.canvas.requestRenderAll(); } };
    o.set('text', ''); tick();
  }
}

const svgI = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
export function buildStoryUI() {
  const pf = PF();
  const row = el('div', { class: 'story-styles hidden', id: 'storyStyles', role: 'listbox', 'aria-label': 'Story styles' },
    ...STORY_STYLES.map((s) => el('button', { class: 'story-chip rip', 'data-style': s.name, role: 'option',
      style: `font-family:"${s.fontFamily}";font-weight:${s.fontWeight};font-style:${s.fontStyle || 'normal'}`, text: s.name,
      onclick: async () => { const o = pf.active(); if (!pf.isText(o)) return; haptic(); await applyStoryStyle(o, s); sync(); } })));
  const qb = (id, label, kids, fn) => el('button', { class: 'qb rip', id, 'aria-label': label, title: label, onclick: () => { const o = pf.active(); if (!pf.isText(o)) return; haptic(); fn(o); sync(); } }, ...kids);
  const bar = el('div', { class: 'quickbar hidden', id: 'textQuickbar', role: 'toolbar', 'aria-label': 'Text quick tools' },
    qb('qbAa', 'Story styles', [el('b', { text: 'Aa' })], () => { row.classList.toggle('hidden'); }),
    qb('qbColour', 'Smart colours', [el('span', { class: 'qb-dot', id: 'qbDot' })], (o) => openSmartColours(o).then(sync)),
    qb('qbAnim', 'Animation', [el('span', { class: 'qb-t', id: 'qbAnimT', text: 'Anim off' })], (o) => { o.set('pfAnim', ANIMS[(ANIMS.indexOf(o.pfAnim || 'none') + 1) % ANIMS.length]); pf.history.record(); previewAnim(o); toast(o.pfAnim === 'none' ? 'Animation off' : `${ANIM_LABEL[o.pfAnim]}: saved with the text (preview only; exports stay still images)`); }),
    qb('qbOutline', 'Outline', [el('span', { class: 'qb-outl', text: 'A' })], (o) => setOutline(o, ((o.pfOutline || 0) + 1) % 3)),
    qb('qbAlign', 'Alignment', [svgI('i-al-c')], (o) => { o.set('textAlign', ALIGNS[(ALIGNS.indexOf(o.textAlign) + 1) % 3]); o.dirty = true; pf.canvas.requestRenderAll(); pf.history.record(); }),
    qb('qbBox', 'Background box', [el('span', { class: 'qb-box', text: 'A' })], (o) => setBox(o, BOXES[(BOXES.indexOf(o.pfBox || 'none') + 1) % 3])),
    qb('qbAuto', 'Auto contrast', [el('span', { class: 'qb-t', text: '◐' })], (o) => { const r = setAutoContrast(o, !o.pfAutoContrast); if (r) toast(`Auto contrast on: ${r.fx === 'scrim' ? 'added a soft scrim' : r.fx === 'shadow' ? 'added a soft shadow' : 'colour picked'} (${r.contrast.toFixed(1)}:1)`); else toast('Auto contrast off'); }),
    qb('qbFx', 'Effects', [svgI('i-fx')], () => { pf.openPane('typo'); syncTypo(); }));
  document.body.append(row, bar);
  function sync() {
    const o = pf.active(); const on = !!o && pf.isText(o) && !document.body.classList.contains('at-home') && !document.getElementById('panel').classList.contains('open');
    bar.classList.toggle('hidden', !on); if (!on) { row.classList.add('hidden'); document.body.classList.remove('has-qb'); return; }
    document.body.classList.add('has-qb');
    document.getElementById('qbDot').style.background = typeof o.fill === 'string' ? o.fill : 'linear-gradient(45deg,#ffb347,#ff4e8a)';
    document.getElementById('qbAnimT').textContent = ANIM_LABEL[o.pfAnim || 'none'];
    document.getElementById('qbOutline').classList.toggle('on', !!o.pfOutline || !!o.strokeWidth);
    document.getElementById('qbBox').dataset.mode = o.pfBox || 'none'; document.getElementById('qbBox').classList.toggle('on', !!o.pfBox);
    document.getElementById('qbAuto').classList.toggle('on', !!o.pfAutoContrast);
    document.getElementById('qbAlign').querySelector('use').setAttribute('href', '#i-al-' + ({ left: 'l', center: 'c', right: 'r', justify: 'c' }[o.textAlign] || 'c'));
    row.querySelectorAll('[data-style]').forEach((b) => b.classList.toggle('on', b.dataset.style === o.pfStory));
  }
  ['selection:created', 'selection:updated', 'selection:cleared', 'object:modified'].forEach((e) => pf.canvas.on(e, sync));
  window.addEventListener('pf:pane', sync);
  return { sync };
}
