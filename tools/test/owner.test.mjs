// Owner read engine (Phase 2.1): GitHub client, store, owner routes through handle().
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeGitHub } from "./fake-github.mjs";
import { createGitHub } from "../../js/localapi/owner/github.js";
import { createStore, memoryCache } from "../../js/localapi/owner/store.js";
import { handle } from "../../js/localapi/index.js";
import { sqlTextCompare } from "../../js/localapi/owner/routes-read.js";

const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const j = (v) => `${JSON.stringify(v, null, 1)}\n`;
const paper = (id, o = {}) => ({ id, title: id, doi: "", year: "", addedAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00", deletedAt: null, inLibrary: true, isMine: false, showOnProfile: true, isPublic: false, tags: [], profileTags: [], ...o });

function files() {
  return {
    "atlas.json": j({ schema: 1, ownerSlug: "dukhyun" }),
    "profile.json": j({ slug: "dukhyun", name: "Owner", notes: "my notes", picture: "media/aaaaaaaaaaaaaaaa.png", profilePublic: true, achievementsPublic: false }),
    "papers/p1.json": j(paper("p1", { updatedAt: "2026-02-01T00:00:00", doi: "10.1/a" })),
    "papers/p2.json": j(paper("p2", { deletedAt: "2026-03-01T00:00:00" })),
    "papers/scholar-1%3A2.json": j(paper("scholar-1:2", { inLibrary: false, isMine: true })),
    "references/p1.json": j({ paperId: "p1", rows: [{ doi: "10.1/x", title: "X", year: "2020", authors: "", journal: "" }] }),
    "tags/3.json": j({ id: 3, name: "beta", createdAt: "c", updatedAt: "u" }),
    "tags/4.json": j({ id: 4, name: "Alpha", createdAt: "c", updatedAt: "u" }),
    "news/n1.json": j({ id: "n1", title: "N", sortDate: "2026-01-01", images: [{ src: "media/aaaaaaaaaaaaaaaa.png", caption: "" }], isPublic: false, deletedAt: null }),
    "media/aaaaaaaaaaaaaaaa.png": PNG,
    "README.md": "# not data\n",
  };
}

function setup(fakeOpts) {
  const fake = createFakeGitHub(files(), fakeOpts);
  const gh = createGitHub({ token: "github_pat_test", repo: "dhfolio/atlas-data", fetch: fake.fetch });
  return { fake, gh };
}

test("store loads the dataset with one GraphQL batch and caches blobs by sha", async () => {
  const { fake, gh } = setup();
  const cache = memoryCache();
  const progress = [];
  const ds = await createStore({ gh, cache, onProgress: (p) => progress.push(p) }).dataset();
  assert.deepEqual(ds.papers.map((p) => p.id).sort(), ["p1", "p2", "scholar-1:2"]);
  assert.equal(ds.profile.notes, "my notes");
  assert.deepEqual(Object.keys(ds.references), ["p1"]);
  assert.equal(fake.calls.filter((c) => c.url.endsWith("/graphql")).length, 1);
  assert.equal(fake.calls.filter((c) => c.url.includes("/git/blobs/")).length, 0, "no REST blob reads when GraphQL answers");
  assert.ok(!fake.calls.some((c) => c.url.includes("README")), "non-dataset files are not read");
  assert.deepEqual(progress.at(-1), { done: 9, total: 9 });

  const before = fake.calls.length;
  await createStore({ gh, cache }).dataset();
  const second = fake.calls.slice(before);
  assert.deepEqual(second.map((c) => c.url.split("/").slice(-2).join("/")).filter((u) => /graphql|blobs/.test(u)), [], "a warm cache reads only ref, commit and tree");
  assert.equal(second.length, 3);
});

test("REST blobs take over when GraphQL is unavailable", async () => {
  const { fake, gh } = setup();
  fake.faults.graphql = false;
  const ds = await createStore({ gh, cache: memoryCache() }).dataset();
  assert.equal(ds.papers.length, 3);
  assert.equal(fake.calls.filter((c) => c.url.includes("/git/blobs/")).length, 9);
});

test("media is fetched on first use and returned as a data: URL", async () => {
  const { fake, gh } = setup();
  const store = createStore({ gh, cache: memoryCache() });
  const url = await store.mediaDataUrl("media/aaaaaaaaaaaaaaaa.png");
  assert.equal(url, `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);
  assert.equal(await store.mediaDataUrl("media/missing0000000000.png"), "");
  const blobReads = fake.calls.filter((c) => c.url.includes("/git/blobs/")).length;
  await store.mediaDataUrl("media/aaaaaaaaaaaaaaaa.png");
  assert.equal(fake.calls.filter((c) => c.url.includes("/git/blobs/")).length, blobReads, "second use is cached");
});

test("the token only ever goes to the API host", async () => {
  const { fake, gh } = setup();
  await createStore({ gh, cache: memoryCache() }).dataset();
  assert.ok(fake.calls.every((c) => c.url.startsWith("https://api.github.com/") && c.auth === "Bearer github_pat_test"));
  assert.throws(() => createGitHub({ token: "t", repo: "not a repo", fetch: fake.fetch }), /bad repository/);
});

function ownerFor(gh) {
  const store = createStore({ gh, cache: memoryCache() });
  return { dataset: () => store.dataset(), mediaDataUrl: (p) => store.mediaDataUrl(p) };
}
const call = (owner, method, path) => handle({ method, path, ownerSlug: "dukhyun", fetch: async () => { throw new Error("no public fetch in owner mode"); }, owner });

test("owner GETs come from the private dataset", async () => {
  const { gh } = setup();
  const owner = ownerFor(gh);
  const state = await call(owner, "GET", "/api/state");
  assert.equal(state.status, 200);
  assert.deepEqual(state.body.papers.map((p) => p.id), ["p1"], "library only, Bin excluded");
  assert.deepEqual(state.body.tags, ["Alpha", "beta"]);
  assert.equal(state.body.profile.notes, "my notes");
  assert.deepEqual((await call(owner, "GET", "/api/bin")).body.map((p) => p.id), ["p2"]);
  assert.deepEqual((await call(owner, "GET", "/api/papers?profile_only=true")).body.map((p) => p.id), ["scholar-1:2"]);
  assert.equal((await call(owner, "GET", `/api/papers/${encodeURIComponent("scholar-1:2")}`)).body.id, "scholar-1:2");
  assert.deepEqual((await call(owner, "GET", "/api/tags")).body[0], { id: 4, name: "Alpha", created_at: "c", updated_at: "u" });
  const me = (await call(owner, "GET", "/api/profile/me")).body;
  assert.ok(me.profile.picture.startsWith("data:image/png;base64,"));
  assert.deepEqual(me.stats, { papers: 1, publications: 0, posts: 0 });
  const news = (await call(owner, "GET", "/api/news")).body;
  assert.equal(news.length, 1, "drafts are the owner's too");
  assert.ok(news[0].images[0].src.startsWith("data:image/png"));
  assert.ok(!("deletedAt" in news[0]));
  const refs = (await call(owner, "GET", "/api/citations/references/p1")).body;
  assert.deepEqual(refs.references.map((r) => r.doi), ["10.1/x"]);
  const pub = (await call(owner, "GET", "/api/profiles/dukhyun")).body;
  assert.deepEqual(pub.publications.map((p) => p.id), ["scholar-1:2"], "public view of the live dataset");
  const other = await call(owner, "GET", "/api/profiles/alice");
  assert.deepEqual([other.status, other.body.detail], [404, "Profile not found."], "the pages' not-found view, as for visitors");
});

test("writes are refused (423) and unported GETs are 501 until editing is switched on", async () => {
  const owner = ownerFor(setup().gh);
  for (const [m, p] of [["POST", "/api/papers"], ["PUT", "/api/papers/p1"], ["DELETE", "/api/bin"], ["PUT", "/api/state"]]) {
    assert.equal((await call(owner, m, p)).status, 423, `${m} ${p}`);
  }
  assert.equal((await call(owner, "GET", "/api/metadata?query=10.1/x")).status, 501);
});

test("GitHub failures become statuses the pages handle, never exceptions", async () => {
  for (const [fault, status, kind] of [[{ status: 401 }, 401, "auth"], [{ offline: true }, 503, "offline"], [{ status: 403 }, 403, "perm"]]) {
    const { fake, gh } = setup();
    Object.assign(fake.faults, fault);
    const res = await call(ownerFor(gh), "GET", "/api/state");
    assert.equal(res.status, status, JSON.stringify(fault));
    assert.equal(res.body.kind, kind);
  }
});

test("GitHub error classification", async () => {
  const { fake, gh } = setup();
  fake.faults.status = 422;
  await assert.rejects(gh.getRepo(), (e) => e.kind === "bad" && e.status === 422);
  const conflict = createGitHub({
    token: "t", repo: "a/b",
    fetch: async () => new Response(JSON.stringify({ message: "Update is not a fast forward" }), { status: 422 }),
  });
  await assert.rejects(conflict.getRepo(), (e) => e.kind === "conflict");
  const limited = createGitHub({
    token: "t", repo: "a/b",
    fetch: async () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
  });
  await assert.rejects(limited.getRepo(), (e) => e.kind === "ratelimit" && e.retryAfter === 60);
});

test("SQL-like text order: case and punctuation are secondary", () => {
  assert.deepEqual(["beta", "Alpha", "alpha", "AI & Work", "AI Work"].sort(sqlTextCompare), ["AI & Work", "AI Work", "alpha", "Alpha", "beta"]);
});
