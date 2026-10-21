// IndexedDB storage: vector library, saved projects and the autosave draft. The API key is NOT stored here.
const DB_NAME = 'posterforge';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('vectors')) db.createObjectStore('vectors', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('userfonts')) db.createObjectStore('userfonts', { keyPath: 'id' }); // imported TTF/OTF files (offline copy)
      if (!db.objectStoreNames.contains('originals')) db.createObjectStore('originals', { keyPath: 'id' }); // full-resolution imports, used for export
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  }));
}

export const saveVectorAsset = (name, svg) => run('vectors', 'readwrite', (s) => s.add({ name, svg, created: Date.now() }));
export const deleteVectorAsset = (id) => run('vectors', 'readwrite', (s) => s.delete(id));
export const getAllVectorAssets = () => run('vectors', 'readonly', (s) => s.getAll()).then((a) => (a || []).sort((x, y) => y.created - x.created));

export const savePosterProject = (p) => run('projects', 'readwrite', (s) => s.put(p));
export const getPosterProject = (id) => run('projects', 'readonly', (s) => s.get(id));
export const deletePosterProject = (id) => run('projects', 'readwrite', (s) => s.delete(id));
export const getAllPosterProjects = () => run('projects', 'readonly', (s) => s.getAll()).then((a) => (a || []).sort((x, y) => y.updated - x.updated));

export const setMeta = (k, v) => run('meta', 'readwrite', (s) => s.put(v, k));
export const getMeta = (k) => run('meta', 'readonly', (s) => s.get(k));

// Original (full-resolution) photos. The canvas works on a downscaled copy; export swaps the original back in.
export const saveOriginal = (rec) => run('originals', 'readwrite', (s) => s.put(rec));
export const getOriginal = (id) => run('originals', 'readonly', (s) => s.get(id));
export const listOriginalIds = () => run('originals', 'readonly', (s) => s.getAllKeys());
export const deleteOriginal = (id) => run('originals', 'readwrite', (s) => s.delete(id));

// Imported fonts (v2): { id, family, label, weight, italic, ml, group, fav, fileName, data: ArrayBuffer, added }
export const saveUserFont = (rec) => run('userfonts', 'readwrite', (s) => s.put(rec));
export const getAllUserFonts = () => run('userfonts', 'readonly', (s) => s.getAll()).then((a) => a || []);
export const deleteUserFont = (id) => run('userfonts', 'readwrite', (s) => s.delete(id));
export const getAllOriginals = () => run('originals', 'readonly', (s) => s.getAll()).then((a) => a || []);
export const clearStore = (name) => run(name, 'readwrite', (s) => s.clear());
export const putRecord = (name, rec, key) => run(name, 'readwrite', (s) => (key === undefined ? s.put(rec) : s.put(rec, key)));
export const getAllRecords = (name) => run(name, 'readonly', (s) => s.getAll()).then((a) => a || []);
export const getAllKeys = (name) => run(name, 'readonly', (s) => s.getAllKeys()).then((a) => a || []);
