/**
 * js/localapi/owner/store.js
 * Loads the private dataset from GitHub: head → tree → only the blobs the
 * cache lacks (GraphQL in batches, REST for anything GraphQL did not return).
 * Blobs are cached by their sha, so a reload after an edit elsewhere fetches
 * just the changed records. Images are fetched on first use.
 * DOM-free: `gh` (github.js), `cache` ({get,set}) and `onProgress` are injected.
 */

import { datasetFromFiles, isDatasetPath } from "../shared/dataset.js?v=1.0.2";
import { bytesToBase64 } from "./github.js?v=1.0.2";

const BATCH = 100;
const REST_CONCURRENCY = 6;
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };

const decoder = new TextDecoder();

export function createStore({ gh, cache, onProgress = () => {}, branch = "main" }) {
  let loading = null;
  let snapshot = null; // { commit, tree: Map<path, sha>, dataset }

  async function textsFor(commit, wanted) {
    const out = new Map();
    const missing = [];
    for (const [path, sha] of wanted) {
      const hit = await cache.get(`t:${sha}`);
      if (typeof hit === "string") out.set(path, hit);
      else missing.push([path, sha]);
    }
    let done = out.size;
    const total = wanted.length;
    onProgress({ done, total });
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
        onProgress({ done: ++done, total });
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
        onProgress({ done: ++done, total });
      }
    }));
    return out;
  }

  async function load() {
    const commit = await gh.getHead(branch);
    const tree = await gh.getTree((await gh.getCommit(commit)).tree);
    const wanted = [...tree].filter(([path]) => isDatasetPath(path));
    const files = await textsFor(commit, wanted);
    snapshot = { commit, tree, dataset: datasetFromFiles(files) };
    return snapshot;
  }

  return {
    /** The dataset of the branch head, loaded once per page. */
    async dataset() {
      if (!loading) loading = load().catch((err) => { loading = null; throw err; });
      return (await loading).dataset;
    },
    async snapshot() {
      await this.dataset();
      return snapshot;
    },
    /** "media/x.jpg" → data: URL (cached by blob sha). */
    async mediaDataUrl(path) {
      const snap = await this.snapshot();
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
}

/** In-memory cache (tests, and the browser when IndexedDB is unavailable). */
export function memoryCache() {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), clear: async () => m.clear(), size: () => m.size };
}
