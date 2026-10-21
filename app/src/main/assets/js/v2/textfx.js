// Text effects: curved text / text on a path (arc, wave, circle), rendered by warping the browser-shaped line image
// column by column. Shaping (incl. Malayalam conjuncts, HarfBuzz in the WebView) happens before the warp, so it is never broken.
/* global fabric */
const T = fabric.Text.prototype;
const baseInit = T.initDimensions, baseRender = T._render, baseToSVG = T.toSVG, baseToObject = T.toObject;
export const WARPS = ['none', 'arc', 'wave', 'circle', 'path'];
const isWarped = (o) => o.pfWarp && o.pfWarp !== 'none' && (o.pfWarp === 'path' ? Array.isArray(o.pfPath) && o.pfPath.length >= 2 : (o.pfWarp === 'circle' || Number(o.pfWarpAmt)));
/** 2.1 text on a custom path: pfPath = [[x,y],...] normalised so the polyline length is 1; the text's flat width is laid along it. */
function pathMapper(pts, W) {
  const P = pts.map(([x, y]) => [x * W, y * W]); const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = cum[cum.length - 1] || 1;
  const ang = (i) => Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]);
  return (x) => {
    const s = Math.max(0, Math.min(L, ((x + W / 2) / W) * L));
    let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const seg = cum[i] - cum[i - 1] || 1; const t = (s - cum[i - 1]) / seg;
    let a = ang(i - 1);
    // smooth the angle across joints
    if (t < 0.5 && i > 1) { const a0 = ang(i - 2); let d = a - a0; d = Math.atan2(Math.sin(d), Math.cos(d)); a = a0 + d * (0.5 + t); }
    else if (t >= 0.5 && i < P.length - 1) { const a1 = ang(i); let d = a1 - a; d = Math.atan2(Math.sin(d), Math.cos(d)); a = a + d * (t - 0.5); }
    return { x: P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, y: P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, a };
  };
}
/** Resamples a drawn polyline to n evenly spaced points, normalised to length 1 and centred. */
export function normalisePath(raw, n = 40) {
  const pts = raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 0.5);
  if (pts.length < 2) return null;
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1]; if (L < 10) return null;
  const out = []; let j = 1;
  for (let k = 0; k < n; k++) { const s = (L * k) / (n - 1); while (j < cum.length - 1 && cum[j] < s) j++; const t = (s - cum[j - 1]) / ((cum[j] - cum[j - 1]) || 1);
    out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t]); }
  const cx = out.reduce((a, p) => a + p[0], 0) / n, cy = out.reduce((a, p) => a + p[1], 0) / n;
  return { pts: out.map(([x, y]) => [+((x - cx) / L).toFixed(5), +((y - cy) / L).toFixed(5)]), length: L, cx, cy };
}

// Maps flat x (centered, -W/2..W/2) to { x, y, a } (position of the column's vertical centre, rotation).
function mapper(o, W, H) {
  if (o.pfWarp === 'path' && Array.isArray(o.pfPath) && o.pfPath.length >= 2) return pathMapper(o.pfPath, W);
  const amt = Number(o.pfWarpAmt) || 0;
  if (o.pfWarp === 'arc' || o.pfWarp === 'circle') {
    const theta = o.pfWarp === 'circle' ? 2 * Math.PI * 0.97 * (amt < 0 ? -1 : 1) : (amt / 100) * Math.PI * 1.6;
    if (Math.abs(theta) < 1e-3) return (x) => ({ x, y: 0, a: 0 });
    const R = W / theta;
    return (x) => { const a = x / R; return { x: R * Math.sin(a), y: R * (1 - Math.cos(a)), a }; };
  }
  if (o.pfWarp === 'wave') {
    const A = (amt / 100) * H * 1.2, lam = W / 1.5;
    return (x) => ({ x, y: A * Math.sin((2 * Math.PI * x) / lam), a: Math.atan((A * 2 * Math.PI / lam) * Math.cos((2 * Math.PI * x) / lam)) });
  }
  return (x) => ({ x, y: 0, a: 0 });
}
function warpBounds(o, W, H) {
  const m = mapper(o, W, H); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const p = m(-W / 2 + (W * i) / N);
    for (const s of [-1, 1]) { const px = p.x - Math.sin(p.a) * (s * H / 2), py = p.y + Math.cos(p.a) * (s * H / 2); x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
  }
  return { x0, y0, x1, y1 };
}
T.initDimensions = function () {
  baseInit.call(this);
  this._pfFlat = { w: this.width, h: this.height };
  if (isWarped(this)) {
    const b = warpBounds(this, this.width, this.height);
    this._pfOff = { x: -(b.x0 + b.x1) / 2, y: -(b.y0 + b.y1) / 2 };
    this.width = Math.max(1, b.x1 - b.x0); this.height = Math.max(1, b.y1 - b.y0);
  } else this._pfOff = null;
};
function flatCanvas(o, scale) {
  const { w, h } = o._pfFlat; const pad = Math.ceil((o.strokeWidth || 0) + 4);
  const c = document.createElement('canvas');
  const k = Math.min(scale, 4096 / (w + 2 * pad), 4096 / (h + 2 * pad));
  c.width = Math.ceil((w + 2 * pad) * k); c.height = Math.ceil((h + 2 * pad) * k);
  const ctx = c.getContext('2d'); ctx.setTransform(k, 0, 0, k, c.width / 2, c.height / 2);
  const sw = o.width, sh = o.height; o.width = w; o.height = h;
  const shadow = o.shadow; o.shadow = null;
  try { o._setFillStyles?.(ctx, o); baseRender.call(o, ctx); } finally { o.width = sw; o.height = sh; o.shadow = shadow; }
  return { c, k, pad };
}
T._render = function (ctx) {
  if (!isWarped(this) || !this._pfFlat) return baseRender.call(this, ctx);
  const m = ctx.getTransform(); const sc = Math.max(1, Math.hypot(m.a, m.b) * 1.25);
  const { c, k, pad } = flatCanvas(this, sc);
  const { w, h } = this._pfFlat; const map = mapper(this, w, h); const off = this._pfOff || { x: 0, y: 0 };
  // warp into an intermediate canvas so a shadow/glow is cast once by the whole shape
  const W2 = Math.ceil((this.width + 2 * pad) * k), H2 = Math.ceil((this.height + 2 * pad) * k);
  const t = document.createElement('canvas'); t.width = W2; t.height = H2; const tc = t.getContext('2d');
  tc.setTransform(k, 0, 0, k, W2 / 2, H2 / 2);
  const cols = Math.ceil(w * k), colW = 1 / k, fullH = h + 2 * pad;
  for (let i = 0; i < cols; i++) {
    const fx = -w / 2 + (i + 0.5) * colW; const p = map(fx);
    tc.save(); tc.translate(p.x + off.x, p.y + off.y); tc.rotate(p.a);
    tc.drawImage(c, (pad + w / 2 + fx) * k - 0.5, 0, 1.6, c.height, -colW * 0.8, -fullH / 2, colW * 1.6, fullH);
    tc.restore();
  }
  ctx.drawImage(t, -(this.width / 2 + pad), -(this.height / 2 + pad), this.width + 2 * pad, this.height + 2 * pad);
};
T.toSVG = function (reviver) {
  if (!isWarped(this)) return baseToSVG.call(this, reviver);
  const { c, k, pad } = (() => { const r = flatCanvas(this, 2); return r; })();
  // rasterise the warped result for SVG (vector curved text is not supported)
  const W2 = Math.ceil((this.width + 2 * pad) * 2), H2 = Math.ceil((this.height + 2 * pad) * 2);
  const out = document.createElement('canvas'); out.width = W2; out.height = H2; const oc = out.getContext('2d');
  oc.setTransform(2, 0, 0, 2, W2 / 2, H2 / 2); const sh = this.shadow; this.shadow = null;
  try { this._render(oc); } finally { this.shadow = sh; }
  void c; void k;
  const mtx = this.calcTransformMatrix().join(' ');
  return `<g transform="matrix(${mtx})"><image x="${-(this.width / 2 + pad)}" y="${-(this.height / 2 + pad)}" width="${this.width + 2 * pad}" height="${this.height + 2 * pad}" href="${out.toDataURL('image/png')}"/></g>`;
};
// Never cache warped text at a stale size
T.toObject = function (props) {
  try { return baseToObject.call(this, props); }
  catch (e) { // stale per-char styles that no longer match the text (e.g. after a programmatic text change): drop empty ones, then all
    const st = this.styles || {}; for (const l in st) { for (const c in st[l]) if (!st[l][c] || !Object.keys(st[l][c]).length) delete st[l][c]; if (!Object.keys(st[l]).length) delete st[l]; }
    try { return baseToObject.call(this, props); } catch (e2) { this.styles = {}; return baseToObject.call(this, props); }
  }
};

export function setWarp(o, kind, amt) {
  o.set({ pfWarp: kind === 'none' ? null : kind, pfWarpAmt: kind === 'none' ? 0 : amt });
  const c = o.getCenterPoint(); o.initDimensions(); o.setPositionByOrigin(c, 'center', 'center'); o.setCoords(); o.dirty = true;
}

// ---- fills ----
export function gradientFill(o, c1, c2, angle = 90) {
  const r = (angle * Math.PI) / 180; const dx = Math.cos(r) / 2, dy = Math.sin(r) / 2;
  return new fabric.Gradient({ type: 'linear', gradientUnits: 'percentage', coords: { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy },
    colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
}
export function textureFill(o, img) {
  const w = (o._pfFlat || o).w || o.width, h = (o._pfFlat || o).h || o.height;
  const k = Math.max(w / img.width, h / img.height);
  return new fabric.Pattern({ source: img, repeat: 'no-repeat', patternTransform: [k, 0, 0, k, -w / 2 + (w - img.width * k) / 2 + w / 2, (h - img.height * k) / 2] });
}
export function glowShadow(color, size) { return new fabric.Shadow({ color, blur: size, offsetX: 0, offsetY: 0 }); }
