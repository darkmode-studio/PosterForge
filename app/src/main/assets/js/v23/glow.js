// PosterForge 2.3.1: glow and drop shadow are SEPARATE effects.
// Data: o.shadow (fabric.Shadow) = drop shadow, exactly as before; o.pfGlow = { on, color, blur, opacity } = glow.
// Old (<= 2.3.0) projects stored glow as pfGlow: '<colour>' + an offset-0 o.shadow; migrateGlow() converts that.
// Rendering: fabric applies o.shadow on the destination context inside render() (also for cached objects, where the
// cache bitmap is drawn with the shadow), so the glow is an extra pass of the same render() with a glow shadow whose
// object is pushed far off-canvas while its shadow is offset back into place: only the halo is painted, the object
// itself is painted once by the normal pass (no double alpha). No cache padding is needed for the same reason.
// API/data shape follows a Gemini draft (window.PosterForgeEffects); render core rewritten.
const OFF = 100000; // device px; far beyond any canvas (4K export included)
const isHex = (c) => typeof c === 'string' && c.trim() !== '';
const num = (v, d) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
export const GLOW_DEFAULT = { on: false, color: '#ff2bd6', blur: 28, opacity: 1 };

/** Normalised glow settings of an object (never mutates). */
export function glowOf(o) {
  const g = o && o.pfGlow;
  if (!g) return null;
  if (typeof g === 'string') return { on: true, color: g, blur: o.shadow && !o.shadow.offsetX && !o.shadow.offsetY ? num(o.shadow.blur, 28) : 28, opacity: 1 };
  if (typeof g !== 'object') return null;
  return { on: g.on !== false, color: isHex(g.color) ? g.color : GLOW_DEFAULT.color, blur: Math.max(0, num(g.blur, GLOW_DEFAULT.blur)), opacity: Math.min(1, Math.max(0, num(g.opacity, 1))) };
}
export const glowOn = (o) => { const g = glowOf(o); return !!(g && g.on && g.blur > 0 && g.opacity > 0); };

/** Convert an old single-slot glow (pfGlow string + offset-0 shadow) into the new separate settings. Idempotent. */
export function migrateGlow(o) {
  if (!o) return false;
  let changed = false;
  if (typeof o.pfGlow === 'string') {
    const g = glowOf(o);
    // the old glow lived in the shadow slot: that shadow was the glow, not a drop shadow
    if (o.shadow && !o.shadow.offsetX && !o.shadow.offsetY) o.shadow = null;
    o.pfGlow = g; o.dirty = true; changed = true;
  }
  (o._objects || []).forEach((c) => { if (migrateGlow(c)) changed = true; });
  return changed;
}
export function migrateCanvas(canvas) { let n = 0; canvas.getObjects().forEach((o) => { if (migrateGlow(o)) n++; }); return n; }

/** Settings setters (always assign a NEW object: clones share pfGlow by reference). */
export function applyGlow(o, settings = {}) {
  if (!o) return;
  const cur = glowOf(o) || GLOW_DEFAULT;
  if (typeof o.pfGlow === 'string') migrateGlow(o);
  const g = {}; for (const k of ['on', 'color', 'blur', 'opacity']) g[k] = settings[k] === undefined ? cur[k] : settings[k];
  if (settings.on === undefined && !glowOf(o)) g.on = true;
  o.set('pfGlow', glowOf({ pfGlow: g })); o.dirty = true; o.canvas && o.canvas.requestRenderAll();
}
export function applyShadow(o, settings = {}) {
  if (!o) return;
  if (settings.on === false) { o.set('shadow', null); o.dirty = true; o.canvas && o.canvas.requestRenderAll(); return; }
  const s = o.shadow || {};
  const color = isHex(settings.color) ? settings.color : s.color || 'rgba(0,0,0,0.5)';
  const op = settings.opacity === undefined ? null : Math.min(1, Math.max(0, num(settings.opacity, 1)));
  o.set('shadow', new fabric.Shadow({ color: op === null ? color : withAlpha(color, op), blur: num(settings.blur, num(s.blur, 10)),
    offsetX: num(settings.offsetX, num(s.offsetX, 0)), offsetY: num(settings.offsetY, num(s.offsetY, 5)) }));
  o.dirty = true; o.canvas && o.canvas.requestRenderAll();
}
export function clearEffects(o) { if (!o) return; o.set({ pfGlow: null, shadow: null }); o.dirty = true; o.canvas && o.canvas.requestRenderAll(); }

function withAlpha(color, a) { try { const c = new fabric.Color(color); return c.setAlpha(c.getAlpha() * a).toRgba(); } catch (_) { return color; } }
// one fabric.Shadow per object, rebuilt only when the settings change (no per-frame allocation)
function glowShadow(o, g) {
  const key = g.color + '|' + g.blur + '|' + g.opacity;
  if (!o.__pfGlowSh || o.__pfGlowKey !== key) { o.__pfGlowSh = new fabric.Shadow({ color: withAlpha(g.color, g.opacity), blur: g.blur, offsetX: 0, offsetY: 0, affectStroke: true }); o.__pfGlowKey = key; }
  return o.__pfGlowSh;
}

let installed = false;
/** Call once after every other render wrapper is installed (v22 text extras, v23 text pro). */
export function installGlow() {
  if (installed) return; installed = true;
  const O = fabric.Object.prototype;
  const setShadow0 = O._setShadow;
  O._setShadow = function (ctx) {
    setShadow0.call(this, ctx);
    if (this.__pfGlowPass && this.shadow) { // paint the object off-canvas, its glow back in place
      const m = ctx.getTransform(); ctx.setTransform(m.a, m.b, m.c, m.d, m.e - OFF, m.f); ctx.shadowOffsetX += OFF;
    }
  };
  const wrap = (proto) => {
    const render0 = proto.render;
    proto.render = function (ctx) {
      if (this.__pfGlowPass || this.__pfInRender || this.visible === false) return render0.call(this, ctx);
      if (typeof this.pfGlow === 'string') migrateGlow(this);
      this.__pfInRender = true;
      try {
        if (glowOn(this)) {
          const keep = { shadow: this.shadow, sel: this.selectionBackgroundColor, sh2: this.pfShadow2 };
          this.__pfGlowPass = true; this.shadow = glowShadow(this, glowOf(this)); this.selectionBackgroundColor = ''; this.pfShadow2 = null;
          try { render0.call(this, ctx); } finally { this.__pfGlowPass = false; this.shadow = keep.shadow; this.selectionBackgroundColor = keep.sel; this.pfShadow2 = keep.sh2; }
        }
        return render0.call(this, ctx);
      } finally { this.__pfInRender = false; }
    };
  };
  // subclasses that define their own render() (e.g. Text after the v22 double-shadow wrapper) must be wrapped too
  const protos = new Set([O]);
  for (const k of Object.keys(fabric)) { const C = fabric[k]; const p = C && C.prototype; if (p && p instanceof fabric.Object && Object.prototype.hasOwnProperty.call(p, 'render')) protos.add(p); }
  protos.forEach(wrap);
  window.PosterForgeEffects = { applyGlow, applyShadow, clearEffects, migrateOld: migrateGlow, glowOf };
}
