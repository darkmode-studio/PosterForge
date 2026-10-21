// 2.2 "My stickers": saved cutouts and pop-out PNGs (IndexedDB, offline) + the bundled leaf/tape stickers, reusable as layers.
import { el, sheet, toast, closeTopSheet } from '../ui.js';
import { haptic } from '../native.js';
import { getMeta, setMeta } from '../db.js';
import { LEAVES } from './popout.js';

const KEY = 'myStickers';
const PF = () => window.PF;
const toDataURL = (blob) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
export async function list() { return (await getMeta(KEY)) || []; }
export async function add(blob, name = 'Sticker') {
  const url = typeof blob === 'string' ? blob : await toDataURL(blob);
  const l = await list(); const rec = { id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, url, created: Date.now() };
  l.unshift(rec); await setMeta(KEY, l.slice(0, 60)); return rec;
}
export async function remove(id) { await setMeta(KEY, (await list()).filter((s) => s.id !== id)); }
export async function place(url, name = 'Sticker') {
  const pf = PF(); const o = await pf.addImageFromURL(url, name, { width: 0.45 });
  o.set({ pfAlpha: true, pfSticker: true }); pf.canvas.add(o); pf.canvas.setActiveObject(o); pf.canvas.requestRenderAll(); haptic('confirm'); return o;
}
export const BUNDLED = [...LEAVES.map((u) => ({ url: u, name: u.split('/').pop().replace('.webp', '').replace('leaf-', '').replace(/^./, (c) => c.toUpperCase()) })), { url: 'img/v22/tape.webp', name: 'Tape' }];

export async function openStickers() {
  const body = el('div', { class: 'col st-body', id: 'myStickers' });
  let close = null;
  const draw = async () => {
    const mine = await list(); body.innerHTML = '';
    body.append(el('h3', { text: `My stickers (${mine.length})` }));
    body.append(mine.length ? el('div', { class: 'st-grid', id: 'stMine' }, ...mine.map((s) => el('div', { class: 'st-cell checker', 'data-id': s.id },
      el('button', { class: 'st-img rip', 'aria-label': s.name, onclick: async () => { await place(s.url, s.name); close?.(); } }, el('img', { src: s.url, alt: s.name })),
      el('button', { class: 'st-del', 'aria-label': 'Delete', text: '✕', onclick: async () => { await remove(s.id); draw(); } }))))
      : el('p', { class: 'note', text: 'Save a lifted subject (Save PNG) or a pop-out (Save pop-out as PNG) and it appears here for reuse.' }));
    body.append(el('h3', { text: 'Leaves & tape (bundled)' }), el('div', { class: 'st-grid', id: 'stBundled' }, ...BUNDLED.map((s) => el('div', { class: 'st-cell checker' },
      el('button', { class: 'st-img rip', 'aria-label': s.name, onclick: async () => { await place(s.url, s.name); close?.(); } }, el('img', { src: s.url, alt: s.name }))))));
  };
  await draw();
  const p = sheet({ title: 'Stickers', body, actions: [{ label: 'Close', value: null, kind: 'btn-ghost' }] });
  close = () => closeTopSheet();
  return p;
}
