// PosterForge 2.3.2 batch carousel export (based on the Gemini draft "batchExport.js").
// Every page is rendered offscreen from the project's stored page JSON (state.pages, kept current with snapshot()),
// scaled from the poster's design size (state.W × state.H — all pages share it), so the live editor never changes page.
// Each page canvas is disposed before the next one starts. Saves go through the native MediaStore bridge (sendBlob).
import { sendBlob } from '../native.js';
import { canvasToBlob } from '../tools.js';
import { snapshot } from '../v2/pages.js';

const PF = () => window.PF;
const MAX = 3840;
const ymd = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
export const slideName = (i, ext, d) => `PosterForge_${ymd(d)}_slide-${String(i + 1).padStart(2, '0')}.${ext}`;
const abortErr = () => { const e = new Error('Export cancelled'); e.name = 'AbortError'; return e; };

export function pagesJSON() { const s = PF().state; snapshot(); return s.pages ? s.pages.slice() : [JSON.parse(PF().serialize()).canvas]; }
/** Scale that fits the page's ORIGINAL design size into width × height (either may be omitted), capped at 3840 px. */
export function scaleFor(W, H, width, height) {
  let k = width && height ? Math.min(width / W, height / H) : width ? width / W : height ? height / H : 1;
  k = Math.min(k, MAX / Math.max(W, H)); return Math.max(k, 1 / Math.max(W, H));
}

/** Renders every page, one at a time. onPage(i, blob, name) lets the caller save each file immediately (low RAM). */
export async function exportAll({ format = 'png', width, height, scale, quality = 0.92, transparent = false, onProgress = () => {}, signal, onPage } = {}) {
  const pf = PF(); const s = pf.state;
  const ext = format === 'jpeg' ? 'jpg' : format; const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  const clear = transparent && ext !== 'jpg';
  const pages = pagesJSON(); const total = pages.length; const day = new Date();
  const k = scale ? Math.min(scale, MAX / Math.max(s.W, s.H)) : scaleFor(s.W, s.H, width, height);
  const out = []; onProgress(0, total);
  for (let i = 0; i < total; i++) {
    if (signal && signal.aborted) throw abortErr();
    const json = JSON.parse(JSON.stringify(pages[i]));
    if (ext === 'jpg' && !json.background) json.background = '#ffffff'; // JPG has no alpha: white, never black
    let sc = await pf.renderStatic(k, { json, transparent: clear });
    let blob;
    try {
      if (ext === 'jpg') { const c = sc.lowerCanvasEl; const g = c.getContext('2d'); g.save(); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height); g.restore(); }
      blob = await canvasToBlob(sc.lowerCanvasEl, mime, quality);
    } finally { const c = sc.lowerCanvasEl; sc.dispose(); if (c) { c.width = 0; c.height = 0; } sc = null; } // free the page before the next one
    const item = { name: slideName(i, ext, day), blob, mime, width: Math.round(s.W * k), height: Math.round(s.H * k) };
    if (onPage) { const r = await onPage(i, item); item.result = r; if (r && r.ok === false) { out.push(item); break; } item.blob = null; }
    out.push(item);
    onProgress(i + 1, total);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}
/** Saves results that still hold a blob (exportAll without onPage). */
export async function saveAll(results, action = 'save') {
  const rs = [];
  for (const it of results) { if (!it.blob) continue; rs.push(await sendBlob(it.blob, it.name, it.mime, action)); it.blob = null; }
  return rs;
}
window.PFBatchExport = { exportAll, saveAll, scaleFor, slideName };
