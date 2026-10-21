// 2.1 canvas sizes grouped by platform with shape previews, custom px/mm/in with saved presets, Story/Reel safe zones
// and the Instagram carousel panorama (one wide artboard exported as seamless 4:5 slides).
import { el, sheet, toast, promptSheet, progressTask } from '../ui.js';
import { haptic, sendBlob } from '../native.js';

const PF = () => window.PF;
const mm = (v, dpi = 300) => Math.round((v / 25.4) * dpi);
export const SIZE_GROUPS = [
  { name: 'Instagram', items: [
    { id: 'ig-portrait', label: 'Portrait post 4:5', w: 1080, h: 1350 }, { id: 'ig-square', label: 'Square 1:1', w: 1080, h: 1080 },
    { id: 'ig-land', label: 'Landscape 1.91:1', w: 1080, h: 566 }, { id: 'ig-story', label: 'Story 9:16', w: 1080, h: 1920, safe: 'story' },
    { id: 'ig-reel', label: 'Reel 9:16', w: 1080, h: 1920, safe: 'reel' }, { id: 'ig-cover', label: 'Reel cover', w: 1080, h: 1920, safe: 'cover' },
    { id: 'ig-profile', label: 'Profile picture', w: 320, h: 320, round: true }, { id: 'ig-pano', label: 'Carousel panorama', w: 1080 * 3, h: 1350, pano: 3 }] },
  { name: 'Threads & Facebook', items: [
    { id: 'th-post', label: 'Threads post 4:5', w: 1080, h: 1350 }, { id: 'fb-post', label: 'Facebook post 1:1', w: 1080, h: 1080 },
    { id: 'fb-cover', label: 'Facebook cover', w: 820, h: 312 }, { id: 'fb-story', label: 'Facebook story', w: 1080, h: 1920, safe: 'story' }] },
  { name: 'YouTube', items: [{ id: 'yt-thumb', label: 'Thumbnail 16:9', w: 1280, h: 720 }, { id: 'yt-banner', label: 'Channel banner', w: 2560, h: 1440, safe: 'banner' }] },
  { name: 'WhatsApp', items: [{ id: 'wa-status', label: 'Status 9:16', w: 1080, h: 1920 }, { id: 'wa-dp', label: 'Profile photo (DP)', w: 640, h: 640, round: true }] },
  { name: 'Print (300 dpi)', items: [
    { id: 'pr-a3', label: 'A3 poster', w: mm(297), h: mm(420) }, { id: 'pr-a4', label: 'A4 poster', w: mm(210), h: mm(297) }, { id: 'pr-a5', label: 'A5 flyer', w: mm(148), h: mm(210) },
    { id: 'pr-flyer', label: 'Flyer (US Letter)', w: 2550, h: 3300 }, { id: 'pr-card', label: 'Business card', w: mm(85), h: mm(55) }] },
  { name: 'Ratios', items: [
    { id: 'r-3-4', label: '3:4', w: 1080, h: 1440 }, { id: 'r-2-3', label: '2:3', w: 1080, h: 1620 }, { id: 'r-4-3', label: '4:3', w: 1440, h: 1080 },
    { id: 'r-16-9', label: '16:9', w: 1920, h: 1080 }, { id: 'r-21-9', label: '21:9', w: 2520, h: 1080 }] },
];
export const ALL_SIZES = SIZE_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.name })));
const PRESET_KEY = 'pf.sizePresets';
export const savedSizes = () => { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch (_) { return []; } };
export function saveSize(p) { const l = savedSizes().filter((x) => x.label !== p.label); l.unshift(p); localStorage.setItem(PRESET_KEY, JSON.stringify(l.slice(0, 20))); }
export function toPx(v, unit, dpi = 300) { v = Number(v); return Math.round(unit === 'mm' ? (v / 25.4) * dpi : unit === 'in' ? v * dpi : v); }

// ---- safe zones (Instagram 1080x1920 guidance) ----
export const SAFE = {
  story: { label: 'Story safe zone', top: 250, bottom: 340, right: 0, note: 'Profile bar and reply box cover the shaded parts' },
  reel: { label: 'Reel safe zone', top: 220, bottom: 420, right: 140, note: 'Caption, buttons and audio bar cover the shaded parts' },
  cover: { label: 'Reel cover guides', top: 0, bottom: 0, right: 0, crops: [[1080, 1080, '1:1 grid crop'], [1080, 1440, '3:4 profile grid']] },
  banner: { label: 'Banner safe area', box: [1546, 423, 'Visible on all devices'] },
};
export function setSafeZone(kind) { PF().state.safeZone = kind || null; PF().canvas.requestRenderAll(); }
export const panoramaCount = () => { const s = PF().state; return s.H === 1350 && s.W % 1080 === 0 && s.W / 1080 >= 2 && s.W / 1080 <= 10 ? s.W / 1080 : 0; };
function drawGuides(ctx) {
  const pf = PF(); const s = pf.state; const v = pf.canvas.viewportTransform; const sz = SAFE[s.safeZone]; const pano = panoramaCount();
  if (!sz && !pano) return;
  ctx.save(); ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
  const lw = 2 / v[0];
  if (sz && (s.W === 1080 && s.H === 1920 || sz.box)) {
    ctx.fillStyle = 'rgba(255,60,90,0.22)'; ctx.strokeStyle = 'rgba(255,90,120,0.9)'; ctx.lineWidth = lw; ctx.setLineDash([10 / v[0], 8 / v[0]]);
    if (sz.top) { ctx.fillRect(0, 0, s.W, sz.top); ctx.strokeRect(0, sz.top, s.W, 0.01); }
    if (sz.bottom) { ctx.fillRect(0, s.H - sz.bottom, s.W, sz.bottom); ctx.strokeRect(0, s.H - sz.bottom, s.W, 0.01); }
    if (sz.right) ctx.fillRect(s.W - sz.right, sz.top, sz.right, s.H - sz.top - sz.bottom);
    for (const [w, h, l] of sz.crops || []) { const y = (s.H - h) / 2; ctx.strokeRect((s.W - w) / 2, y, w, h); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = "26px Poppins"; ctx.fillText(l, 20, y + 36); }
    if (sz.box) { const [w, h, l] = sz.box; const x = (s.W - w) / 2, y = (s.H - h) / 2; ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, s.W, y); ctx.fillRect(0, y + h, s.W, s.H - y - h); ctx.fillRect(0, y, x, h); ctx.fillRect(x + w, y, s.W - x - w, h); ctx.strokeRect(x, y, w, h); ctx.fillStyle = '#fff'; ctx.font = '36px Poppins'; ctx.fillText(l, x + 16, y + 44); }
  }
  if (pano) { ctx.setLineDash([14 / v[0], 10 / v[0]]); ctx.strokeStyle = 'rgba(80,200,255,0.95)'; ctx.lineWidth = lw * 1.5; for (let i = 1; i < pano; i++) { ctx.beginPath(); ctx.moveTo(i * 1080, 0); ctx.lineTo(i * 1080, s.H); ctx.stroke(); }
    ctx.fillStyle = 'rgba(80,200,255,0.95)'; ctx.font = '34px Poppins'; for (let i = 0; i < pano; i++) ctx.fillText(`${i + 1}/${pano}`, i * 1080 + 24, 50); }
  ctx.restore();
}
export function installGuides() { PF().canvas.on('after:render', (e) => drawGuides(e.ctx || PF().canvas.contextContainer)); }

/** Exports the panorama as N seamless 1080x1350 slides (scale 1 = Instagram size). */
export async function exportPanorama({ action = 'save', scale = 1 } = {}) {
  const pf = PF(); const n = panoramaCount(); if (!n) { toast('This artboard is not a carousel panorama'); return []; }
  const pt = progressTask(`Exporting ${n} slides…`); const out = [];
  try {
    const sc = await pf.renderStatic(scale);
    const full = sc.lowerCanvasEl; const w = Math.round(1080 * scale), h = Math.round(1350 * scale);
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(full, i * w, 0, w, h, 0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
      const r = await sendBlob(blob, `${(pf.state.projectName || 'carousel').replace(/[^\w-]+/g, '_')}-${i + 1}-of-${n}.jpg`, 'image/jpeg', action);
      out.push(r); pt.set((i + 1) / n);
    }
    sc.dispose(); toast(`${n} slides saved: post them together in order`);
  } catch (e) { toast('Panorama export failed: ' + e.message, 'error'); } finally { pt.done(); }
  return out;
}

const shape = (w, h, round) => { const k = Math.min(54 / w, 54 / h); return el('span', { class: 'sz-shape' + (round ? ' round' : ''), style: `width:${Math.max(6, Math.round(w * k))}px;height:${Math.max(6, Math.round(h * k))}px` }); };
/** Size picker. mode 'resize' changes the artboard; 'new' resolves { w, h, item } for a new poster. */
export async function openSizes({ mode = 'resize' } = {}) {
  const pf = PF(); const s = pf.state;
  let unit = 'px';
  const wI = el('input', { type: 'number', id: 'szW', value: String(s.W), min: '1', step: 'any', inputmode: 'decimal' });
  const hI = el('input', { type: 'number', id: 'szH', value: String(s.H), min: '1', step: 'any', inputmode: 'decimal' });
  const dpiI = el('input', { type: 'number', id: 'szDpi', value: '300', min: '72', max: '600' });
  const unitSeg = el('div', { class: 'seg', id: 'szUnit' }, ...['px', 'mm', 'in'].map((u) => el('button', { class: u === unit ? 'on' : '', 'data-unit': u, text: u, onclick: () => {
    const wpx = toPx(wI.value, unit, Number(dpiI.value)), hpx = toPx(hI.value, unit, Number(dpiI.value)); unit = u;
    const back = (px) => (u === 'px' ? px : u === 'mm' ? +(px / Number(dpiI.value) * 25.4).toFixed(1) : +(px / Number(dpiI.value)).toFixed(2));
    wI.value = back(wpx); hI.value = back(hpx); unitSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === u)); upd(); } })));
  const outPx = el('span', { class: 'note', id: 'szPx' });
  const upd = () => { outPx.textContent = `= ${toPx(wI.value, unit, Number(dpiI.value))} × ${toPx(hI.value, unit, Number(dpiI.value))} px`; };
  [wI, hI, dpiI].forEach((i) => i.addEventListener('input', upd)); upd();
  let scaleContent = true;
  const list = el('div', { class: 'sz-groups', id: 'sizeGroups' });
  const body = el('div', { class: 'sz-body' }, list,
    el('h3', { text: 'Custom size' }), el('div', { class: 'row sz-custom' }, wI, el('span', { text: '×' }), hI, unitSeg),
    el('div', { class: 'row' }, el('span', { class: 'small', text: 'DPI (mm/in)' }), dpiI, outPx),
    mode === 'resize' ? el('label', { class: 'row small' }, el('input', { type: 'checkbox', checked: true, onchange: (e) => (scaleContent = e.target.checked) }), el('span', { text: 'Scale and re-centre existing items' })) : null);
  const pick = (it, close) => close({ w: it.w, h: it.h, item: it });
  const v = await sheet({ title: mode === 'new' ? 'New poster size' : `Canvas size (now ${s.W} × ${s.H})`, body,
    actions: [{ label: 'Cancel', value: null, kind: 'btn-ghost' }, { label: 'Save preset', value: 'savePreset', kind: 'btn-secondary' }, { label: 'Use custom', value: () => ({ w: toPx(wI.value, unit, Number(dpiI.value)), h: toPx(hI.value, unit, Number(dpiI.value)), item: null }), kind: 'btn-accent' }],
    onOpen: (_, close) => {
      const mine = savedSizes();
      const groups = mine.length ? [{ name: 'My sizes', items: mine.map((m, i) => ({ ...m, id: 'my-' + i })) }, ...SIZE_GROUPS] : SIZE_GROUPS;
      for (const g of groups) {
        list.append(el('h3', { class: 'sz-h', text: g.name }), el('div', { class: 'sz-grid' }, ...g.items.map((it) => el('button', { class: 'sz-card rip' + (it.w === s.W && it.h === s.H ? ' on' : ''), 'data-size': it.id, onclick: () => pick(it, close) },
          el('span', { class: 'sz-pv' }, shape(it.w, it.h, it.round)), el('b', { text: it.label }), el('small', { text: `${it.w}×${it.h}` })))));
      }
    } });
  if (v === 'savePreset') {
    const w = toPx(wI.value, unit, Number(dpiI.value)), h = toPx(hI.value, unit, Number(dpiI.value));
    const n = await promptSheet('Preset name', { value: `${w}×${h}`, okLabel: 'Save' }); if (n) { saveSize({ label: n.trim().slice(0, 30), w, h }); toast('Size saved under My sizes'); }
    return openSizes({ mode });
  }
  if (!v) return null;
  let { w, h } = v; const it = v.item;
  if (it && it.pano) {
    const n = await sheet({ title: 'Carousel panorama', message: 'One wide design that is cut into seamless 4:5 slides. How many slides?', body: null,
      actions: [2, 3, 4, 5, 6, 8, 10].map((k) => ({ label: String(k), value: k, kind: k === 3 ? 'btn-accent' : 'btn-secondary' })) });
    if (!n) return null; w = 1080 * n; h = 1350;
  }
  if (!(w >= 200 && w <= 12000 && h >= 200 && h <= 6000)) { toast('Size must be 200–6000 px (panoramas up to 10 slides)', 'error'); return null; }
  if (mode === 'new') return { w, h, item: it };
  await setArtboardWide(w, h, scaleContent);
  setSafeZone(it && it.safe ? it.safe : null); haptic('confirm');
  if (it && it.safe && SAFE[it.safe].note) toast(SAFE[it.safe].note);
  if (it && it.pano) toast(`Panorama: ${w / 1080} slides. Export → “Panorama slides” cuts it for Instagram`);
  return { w, h, item: it };
}
/** setArtboard caps at 6000; a panorama of up to 10 slides is 10800 wide, so allow it by setting state directly when needed. */
async function setArtboardWide(w, h, scaleContent) {
  const pf = PF();
  if (w <= 6000) return pf.setArtboard(w, h, scaleContent);
  // temporarily lift the limit: setArtboard has no hard check of its own (the 6000 check lives in the old sheet)
  return pf.setArtboard(w, h, scaleContent);
}
