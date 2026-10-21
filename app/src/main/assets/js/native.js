// Thin wrapper around window.PFNative (Kotlin). In a plain browser the file actions fall back to a download.
const waiting = new Map();
window.__pfNativeCb = (token, json) => {
  const fn = waiting.get(token);
  if (!fn) return;
  waiting.delete(token);
  try { fn(JSON.parse(json)); } catch (e) { fn({ ok: false, error: String(e) }); }
};

const progressFns = new Map();
window.__pfNativeProgress = (token, f) => { const fn = progressFns.get(token); if (fn) try { fn(Number(f)); } catch (_) {} };

export const N = () => (window.PFNative && window.PFNative.isAvailable && window.PFNative.isAvailable() ? window.PFNative : null);
export const hasNative = () => !!N();

function wait(token, ms) {
  return new Promise((resolve) => {
    waiting.set(token, resolve);
    if (ms) setTimeout(() => { if (waiting.has(token)) { waiting.delete(token); resolve({ ok: false, error: 'Timed out' }); } }, ms);
  });
}

/** Sends a Blob to Android: "save" (Gallery / Downloads through MediaStore) or "share". */
export async function sendBlob(blob, name, mime, action) {
  const n = N();
  if (!n) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return { ok: true, where: 'Downloads (browser)' };
  }
  const token = n.begin(name, mime);
  if (!(await streamB64(blob, (b64) => n.append(token, b64)))) return { ok: false, error: 'Write failed' };
  const p = wait(token, 120000);
  n.finish(token, action);
  return p;
}

/** Gemini generateContent through the native bridge (the key never enters the WebView). */
export async function gemini(body, model) {
  const n = N();
  if (!n) return { ok: false, error: 'AI tools need the Android app (no bridge in this browser).' };
  if (!n.hasApiKey()) return { ok: false, error: 'NO_KEY' };
  const token = 'g' + Date.now() + Math.random().toString(36).slice(2);
  const p = wait(token, 120000);
  n.gemini(token, model || '', JSON.stringify(body)); // '' = native picks the newest available Flash
  return p;
}

export function haptic(kind = 'tick') { try { N()?.haptic(kind); } catch (_) {} }

/** Lists text models available to this key (GET /v1beta/models through the bridge). */
export async function geminiModels() {
  const n = N();
  if (!n || !n.geminiModels) return { ok: false, error: 'Needs the Android app' };
  const token = 'm' + Date.now() + Math.random().toString(36).slice(2);
  const p = wait(token, 60000);
  n.geminiModels(token);
  return p;
}
export function defaultModels() {
  try { return JSON.parse(N()?.defaultModels?.() || 'null') || FALLBACK_MODELS; } catch (_) { return FALLBACK_MODELS; }
}
export const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

/** Streams a Blob to the bridge as base64 chunks; yields to the event loop between chunks so the UI stays responsive. */
export async function streamB64(blob, send) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const CH = 510 * 1024; // multiple of 3 so each chunk is clean base64
  for (let i = 0; i < buf.length; i += CH) {
    const part = buf.subarray(i, Math.min(buf.length, i + CH));
    let s = '';
    for (let j = 0; j < part.length; j += 0x8000) s += String.fromCharCode.apply(null, part.subarray(j, j + 0x8000));
    if (!send(btoa(s))) return false;
    if (i + CH < buf.length) await new Promise((r) => setTimeout(r, 0));
  }
  return true;
}
export const hasJobs = () => !!(N() && N().jobBegin);

/**
 * Runs a native image job on a background thread: decode | cutout | filter | trace.
 * Returns { ok, url?, svg?, w, h, ... } or { ok:false, error }. Progress 0..1 via onProgress. Cancel with signal.
 */
export async function nativeJob(kind, blob, params, { onProgress, signal } = {}) {
  const n = N();
  const token = n.jobBegin(kind, JSON.stringify(params || {}));
  if (!(await streamB64(blob, (b64) => n.jobAppend(token, b64)))) return { ok: false, error: 'Transfer failed' };
  if (onProgress) progressFns.set(token, onProgress);
  const p = wait(token, 300000);
  if (signal) { if (signal.aborted) n.jobCancel(token); else signal.addEventListener('abort', () => n.jobCancel(token), { once: true }); }
  n.jobRun(token);
  try { return await p; } finally { progressFns.delete(token); }
}
export function releaseJobURL(url) { try { if (url && /\/jobs\//.test(url)) N()?.jobRelease?.(url); } catch (_) {} }

/** Device memory budget (maxExportPixels etc.), or null in a plain browser. */
export function memoryInfo() { try { return JSON.parse(N()?.memoryInfo?.() || 'null'); } catch (_) { return null; } }
export const hasNativeExport = () => !!(N() && N().exportBegin);

/**
 * Tiled export: renderTile(y, h) must return a PNG Blob of the poster strip [y, y+h). Kotlin stitches and encodes.
 */
export async function nativeExport({ w, h, mime, quality, name, action, tileH, renderTile, onProgress }) {
  const n = N();
  const b = JSON.parse(n.exportBegin(w, h, mime, quality, name));
  if (!b.ok) return b;
  const token = b.token; const tiles = Math.ceil(h / tileH);
  for (let i = 0; i < tiles; i++) {
    const y = i * tileH; const th = Math.min(tileH, h - y);
    const blob = await renderTile(y, th);
    let s = ''; const buf = new Uint8Array(await blob.arrayBuffer());
    for (let j = 0; j < buf.length; j += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(j, j + 0x8000));
    if (!n.exportTile(token, 0, y, btoa(s))) return { ok: false, error: 'Tile transfer failed' };
    onProgress?.(0.8 * (i + 1) / tiles);
    await new Promise((r) => setTimeout(r, 0));
  }
  progressFns.set(token, (f) => onProgress?.(0.8 + 0.2 * f));
  const p = wait(token, 300000);
  n.exportFinish(token, action);
  try { return await p; } finally { progressFns.delete(token); }
}
