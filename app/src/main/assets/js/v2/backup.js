// Backup & restore of everything PosterForge keeps on the phone, as one .pfbackup file (NDJSON; binary as base64).
import { el, sheet, toast, busy, confirmSheet } from '../ui.js';
import { sendBlob } from '../native.js';
import { getAllRecords, putRecord, getAllKeys, getMeta, setMeta } from '../db.js';

const STORES = ['projects', 'vectors', 'userfonts', 'originals'];
const LS_KEYS = ['pf.favFonts', 'pf.textStyles', 'pf.exportScale', 'pf.exp.kind', 'pf.exp.preset', 'pf.exp.q'];
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
async function encode(v) {
  if (v instanceof Blob) return { $blob: b64(new Uint8Array(await v.arrayBuffer())), type: v.type };
  if (v instanceof ArrayBuffer) return { $ab: b64(new Uint8Array(v)) };
  if (Array.isArray(v)) return Promise.all(v.map(encode));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = await encode(x); return o; }
  return v;
}
function decode(v) {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') { if ('$blob' in v) return new Blob([unb64(v.$blob)], { type: v.type || '' }); if ('$ab' in v) return unb64(v.$ab).buffer; const o = {}; for (const [k, x] of Object.entries(v)) o[k] = decode(x); return o; }
  return v;
}
/** Builds the backup Blob. opts.originals: include full-resolution photos (bigger file). */
export async function buildBackup({ originals = true } = {}) {
  const parts = []; const counts = {};
  const ls = Object.fromEntries(LS_KEYS.map((k) => [k, localStorage.getItem(k)]).filter(([, v]) => v != null));
  parts.push(JSON.stringify({ app: 'PosterForge', format: 1, created: new Date().toISOString(), version: window.PFNative?.appVersion?.() || 'web', localStorage: ls }) + '\n');
  for (const st of STORES) {
    if (st === 'originals' && !originals) continue;
    const recs = await getAllRecords(st).catch(() => []); counts[st] = recs.length;
    const keys = st === 'vectors' ? await getAllKeys(st) : null;
    for (let i = 0; i < recs.length; i++) parts.push(JSON.stringify({ store: st, rec: await encode(recs[i]), key: keys ? keys[i] : undefined }) + '\n');
  }
  const draft = await getMeta('draft').catch(() => null);
  if (draft) parts.push(JSON.stringify({ store: 'meta', key: 'draft', rec: draft }) + '\n');
  return { blob: new Blob(parts, { type: 'application/octet-stream' }), counts };
}
/** Restores from backup text. Existing items with the same id are replaced; nothing else is deleted. */
export async function restoreBackup(text) {
  const lines = text.split('\n').filter(Boolean);
  const head = JSON.parse(lines[0] || '{}');
  if (head.app !== 'PosterForge') throw new Error('This is not a PosterForge backup file');
  const counts = {};
  for (const line of lines.slice(1)) {
    const { store, rec, key } = JSON.parse(line);
    if (store === 'meta') { if (key === 'draft') await setMeta('draft', rec); continue; }
    if (!STORES.includes(store)) continue;
    await putRecord(store, decode(rec), store === 'vectors' && rec.id == null ? undefined : undefined);
    counts[store] = (counts[store] || 0) + 1;
  }
  for (const [k, v] of Object.entries(head.localStorage || {})) localStorage.setItem(k, v);
  return { counts, created: head.created };
}
export async function backupSheet() {
  const orig = el('input', { type: 'checkbox', id: 'bkOriginals' }); orig.checked = true;
  const file = el('input', { type: 'file', id: 'restoreInput', accept: '.pfbackup,application/octet-stream,application/json,*/*', class: 'hidden' });
  const body = el('div', { class: 'col-gap' },
    el('p', { class: 'note', text: 'A backup is one file with all your projects (every page), imported fonts, saved styles, favourites, your vector library and the current draft. Keep it in Drive or send it to another phone, then restore it here.' }),
    el('label', { class: 'row note' }, orig, ' Include full-resolution photos (larger file, sharper re-exports)'),
    el('button', { class: 'btn-filled rip', id: 'btnBackupNow', text: 'Create backup file', onclick: async () => {
      busy('Creating backup…');
      try { const { blob, counts } = await buildBackup({ originals: orig.checked }); busy();
        const r = await sendBlob(blob, `PosterForge-backup-${window.PF.stamp()}.pfbackup`, 'application/octet-stream', 'save');
        if (r.ok) toast(`Backup saved (${counts.projects || 0} projects, ${(blob.size / 1048576).toFixed(1)} MB) to ${r.where || 'Downloads'}`, '', 5000); else toast('Backup failed: ' + r.error, 'error');
      } catch (e) { busy(); toast('Backup failed: ' + e.message, 'error'); } } }),
    el('button', { class: 'btn-tonal rip', id: 'btnBackupShare', text: 'Share backup (Drive, WhatsApp…)', onclick: async () => {
      busy('Creating backup…'); try { const { blob } = await buildBackup({ originals: orig.checked }); busy(); await sendBlob(blob, `PosterForge-backup-${window.PF.stamp()}.pfbackup`, 'application/octet-stream', 'share'); } catch (e) { busy(); toast(e.message, 'error'); } } }),
    el('label', { class: 'btn-tonal rip file-btn', for: 'restoreInput' }, 'Restore from a backup file…', file));
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = ''; if (!f) return;
    if (!(await confirmSheet('Restore backup?', 'Projects, fonts and styles from the file are added. Items with the same name/id are replaced; nothing else is deleted.', 'Restore'))) return;
    busy('Restoring…');
    try { const r = await restoreBackup(await f.text()); await window.PFFonts?.loadUserFonts(); busy();
      toast(`Restored ${r.counts.projects || 0} projects, ${r.counts.userfonts || 0} font files`, '', 5000); window.dispatchEvent(new Event('pf:projects'));
    } catch (e) { busy(); toast('Restore failed: ' + e.message, 'error'); }
  });
  await sheet({ title: 'Backup & restore', body, actions: [{ label: 'Close', value: null, kind: 'btn-ghost' }] });
}
window.PFBackup = { buildBackup, restoreBackup, backupSheet };
