/**
 * js/localapi/owner/store.js
 * The private dataset as of a commit: loads head → tree → only the blobs the
 * cache lacks (GraphQL in batches, REST for anything GraphQL did not return).
 * Blobs are cached by sha, so a reload after an edit elsewhere fetches just
 * the changed records. Images are fetched on first use.
 *
 * The dataset object is live: the editor applies local edits to it, and
 * applyRemote() folds in commits made on another device.
 * DOM-free: `gh` (github.js), `cache` ({get,set}) and `onProgress` are injected.
 */

import { applyFile, datasetFromFiles, isDatasetPath } from "../shared/dataset.js?v=1.0.4";
import { bytesToBase64 } from "./github.js?v=1.0.4";

const BATCH = 100;
const REST_CONCURRENCY = 6;
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

const decoder = new TextDecoder();

export function createStore({ gh, cache, onProgress = () => {}, branch = "main" }) {
  let loading = null;
  let snapshot = null; // { commit, treeSha, tree: Map<path, sha>, dataset }

  async function textsFor(commit, wanted, report = true) {
    const out = new Map();
    const missing = [];
    for (const [path, sha] of wanted) {
      const hit = await cache.get(`t:${sha}`);
      if (typeof hit === "string") out.set(path, hit);
      else missing.push([path, sha]);
    }
    let done = out.size;
    const total = wanted.length;
    const progress = () => report && onProgress({ done, total });
    progress();
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      let texts = new Map();
      try {
        texts = await gh.getTexts(commit, batch.map(([p]) => p));
      } catch (err) {
        if (err.kind === "auth" || err.kind === "offline") throw err;
        // GraphQL unavailable: REST below picks up every path.
      }
      for (const [path, sha] of batch) {
        if (!texts.has(path)) continue;
        out.set(path, texts.get(path));
        await cache.set(`t:${sha}`, texts.get(path));
        done++;
        progress();
      }
    }
    const rest = missing.filter(([p]) => !out.has(p));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(REST_CONCURRENCY, rest.length) }, async () => {
      while (next < rest.length) {
        const [path, sha] = rest[next++];
        const text = decoder.decode(await gh.getBlobBytes(sha));
        out.set(path, text);
        await cache.set(`t:${sha}`, text);
        done++;
        progress();
      }
    }));
    return out;
  }

  async function treeOf(commit) {
    const treeSha = (await gh.getCommit(commit)).tree;
    return { treeSha, tree: await gh.getTree(treeSha) };
  }

  async function load() {
    const commit = await gh.getHead(branch);
    const { treeSha, tree } = await treeOf(commit);
    const wanted = [...tree].filter(([path]) => isDatasetPath(path));
    const files = await textsFor(commit, wanted);
    snapshot = { commit, treeSha, tree, dataset: datasetFromFiles(files) };
    return snapshot;
  }

  const store = {
    branch,
    gh,
    /** The live dataset (head at load time plus everything applied since). */
    async dataset() {
      if (!loading) loading = load().catch((err) => { loading = null; throw err; });
      return (await loading).dataset;
    },
    async snapshot() {
      await store.dataset();
      return snapshot;
    },
    /** Whether the loaded tree has this path (false before the first load). */
    has(path) {
      return Boolean(snapshot && snapshot.tree.has(path));
    },
    /** After our own commit landed: the dataset already holds those edits. */
    setBase({ commit, treeSha, tree }) {
      Object.assign(snapshot, { commit, treeSha, tree });
    },
    /**
     * Fold a newer commit made elsewhere into the dataset. `except` paths are
     * left alone (local edits that will be committed on top). Returns the
     * dataset paths that changed remotely.
     */
    async applyRemote(commit, except = new Set()) {
      const { treeSha, tree } = await treeOf(commit);
      const changed = [];
      for (const path of new Set([...snapshot.tree.keys(), ...tree.keys()])) {
        if (snapshot.tree.get(path) !== tree.get(path)) changed.push(path);
      }
      const data = changed.filter((p) => isDatasetPath(p) && !except.has(p));
      const present = data.filter((p) => tree.has(p)).map((p) => [p, tree.get(p)]);
      const texts = await textsFor(commit, present, false);
      for (const p of data) applyFile(snapshot.dataset, p, tree.has(p) ? texts.get(p) : null);
      Object.assign(snapshot, { commit, treeSha, tree });
      return changed;
    },
    /** Put the snapshot's version of these files back into the dataset (conflict → "theirs"). */
    async reloadPaths(present, gone = []) {
      const texts = await textsFor(snapshot.commit, present.map((p) => [p, snapshot.tree.get(p)]), false);
      for (const p of present) applyFile(snapshot.dataset, p, texts.get(p));
      for (const p of gone) applyFile(snapshot.dataset, p, null);
    },
    /** "media/x.jpg" → data: URL (cached by blob sha). */
    async mediaDataUrl(path) {
      const snap = await store.snapshot();
      const sha = snap.tree.get(path);
      const ext = path.split(".").pop();
      if (!sha || !MIME[ext]) return "";
      const key = `m:${sha}`;
      const hit = await cache.get(key);
      if (typeof hit === "string") return hit;
      const url = `data:${MIME[ext]};base64,${bytesToBase64(await gh.getBlobBytes(sha))}`;
      await cache.set(key, url);
      return url;
    },
  };
  return store;
}

/** In-memory cache (tests, and the browser when IndexedDB is unavailable). */
export function memoryCache() {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), clear: async () => m.clear(), size: () => m.size };
}
