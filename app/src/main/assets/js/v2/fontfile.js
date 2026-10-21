// Pure font-file helpers (no DOM): sfnt name/OS2/cmap parsing for auto-categorising imported fonts, and a tiny ZIP reader.
const WEIGHT_NAMES = [[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']];
export const weightName = (w) => WEIGHT_NAMES.reduce((best, [v, n]) => (Math.abs(v - w) < Math.abs(best[0] - w) ? [v, n] : best), [400, 'Regular'])[1];

function utf16be(dv, off, len) { let s = ''; for (let i = 0; i + 1 < len; i += 2) s += String.fromCharCode(dv.getUint16(off + i)); return s; }
function latin1(dv, off, len) { let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(dv.getUint8(off + i)); return s; }

/** Parses a TTF/OTF ArrayBuffer. Returns { family, subfamily, fullName, weight, italic, ml, latin, group, panose, familyClass } or throws. */
export function parseFont(buf) {
  const dv = new DataView(buf);
  const tag = dv.getUint32(0);
  if (tag === 0x774F4646 || tag === 0x774F4632) throw new Error('WOFF/WOFF2 files are web fonts; import the TTF or OTF instead');
  if (tag === 0x74746366) throw new Error('Font collections (.ttc) are not supported');
  if (![0x00010000, 0x4F54544F, 0x74727565].includes(tag)) throw new Error('Not a TTF/OTF font file');
  const n = dv.getUint16(4); const tables = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; tables[latin1(dv, o, 4)] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) }; }
  if (!tables.cmap || !tables.name) throw new Error('Font is missing required tables');
  // name
  const names = {};
  { const t = tables.name.off; const count = dv.getUint16(t + 2), so = t + dv.getUint16(t + 4);
    for (let i = 0; i < count; i++) {
      const r = t + 6 + i * 12; const pid = dv.getUint16(r), eid = dv.getUint16(r + 2), lang = dv.getUint16(r + 4), nid = dv.getUint16(r + 6), len = dv.getUint16(r + 8), off = dv.getUint16(r + 10);
      let v = null; let pri = 0;
      if (pid === 3 && (eid === 1 || eid === 10)) { v = utf16be(dv, so + off, len); pri = lang === 0x409 ? 3 : 2; }
      else if (pid === 0) { v = utf16be(dv, so + off, len); pri = 2; }
      else if (pid === 1 && eid === 0) { v = latin1(dv, so + off, len); pri = 1; }
      if (v != null && (!names[nid] || names[nid].pri < pri)) names[nid] = { v: v.replace(/\0/g, '').trim(), pri };
    } }
  const nm = (i) => (names[i] ? names[i].v : '');
  let weight = 400, italic = false, panose = [], familyClass = 0;
  if (tables['OS/2']) { const t = tables['OS/2'].off; weight = dv.getUint16(t + 4) || 400; familyClass = dv.getInt16(t + 30); for (let i = 0; i < 10; i++) panose.push(dv.getUint8(t + 32 + i)); italic = !!(dv.getUint16(t + 62) & 1); }
  if (weight < 100) weight = weight * 100; // some old fonts use 1..9
  weight = Math.max(100, Math.min(900, Math.round(weight / 100) * 100));
  const sub = nm(17) || nm(2);
  if (/italic|oblique/i.test(sub)) italic = true;
  const family = (nm(16) || nm(1) || 'Imported font').slice(0, 60);
  const has = cmapHas(dv, tables.cmap.off);
  const ml = has(0x0D15) && has(0x0D4D);
  const latin = has(0x41) && has(0x61);
  return { family, subfamily: sub, fullName: nm(4), weight, italic, ml, latin, panose, familyClass, group: classify({ ml, panose, familyClass, family, sub }) };
}

/** Style class from OS/2 sFamilyClass + PANOSE (font-provided data), else 'Other'. */
export function classify({ ml, panose, familyClass, family = '', sub = '' }) {
  if (ml) return 'Malayalam';
  const cls = (familyClass >> 8) & 0xff, ptype = panose[0] || 0, serifStyle = panose[1] || 0, prop = panose[3] || 0;
  if (ptype === 3 || cls === 10) return 'Script';
  if (ptype === 4 || cls === 9 || cls === 12) return 'Display';
  if (ptype === 2) {
    if (prop === 6 || prop === 8) return 'Condensed';
    if (serifStyle >= 11 && serifStyle <= 13) return 'Sans';
    if (serifStyle >= 2 && serifStyle <= 10) return 'Serif';
    if (serifStyle === 14 || serifStyle === 15) return 'Display';
  }
  if (cls >= 1 && cls <= 7) return 'Serif';
  if (cls === 8) return 'Sans';
  if (/condensed|narrow|compressed/i.test(family + ' ' + sub)) return 'Condensed';
  return 'Other';
}

function cmapHas(dv, t) {
  const n = dv.getUint16(t + 2); let best = null;
  for (let i = 0; i < n; i++) {
    const r = t + 4 + i * 8; const pid = dv.getUint16(r), eid = dv.getUint16(r + 2), off = t + dv.getUint32(r + 4); const fmt = dv.getUint16(off);
    const score = (fmt === 12 ? 4 : fmt === 4 ? 3 : 0) + (pid === 3 ? 1 : pid === 0 ? 1 : 0); void eid;
    if ((fmt === 4 || fmt === 12) && (!best || score > best.score)) best = { off, fmt, score };
  }
  if (!best) return () => false;
  const o = best.off;
  if (best.fmt === 4) {
    const segX2 = dv.getUint16(o + 6); const ends = o + 14, starts = ends + segX2 + 2;
    return (cp) => { for (let i = 0; i < segX2; i += 2) { const e = dv.getUint16(ends + i); if (cp <= e) return cp >= dv.getUint16(starts + i); } return false; };
  }
  const groups = dv.getUint32(o + 12);
  return (cp) => { for (let i = 0; i < groups; i++) { const g = o + 16 + i * 12; if (cp >= dv.getUint32(g) && cp <= dv.getUint32(g + 4)) return true; } return false; };
}

/** Minimal ZIP reader (stored + deflate via DecompressionStream). Returns [{ name, data: ArrayBuffer }] for entries matching filter. */
export async function unzip(buf, filter = () => true) {
  const dv = new DataView(buf); let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const out = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen)); p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || !filter(name)) continue;
    const ds = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = new Uint8Array(buf.slice(ds, ds + csize));
    let data;
    if (method === 0) data = raw.buffer;
    else if (method === 8) data = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    else continue;
    out.push({ name, data });
  }
  return out;
}
