// 2.2 ratio bar: a scrolling row of aspect ratios with shape previews and platform icons.
import { el, toast } from '../ui.js';
import { haptic } from '../native.js';

const PF = () => window.PF;
const ICON = {
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="10" y1="19" x2="14" y2="19"/>',
  play: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z" fill="currentColor"/>',
  camera: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/>',
  film: '<rect x="2" y="6" width="20" height="12" rx="1"/><line x1="6" y1="6" x2="6" y2="18"/><line x1="18" y1="6" x2="18" y2="18"/>',
  monitor: '<rect x="2" y="4" width="20" height="13" rx="1.5"/><line x1="8" y1="21" x2="16" y2="21"/>',
  banner: '<rect x="1" y="8" width="22" height="8" rx="1"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/>',
  print: '<rect x="5" y="3" width="14" height="18" rx="1"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
export const RATIOS = [
  { id: 'original', label: 'Original', sub: 'photo', icons: ['photo'] },
  { id: '9:16', r: 9 / 16, label: '9:16', sub: 'Stories · Reels', icons: ['phone', 'camera'] },
  { id: '9:19.5', r: 9 / 19.5, label: '5.8" phone', sub: '9:19.5 wallpaper', icons: ['phone'] },
  { id: '16:9', r: 16 / 9, label: '16:9', sub: 'YouTube · TV', icons: ['play', 'monitor'] },
  { id: '1:1', r: 1, label: '1:1', sub: 'Square post', icons: ['camera'] },
  { id: '4:3', r: 4 / 3, label: '4:3', sub: 'Photo · slides', icons: ['photo', 'monitor'] },
  { id: '3:4', r: 3 / 4, label: '3:4', sub: 'Portrait · print', icons: ['photo', 'print'] },
  { id: '2:1', r: 2, label: '2:1', sub: 'Wide post', icons: ['monitor'] },
  { id: '1.85:1', r: 1.85, label: '1.85:1', sub: 'Widescreen film', icons: ['film'] },
  { id: '2.35:1', r: 2.35, label: '2.35:1', sub: 'Cinemascope', icons: ['film'] },
  { id: '128:27', r: 128 / 27, label: '128:27', sub: 'Banner · header', icons: ['banner'] },
];
/** Pixel size for a ratio: short side 1080, long side capped at 3840. */
export function ratioSize(r) {
  if (r <= 1) { let W = 1080, H = Math.round(1080 / r); if (H > 3840) { H = 3840; W = Math.round(3840 * r); } return { w: W, h: H }; }
  let W = Math.round(1080 * r), H = 1080; if (W > 3840) { W = 3840; H = Math.round(3840 / r); } return { w: W, h: H };
}
export function photoRatio() {
  const pf = PF(); const a = pf.canvas.getActiveObject(); const im = a && a.type === 'image' ? a : pf.canvas.getObjects().find((o) => o.type === 'image' && (o.pfRole === 'bg' || o.pfRole === 'popPhoto')) || pf.canvas.getObjects().find((o) => o.type === 'image');
  if (!im) return null; const e = im.getElement(); const w = (im.width || e.naturalWidth) * Math.abs(im.scaleX), h = (im.height || e.naturalHeight) * Math.abs(im.scaleY);
  return w / h;
}
export async function applyRatio(id) {
  const pf = PF(); const R = RATIOS.find((x) => x.id === id); if (!R) return null;
  const r = id === 'original' ? photoRatio() : R.r; if (!r) { toast('Add a photo first: Original uses the photo\'s own shape'); return null; }
  const { w, h } = ratioSize(r); await pf.setArtboard(w, h, true); pf.state.zoom = 1; pf.state.panX = pf.state.panY = 0; pf.layout(); haptic();
  document.querySelectorAll('.ratio-chip').forEach((b) => b.classList.toggle('on', b.dataset.ratio === id));
  toast(`${R.label} · ${w}×${h}`); return { w, h };
}
export function ratioBar(id = 'ratioBar') {
  const s = PF().state; const cur = s.W / s.H;
  return el('div', { class: 'ratio-bar', id, role: 'listbox', 'aria-label': 'Aspect ratio' }, ...RATIOS.map((R) => {
    const r = R.r || 0.8;
    const shape = el('span', { class: 'ratio-shape' + (R.id === 'original' ? ' orig' : ''), style: r >= 1 ? `width:30px;height:${Math.max(6, Math.round(30 / r))}px` : `width:${Math.max(6, Math.round(30 * r))}px;height:30px` });
    const b = el('button', { class: 'ratio-chip rip' + (R.r && Math.abs(R.r - cur) < 0.005 ? ' on' : ''), 'data-ratio': R.id, title: R.sub, onclick: () => applyRatio(R.id) },
      el('span', { class: 'ratio-box' }, shape), el('b', { text: R.label }), el('small', { text: R.sub }));
    const ic = el('span', { class: 'ratio-icons' }); ic.innerHTML = R.icons.map(svg).join(''); b.append(ic);
    return b;
  }));
}
