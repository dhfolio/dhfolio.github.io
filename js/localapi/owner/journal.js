/**
 * js/localapi/owner/journal.js
 * Edits not yet committed: path → file text (null = delete). Persisted after
 * every change, so a closed tab, a crash or a lost connection loses nothing;
 * the next page load replays the journal and commits it.
 *
 * storage: { load(): Promise<[path, text|null][]>, save(entries): Promise }
 */

export async function createJournal(storage) {
  const entries = new Map(await storage.load().catch(() => []));
  let massDeleteOk = false;
  const persist = () => storage.save([...entries]);
  return {
    get size() { return entries.size; },
    entries: () => [...entries],
    has: (path) => entries.has(path),
    async set(path, text) {
      entries.set(path, text);
      await persist();
    },
    /** Drop the entries a commit carried, unless they were edited again meanwhile. */
    async settle(committed) {
      for (const [path, text] of committed) if (entries.get(path) === text) entries.delete(path);
      await persist();
    },
    async drop(paths) {
      for (const p of paths) entries.delete(p);
      await persist();
    },
    /** Set by deliberate bulk deletions (empty Bin, bulk delete) to pass the mass-delete guard once. */
    get massDeleteOk() { return massDeleteOk; },
    set massDeleteOk(v) { massDeleteOk = Boolean(v); },
  };
}

export function memoryJournalStorage(initial = []) {
  let saved = initial;
  return { load: async () => saved, save: async (e) => { saved = e; }, peek: () => saved };
}

/** Journal kept in the owner cache (IndexedDB), under one key. */
export function cacheJournalStorage(cache, key = "journal") {
  return {
    load: async () => {
      const raw = await cache.get(key);
      try { return raw ? JSON.parse(raw) : []; } catch { return []; }
    },
    save: (entries) => cache.set(key, JSON.stringify(entries)),
  };
}
