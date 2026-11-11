/**
 * js/localapi/owner/session.js
 * Owner mode for this browser: the token stored by the Owner dialog
 * (js/owner-ui.js), validated once per page load; the dataset store; the
 * journal of unsaved edits (replayed on load); the committer; the editor.
 * Imported by boot.js only when a token is present.
 *
 * Only one tab edits at a time (Web Locks "atlas-editor"): the journal is
 * one per browser, and two tabs writing it would undo each other.
 */

import { createGitHub } from "./github.js?v=1.0.4";
import { createStore } from "./store.js?v=1.0.4";
import { deleteCache, idbCache } from "./idb.js?v=1.0.4";
import { cacheJournalStorage, createJournal } from "./journal.js?v=1.0.4";
import { createCommitter } from "./committer.js?v=1.0.4";
import { createEditor } from "./editor.js?v=1.0.4";
import { applyFile } from "../shared/dataset.js?v=1.0.4";

export const TOKEN_KEY = "atlas-gh-token";

export function readToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function editLock() {
  if (!globalThis.navigator?.locks) return Promise.resolve("");
  return new Promise((resolve) => {
    navigator.locks.request("atlas-editor", { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve("Editing is open in another tab or window. Close it and reload this page to edit here.");
        return undefined;
      }
      resolve("");
      return new Promise(() => {}); // held for the life of the page
    });
  });
}

const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

/** {owner} when the token works, {error} otherwise. Never throws. */
export async function startOwner({ cfg, fetch }) {
  const token = readToken();
  if (!token) return { error: { kind: "none", message: "No token on this device." } };
  try {
    const gh = createGitHub({ token, repo: cfg.dataRepo, fetch, apiBase: cfg.githubApi || "https://api.github.com" });
    await gh.getRepo();
    const cache = idbCache();
    const store = createStore({ gh, cache, onProgress: (p) => emit("atlas-owner-progress", p) });
    const journal = await createJournal(cacheJournalStorage(cache));
    const committer = createCommitter({ store, journal, onStatus: (s) => emit("atlas-owner-status", s) });

    // Edits left unsaved by an earlier visit (closed tab, offline) go back on top of head.
    let ready = null;
    const dataset = () => (ready ||= store.dataset().then((ds) => {
      for (const [path, text] of journal.entries()) applyFile(ds, path, text);
      if (journal.size) committer.schedule();
      return ds;
    }).catch((err) => { ready = null; throw err; }));

    const readOnly = await editLock();
    const editor = createEditor({ dataset, journal, committer, readOnly, hasMedia: (p) => store.has(p) });
    // A photo not committed yet is served from the journal.
    const mediaDataUrl = async (path) => {
      const pending = journal.entries().find(([p]) => p === path)?.[1];
      if (pending && typeof pending === "object") return `data:${pending.mime};base64,${pending.base64}`;
      return store.mediaDataUrl(path);
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && journal.size) committer.flush();
    });
    window.addEventListener("online", () => { if (journal.size) committer.flush(); });
    window.__raOwnerActions = {
      flush: () => committer.flush(),
      resolve: (choice) => committer.resolve(choice),
      confirmDelete: () => committer.confirmDelete(),
      pending: () => journal.size,
      status: () => committer.status,
    };
    emit("atlas-owner-status", readOnly ? { state: "readonly", message: readOnly, pending: journal.size } : committer.status);

    return {
      owner: {
        dataset,
        snapshot: () => store.snapshot(),
        mediaDataUrl,
        editor,
      },
    };
  } catch (err) {
    return { error: { kind: err.kind || "bad", message: err.message || String(err) } };
  }
}

/** Forget the token, the cached data and any unsaved edits on this device. */
export async function lock() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  await deleteCache();
}
