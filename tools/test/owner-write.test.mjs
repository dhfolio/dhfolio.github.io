// Phase 2.2: owner writes, journal, committer (commit protocol, conflicts, failures).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeGitHub } from "./fake-github.mjs";
import { createGitHub } from "../../js/localapi/owner/github.js";
import { createStore, memoryCache } from "../../js/localapi/owner/store.js";
import { createJournal, memoryJournalStorage } from "../../js/localapi/owner/journal.js";
import { createCommitter } from "../../js/localapi/owner/committer.js";
import { createEditor } from "../../js/localapi/owner/editor.js";
import { applyFile } from "../../js/localapi/shared/dataset.js";
import { handle } from "../../js/localapi/index.js";

const j = (v) => `${JSON.stringify(v, null, 1)}\n`;
const T0 = "2026-01-01T00:00:00";
const paper = (id, o = {}) => ({ id, title: id, authors: "", affiliations: "", year: "", journal: "", shortJournal: "", volume: "", pages: "",
  citationCount: 0, citationSource: "", type: "paper", doi: "", url: "", pdfPath: "", tags: [], starred: false, pinned: false, isRead: false,
  status: "unread", notes: "", summary: "", sourceType: "manual", sourceName: "", addedAt: T0, updatedAt: T0, deletedAt: null, authorOrder: null,
  isCoFirst: false, correspondingRole: "none", isPublic: false, isMine: false, isLast: false, isSelected: false, inLibrary: true, showOnProfile: true,
  extraLinks: [], authorAnnotations: {}, profileTags: [], ...o });

function baseFiles(extra = {}) {
  return {
    "atlas.json": j({ schema: 1, ownerSlug: "dukhyun" }),
    "profile.json": j({ slug: "dukhyun", name: "Owner", notes: "" }),
    "papers/p1.json": j(paper("p1", { tags: ["2D"] })),
    "papers/p2.json": j(paper("p2", { tags: ["2D", "AI"], deletedAt: "2026-02-01T00:00:00" })),
    "references/p2.json": j({ paperId: "p2", rows: [] }),
    "manual-links/L1.json": j({ id: "L1", paperA: "p1", paperB: "p2", createdAt: T0 }),
    "tags/1.json": j({ id: 1, name: "2D", createdAt: T0, updatedAt: T0 }),
    "tags/2.json": j({ id: 2, name: "AI", createdAt: T0, updatedAt: T0 }),
    ...extra,
  };
}

async function setup({ files = baseFiles(), journalEntries = [], readOnly = "" } = {}) {
  const fake = createFakeGitHub(files);
  const gh = createGitHub({ token: "t", repo: "dhfolio/atlas-data", fetch: fake.fetch });
  const store = createStore({ gh, cache: memoryCache() });
  const storage = memoryJournalStorage(journalEntries);
  const journal = await createJournal(storage);
  const timers = [];
  const statuses = [];
  const committer = createCommitter({
    store, journal, onStatus: (s) => statuses.push(s),
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  let ready = null;
  const dataset = () => (ready ||= store.dataset().then((ds) => {
    for (const [p, t] of journal.entries()) applyFile(ds, p, t);
    if (journal.size) committer.schedule();
    return ds;
  }));
  const editor = createEditor({ dataset, journal, committer, readOnly });
  const owner = { dataset, mediaDataUrl: async () => "", editor };
  const call = async (method, path, body) => handle({ method, path, body: body === undefined ? undefined : JSON.stringify(body), ownerSlug: "dukhyun", fetch: async () => { throw new Error("no"); }, owner });
  const last = () => statuses.at(-1);
  return { fake, store, journal, storage, committer, timers, statuses, last, call, owner };
}

const file = (fake, path) => {
  const t = fake.headFiles().get(path);
  return t == null ? undefined : JSON.parse(t);
};

test("adding a paper: answered at once, one commit with the paper and its new tag", async () => {
  const { fake, call, committer, journal, timers, last } = await setup();
  const res = await call("POST", "/api/papers", { id: "new1", title: "Fresh", tags: ["New tag", "2D", "new TAG"], addedAt: "2026-11-11T00:00:00", updatedAt: "2026-11-11T00:00:00", url: "https://x.org" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.tags, ["2D", "New tag"], "trimmed, case-insensitive dedupe, casefold order");
  assert.equal(res.body.deletedAt, null);
  assert.equal(res.body.inLibrary, true);
  assert.equal(last().state, "pending");
  assert.deepEqual(timers.map((t) => t.ms), [5000], "save 5 s after the edit");
  assert.equal((await call("GET", "/api/state")).body.papers.some((p) => p.id === "new1"), true, "visible before the commit");

  await committer.flush();
  assert.equal(last().state, "saved");
  assert.equal(journal.size, 0);
  assert.deepEqual(file(fake, "papers/new1.json").tags, ["2D", "New tag"]);
  assert.deepEqual(file(fake, "tags/3.json"), { id: 3, name: "New tag", createdAt: file(fake, "tags/3.json").createdAt, updatedAt: file(fake, "tags/3.json").updatedAt });
  assert.equal(fake.commitMessages().length, 2, "one commit on top of the initial one");
  assert.match(fake.commitMessages()[0], /papers\/new1\.json/);
  assert.equal((await call("POST", "/api/papers", { id: "new1", addedAt: "x" })).status, 409);
});

test("validation: missing addedAt, bad JSON, script links", async () => {
  const { call } = await setup();
  assert.equal((await call("POST", "/api/papers", { id: "a" })).status, 422);
  assert.equal((await handle({ method: "POST", path: "/api/papers", body: "{", ownerSlug: "dukhyun", fetch: null, owner: (await setup()).owner })).status, 422);
  const bad = await call("PUT", "/api/papers/p1", { ...paper("p1"), url: "javascript:alert(1)" });
  assert.deepEqual([bad.status, bad.body.detail], [400, "URL must be an http(s) or mailto link."]);
  assert.equal((await call("PUT", "/api/papers/p1", { ...paper("p1"), extraLinks: [{ label: "x", url: " JavaScript:x" }] })).status, 400);
  assert.equal((await call("PUT", "/api/papers/nope", paper("nope"))).status, 404);
});

test("update keeps Bin state; delete is a soft delete; restore and permanent delete", async () => {
  const { fake, call, committer } = await setup();
  const put = await call("PUT", "/api/papers/p2", { ...paper("p2"), title: "Edited while binned", updatedAt: "" });
  assert.equal(put.body.deletedAt, "2026-02-01T00:00:00");
  assert.match(put.body.updatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/, "empty updatedAt becomes now");
  const del = await call("DELETE", "/api/papers/p1");
  assert.equal(del.status, 204);
  assert.deepEqual((await call("GET", "/api/bin")).body.map((p) => p.id).sort(), ["p1", "p2"]);
  assert.equal((await call("POST", "/api/bin/p1/restore")).body.deletedAt, null);
  assert.equal((await call("POST", "/api/bin/p1/restore")).status, 404, "not in the Bin any more");
  assert.equal((await call("DELETE", "/api/bin/p2")).status, 204);
  await committer.flush();
  const head = fake.headFiles();
  assert.ok(!head.has("papers/p2.json") && !head.has("references/p2.json") && !head.has("manual-links/L1.json"), "paper, its references and links are gone");
  assert.equal(file(fake, "papers/p1.json").deletedAt, null);
});

test("bulk endpoints count only eligible papers", async () => {
  const { call } = await setup();
  assert.deepEqual((await call("POST", "/api/papers/bulk-status", { paperIds: ["p1", "p2", "zz"], status: "read" })).body, { count: 1 });
  assert.deepEqual((await call("POST", "/api/papers/bulk-profile-visibility", { paperIds: ["p1"], showOnProfile: false })).body, { count: 1 });
  assert.deepEqual((await call("POST", "/api/papers/bulk-delete", { paperIds: ["p1", "p2"] })).body, { count: 1 });
  assert.deepEqual((await call("POST", "/api/bin/bulk-restore", { paperIds: ["p1", "p2"] })).body, { count: 2 });
  assert.deepEqual((await call("DELETE", "/api/bin")).body, { count: 0 });
});

test("tag rename and delete follow every paper without touching updatedAt", async () => {
  const { fake, call, committer } = await setup();
  assert.equal((await call("PUT", "/api/tags/1", { name: "AI" })).status, 409);
  const renamed = await call("PUT", "/api/tags/1", { name: "Two-D" });
  assert.equal(renamed.body.name, "Two-D");
  await call("DELETE", "/api/tags/2");
  await committer.flush();
  assert.deepEqual(file(fake, "papers/p1.json").tags, ["Two-D"]);
  assert.deepEqual(file(fake, "papers/p2.json").tags, ["Two-D"]);
  assert.equal(file(fake, "papers/p1.json").updatedAt, T0);
  assert.equal(fake.headFiles().has("tags/2.json"), false);
  assert.deepEqual((await call("POST", "/api/tags", { name: "  " })).status, 400);
  // max+1 (plan §1): two devices picking the same id write the same file, which the committer reports as a conflict.
  assert.deepEqual((await call("POST", "/api/tags", { name: "Fresh" })).body.id, 2);
});

test("manual links: create (canonical pair, 409 twice), list, delete", async () => {
  const { call } = await setup({ files: baseFiles({ "papers/p3.json": j(paper("p3")) }) });
  const made = await call("POST", "/api/papers/p3/manual-links", { targetPaperId: "p1" });
  assert.equal(made.status, 200);
  assert.equal(made.body.otherPaper.id, "p1");
  assert.equal((await call("POST", "/api/papers/p1/manual-links", { targetPaperId: "p3" })).status, 409);
  assert.equal((await call("POST", "/api/papers/p1/manual-links", { targetPaperId: "p1" })).status, 400);
  assert.equal((await call("GET", "/api/papers/p1/manual-links")).body.length, 1, "link to the binned p2 is hidden");
  assert.equal((await call("DELETE", `/api/papers/p1/manual-links/${made.body.id}`)).status, 204);
});

test("another device committed other files meanwhile: folded in, saved without asking", async () => {
  const { fake, call, committer, store, last } = await setup();
  await call("PUT", "/api/papers/p1", { ...paper("p1"), title: "mine" });
  const remote = fake.remoteCommit({ "papers/p9.json": j(paper("p9", { title: "from phone" })) });
  await committer.flush();
  assert.equal(last().state, "saved");
  assert.equal(file(fake, "papers/p1.json").title, "mine");
  assert.equal(file(fake, "papers/p9.json").title, "from phone");
  assert.ok((await store.dataset()).papers.some((p) => p.id === "p9"), "the phone's paper is in this page's data now");
  assert.notEqual(fake.head, remote);
});

test("same file changed on another device: stop, then 'mine' or 'theirs'", async () => {
  for (const choice of ["mine", "theirs"]) {
    const { fake, call, committer, journal, store, last } = await setup();
    await call("PUT", "/api/papers/p1", { ...paper("p1"), title: "mine" });
    await call("PUT", "/api/profile", { notes: "kept either way" });
    fake.remoteCommit({ "papers/p1.json": j(paper("p1", { title: "theirs" })) });
    await committer.flush();
    assert.equal(last().state, "conflict");
    assert.deepEqual(last().paths, ["papers/p1.json"]);
    assert.equal(journal.size, 2, "nothing lost while waiting");
    await committer.resolve(choice);
    assert.equal(last().state, "saved", choice);
    assert.equal(file(fake, "papers/p1.json").title, choice);
    assert.equal((await store.dataset()).papers.find((p) => p.id === "p1").title, choice);
    assert.equal(file(fake, "profile.json").notes, "kept either way");
  }
});

test("offline: edits wait in the journal and go out when the connection is back", async () => {
  const { fake, call, committer, journal, storage, timers, last } = await setup();
  await call("PUT", "/api/profile", { notes: "on the train" });
  fake.faults.offline = true;
  await committer.flush();
  assert.equal(last().state, "offline");
  assert.equal(journal.size, 1);
  assert.deepEqual(storage.peek().map(([p]) => p), ["profile.json"], "persisted for the next page load");
  assert.deepEqual(timers.map((t) => t.ms), [30000], "retries by itself");
  fake.faults.offline = false;
  await committer.flush();
  assert.equal(last().state, "saved");
  assert.equal(file(fake, "profile.json").notes, "on the train");
});

test("expired token: blocked with the journal kept until a new token is in", async () => {
  const { fake, call, committer, journal, last } = await setup();
  await call("PUT", "/api/profile", { notes: "x" });
  fake.faults.status = 401;
  await committer.flush();
  assert.equal(last().state, "auth");
  fake.faults.status = 0;
  await committer.flush();
  assert.equal(last().state, "auth", "stays blocked; no silent retry with a dead token");
  assert.equal(journal.size, 1);
  await committer.unblock();
  assert.equal(last().state, "saved");
});

test("rate limit waits for retry-after", async () => {
  const { fake, call, committer, timers, last } = await setup();
  await call("PUT", "/api/profile", { notes: "x" });
  fake.faults.status = 403;
  fake.faults.headers = { "retry-after": "42" };
  await committer.flush();
  assert.equal(last().state, "ratelimit");
  assert.deepEqual(timers.map((t) => t.ms), [42000]);
});

test("mass-delete guard stops an unexpected wipe; deliberate bulk deletes pass", async () => {
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`papers/q${i}.json`, j(paper(`q${i}`, { deletedAt: T0 }))]));
  const { fake, journal, committer, call, last } = await setup({ files: baseFiles(many) });
  await journal.set("papers/p1.json", null);
  for (let i = 0; i < 25; i++) await journal.set(`papers/q${i}.json`, null);
  await committer.flush();
  assert.equal(last().state, "confirm-delete");
  assert.ok(fake.headFiles().has("papers/q0.json"), "nothing deleted yet");
  await committer.confirmDelete();
  assert.equal(last().state, "saved");
  assert.equal(fake.headFiles().has("papers/q0.json"), false);

  const second = await setup({ files: baseFiles(many) });
  assert.deepEqual((await second.call("DELETE", "/api/bin")).body, { count: 31 });
  await second.committer.flush();
  assert.equal(second.last().state, "saved", "Empty Bin is deliberate");
});

test("journal replay: unsaved edits from a closed tab are applied and committed; an already-landed one is not repeated", async () => {
  const entry = ["papers/p1.json", j(paper("p1", { title: "typed before the tab closed" }))];
  const { fake, call, committer, timers } = await setup({ journalEntries: [entry] });
  assert.equal((await call("GET", "/api/papers/p1")).body.title, "typed before the tab closed");
  assert.equal(timers.length, 1, "save scheduled on load");
  await committer.flush();
  assert.equal(file(fake, "papers/p1.json").title, "typed before the tab closed");

  const landed = await setup({ files: { ...baseFiles(), [entry[0]]: entry[1] }, journalEntries: [entry] });
  await landed.call("GET", "/api/papers/p1");
  await landed.committer.flush();
  assert.equal(landed.fake.commitMessages().length, 1, "no empty commit");
  assert.equal(landed.journal.size, 0);
});

test("idle 5 s, but at most 30 s after the first unsaved edit", async () => {
  let t = 0;
  const fake = createFakeGitHub(baseFiles());
  const store = createStore({ gh: createGitHub({ token: "t", repo: "dhfolio/atlas-data", fetch: fake.fetch }), cache: memoryCache() });
  const journal = await createJournal(memoryJournalStorage());
  const armed = [];
  const committer = createCommitter({ store, journal, now: () => t, setTimer: (fn, ms) => (armed.push(ms), {}), clearTimer: () => {} });
  await journal.set("profile.json", "{}\n");
  committer.schedule();
  t = 20000; committer.schedule();
  t = 28000; committer.schedule();
  assert.deepEqual(armed, [5000, 5000, 2000]);
});

test("a new paper with a DOI gets its reference list in the background", async () => {
  const fake = createFakeGitHub(baseFiles());
  const gh = createGitHub({ token: "t", repo: "dhfolio/atlas-data", fetch: fake.fetch });
  const store = createStore({ gh, cache: memoryCache() });
  const journal = await createJournal(memoryJournalStorage());
  const committer = createCommitter({ store, journal, setTimer: () => ({}), clearTimer: () => {} });
  const editor = createEditor({ dataset: () => store.dataset(), journal, committer });
  const seen = [];
  // Every provider answers 404: the paper was "fetched, nothing found".
  const providers = async (url) => { seen.push(new URL(url).host); return new Response("{}", { status: 404 }); };
  const res = await handle({ method: "POST", path: "/api/papers", body: JSON.stringify({ id: "d1", doi: "10.1/zzz", addedAt: T0 }), ownerSlug: "dukhyun", fetch: providers, owner: { dataset: () => store.dataset(), mediaDataUrl: async () => "", editor } });
  assert.equal(res.status, 200, "answered before the lookup finishes");
  await new Promise((r) => setTimeout(r, 50));
  await committer.flush();
  const refs = file(fake, "references/d1.json");
  assert.equal(refs.paperId, "d1");
  assert.deepEqual(refs.rows.map((r) => [r.doi, r.title, r.source]), [["", "", "none"]], "placeholder row, as cache_references stored it");
  assert.ok(seen.every((h) => ["api.crossref.org", "api.openalex.org", "api.semanticscholar.org"].includes(h)), seen.join(","));
});

test("GET /api/metadata: lookup failures come back as JSON errors", async () => {
  const { owner } = await setup();
  const down = async () => new Response("{}", { status: 503 });
  const empty = await handle({ method: "GET", path: "/api/metadata?query=", ownerSlug: "dukhyun", fetch: down, owner });
  assert.equal(empty.status, 422);
  const failed = await handle({ method: "GET", path: "/api/metadata?query=10.1%2Fnothing", ownerSlug: "dukhyun", fetch: down, owner });
  assert.equal(failed.status, 502);
  assert.equal(typeof failed.body.detail, "string");
});

test("read-only tab, whole-state PUT and unported writes", async () => {
  const ro = await setup({ readOnly: "Editing is open in another tab." });
  assert.deepEqual(await ro.call("PUT", "/api/profile", { notes: "x" }), { status: 423, body: { detail: "Editing is open in another tab." } });
  const { call } = await setup();
  assert.equal((await call("PUT", "/api/state", {})).status, 405);
  assert.equal((await call("POST", "/api/imports/csv/preview", {})).status, 501);
});
