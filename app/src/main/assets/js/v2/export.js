// Export v2: PNG / transparent PNG / JPG (quality) / PDF with bleed & crop marks / SVG, size presets, low-resolution
// warning, and carousel export of every page at once.
import { el, sheet, toast, progressTask } from '../ui.js';
import { sendBlob, haptic, hasNative, hasNativeExport } from '../native.js';
import { canvasToBlob } from '../tools.js';
import { goTo, snapshot, pageCount } from './pages.js';

const PF = () => window.PF;
export const SIZE_PRESETS = [
  { id: 'x1', label: '1×', scale: 1 }, { id: 'x2', label: '2×', scale: 2 }, { id: 'x3', label: '3×', scale: 3 }, { id: 'x4', label: '4×', scale: 4 },
  { id: 'ig', label: 'Instagram (1080 wide)', width: 1080 }, { id: 'hd', label: 'Full HD (1920 long side)', long: 1920 }, { id: 'print', label: 'Print 300 dpi A4', long: 3508 }, { id: '4k', label: '4K (3840 long side)', long: 3840 },
];
export function presetScale(p, W, H) { if (p.scale) return p.scale; if (p.width) return p.width / W; if (p.long) return p.long / Math.max(W, H); return 1; }

/** Images that will be upscaled at this export scale: [{ name, factor }] (factor > 1.25 = visibly soft). */
export function lowResImages(scale) {
  const pf = PF(); const out = [];
  const visit = (o, k) => { const kk = k * Math.abs(o.scaleX || 1);
    if (o.type === 'image') {
      const need = o.width * kk * scale; // output pixels across the photo
      const avail = o.pfOrigW && !o.pfGeo ? Math.max(o.pfOrigW, o.width) : o.width;
      const f = need / Math.max(1, avail);
      if (f > 1.25 && !o.pfTemplatePhoto) out.push({ name: o.name || 'Photo', factor: Math.round(f * 10) / 10 });
    }
    (o._objects || []).forEach((c) => visit(c, kk)); };
  pf.canvas.getObjects().forEach((o) => visit(o, 1));
  return out;
}

// ---- minimal PDF writer: one JPEG per page, with TrimBox/BleedBox and optional crop marks ----
export function buildPDF(pages) { // pages: [{ jpeg: Uint8Array, pxW, pxH, wPt, hPt, bleedPt, slugPt, marks }]
  const enc = new TextEncoder(); const parts = []; const offs = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body) => { offs[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length; const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  pages.forEach((p, i) => {
    const pg = 3 + i * 3, im = pg + 1, ct = pg + 2; const s = p.slugPt;
    const W = p.wPt + 2 * (p.bleedPt + s), H = p.hPt + 2 * (p.bleedPt + s);
    const f = (v) => v.toFixed(2);
    const trim = [s + p.bleedPt, s + p.bleedPt, s + p.bleedPt + p.wPt, s + p.bleedPt + p.hPt], bleed = [s, s, W - s, H - s];
    obj(pg, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(W)} ${f(H)}] /BleedBox [${bleed.map(f).join(' ')}] /TrimBox [${trim.map(f).join(' ')}] /Resources << /XObject << /Im${i} ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
    obj(im, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); push(p.jpeg); push('\nendstream'); });
    let c = `q ${f(W - 2 * s)} 0 0 ${f(H - 2 * s)} ${f(s)} ${f(s)} cm /Im${i} Do Q\n`;
    if (p.marks && s > 0) {
      const [x0, y0, x1, y1] = trim; const L = s - 2; c += '0 0 0 RG 0.5 w\n';
      for (const [x, y, dx, dy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]]) {
        const bx = x + dx * p.bleedPt, by = y + dy * p.bleedPt;
        c += `${f(x)} ${f(by + dy * 2)} m ${f(x)} ${f(by + dy * (L))} l S ${f(bx + dx * 2)} ${f(y)} m ${f(bx + dx * L)} ${f(y)} l S\n`;
      }
    }
    obj(ct, () => { push(`<< /Length ${enc.encode(c).length} >>\nstream\n`); push(c); push('endstream'); });
  });
  const xref = len; const count = 3 + n * 3;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(String(offs[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
/** Renders the live page with bleed: the poster is drawn at trim size; the bleed band is filled with an edge-stretched copy. */
async function renderBleedJPEG(scale, bleedPx, quality) {
  const pf = PF(); const s = pf.state;
  const sc = await pf.renderStatic(scale); const src = sc.lowerCanvasEl;
  const W = src.width, H = src.height; const c = document.createElement('canvas'); c.width = W + 2 * bleedPx; c.height = H + 2 * bleedPx; const x = c.getContext('2d');
  x.fillStyle = (typeof pf.canvas.backgroundColor === 'string' && pf.canvas.backgroundColor) || '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  if (bleedPx > 0) { x.drawImage(src, 0, 0, c.width, c.height); x.filter = 'none'; }
  x.drawImage(src, bleedPx, bleedPx); sc.dispose(); void s;
  return new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', quality)).arrayBuffer());
}
export async function exportPDF({ scale, bleedMm = 3, marks = true, quality = 0.92, allPages = true, dpi = 300, onProgress = () => {} }) {
  const pf = PF(); const s = pf.state; const n = allPages ? pageCount() : 1; const start = s.page;
  const pxW = Math.round(s.W * scale), pxH = Math.round(s.H * scale);
  const ptPerPx = 72 / dpi; const bleedPt = (bleedMm / 25.4) * 72; const bleedPx = Math.round((bleedMm / 25.4) * dpi);
  const pages = [];
  for (let i = 0; i < n; i++) {
    if (allPages && s.pages) await goTo(i, { silent: true });
    const jpeg = await renderBleedJPEG(scale, bleedPx, quality);
    pages.push({ jpeg, pxW: pxW + 2 * bleedPx, pxH: pxH + 2 * bleedPx, wPt: pxW * ptPerPx, hPt: pxH * ptPerPx, bleedPt, slugPt: marks ? 18 : 0, marks });
    onProgress((i + 1) / n);
  }
  if (allPages && s.pages) await goTo(start, { silent: true });
  return buildPDF(pages);
}

async function exportOne({ kind, scale, quality, action, name, onProgress }) {
  const pf = PF(); const mime = kind === 'jpg' ? 'image/jpeg' : kind === 'webp' ? 'image/webp' : kind === 'svg' ? 'image/svg+xml' : 'image/png'; const transparent = kind === 'tpng';
  if (kind !== 'svg' && kind !== 'webp' && hasNativeExport() && !transparent) return pf.exportTiled({ scale, mime, name, action, onProgress, quality: Math.round(quality * 100) });
  const blob = kind === 'svg' ? await pf.exportSVGBlob() : await pf.exportPNGBlob(scale, mime, quality, { transparent });
  return sendBlob(blob, name, mime, action);
}
export async function runExport({ kind, scale, quality = 0.92, action = 'save', allPages = false, bleedMm = 3, marks = true }) {
  const pf = PF(); const s = pf.state; pf.canvas.discardActiveObject(); pf.canvas.requestRenderAll();
  if (kind !== 'svg' && kind !== 'pdf' && !pf.fitsBudget(scale)) { toast('That size is too large for this device’s memory', 'error'); return { ok: false, error: 'budget' }; }
  const n = allPages ? pageCount() : 1; const stamp = pf.stamp();
  const pt = progressTask(kind === 'pdf' ? 'Building print PDF…' : `Exporting ${n > 1 ? n + ' pages' : Math.round(s.W * scale) + ' × ' + Math.round(s.H * scale)}…`);
  const results = [];
  try {
    if (kind === 'pdf') {
      const blob = await exportPDF({ scale, bleedMm, marks, quality, allPages, onProgress: pt.set });
      const r = await sendBlob(blob, `PosterForge_${stamp}.pdf`, 'application/pdf', action); results.push(r);
    } else {
      snapshot(); const start = s.page;
      for (let i = 0; i < n; i++) {
        if (n > 1) await goTo(i, { silent: true });
        const ext = kind === 'tpng' ? 'png' : kind;
        const r = await exportOne({ kind, scale, quality, action: n > 1 && action === 'share' ? 'save' : action, name: `PosterForge_${stamp}${n > 1 ? '_' + String(i + 1).padStart(2, '0') : ''}.${ext}`, onProgress: (f) => pt.set((i + f) / n) });
        results.push(r); if (!r.ok) break;
      }
      if (n > 1) await goTo(start, { silent: true });
    }
    const bad = results.find((r) => !r.ok);
    if (bad) toast('Export failed: ' + bad.error, 'error'); else { haptic('confirm'); if (!hasNative() || n > 1) toast(n > 1 ? `Saved ${n} pages` : 'Saved'); }
    return { ok: !bad, results };
  } catch (e) { toast('Export failed: ' + e.message, 'error'); return { ok: false, error: e.message }; }
  finally { pt.done(); }
}

export async function exportSheetV2() {
  const pf = PF(); const s = pf.state;
  let kind = localStorage.getItem('pf.exp.kind') || 'png', preset = localStorage.getItem('pf.exp.preset') || 'x2', quality = Number(localStorage.getItem('pf.exp.q') || 92), all = pageCount() > 1;
  let bleed = 3, marks = true;
  const box = el('div', { class: 'col-gap exp' });
  const draw = () => {
    const p = SIZE_PRESETS.find((x) => x.id === preset) || SIZE_PRESETS[1]; const scale = presetScale(p, s.W, s.H);
    const low = kind === 'svg' ? [] : lowResImages(scale);
    box.replaceChildren(
      el('label', { class: 'small', text: 'Format' }),
      el('div', { class: 'seg wrap', id: 'expKind' }, ...[['png', 'PNG'], ['tpng', 'Transparent PNG'], ['jpg', 'JPG'], ['webp', 'WebP'], ['pdf', 'Print PDF'], ['svg', 'SVG']].map(([k, l]) => el('button', { class: k === kind ? 'on' : '', 'data-kind': k, text: l, onclick: () => { kind = k; draw(); } }))),
      ...(kind === 'svg' ? [] : [el('label', { class: 'small', text: 'Size' }), el('div', { class: 'seg wrap', id: 'expSize' }, ...SIZE_PRESETS.map((x) => { const sc = presetScale(x, s.W, s.H); const ok = kind === 'pdf' || pf.fitsBudget(sc);
        return el('button', { class: x.id === preset ? 'on' : '', 'data-preset': x.id, disabled: ok ? undefined : 'true', text: `${x.label}`, title: `${Math.round(s.W * sc)}×${Math.round(s.H * sc)}`, onclick: () => { if (ok) { preset = x.id; draw(); } } }); })),
        el('p', { class: 'note', id: 'expDims', text: `Output ${Math.round(s.W * scale)} × ${Math.round(s.H * scale)} px${kind === 'pdf' ? ` · ${(s.W * scale / 300 * 25.4).toFixed(0)} × ${(s.H * scale / 300 * 25.4).toFixed(0)} mm at 300 dpi` : ''}` })]),
      ...(kind === 'jpg' || kind === 'webp' || kind === 'pdf' ? [el('div', { class: 'slider-row' }, el('span', { class: 'lbl', text: 'Quality' }), (() => { const i = el('input', { type: 'range', id: 'expQuality', min: 50, max: 100, value: quality }); i.oninput = () => { quality = Number(i.value); i.nextSibling.textContent = quality; }; return i; })(), el('span', { class: 'val', text: String(quality) }))] : []),
      ...(kind === 'pdf' ? [el('label', { class: 'small', text: 'Bleed' }), el('div', { class: 'seg', id: 'expBleed' }, ...[0, 3, 5].map((b) => el('button', { class: b === bleed ? 'on' : '', 'data-bleed': String(b), text: b ? `${b} mm` : 'None', onclick: () => { bleed = b; draw(); } }))),
        el('label', { class: 'row note' }, (() => { const c = el('input', { type: 'checkbox', id: 'expMarks' }); c.checked = marks; c.onchange = () => { marks = c.checked; }; return c; })(), ' Crop marks')] : []),
      ...(kind === 'tpng' ? [el('p', { class: 'note', text: 'The background colour and background photo are left out, so the PNG keeps transparency.' })] : []),
      ...(pageCount() > 1 && kind !== 'svg' ? [el('label', { class: 'row note' }, (() => { const c = el('input', { type: 'checkbox', id: 'expAll' }); c.checked = all; c.onchange = () => { all = c.checked; }; return c; })(), ` All ${pageCount()} pages (carousel)${kind === 'pdf' ? ' in one PDF' : ''}`)] : []),
      ...(low.length ? [el('p', { class: 'note warn', id: 'expLowRes', text: `⚠ Low resolution: ${low.map((x) => `${x.name} will be enlarged ${x.factor}×`).join('; ')}. Use a smaller size or a larger photo for sharp results.` })] : []));
  };
  draw();
  const a = await sheet({ title: 'Export', body: box, actions: [{ label: 'Share', value: 'share', kind: 'btn-secondary' }, { label: 'Save', value: 'save', kind: 'btn-accent' }] });
  if (!a) return null;
  localStorage.setItem('pf.exp.kind', kind); localStorage.setItem('pf.exp.preset', preset); localStorage.setItem('pf.exp.q', String(quality));
  const p = SIZE_PRESETS.find((x) => x.id === preset) || SIZE_PRESETS[1];
  return runExport({ kind, scale: presetScale(p, s.W, s.H), quality: quality / 100, action: a, allPages: all && pageCount() > 1, bleedMm: bleed, marks });
}
window.PFExport = { runExport, exportSheetV2, lowResImages, buildPDF, exportPDF };
