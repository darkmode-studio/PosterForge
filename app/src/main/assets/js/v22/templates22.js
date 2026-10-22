// 2.2 templates: pop-out frame, three-strip story with a cutout breaking the strips, text behind the subject,
// and six Malayalam lettering styles (only the words change). Appended to the 2.0 template library.
/* global fabric */
import { TEMPLATES, TEMPLATE_CATS, SIZES } from '../v2/templates.js';
import { popoutTemplatePage } from './popout.js';

const V = 'img/v22/';
const txt = (text, p = {}) => ({ type: 'text', version: '5.3.0', originX: 'center', originY: 'center', text, fontFamily: 'Montserrat', fontWeight: 400, fontSize: 60, fill: '#ffffff',
  textAlign: 'center', lineHeight: 1.1, charSpacing: 0, name: text.split('\n')[0].slice(0, 24), ...p });
const img = (src, cx, cy, s, extra = {}) => ({ type: 'image', version: '5.3.0', originX: 'center', originY: 'center', left: cx, top: cy, width: 1080, height: 1350, scaleX: s, scaleY: s, src, crossOrigin: null, ...extra });
const clipR = (x, y, w, h) => ({ type: 'rect', version: '5.3.0', originX: 'left', originY: 'top', left: x, top: y, width: w, height: h, fill: '#000', strokeWidth: 0, absolutePositioned: true });
const page = (bg, objects) => ({ version: '5.3.0', background: bg, objects });
const paperRect = (W, H, src) => ({ type: 'rect', version: '5.3.0', left: 0, top: 0, width: W, height: H, strokeWidth: 0, fill: { type: 'pattern', source: src, repeat: 'repeat' }, name: 'Paper', pfRole: 'bg', selectable: false, evented: false, locked: true, hasControls: false });
const counter = (W, t, color = '#ffffff', font = 'Cormorant Garamond') => txt(t, { left: W - 80, top: 70, fontFamily: font, fontSize: 30, fill: color, pfRole: 'pageNo', name: 'Page number', charSpacing: 80 });

/** Three stacked strips with black gaps; the middle strip's subject breaks out over the strip edges. */
export function threeStrip(W = 1080, H = 1920) {
  const g = 26, sh = (H - g * 4) / 3; const strips = [0, 1, 2].map((i) => ({ x: g, y: g + i * (sh + g), w: W - g * 2, h: sh }));
  const srcs = ['templates/misty-mountains.webp', V + 'balloon-dusk-photo.webp', 'templates/sea-aerial.webp'];
  const objs = strips.map((r, i) => { const s = Math.max(r.w / 1080, r.h / 1350); const cy = i === 1 ? r.y + r.h / 2 + (675 - 760) * 1.0 * s : r.y + r.h / 2;
    return img(srcs[i], r.x + r.w / 2, cy, s, { clipPath: clipR(r.x, r.y, r.w, r.h), name: `Strip ${i + 1} photo`, pfRole: i === 1 ? 'stripPhoto' : undefined }); });
  // middle strip: balloon photo + its cutout with the same transform; the balloon rises out over the top strip
  const S = Math.max(1, (strips[1].w + 2) / 1080); const r1 = strips[1]; const balloonTop = r1.y - r1.h * 0.5;
  const cy = Math.max(r1.y + r1.h - 1350 * S / 2, balloonTop + (675 - 430) * S);
  objs[1] = { ...img(V + 'balloon-dusk-photo.webp', W / 2, cy, S), clipPath: clipR(r1.x, r1.y, r1.w, r1.h), name: 'Strip 2 photo', pfRole: 'stripPhoto' };
  const sub = img(V + 'balloon-dusk-subject.webp', W / 2, cy, S, { name: 'Subject cutout', pfRole: 'subject', pfAlpha: true });
  const title = txt('AWAKEN', { left: W / 2, top: strips[1].y + strips[1].h * 0.84, fontFamily: 'Playfair Display', fontWeight: 900, fontSize: 132, fill: '#ffd21f', charSpacing: 40,
    shadow: { color: 'rgba(0,0,0,0.55)', blur: 22, offsetX: 0, offsetY: 6 } });
  const subT = txt('A JOURNEY INWARD', { left: W / 2, top: strips[1].y + strips[1].h * 0.84 + 74, fontFamily: 'Cinzel', fontWeight: 400, fontSize: 26, charSpacing: 520, fill: '#ffffff',
    shadow: { color: 'rgba(0,0,0,0.6)', blur: 10, offsetX: 0, offsetY: 2 } });
  return [page('#000000', [...objs, title, subT, sub])];
}
/** Big thin title behind the lifted subject + handwritten line + 1/10 counter, muted film grade. */
export function textBehind(W = 1080, H = 1350) {
  const ph = img(V + 'balloon-sky-muted-photo.webp', W / 2, H / 2, Math.max(W / 1080, H / 1350), { name: 'Photo (Matte film)', pfRole: 'bg', locked: true, selectable: false, evented: false, hasControls: false });
  const sub = img(V + 'balloon-sky-muted-subject.webp', W / 2, H / 2, Math.max(W / 1080, H / 1350), { name: 'Subject cutout', pfRole: 'subject', pfAlpha: true });
  const title = txt('SKYWARD', { left: W / 2, top: H * 0.36, fontFamily: 'Raleway', fontWeight: 200, fontSize: W * 0.175, charSpacing: 40, fill: '#fbf7ef', pfBehind: true, opacity: 0.96 });
  const hand = txt('somewhere above the noise', { left: W / 2, top: H * 0.9, fontFamily: 'Caveat', fontSize: W * 0.05, fill: '#fbf7ef', angle: -3 });
  return [page('#8fa3b0', [ph, title, sub, hand, counter(W, '1/10', '#fbf7ef', 'Raleway'), { type: 'rect', version: '5.3.0', left: 0, top: 0, width: W, height: H, fill: { type: 'pattern', source: 'templates/grain.webp', repeat: 'repeat' },
    opacity: 0.22, globalCompositeOperation: 'overlay', name: 'Film grain', selectable: false, evented: false, locked: true, hasControls: false, strokeWidth: 0 }])];
}
// ---- Malayalam lettering ----
const swash = (cx, cy, w, color, flip = false) => ({ type: 'path', version: '5.3.0', originX: 'center', originY: 'center', left: cx, top: cy, scaleX: w / 720, scaleY: (w / 720) * (flip ? -1 : 1),
  path: [['M', 0, 20], ['C', 120, -30, 220, 50, 330, 14], ['C', 360, 4, 372, -10, 360, -20], ['C', 346, -30, 330, -12, 346, 0], ['C', 380, 26, 470, -6, 560, 6], ['C', 640, 16, 690, 30, 720, 20]],
  fill: '', stroke: color, strokeWidth: 6, strokeLineCap: 'round', strokeLineJoin: 'round', name: 'Swash' });
const diamond = (cx, cy, s, color) => ({ type: 'rect', version: '5.3.0', originX: 'center', originY: 'center', left: cx, top: cy, width: s, height: s, angle: 45, fill: color, strokeWidth: 0, name: 'Ornament' });
function lettering({ W, H, bg, paper, word, sub, font, weight = 700, size, fill, stroke, sw, sh1, sh2, warp, amt, deco, subColor, subFont = 'Cinzel', photo }) {
  const objs = [];
  if (photo) objs.push(img(photo, W / 2, H / 2, Math.max(W / 1080, H / 1350), { name: 'Background photo', pfRole: 'bg', locked: true, selectable: false, evented: false, hasControls: false }), { type: 'rect', version: '5.3.0', left: 0, top: 0, width: W, height: H, fill: 'rgba(0,0,0,0.38)', strokeWidth: 0, name: 'Shade', selectable: false, evented: false, locked: true });
  if (paper) objs.push(paperRect(W, H, paper));
  const t = txt(word, { left: W / 2, top: H * 0.47, fontFamily: font, fontWeight: weight, fontSize: size, fill, stroke, strokeWidth: sw, paintFirst: 'stroke', strokeLineJoin: 'round',
    shadow: sh1, pfShadow2: sh2, pfWarp: warp === 'none' ? null : warp, pfWarpAmt: amt, lineHeight: 1.2, name: 'Malayalam title', pfRole: 'lettering' });
  if (typeof fill === 'string' && fill.startsWith('tex:')) { t.fill = { type: 'pattern', source: fill.slice(4), repeat: 'repeat' }; t.pfFillMode = 'photo'; }
  objs.push(t);
  const lines = String(word).split('\n').length; const half = size * (0.55 * lines + 0.25); const ty = t.top;
  if (deco) objs.push(...deco(ty - half, ty + half));
  if (sub) objs.push(txt(sub, { left: W / 2, top: Math.min(H - 80, ty + half + (deco ? 95 : 70)), fontFamily: subFont, fontSize: 30, charSpacing: 380, fill: subColor || '#f3e7c9', name: 'Subtitle' }));
  return [page(bg, objs)];
}
export const ML_LETTERING = [
  ['ml-letter-green', 'ഓണാശംസകൾ · cream on green', { bg: '#163828', paper: V + 'paper-green.webp', word: 'ഓണാശംസകൾ', sub: 'HAPPY ONAM', font: 'RIT Bahadur', size: 190, fill: 'tex:' + V + 'texture-cream.webp', stroke: '#0b2117', sw: 14,
    sh1: { color: 'rgba(0,0,0,0.55)', blur: 24, offsetX: 0, offsetY: 14 }, sh2: { color: '#c9a24a', blur: 0, offsetX: 6, offsetY: 6 }, warp: 'arc', amt: 8,
    deco: (a, b) => [swash(540, a, 640, '#f0e2be'), swash(540, b, 640, '#f0e2be', true), diamond(540, a - 50, 18, '#c9a24a'), diamond(540, b + 160, 18, '#c9a24a')] }],
  ['ml-letter-maroon', 'സ്നേഹപൂർവ്വം · gold on maroon', { bg: '#58141c', paper: V + 'paper-maroon.webp', word: 'സ്നേഹപൂർവ്വം', sub: 'WITH LOVE', font: 'RIT Keram', size: 150, fill: 'tex:' + V + 'texture-gold.webp', stroke: '#2a0609', sw: 12,
    sh1: { color: 'rgba(0,0,0,0.6)', blur: 20, offsetX: 0, offsetY: 12 }, sh2: { color: '#f3d9a0', blur: 0, offsetX: -4, offsetY: -4 }, warp: 'arc', amt: 8,
    deco: (a, b) => [swash(540, a, 560, '#d8b25a'), swash(540, b, 560, '#d8b25a', true)], subColor: '#e9cf8f' }],
  ['ml-letter-navy', 'ഉത്സവം · yellow outline', { bg: '#121e3a', paper: V + 'paper-navy.webp', word: 'ഉത്സവം', sub: 'FESTIVAL NIGHTS', font: 'Baloo Chettan 2', size: 240, fill: '#ffffff', stroke: '#ffd21f', sw: 18,
    sh1: { color: 'rgba(0,0,0,0.7)', blur: 0, offsetX: 10, offsetY: 12 }, sh2: { color: '#ff4e8a', blur: 0, offsetX: 18, offsetY: 22 }, warp: 'arc', amt: 12, subColor: '#ffd21f', subFont: 'Bebas Neue' }],
  ['ml-letter-cream', 'കഥ തുടരുന്നു · ink on ivory', { bg: '#f3eddf', paper: V + 'paper-ivory.webp', word: 'കഥ\nതുടരുന്നു', sub: 'THE STORY CONTINUES', font: 'Noto Serif Malayalam', weight: 700, size: 140, fill: '#6b1d24', stroke: '#fbf6ea', sw: 6,
    sh1: { color: 'rgba(60,30,20,0.35)', blur: 18, offsetX: 0, offsetY: 10 }, sh2: { color: '#d9b77a', blur: 0, offsetX: 5, offsetY: 5 }, warp: 'arc', amt: 6,
    deco: (a, b) => [swash(540, a, 520, '#6b1d24'), swash(540, b, 520, '#6b1d24', true), swash(540, b + 150, 300, '#b08a4a'), diamond(540, a - 46, 14, '#b08a4a')], subColor: '#6b1d24' }],
  ['ml-letter-sunset', 'നാട്ടുവഴികൾ · gold on dusk', { bg: '#1a1020', photo: 'templates/dusk-hills.webp', word: 'നാട്ടുവഴികൾ', sub: 'VILLAGE ROADS', font: 'RIT Sundar', size: 165, fill: 'tex:' + V + 'texture-gold.webp', stroke: '#1a0e08', sw: 12,
    sh1: { color: 'rgba(0,0,0,0.75)', blur: 26, offsetX: 0, offsetY: 14 }, sh2: { color: '#fff1c8', blur: 0, offsetX: 0, offsetY: -5 }, warp: 'arc', amt: 10 }],
  ['ml-letter-neon', 'രാവിലെ · neon double glow', { bg: '#07070c', word: 'രാവിലെ', sub: 'GOOD MORNING', font: 'Chilanka', weight: 400, size: 230, fill: '#e9fbff', stroke: '#19d3ff', sw: 6,
    sh1: { color: 'rgba(25,211,255,0.95)', blur: 34, offsetX: 0, offsetY: 0 }, sh2: { color: 'rgba(255,78,138,0.9)', blur: 26, offsetX: 8, offsetY: 8 }, warp: 'wave', amt: 8, subColor: '#19d3ff', subFont: 'Space Mono' }],
];

let added = false;
export function addTemplates() {
  if (added) return; added = true;
  const add = (id, name, cat, size, lang, build) => TEMPLATES.push({ id, name, cat, size, lang, build: () => { const [W, H] = SIZES[size]; return { w: W, h: H, pages: build(W, H) }; } });
  add('popout-frame-post', 'Pop-out frame', 'Pop-out', 'post', 'en', (W, H) => [popoutTemplatePage(W, H)]);
  add('popout-frame-story', 'Pop-out frame (story)', 'Pop-out', 'story', 'en', (W, H) => [popoutTemplatePage(W, H, { words: { title: 'ABOVE IT ALL', note: 'a slow morning, a light heart', script: 'fly high', counter: '02 / 05' } })]);
  add('strip3-awaken', 'Three-strip story', 'Pop-out', 'story', 'en', (W, H) => threeStrip(W, H));
  add('text-behind-skyward', 'Text behind subject', 'Pop-out', 'post', 'en', (W, H) => textBehind(W, H));
  for (const [id, name, o] of ML_LETTERING) add(id, name, 'Lettering', 'square', 'ml', (W, H) => lettering({ W, H, ...o, size: o.size * (W / 1080) }));
  for (const c of ['Pop-out', 'Lettering']) if (!TEMPLATE_CATS.includes(c)) TEMPLATE_CATS.push(c);
}

// ---- double shadow + texture fills for text (pfShadow2, pfTexture) ----
export function installTextExtras() {
  const T = fabric.Text.prototype; const render0 = T.render;
  T.render = function (ctx) {
    if (this.pfShadow2 && this.visible !== false) {
      const keep = this.shadow; this.shadow = new fabric.Shadow(this.pfShadow2);
      try { render0.call(this, ctx); } finally { this.shadow = keep; }
    }
    return render0.call(this, ctx);
  };
}
