// 2.1 (2.0 audit fix) text on a custom path: draw a line with your finger and the text follows it.
/* global fabric */
import { el, toast } from '../ui.js';
import { haptic } from '../native.js';
import { normalisePath, setWarp } from '../v2/textfx.js';

const PF = () => window.PF;
/** Puts `o` on a path given in canvas (scene) coordinates. */
export function applyPath(o, scenePts) {
  const pf = PF(); const n = normalisePath(scenePts); if (!n) return false;
  const sx = Math.abs(o.scaleX || 1);
  // size the text so its flat width matches the drawn length
  const flatW = (o._pfFlat && o._pfFlat.w) || o.width; const k = (n.length / sx) / Math.max(1, flatW);
  o.set({ angle: 0, fontSize: Math.max(8, Math.min(PF().state.W * 0.4, o.fontSize * k)), pfPath: n.pts });
  setWarp(o, 'path', 100);
  const xs = scenePts.map((p) => p[0]), ys = scenePts.map((p) => p[1]);
  o.setPositionByOrigin(new fabric.Point((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2), 'center', 'center'); o.setCoords();
  pf.canvas.requestRenderAll(); pf.history.record(); return true;
}
export function drawPathMode(o) {
  const pf = PF(); if (!pf.isText(o)) return Promise.resolve(false);
  const up = pf.canvas.upperCanvasEl; const r = up.getBoundingClientRect();
  const ov = el('canvas', { class: 'path-draw', id: 'pathDraw' }); ov.width = Math.round(r.width); ov.height = Math.round(r.height);
  ov.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:80;touch-action:none`;
  const hint = el('div', { class: 'path-hint', id: 'pathHint' }, el('span', { text: 'Draw the path for your text' }), el('button', { class: 'btn-ghost', id: 'pathCancel', text: 'Cancel' }));
  document.body.append(ov, hint); pf.closePanel?.();
  const ctx = ov.getContext('2d'); ctx.lineWidth = 4; ctx.strokeStyle = '#ffb347'; ctx.lineCap = 'round'; ctx.setLineDash([10, 8]);
  const inv = fabric.util.invertTransform(pf.canvas.viewportTransform);
  const toScene = (cx, cy) => { const zx = pf.canvas.getWidth() / r.width; const p = fabric.util.transformPoint(new fabric.Point((cx - r.left) * zx, (cy - r.top) * zx), inv); return [p.x, p.y]; };
  return new Promise((resolve) => {
    let pts = [], screen = [];
    const done = (ok) => { ov.remove(); hint.remove(); resolve(ok); };
    hint.querySelector('#pathCancel').onclick = () => done(false);
    ov.addEventListener('pointerdown', (e) => { ov.setPointerCapture?.(e.pointerId); pts = [toScene(e.clientX, e.clientY)]; screen = [[e.clientX - r.left, e.clientY - r.top]]; });
    ov.addEventListener('pointermove', (e) => { if (!pts.length) return; pts.push(toScene(e.clientX, e.clientY)); screen.push([e.clientX - r.left, e.clientY - r.top]);
      ctx.clearRect(0, 0, ov.width, ov.height); ctx.beginPath(); screen.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); });
    ov.addEventListener('pointerup', () => { const ok = pts.length > 3 && applyPath(o, pts); if (!ok) toast('Draw a longer line'); else haptic('confirm'); done(ok); });
  });
}
/** Adds the "Path" chip to the Text effects pane (Straight / Arc / Wave / Circle / Path). */
export function installPathChip() {
  const row = document.getElementById('tyWarp'); if (!row || row.querySelector('[data-warp="path"]')) return;
  const b = el('button', { class: 'chip rip', 'data-warp-path': '1', id: 'tyPathBtn', text: '✎ Draw path' });
  b.onclick = (e) => { e.stopPropagation(); const o = PF().active(); if (!PF().isText(o)) return; haptic(); drawPathMode(o); };
  row.append(b);
}
