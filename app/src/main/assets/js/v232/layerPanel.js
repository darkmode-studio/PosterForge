// PosterForge 2.3.2 layer list (based on the Gemini draft "layerPanel.js", rewritten to use the app's own layer functions).
// Rows: 40px cached thumbnail, name + type line, visibility / lock / more. Tap = select (multi-select aware; locked layers
// are selectable ONLY from here, as in 2.1.1). Long-press 250 ms (or the grip) = drag to reorder with placeholder and
// edge auto-scroll. Swipe left = Duplicate / Delete. Groups expand to show their children.
/* global fabric */
import { el } from '../ui.js';
import { haptic } from '../native.js';

const PF = () => window.PF;
let box = null, cv = null, onChange = null;
const expanded = new WeakSet();
let openSwipe = null; // li with Duplicate/Delete revealed
let lastSig = '';
const SWIPE_W = 136, LONG_MS = 250, SLOP = 8;

const svgIcon = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#' + id); s.append(u); return s; };
const btn = (id, label, fn, cls = '') => el('button', { class: 'layer-btn rip ' + cls, 'aria-label': label, title: label, onclick: (e) => { e.stopPropagation(); fn(); } }, svgIcon(id));
const isGroupRow = (o) => o.type === 'group' && o.pfRole !== 'clip' && (o._objects || []).length > 0;
function title(o) {
  if (o.name) return String(o.name).replace(/\s+/g, ' ').slice(0, 40);
  if (o.text != null) { const t = String(o.text).trim().replace(/\s+/g, ' '); return t ? (t.length > 20 ? t.slice(0, 20) + '…' : t) : 'Empty text'; }
  return PF().typeLabel(o);
}
function sub(o) {
  const pf = PF(); const g = o.globalCompositeOperation;
  return pf.typeLabel(o) + (g && g !== 'source-over' ? ' · ' + pf.blendLabel(g) : '') + (o.pfMask ? ' · masked' : '') + (o.locked ? ' · locked' : '') + (o.visible === false ? ' · hidden' : '');
}
const selectedSet = () => { const a = cv.getActiveObject(); return a ? (a.type === 'activeSelection' ? a.getObjects() : [a]) : []; };
function changed() { cv.requestRenderAll(); PF().history.record(); if (onChange) onChange(); PF().refreshLayers(); }
function closeSwipe() { if (!openSwipe) return; openSwipe.querySelector('.layer-row').style.transform = ''; openSwipe.classList.remove('pf-swiped'); openSwipe = null; }

function syncSelection() {
  const sel = selectedSet();
  box.querySelectorAll('.layer-item').forEach((li) => { const on = sel.includes(li._obj) || (li._child && sel.includes(li._parent)); li.classList.toggle('active', !li._child && on); li.classList.toggle('pf-in-active', !!li._child && on); li.setAttribute('aria-selected', String(!li._child && sel.includes(li._obj))); });
}
// Structure signature: if only the selection changed we skip the rebuild (thumbnails are cached anyway).
function signature() {
  const out = [];
  const v = (o, d) => { out.push(d, o.type, title(o), sub(o), o.visible, o.locked, o.left, o.top, o.scaleX, o.angle, o.fill, o.width, o.height, expanded.has(o)); if (expanded.has(o)) (o._objects || []).forEach((k) => v(k, d + 1)); };
  cv.getObjects().forEach((o) => v(o, 0));
  const h = PF().history.undoStack; out.push(h.length, (h[h.length - 1] || '').length); // any recorded edit forces a rebuild
  return JSON.stringify(out);
}

function row(o, child, parent) {
  const pf = PF();
  const r = el('div', { class: 'layer-row' });
  if (!child) r.append(btn('i-grip', 'Drag to reorder', () => {}, 'grip'));
  if (isGroupRow(o) && !child) r.append(el('button', { class: 'layer-btn pf-expand' + (expanded.has(o) ? ' open' : ''), 'aria-label': expanded.has(o) ? 'Collapse group' : 'Expand group', 'aria-expanded': String(expanded.has(o)), text: '▸', onclick: (e) => { e.stopPropagation(); if (expanded.has(o)) expanded.delete(o); else expanded.add(o); build(true); } }));
  r.append(el('img', { class: 'layer-thumb', src: pf.thumbFor(o), alt: '', loading: 'lazy' }),
    el('div', { class: 'layer-name' }, el('span', { text: title(o) }), el('small', { text: sub(o) })));
  if (!child) r.append(
    btn(o.visible === false ? 'i-eyeoff' : 'i-eye', o.visible === false ? 'Show' : 'Hide', () => { o.set('visible', o.visible === false); if (!o.visible) cv.discardActiveObject(); changed(); }, 'pf-vis'),
    btn(o.locked ? 'i-lock' : 'i-unlock', o.locked ? 'Unlock' : 'Lock', () => { pf.setLocked(o, !o.locked); changed(); }, 'pf-lock' + (o.locked ? ' on' : '')),
    btn('i-more', 'More', () => pf.layerMenu(o), 'pf-more'));
  const li = el('li', { class: 'layer-item' + (child ? ' child' : '') + (o.locked ? ' locked' : '') + (o.visible === false ? ' hidden-layer' : ''), role: 'option' });
  if (!child) li.append(el('div', { class: 'pf-actions' },
    el('button', { class: 'pf-dup rip', text: 'Duplicate', onclick: (e) => { e.stopPropagation(); closeSwipe(); pf.duplicateObj(o).then(() => { if (onChange) onChange(); pf.refreshLayers(); }); } }),
    el('button', { class: 'pf-del rip', text: 'Delete', onclick: (e) => { e.stopPropagation(); closeSwipe(); pf.deleteObjects([o]); if (onChange) onChange(); } })));
  li.append(r); li._obj = o; li._child = !!child; li._parent = parent || null;
  r.addEventListener('click', () => { if (li._suppress) { li._suppress = false; return; } if (openSwipe) { closeSwipe(); return; } pf.selectFromLayer(child ? parent : o); });
  if (!child) gestures(li, r);
  return li;
}

// One pointer state machine per row so swipe and drag never fight: < 250 ms + horizontal = swipe; held 250 ms = drag;
// vertical movement before that = native scroll (we let go).
function gestures(li, r) {
  let st = null;
  const reset = () => { if (st) clearTimeout(st.timer); st = null; };
  r.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || cv.isDrawingMode) return;
    const onGrip = !!e.target.closest('.grip');
    if (e.target.closest('button') && !onGrip) return;
    if (openSwipe && openSwipe !== li) closeSwipe();
    st = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: null, base: li.classList.contains('pf-swiped') ? -SWIPE_W : 0 };
    if (onGrip) { e.preventDefault(); startDrag(li, e); reset(); return; }
    st.timer = setTimeout(() => { if (st && !st.mode) { st.mode = 'drag'; startDrag(li, { clientY: st.y, pointerId: st.id, target: r }); reset(); } }, LONG_MS);
  });
  r.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x, dy = e.clientY - st.y; // fixed: the draft read e.target.clientX
    if (!st.mode) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      clearTimeout(st.timer);
      if (Math.abs(dx) > Math.abs(dy)) { st.mode = 'swipe'; try { r.setPointerCapture(e.pointerId); } catch (_) {} r.style.transition = 'none'; }
      else { reset(); return; } // vertical = list scroll
    }
    if (st.mode === 'swipe') r.style.transform = `translateX(${Math.max(-SWIPE_W - 24, Math.min(0, st.base + dx))}px)`;
  });
  const end = (e) => {
    if (!st || (e && e.pointerId !== st.id)) return;
    if (st.mode === 'swipe') {
      const dx = (e ? e.clientX : st.x) - st.x; const pos = st.base + dx; r.style.transition = '';
      li._suppress = Math.abs(dx) > SLOP;
      if (pos < -SWIPE_W / 2) { r.style.transform = `translateX(${-SWIPE_W}px)`; li.classList.add('pf-swiped'); openSwipe = li; haptic('tick'); }
      else { r.style.transform = ''; li.classList.remove('pf-swiped'); if (openSwipe === li) openSwipe = null; }
    }
    reset();
  };
  r.addEventListener('pointerup', end); r.addEventListener('pointercancel', end);
}

let drag = null;
function scroller(n) { for (let p = n.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p).overflowY; if ((s === 'auto' || s === 'scroll') && p.scrollHeight > p.clientHeight) return p; } return document.scrollingElement; }
function startDrag(li, e) {
  if (drag) return;
  closeSwipe(); haptic('tick');
  const list = li.parentElement; const rect = li.getBoundingClientRect();
  // hide children of the dragged group; they move with it
  [...list.children].forEach((x) => { if (x._child && x._parent === li._obj) x.style.display = 'none'; });
  const ph = el('li', { class: 'pf-placeholder', 'aria-hidden': 'true' }); ph.style.height = rect.height + 'px';
  list.insertBefore(ph, li);
  Object.assign(li.style, { position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', zIndex: 50, pointerEvents: 'none' });
  li.classList.add('dragging', 'pf-dragging');
  drag = { li, list, ph, y0: e.clientY, top0: rect.top, y: e.clientY, sc: scroller(list), raf: 0 };
  const cap = e.target && e.target.setPointerCapture ? e.target : null; try { cap && cap.setPointerCapture(e.pointerId); } catch (_) {}
  const move = (ev) => { if (!drag) return; if (ev.cancelable) ev.preventDefault(); drag.y = ev.touches ? ev.touches[0].clientY : ev.clientY; place(); };
  const tm = (ev) => { if (drag && ev.cancelable) ev.preventDefault(); }; // stop the WebView from scrolling while dragging
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('touchmove', tm); finishDrag(); };
  window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  window.addEventListener('touchmove', tm, { passive: false });
  const tick = () => { if (!drag) return; const r = drag.sc === document.scrollingElement ? { top: 0, bottom: innerHeight } : drag.sc.getBoundingClientRect(); const edge = 48;
    const v = drag.y < r.top + edge ? -Math.ceil((r.top + edge - drag.y) / 4) : drag.y > r.bottom - edge ? Math.ceil((drag.y - r.bottom + edge) / 4) : 0;
    if (v) { drag.sc.scrollTop += v; place(); } drag.raf = requestAnimationFrame(tick); };
  drag.raf = requestAnimationFrame(tick);
}
function place() {
  const { li, list, ph, y } = drag;
  li.style.top = (drag.top0 + y - drag.y0) + 'px';
  const tops = [...list.children].filter((x) => x !== li && x !== ph && !x._child && x.classList.contains('layer-item'));
  const before = tops.find((x) => { const b = x.getBoundingClientRect(); return y < b.top + b.height / 2; });
  if (before) { if (ph.nextSibling !== before) list.insertBefore(ph, before); } else if (list.lastChild !== ph) list.append(ph);
}
function finishDrag() {
  const { li, list, ph } = drag; cancelAnimationFrame(drag.raf);
  // Map the placeholder position to a top-level index (group child rows are not layers of the canvas).
  let t = 0; for (const x of list.children) { if (x === ph) break; if (x !== li && !x._child && x.classList.contains('layer-item')) t++; }
  drag = null;
  li.removeAttribute('style'); li.classList.remove('dragging', 'pf-dragging'); ph.remove();
  li._suppress = true; setTimeout(() => { li._suppress = false; }, 50);
  const objs = cv.getObjects(); const n = objs.length; const from = n - 1 - objs.indexOf(li._obj); const to = n - 1 - t;
  if (t !== from) { cv.moveTo(li._obj, to); changed(); } else build(true);
}
function moveTo(fromTop, toTop) { PF().reorderLayer(fromTop, toTop); if (onChange) onChange(); }

function build(force) {
  if (!box || !cv || drag) return;
  const sig = signature();
  if (!force && sig === lastSig && box.firstChild) { syncSelection(); return; }
  lastSig = sig; openSwipe = null;
  box.replaceChildren();
  const objs = cv.getObjects();
  if (!objs.length) { box.append(el('li', { class: 'empty pf-layer-empty', text: 'No layers yet — add text or a photo' })); return; }
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i]; box.append(row(o));
    if (isGroupRow(o) && expanded.has(o)) { const k = o._objects; for (let j = k.length - 1; j >= 0; j--) box.append(row(k[j], true, o)); }
  }
  syncSelection();
}
export function render(container, canvas, opts = {}) { box = container; cv = canvas; onChange = opts.onChange || null; box.classList.add('pf-layer-panel'); box.setAttribute('role', 'listbox'); build(true); }
export function refresh(container) { if (container && container !== box) { box = container; box.classList.add('pf-layer-panel'); } if (!box) return false; build(false); return true; }
export function destroy() { if (box) box.replaceChildren(); box = null; cv = null; onChange = null; lastSig = ''; }
window.PFLayerPanel = { render, refresh, destroy, moveTo, expand: (o, on = true) => { if (on) expanded.add(o); else expanded.delete(o); build(true); } };
