/**
 * js/localapi/owner/session.js
 * Owner mode for this browser: the token stored by the Owner dialog
 * (js/owner-ui.js), validated once per page load, and the dataset store.
 * Imported by boot.js only when a token is present.
 */

import { createGitHub } from "./github.js?v=1.0.2";
import { createStore } from "./store.js?v=1.0.2";
import { deleteCache, idbCache } from "./idb.js?v=1.0.2";

export const TOKEN_KEY = "atlas-gh-token";

export function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

/** {owner} when the token works, {error} otherwise. Never throws. */
export async function startOwner({ cfg, fetch }) {
  const token = readToken();
  if (!token) return { error: { kind: "none", message: "No token on this device." } };
  try {
    const gh = createGitHub({ token, repo: cfg.dataRepo, fetch, apiBase: cfg.githubApi || "https://api.github.com" });
    await gh.getRepo();
    const store = createStore({
      gh,
      cache: idbCache(),
      onProgress: (p) => window.dispatchEvent(new CustomEvent("atlas-owner-progress", { detail: p })),
    });
    return {
      owner: {
        dataset: () => store.dataset(),
        snapshot: () => store.snapshot(),
        mediaDataUrl: (path) => store.mediaDataUrl(path),
      },
    };
  } catch (err) {
    return { error: { kind: err.kind || "bad", message: err.message || String(err) } };
  }
}

/** Forget the token and every cached record on this device. */
export async function lock() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  await deleteCache();
}
