/**
 * js/localapi/owner/committer.js
 * Turns the journal into commits on the private repository.
 *
 * One flush = tree (base_tree = the commit we loaded/last wrote; text files
 * inline, deletions as sha:null) → commit → fast-forward ref update.
 * If another device committed meanwhile, the ref update is a conflict:
 *   - none of our paths changed there → fold their commit in, retry (silent)
 *   - some did → stop with state "conflict"; resolve("mine" | "theirs")
 * Records are never merged field by field.
 *
 * Timing: 5 s after the last edit, at most 30 s after the first unsaved one,
 * or immediately via flush() (tab hidden, "save now", coming back online).
 * DOM-free; timers and the status callback are injected.
 */

const DEFAULTS = { idleMs: 5000, maxMs: 30000, retryMs: 30000, massDelete: { count: 20, ratio: 0.2 } };
const RECORD = /^(papers|talks|recognitions|news|tags|profile-tags|manual-links|references)\/[^/]+\.json$/;

export function createCommitter({
  store, journal, branch = "main", onStatus = () => {}, now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
  exclusive = (fn) => fn(), options = {},
}) {
  const opt = { ...DEFAULTS, ...options };
  const gh = store.gh;
  let timer = null;
  let firstPendingAt = null;
  let running = null;
  let blocked = null; // { state, ... } while user action is needed
  let lastCommit = "";
  let status = { state: journal.size ? "pending" : "saved", pending: journal.size };

  function emit(next) {
    status = { pending: journal.size, lastCommit, ...next };
    onStatus(status);
  }

  function arm(ms) {
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; flush(); }, Math.max(0, ms));
  }

  function schedule() {
    if (blocked) return emit(blocked);
    if (!journal.size) return emit({ state: "saved" });
    if (firstPendingAt === null) firstPendingAt = now();
    arm(Math.min(opt.idleMs, opt.maxMs - (now() - firstPendingAt)));
    emit({ state: "pending" });
  }

  function flush() {
    if (!running) running = Promise.resolve(exclusive(run)).finally(() => { running = null; });
    return running;
  }

  const message = (entries) => {
    const names = entries.filter(([p]) => !p.startsWith("media/")).map(([p, t]) => `${t === null ? "-" : ""}${p}`);
    if (!names.length) names.push(...entries.map(([p]) => p));
    return `edit: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` (+${names.length - 3})` : ""}`;
  };

  async function attempt(entries) {
    let snap = await store.snapshot();
    for (let round = 0; round < 3; round++) {
      const tree = [];
      for (const [path, text] of entries) {
        if (text === null) {
          if (snap.tree.has(path)) tree.push({ path, mode: "100644", type: "blob", sha: null });
        } else if (typeof text === "object") {
          // A photo ({base64}): binary, so it is a blob of its own; skipped if the tree already has it.
          if (!snap.tree.has(path)) tree.push({ path, mode: "100644", type: "blob", sha: await gh.createBlobBase64(text.base64) });
        } else {
          tree.push({ path, mode: "100644", type: "blob", content: text });
        }
      }
      if (!tree.length) return { done: true };
      const treeSha = await gh.createTree(snap.treeSha, tree);
      // A replayed journal whose commit had already landed: nothing to do.
      if (treeSha === snap.treeSha) return { done: true };
      const commit = await gh.createCommit(message(entries), treeSha, [snap.commit]);
      try {
        await gh.updateRef(branch, commit);
      } catch (err) {
        if (err.kind !== "conflict") throw err;
        const head = await gh.getHead(branch);
        const mine = new Set(entries.map(([p]) => p));
        const changed = await store.applyRemote(head, mine);
        snap = await store.snapshot();
        const overlap = changed.filter((p) => mine.has(p));
        if (overlap.length) return { conflict: overlap };
        continue;
      }
      store.setBase({ commit, treeSha, tree: await gh.getTree(treeSha) });
      lastCommit = commit;
      return { done: true };
    }
    return { busy: true };
  }

  async function run() {
    if (timer) { clearTimer(timer); timer = null; }
    firstPendingAt = null;
    if (blocked) return emit(blocked);
    const entries = journal.entries();
    if (!entries.length) return emit({ state: "saved" });

    const deletes = entries.filter(([p, t]) => t === null && RECORD.test(p)).length;
    if (deletes > opt.massDelete.count && !journal.massDeleteOk) {
      const snap = await store.snapshot();
      const records = [...snap.tree.keys()].filter((p) => RECORD.test(p)).length;
      if (deletes > opt.massDelete.ratio * records) {
        blocked = { state: "confirm-delete", deletes, message: `${deletes} records would be deleted in one save.` };
        return emit(blocked);
      }
    }

    emit({ state: "saving" });
    try {
      const result = await attempt(entries);
      if (result.conflict) {
        blocked = { state: "conflict", paths: result.conflict, message: "Changed on another device too." };
        return emit(blocked);
      }
      if (result.busy) {
        emit({ state: "error", message: "The repository kept changing; retrying shortly." });
        return arm(opt.retryMs);
      }
      await journal.settle(entries);
      journal.massDeleteOk = false;
      if (journal.size) return schedule();
      return emit({ state: "saved" });
    } catch (err) {
      const kind = err && err.kind;
      if (kind === "offline") { emit({ state: "offline", message: err.message }); return arm(opt.retryMs); }
      if (kind === "ratelimit") { emit({ state: "ratelimit", message: err.message }); return arm((err.retryAfter || 60) * 1000); }
      if (kind === "auth" || kind === "perm") {
        blocked = { state: kind, message: err.message };
        return emit(blocked);
      }
      emit({ state: "error", message: (err && err.message) || String(err) });
      if (kind === "server") arm(opt.retryMs);
    }
  }

  return {
    get status() { return status; },
    schedule,
    flush,
    /** Mass-delete guard: the user confirmed. */
    confirmDelete() {
      if (blocked?.state !== "confirm-delete") return;
      blocked = null;
      journal.massDeleteOk = true;
      return flush();
    },
    /**
     * Conflict: "mine" writes our version of the clashing files over theirs;
     * "theirs" drops our edits to those files and loads theirs.
     */
    async resolve(choice) {
      if (blocked?.state !== "conflict") return;
      const paths = blocked.paths;
      blocked = null;
      if (choice === "theirs") {
        await journal.drop(paths);
        const snap = await store.snapshot();
        await store.reloadPaths(paths.filter((p) => snap.tree.has(p)), paths.filter((p) => !snap.tree.has(p)));
      }
      return flush();
    },
    /** A new token was entered after "auth": try again. */
    unblock() {
      blocked = null;
      return flush();
    },
  };
}
