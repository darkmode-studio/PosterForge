(() => {
  const files = {}; let key = '';
  window.__pfFiles = files; window.__geminiCalls = [];
  window.__geminiReply = () => ({ ok: false, error: 'no mock' });
  window.PFNative = {
    isAvailable: () => true, platform: () => 'test', appVersion: () => '1.0.0-test',
    hasApiKey: () => !!key, apiKeyHint: () => key ? '••••' + key.slice(-4) : '', setApiKey: (v) => { key = v; return true; }, clearApiKey: () => { key = ''; },
    haptic: () => {},
    begin: (name, mime) => { const t = 'f' + Object.keys(files).length; files[t] = { name, mime, b64: [] }; return t; },
    append: (t, b64) => { files[t].b64.push(b64); return true; },
    finish: (t, action) => { files[t].action = action; setTimeout(() => window.__pfNativeCb(t, JSON.stringify({ ok: true, where: 'Pictures/PosterForge' })), 10); },
    defaultModels: () => JSON.stringify(['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.6-flash']),
    geminiModels: (t) => setTimeout(() => window.__pfNativeCb(t, JSON.stringify({ ok: true, models: [{ id: 'gemini-3.8-flash' }, { id: 'gemini-3.6-flash' }, { id: 'gemini-3.5-flash-lite' }] })), 20),
    gemini: (t, model, body) => { const b = JSON.parse(body); window.__geminiCalls.push({ model, body: b }); setTimeout(() => window.__pfNativeCb(t, JSON.stringify(window.__geminiReply(b))), 30); },
  };

  // --- 1.1.0 job/export protocol: same contract as NativeBridge.kt, implemented with imaging.jsJob ---
  const jobs = {}; let seq = 0;
  window.__pfJobLog = []; window.__pfProgressLog = []; window.__pfMem = { maxExportPixels: 80e6, availMem: 3e9, lowMemory: false };
  window.__pfExports = [];
  const b64ToBytes = (parts) => { const s = atob(parts.join('')); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const prog = (t, f) => { window.__pfProgressLog.push([t, f]); window.__pfNativeProgress && window.__pfNativeProgress(t, f); };
  Object.assign(window.PFNative, {
    memoryInfo: () => JSON.stringify(window.__pfMem),
    jobBegin: (kind, params) => { const t = 'j' + (++seq); jobs[t] = { kind, params: JSON.parse(params), b64: [], cancelled: false }; window.__pfJobLog.push(kind); return t; },
    jobAppend: (t, b64) => { if (!jobs[t]) return false; jobs[t].b64.push(b64); return true; },
    jobCancel: (t) => { if (jobs[t]) jobs[t].cancelled = true; },
    jobRelease: () => {},
    jobRun: (t) => { const j = jobs[t]; setTimeout(async () => {
      try {
        const im = await import('./js/imaging.js');
        const blob = new Blob([b64ToBytes(j.b64)]);
        const r = await im.jsJob(j.kind, blob, j.params, (f) => prog(t, f));
        window.__pfNativeCb(t, JSON.stringify(j.cancelled ? { ok: false, error: 'Cancelled', cancelled: true } : r));
      } catch (e) { window.__pfNativeCb(t, JSON.stringify({ ok: false, error: String(e && e.message || e) })); }
      delete jobs[t];
    }, 5); },
    exportBegin: (w, h, mime, quality, name) => { const t = 'x' + (++seq); const c = document.createElement('canvas'); c.width = w; c.height = h; jobs[t] = { c, mime, quality, name, tiles: [] }; return JSON.stringify({ ok: true, token: t }); },
    exportTile: (t, x, y, b64) => { const j = jobs[t]; if (!j) return false; j.tiles.push([x, y, b64ToBytes([b64])]); return true; },
    exportFinish: (t, action) => { const j = jobs[t]; setTimeout(async () => {
      const ctx = j.c.getContext('2d');
      for (const [x, y, bytes] of j.tiles) { const bm = await createImageBitmap(new Blob([bytes], { type: 'image/png' })); ctx.drawImage(bm, x, y); bm.close(); }
      prog(t, 0.5);
      const blob = await new Promise((r) => j.c.toBlob(r, j.mime, j.quality / 100));
      const buf = new Uint8Array(await blob.arrayBuffer()); let s2 = ''; for (let i = 0; i < buf.length; i += 0x8000) s2 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      const ft = 'f' + Object.keys(files).length; files[ft] = { name: j.name, mime: j.mime, b64: [btoa(s2)], action, tiles: j.tiles.length };
      window.__pfExports.push({ w: j.c.width, h: j.c.height, tiles: j.tiles.length, mime: j.mime });
      prog(t, 1); delete jobs[t];
      window.__pfNativeCb(t, JSON.stringify({ ok: true, where: 'Pictures/PosterForge' }));
    }, 5); },
  });
})();

// --- 2.1 subject lift + image clipboard: same contract as NativeBridge.kt / SubjectLift.kt ---
(() => {
  const P = window.PFNative; const jobRun0 = P.jobRun; const jobBegin0 = P.jobBegin; const jobAppend0 = P.jobAppend;
  const subj = {}; let seq = 0;
  window.__pfSubject = { playServices: true, mode: 'ellipse' }; // mode: ellipse | none | no_play_services | model_downloading
  window.__pfClipboard = null; window.__pfCopies = [];
  const b64ToBytes = (parts) => { const s = atob(parts.join('')); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  P.subjectInfo = () => JSON.stringify({ playServices: window.__pfSubject.playServices });
  P.jobBegin = (kind, params) => { if (kind !== 'subject') return jobBegin0(kind, params); const t = 's' + (++seq); subj[t] = { params: JSON.parse(params), b64: [] }; window.__pfJobLog.push(kind); return t; };
  P.jobAppend = (t, b64) => (subj[t] ? (subj[t].b64.push(b64), true) : jobAppend0(t, b64));
  P.jobRun = (t) => { const j = subj[t]; if (!j) return jobRun0(t); setTimeout(async () => {
    const m = window.__pfSubject.mode;
    if (m === 'whole') { // buggy engine: returns the whole opaque photo (the 2.1.0 device bug)
      const bm = await createImageBitmap(new Blob([b64ToBytes(j.b64)])); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; c.getContext('2d').drawImage(bm, 0, 0);
      window.__pfNativeCb(t, JSON.stringify({ ok: true, url: c.toDataURL('image/png'), w: bm.width, h: bm.height, x: 0, y: 0, srcW: bm.width, srcH: bm.height })); return; }
    if (m !== 'ellipse') { window.__pfNativeCb(t, JSON.stringify({ ok: false, code: m === 'none' ? 'no_subject' : m, error: m })); return; }
    const bm = await createImageBitmap(new Blob([b64ToBytes(j.b64)])); const W = bm.width, H = bm.height;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    x.beginPath(); x.ellipse(W / 2, H / 2, W * 0.2, H * 0.2, 0, 0, Math.PI * 2); x.clip(); x.drawImage(bm, 0, 0);
    const bx = Math.round(W * 0.3), by = Math.round(H * 0.3), bw = Math.round(W * 0.4), bh = Math.round(H * 0.4);
    const o = document.createElement('canvas'); o.width = bw; o.height = bh; o.getContext('2d').drawImage(c, bx, by, bw, bh, 0, 0, bw, bh);
    window.__pfNativeProgress && window.__pfNativeProgress(t, 1);
    window.__pfNativeCb(t, JSON.stringify({ ok: true, url: o.toDataURL('image/png'), w: bw, h: bh, x: bx, y: by, srcW: W, srcH: H }));
  }, 20); };
  const finish0 = P.finish;
  P.finish = (t, action) => { if (action !== 'copy') return finish0(t, action); const f = window.__pfFiles[t]; f.action = 'copy'; window.__pfClipboard = f; window.__pfCopies.push(f.name);
    setTimeout(() => window.__pfNativeCb(t, JSON.stringify({ ok: true, copied: true })), 10); };
  P.clipboardImage = (t) => setTimeout(() => { const f = window.__pfClipboard;
    window.__pfNativeCb(t, JSON.stringify(f ? { ok: true, url: 'data:' + f.mime + ';base64,' + f.b64.join(''), w: 0, h: 0 } : { ok: false, code: 'empty', error: 'Clipboard is empty' })); }, 10);
})();
