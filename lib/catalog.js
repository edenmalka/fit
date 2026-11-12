// The catalog, saved in this browser (IndexedDB) for now.
// Each item: { id, name, w, d, h, glb: Blob (already at real size), photo: Blob|null, createdAt }.
// Note: items live only on the device/browser where they were saved.

// Built-in items ship with the site, so they work for anyone on any phone.
// Bump ?v= whenever an asset file changes, so phones don't show a cached old copy.
export const BUILTIN = [
  { id: 'demo', name: 'ספת דוגמה', w: 200, d: 90, h: 85, url: 'assets/demo-sofa.glb?v=2', builtin: true },
];

const DB = 'fit', STORE = 'items';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function listItems() {
  let saved = [];
  try { saved = await tx('readonly', (s) => s.getAll()); } catch (e) { console.warn(e); }
  saved.sort((a, b) => b.createdAt - a.createdAt);
  return [...saved, ...BUILTIN];
}

export async function getItem(id) {
  const b = BUILTIN.find((x) => x.id === id);
  if (b) return b;
  return tx('readonly', (s) => s.get(id));
}

export async function saveItem(item) {
  const full = { id: crypto.randomUUID().slice(0, 8), createdAt: Date.now(), ...item };
  await tx('readwrite', (s) => s.put(full));
  return full;
}

export async function deleteItem(id) {
  await tx('readwrite', (s) => s.delete(id));
}

/** A URL that model-viewer can load for this item. Caller revokes blob: URLs when done. */
export function modelUrl(item) {
  return item.builtin ? item.url : URL.createObjectURL(item.glb);
}
