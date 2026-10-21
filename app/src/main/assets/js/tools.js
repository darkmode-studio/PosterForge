// Offline tools: SVG sanitiser, image tracing, edge flood-fill cutout, text-to-outline, palette.

// Bundled fonts: generated manifest (build-fonts-v2.py). Licences: fonts/licenses/*.txt, listed in Settings → About.
import { FONT_DATA } from './fontdata.js';
export const FONT_GROUPS = ['Malayalam', 'Serif', 'Sans', 'Condensed', 'Display', 'Script', 'Handwriting', 'Retro'];
// Face key: "400" / "700i" etc.  faces: [{ w, italic, url, range? }]
export const parseFaceKey = (k) => ({ w: parseInt(k, 10) || 400, italic: /i$/.test(k) });
function facesOf(d) {
  const out = Object.entries(d.x || {}).map(([k, url]) => ({ ...parseFaceKey(k), url }));
  for (const [k, v] of Object.entries(d.v || {})) out.push({ w: v.wght[0], w2: v.wght[1], italic: k === 'vi', url: v.file, variable: true });
  return out.sort((a, b) => (a.italic - b.italic) || (a.w - b.w));
}
export const FONT_CATALOG = FONT_DATA.map((d) => ({ family: d.f, group: d.g, ml: !!d.ml, faces: facesOf(d), license: d.l, licenseFile: d.lf, source: d.s, modified: d.m, bundled: true }));
FONT_CATALOG.forEach((f) => { f.files = Object.fromEntries(f.faces.filter((x) => !x.italic).map((x) => [x.w, x.url])); });
export const LOCAL_FONTS = Object.fromEntries(FONT_CATALOG.map((f) => [f.family, f.files]));
export const FONT_FAMILIES = FONT_CATALOG.map((f) => f.family);
export const MALAYALAM_FONTS = new Set(FONT_CATALOG.filter((f) => f.ml).map((f) => f.family));
export const LATIN_ONLY = new Set(FONT_CATALOG.filter((f) => !f.ml).map((f) => f.family));
export const MALAYALAM_RE = /[\u0D00-\u0D7F]/;
export const fontEntry = (fam) => FONT_CATALOG.find((f) => f.family === fam) || null;
/** Real faces available for (weight, italic): exact match, else null (the browser then synthesises bold/oblique). */
export function hasFace(fam, w, italic) {
  const e = fontEntry(fam); if (!e) return false;
  return e.faces.some((f) => !!f.italic === !!italic && (f.variable ? w >= f.w && w <= f.w2 : Math.abs(f.w - w) < 100));
}
export function boldWeightFor(fam) {
  const e = fontEntry(fam); if (!e) return 700;
  const ws = e.faces.filter((f) => !f.italic).flatMap((f) => (f.variable ? [Math.min(700, f.w2)] : [f.w])).filter((w) => w >= 600);
  return ws.length ? Math.min(...ws) : 700;
}

let registered = false;
const faceRegistry = new Set();
function addFace(family, face) {
  const k = family + '|' + face.url + '|' + face.w + '|' + face.italic; if (faceRegistry.has(k)) return; faceRegistry.add(k);
  const src = face.buffer ? face.buffer : `url(${new URL(face.url, document.baseURI).href})`;
  try {
    const ff = new FontFace(family, src, { weight: face.variable ? `${face.w} ${face.w2}` : String(face.w), style: face.italic ? 'italic' : 'normal', display: 'block' });
    document.fonts.add(ff);
  } catch (e) { console.warn('font face', family, e); }
}
/** Registers every bundled face with document.fonts (unloaded: the browser fetches a file only when it is used = lazy loading). */
export function registerFonts() {
  if (registered || typeof FontFace === 'undefined') return; registered = true;
  for (const f of FONT_CATALOG) for (const face of f.faces) addFace(f.family, face);
}
/** Adds an imported (user) family at runtime. entry: { family, group, ml, faces:[{w, italic, buffer}] , user:true, id } */
export function addCatalogEntry(entry) {
  const old = FONT_CATALOG.findIndex((f) => f.family === entry.family);
  if (old >= 0) FONT_CATALOG.splice(old, 1);
  entry.files = Object.fromEntries(entry.faces.filter((x) => !x.italic).map((x) => [x.w, x.url || ('user:' + entry.family + ':' + x.w)]));
  FONT_CATALOG.push(entry); LOCAL_FONTS[entry.family] = entry.files;
  if (!FONT_FAMILIES.includes(entry.family)) FONT_FAMILIES.push(entry.family);
  if (entry.ml) { MALAYALAM_FONTS.add(entry.family); LATIN_ONLY.delete(entry.family); } else { LATIN_ONLY.add(entry.family); MALAYALAM_FONTS.delete(entry.family); }
  if (typeof FontFace !== 'undefined') for (const face of entry.faces) addFace(entry.family, face);
}
export function removeCatalogEntry(family) {
  const i = FONT_CATALOG.findIndex((f) => f.family === family && f.user); if (i < 0) return;
  FONT_CATALOG.splice(i, 1); delete LOCAL_FONTS[family]; const j = FONT_FAMILIES.indexOf(family); if (j >= 0) FONT_FAMILIES.splice(j, 1);
  MALAYALAM_FONTS.delete(family); LATIN_ONLY.delete(family);
}
/** Loads the given families (default: the few UI fonts) in every face. */
export async function loadAllFonts(families) {
  registerFonts();
  const specs = [];
  for (const fam of families || ['Montserrat', 'Poppins', 'Manjari']) {
    const e = fontEntry(fam); if (!e) continue;
    for (const f of e.faces) specs.push(`${f.italic ? 'italic ' : ''}${f.variable ? 400 : f.w} 40px "${fam}"`);
  }
  await Promise.all(specs.map((s) => document.fonts.load(s, 'Aa കേരളം').catch(() => null)));
}

// ---------------- SVG sanitiser ----------------
const ALLOWED = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan',
  'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'use', 'symbol', 'title', 'desc', 'image', 'pattern', 'style']);
const URL_ATTRS = new Set(['href', 'xlink:href', 'src']);

/** Pulls the first <svg>...</svg> out of an AI reply (handles ``` fences). Returns '' if none. */
export function extractSVG(text) {
  if (!text) return '';
  const m = String(text).match(/<svg[\s\S]*?<\/svg>/i);
  return m ? m[0] : '';
}

/**
 * Returns a clean, standalone SVG string, or throws. Removes scripts, event handlers, foreignObject, external
 * references and CSS url()/@import. Ensures xmlns and a viewBox.
 */
export function sanitizeSVG(input) {
  const raw = extractSVG(input) || String(input || '');
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid SVG');
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('Not an SVG');

  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8 || child.nodeType === 7) { child.remove(); continue; } // comments, processing instr.
      if (child.nodeType !== 1) continue;
      const name = child.localName.toLowerCase();
      if (!ALLOWED.has(name)) { child.remove(); continue; }
      if (name === 'style') {
        const css = child.textContent || '';
        if (/@import|url\s*\(\s*['"]?(?!#)|expression|javascript:/i.test(css)) { child.remove(); continue; }
      }
      for (const attr of [...child.attributes]) {
        const an = attr.name.toLowerCase();
        const v = attr.value.trim();
        if (an.startsWith('on')) { child.removeAttribute(attr.name); continue; }
        if (URL_ATTRS.has(an) || an.endsWith(':href')) {
          const ok = v.startsWith('#') || (name === 'image' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v));
          if (!ok) child.removeAttribute(attr.name);
          continue;
        }
        if (/javascript:|url\s*\(\s*['"]?(?!#)/i.test(v)) child.removeAttribute(attr.name);
      }
      if (name === 'image' && !child.getAttribute('href') && !child.getAttribute('xlink:href')) { child.remove(); continue; }
      walk(child);
    }
  };
  for (const attr of [...root.attributes]) if (attr.name.toLowerCase().startsWith('on')) root.removeAttribute(attr.name);
  walk(root);

  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!root.getAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width')) || 100, h = parseFloat(root.getAttribute('height')) || 100;
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  const out = new XMLSerializer().serializeToString(root);
  if (!/<(path|rect|circle|ellipse|line|polyline|polygon|text|image|use)\b/i.test(out)) throw new Error('SVG has no drawable shapes');
  return out;
}

export const svgToDataURL = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

// ---------------- image helpers ----------------
export function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot read that image')); };
    img.src = url;
  });
}

/** Draws an image into a canvas no larger than maxSide (keeps memory sane on phones). */
export function imageToCanvas(img, maxSide = 2048) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
export const canvasToBlob = (c, type = 'image/png', q) => new Promise((r) => c.toBlob(r, type, q));

// ---------------- tracing ----------------
export function traceCanvasToSVG(c, colors = 8) {
  const ctx = c.getContext('2d');
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const svg = ImageTracer.imagedataToSVG(data, {
    numberofcolors: colors, colorsampling: 2, mincolorratio: 0, colorquantcycles: 3, ltres: 1, qtres: 1, pathomit: 10,
    blurradius: 0, strokewidth: 0, linefilter: true, roundcoords: 1, viewbox: true, desc: false,
  });
  return sanitizeSVG(stripTransparentPaths(svg));
}
export async function traceImageFileToSVG(file, colors = 8) {
  const img = await fileToImage(file);
  return traceCanvasToSVG(imageToCanvas(img, 700), colors);
}
function stripTransparentPaths(svg) {
  return svg.replace(/<path[^>]*opacity="0(\.0+)?"[^>]*\/>/g, '');
}

// ---------------- cutout ----------------
/**
 * Edge flood fill: starts from every border pixel close to the dominant border colour and spreads inward through
 * pixels within `tolerance` of that colour. Interior pixels of the same colour that are enclosed by the subject are
 * kept. `feather` softens the edge. Works for plain / studio / smooth backgrounds only.
 */
export function cutoutCanvas(src, tolerance = 45, feather = 12) {
  const w = src.width, h = src.height;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  // dominant border colour: median of border samples per channel
  const rs = [], gs = [], bs = [];
  const sample = (x, y) => { const i = (y * w + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); };
  for (let x = 0; x < w; x += Math.max(1, w >> 7)) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y += Math.max(1, h >> 7)) { sample(0, y); sample(w - 1, y); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const R = med(rs), G = med(gs), B = med(bs);
  const dist = new Float32Array(w * h);
  for (let p = 0, i = 0; p < w * h; p++, i += 4) dist[p] = Math.hypot(d[i] - R, d[i + 1] - G, d[i + 2] - B);

  const bg = new Uint8Array(w * h); // 1 = background reached by the fill
  const queue = new Int32Array(w * h);
  let qh = 0, qt = 0;
  const seed = (p) => { if (!bg[p] && dist[p] <= tolerance) { bg[p] = 1; queue[qt++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) {
    const p = queue[qh++], x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < w * (h - 1)) seed(p + w);
  }
  for (let p = 0; p < w * h; p++) {
    if (bg[p]) { d[p * 4 + 3] = 0; continue; }
    if (feather > 0 && dist[p] < tolerance + feather) {
      const x = p % w;
      const touches = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (p >= w && bg[p - w]) || (p < w * (h - 1) && bg[p + w]);
      if (touches) d[p * 4 + 3] = Math.round(((dist[p] - tolerance) / feather) * d[p * 4 + 3]);
    }
  }
  ctx.putImageData(id, 0, 0);
  let removed = 0; for (let p = 0; p < w * h; p++) removed += bg[p];
  return { canvas: out, removedRatio: removed / (w * h), bgColor: `rgb(${R},${G},${B})` };
}

// ---------------- palette (offline) ----------------
export function extractPalette(img, k = 6) {
  const c = imageToCanvas(img, 96);
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const px = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) px.push([d[i], d[i + 1], d[i + 2]]);
  if (!px.length) return [];
  let cents = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * px.length / k)].slice());
  let counts = new Array(k).fill(0);
  for (let it = 0; it < 8; it++) {
    const sums = cents.map(() => [0, 0, 0]); counts = new Array(k).fill(0);
    for (const p of px) {
      let bi = 0, bd = Infinity;
      cents.forEach((c2, ci) => { const dd = (p[0] - c2[0]) ** 2 + (p[1] - c2[1]) ** 2 + (p[2] - c2[2]) ** 2; if (dd < bd) { bd = dd; bi = ci; } });
      sums[bi][0] += p[0]; sums[bi][1] += p[1]; sums[bi][2] += p[2]; counts[bi]++;
    }
    cents = cents.map((c2, ci) => (counts[ci] ? sums[ci].map((s) => s / counts[ci]) : c2));
  }
  const hex = (v) => Math.round(v).toString(16).padStart(2, '0');
  const seen = new Set();
  return cents.map((c2, i) => ({ c: '#' + c2.map(hex).join(''), n: counts[i] }))
    .sort((a, b) => b.n - a.n).map((x) => x.c).filter((x) => (seen.has(x) ? false : seen.add(x)));
}

// ---------------- text to outline ----------------
const fontCache = new Map();
async function loadOpenType(family, weight) {
  const files = LOCAL_FONTS[family] || LOCAL_FONTS.Montserrat;
  const url = files[weight >= 600 ? 700 : 400] || files[400];
  if (!fontCache.has(url)) {
    fontCache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error('Font missing: ' + url); return r.arrayBuffer(); })
      .then((b) => opentype.parse(b)));
  }
  return fontCache.get(url);
}

/**
 * Converts a fabric text object into vector paths.
 *  - Malayalam (or any text with Malayalam letters): waits for the web font, renders the object with the browser's
 *    shaping engine (HarfBuzz) at high resolution, then traces it. Conjuncts come out exactly as shown on screen.
 *  - Latin text: real glyph outlines from the bundled TTF through opentype.js.
 * Returns a fabric object placed exactly over the original.
 */
export async function convertFabricTextToVector(obj, { resolution } = {}) {
  const text = obj.text || '';
  if (!text.trim()) throw new Error('Text is empty');
  const weight = Number(obj.fontWeight === 'bold' ? 700 : obj.fontWeight || 400);
  const family = obj.fontFamily;
  const center = obj.getCenterPoint();
  const common = { originX: 'center', originY: 'center', left: center.x, top: center.y, angle: obj.angle,
    scaleX: obj.scaleX, scaleY: obj.scaleY, flipX: obj.flipX, flipY: obj.flipY, opacity: obj.opacity, shadow: obj.shadow };

  if (MALAYALAM_RE.test(text)) {
    await document.fonts.load(`${weight} ${Math.round(obj.fontSize)}px "${family}"`, text);
    if (!document.fonts.check(`${weight} ${Math.round(obj.fontSize)}px "${family}"`, text)) throw new Error(`Font ${family} did not load`);
    fabric.util.clearFabricFontCache(family);
    const clone = await new Promise((r) => obj.clone(r));
    clone.set({ fill: '#000000', stroke: null, strokeWidth: 0, shadow: null, angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, opacity: 1 });
    clone.initDimensions();
    // aim for ~360px tall glyphs, but cap the bitmap at ~16 megapixels
    let res = resolution || Math.max(4, Math.min(12, 360 / clone.fontSize));
    const area = clone.width * clone.height * res * res;
    if (area > 16e6) res = Math.sqrt(16e6 / (clone.width * clone.height));
    const c = clone.toCanvasElement({ multiplier: res });
    const ctx = c.getContext('2d');
    const id = ctx.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) { const on = d[i + 3] > 110; d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = on ? 255 : 0; }
    const svg = ImageTracer.imagedataToSVG(id, {
      pal: [{ r: 0, g: 0, b: 0, a: 0 }, { r: 0, g: 0, b: 0, a: 255 }], colorsampling: 0, numberofcolors: 2, colorquantcycles: 1,
      ltres: 0.2, qtres: 0.2, pathomit: Math.round(res * 2), blurradius: 0, strokewidth: 0, linefilter: false,
      rightangleenhance: false, scale: 1 / res, roundcoords: 2, viewbox: false, desc: false,
    });
    const W = c.width / res, H = c.height / res;
    // The frame rect keeps the group's box equal to the text box, so the outline lands exactly on the text.
    const clean = sanitizeSVG(stripTransparentPaths(svg).replace('<svg ', `<svg viewBox="0 0 ${W} ${H}" `)
      .replace(/(<svg[^>]*>)/, `$1<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="none"/>`));
    const group = await new Promise((resolve) => fabric.loadSVGFromString(clean, (objs, opts) => resolve(fabric.util.groupSVGElements(objs, opts))));
    const fill = obj.fill;
    (group._objects || [group]).forEach((o) => {
      if (o.type === 'rect') { o.set({ visible: false, fill: '', stroke: null }); return; }
      o.set({ fill, stroke: obj.stroke && obj.strokeWidth ? obj.stroke : null, strokeWidth: obj.strokeWidth || 0 });
    });
    // Size the outline to the rendered text box so it sits exactly where the text was
    group.set({ ...common, scaleX: obj.scaleX * (c.width / res) / group.width, scaleY: obj.scaleY * (c.height / res) / group.height });
    group.set('name', 'Outline: ' + text.slice(0, 18));
    return group;
  }

  const font = await loadOpenType(family, weight);
  await document.fonts.load(`${weight} ${Math.round(obj.fontSize)}px "${family}"`, text);
  obj.initDimensions();
  // Lay the glyphs out in the text object's own box, using Fabric's line metrics, so the outline lands on the text.
  const fs = obj.fontSize;
  const cmds = [];
  let y = 0;
  (obj._textLines || [text]).forEach((chars, i) => {
    const line = Array.isArray(chars) ? chars.join('') : String(chars);
    const hLine = obj.getHeightOfLine(i);
    const baseline = y + hLine / obj.lineHeight - (hLine / obj.lineHeight) * obj._fontSizeFraction;
    const lineW = obj.getLineWidth(i);
    const glyphW = font.getAdvanceWidth(line, fs);
    let x = obj._getLineLeftOffset(i);
    if (obj.textAlign === 'center') x += (lineW - glyphW) / 2; else if (obj.textAlign === 'right') x += lineW - glyphW;
    if (line.trim()) cmds.push(font.getPath(line, x, baseline, fs).toPathData(2));
    y += hLine;
  });
  const p = new fabric.Path(cmds.join(' ') || 'M0 0', {
    fill: obj.fill, stroke: obj.stroke && obj.strokeWidth ? obj.stroke : null, strokeWidth: obj.strokeWidth || 0, fillRule: 'nonzero',
  });
  const off = { x: p.pathOffset.x - obj.width / 2, y: p.pathOffset.y - obj.height / 2 };
  const pos = fabric.util.transformPoint(off, obj.calcTransformMatrix());
  p.set({ ...common, left: pos.x, top: pos.y, name: 'Outline: ' + text.slice(0, 18) });
  p.setCoords();
  return p;
}
