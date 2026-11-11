/**
 * js/localapi/owner/idb.js
 * Blob cache in IndexedDB (key → string). Values are contents addressed by
 * git blob sha, so they never go stale. Deleted entirely on Lock.
 */

export const DB_NAME = "atlas-owner";
const STORE = "blobs";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbCache() {
  let dbp = null;
  const db = () => (dbp ||= open());
  const run = (mode, fn) => db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
  return {
    get: (key) => run("readonly", (s) => s.get(key)).catch(() => undefined),
    set: (key, value) => run("readwrite", (s) => s.put(value, key)).catch(() => undefined),
  };
}

export function deleteCache() {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
