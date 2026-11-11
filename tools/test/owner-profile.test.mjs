// Phase 2.3: profile, talks, recognitions, news (with photos) — rules ported from research-atlas-v2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createFakeGitHub } from "./fake-github.mjs";
import { createGitHub } from "../../js/localapi/owner/github.js";
import { createStore, memoryCache } from "../../js/localapi/owner/store.js";
import { createJournal, memoryJournalStorage } from "../../js/localapi/owner/journal.js";
import { createCommitter } from "../../js/localapi/owner/committer.js";
import { createEditor } from "../../js/localapi/owner/editor.js";
import { handle } from "../../js/localapi/index.js";
import { project } from "../../js/localapi/shared/projection.js";
import { datasetFromFiles } from "../../js/localapi/shared/dataset.js";

const j = (v) => `${JSON.stringify(v, null, 1)}\n`;
const T0 = "2026-01-01T00:00:00";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_B64}`;
const PNG_PATH = `media/${createHash("sha256").update(Buffer.from(PNG_B64, "base64")).digest("hex").slice(0, 16)}.png`;
const JPG_B64 = Buffer.from("not really a jpeg, but bytes").toString("base64");
const JPG = `data:image/jpeg;base64,${JPG_B64}`;

function files() {
  return {
    "atlas.json": j({ schema: 1, ownerSlug: "dukhyun" }),
    "profile.json": j({ name: "Owner", bio: "", about: "", affiliation: "", scholarUrl: "", websiteUrl: "", linkedinUrl: "", githubUrl: "", facebookUrl: "",
      instagramUrl: "", xUrl: "", youtubeUrl: "", akaNames: "", slug: "dukhyun", picture: "", pictureCaption: "", journalOrder: [], tagOrder: [],
      pubViewPrefs: { showAllPubs: null, sortMode: null, showNumbering: null, positionFilters: [] }, profilePublic: true, achievementsPublic: false,
      notes: "", createdAt: T0, updatedAt: T0 }),
    "news/n1.json": j({ id: "n1", dateLabel: "", sortDate: "2025-01-01", endDate: "", title: "Old", body: "", links: [], images: [{ src: PNG_PATH, caption: "" }],
      isPublic: true, addedAt: T0, updatedAt: T0, deletedAt: null }),
    [PNG_PATH]: Uint8Array.from(Buffer.from(PNG_B64, "base64")),
    "tags/1.json": j({ id: 1, name: "2D", createdAt: T0, updatedAt: T0 }),
  };
}

async function setup() {
  const fake = createFakeGitHub(files());
  const gh = createGitHub({ token: "t", repo: "dhfolio/atlas-data", fetch: fake.fetch });
  const store = createStore({ gh, cache: memoryCache() });
  const journal = await createJournal(memoryJournalStorage());
  const committer = createCommitter({ store, journal, setTimer: () => ({}), clearTimer: () => {} });
  const editor = createEditor({ dataset: () => store.dataset(), journal, committer, hasMedia: (p) => store.has(p) });
  const mediaDataUrl = async (p) => {
    const e = journal.entries().find(([q]) => q === p)?.[1];
    return e && typeof e === "object" ? `data:${e.mime};base64,${e.base64}` : store.mediaDataUrl(p);
  };
  const owner = { dataset: () => store.dataset(), mediaDataUrl, editor };
  const call = (method, path, body) => handle({ method, path, body: body === undefined ? undefined : JSON.stringify(body), ownerSlug: "dukhyun", fetch: null, owner });
  const blobUploads = () => fake.calls.filter((c) => c.method === "POST" && c.url.endsWith("/git/blobs")).length;
  return { fake, store, journal, committer, call, blobUploads };
}
const file = (fake, path) => JSON.parse(fake.headFiles().get(path));

test("PUT /api/profile/me: partial update with the original's cleaning; photo stored once as media/", async () => {
  const { fake, call, committer, blobUploads } = await setup();
  const res = await call("PUT", "/api/profile/me", {
    name: "  New Name ", akaNames: " A , B,,C ", picture: JPG, pictureCaption: "x".repeat(200),
    journalOrder: [" Nature", "nature", "", "Science"], pubViewPrefs: { sortMode: "year", showNumbering: "bogus", positionFilters: ["main", "main", "x"] },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.profile.name, "New Name");
  assert.equal(res.body.profile.akaNames, "A, B, C");
  assert.equal(res.body.profile.pictureCaption.length, 140);
  assert.deepEqual(res.body.profile.journalOrder, ["Nature", "Science"]);
  assert.deepEqual(res.body.profile.pubViewPrefs, { showAllPubs: null, sortMode: "year", showNumbering: null, positionFilters: ["main"] });
  assert.equal(res.body.profile.picture, JPG, "the page gets the photo back as a data URL");
  assert.ok(res.body.stats && res.body.visibility && res.body.username, "same shape as GET /api/profile/me");
  await committer.flush();
  const stored = file(fake, "profile.json");
  assert.match(stored.picture, /^media\/[0-9a-f]{16}\.jpg$/);
  assert.equal(Buffer.from(fake.headFiles().get(stored.picture)).toString("base64"), JPG_B64, "bytes stored as a binary blob");
  assert.equal(stored.bio, "", "fields not sent are unchanged");
  assert.equal(blobUploads(), 1);

  await call("PUT", "/api/profile/me", { picture: JPG });
  await committer.flush();
  assert.equal(blobUploads(), 1, "the same photo is not uploaded again");
  assert.equal((await call("PUT", "/api/profile/me", { akaNames: "a,b,c,d,e,f" })).status, 400);
  assert.equal((await call("PUT", "/api/profile/me", { websiteUrl: "javascript:x" })).status, 400);
  assert.equal((await call("PUT", "/api/profile/me", { picture: "data:image/svg+xml;base64,PHN2Zy8+" })).status, 400, "no SVG under this origin");
  assert.equal((await call("PUT", "/api/profile/me", { picture: "https://elsewhere/x.jpg" })).status, 400);
  const cleared = await call("PUT", "/api/profile/me", { picture: "" });
  assert.equal(cleared.body.profile.picture, "");
});

test("visibility: achievements toggle; the site itself cannot go private", async () => {
  const { call } = await setup();
  assert.deepEqual((await call("PATCH", "/api/profile/me/visibility", { achievementsPublic: true })).body, { profilePublic: true, achievementsPublic: true });
  assert.equal((await call("PATCH", "/api/profile/me/visibility", { profilePublic: false })).status, 400);
  assert.equal((await call("PATCH", "/api/profile/me/username", { username: "x" })).status, 501, "username changes are not ported");
});

test("talks and recognitions: create, 409, tags in the right scope, soft delete, bulk", async () => {
  const { fake, call, committer } = await setup();
  const talk = { id: "t1", title: "Talk", addedAt: T0, tags: ["2D", "Invited"], profileTags: ["Keynote"], venueUrl: "https://v.example" };
  const made = await call("POST", "/api/talks", talk);
  assert.equal(made.status, 200);
  assert.equal(made.body.isMine, true, "TalkPayload default");
  assert.equal((await call("POST", "/api/talks", talk)).status, 409);
  assert.equal((await call("PUT", "/api/talks/t1", { ...talk, venueUrl: "javascript:x" })).status, 400);
  const rec = await call("POST", "/api/recognitions", { id: "r1", title: "Award", addedAt: T0, profileTags: ["Keynote"] });
  assert.equal(rec.body.type, "paper");
  await committer.flush();
  const tagNames = [...fake.headFiles()].filter(([p]) => p.startsWith("tags/")).map(([, t]) => JSON.parse(t).name).sort();
  assert.deepEqual(tagNames, ["2D", "Invited"], "Library tags are shared with talks");
  const scopes = [...fake.headFiles()].filter(([p]) => p.startsWith("profile-tags/")).map(([, t]) => JSON.parse(t)).map((t) => `${t.name}/${t.scope}`).sort();
  assert.deepEqual(scopes, ["Keynote/general", "Keynote/recognition"], "same name, two scopes");

  assert.deepEqual((await call("POST", "/api/talks/bulk-profile-visibility", { talkIds: ["t1", "zz"], showOnProfile: false })).body, { count: 1 });
  assert.equal((await call("DELETE", "/api/talks/t1")).status, 204);
  assert.equal((await call("GET", "/api/talks")).body.length, 0);
  assert.equal((await call("GET", "/api/talks/t1")).status, 404);
  assert.deepEqual((await call("POST", "/api/recognitions/bulk-delete", { recognitionIds: ["r1"] })).body, { count: 1 });
  await committer.flush();
  assert.ok(file(fake, "talks/t1.json").deletedAt, "soft delete keeps the file");
});

test("news: limits, photos deduplicated against stored media, drafts, update stamps, delete", async () => {
  const { fake, call, committer, blobUploads } = await setup();
  const item = { id: "n2", title: "T".repeat(600), body: "b", sortDate: "2026-02-01", isPublic: false, links: [{ label: "x", url: "https://a", children: [{ label: "", url: "" }] }],
    images: [{ src: JPG, caption: "c".repeat(300) }, { src: PNG, caption: "" }] };
  const res = await call("POST", "/api/news", item);
  assert.equal(res.status, 200);
  assert.equal(res.body.title.length, 500);
  assert.deepEqual(res.body.links, [{ label: "x", url: "https://a", children: [] }]);
  assert.equal(res.body.images[0].caption.length, 200);
  assert.deepEqual(res.body.images.map((i) => i.src), [JPG, PNG], "the editor gets data URLs back");
  assert.equal(res.body.isPublic, false);
  await committer.flush();
  const stored = file(fake, "news/n2.json");
  assert.equal(stored.images[1].src, PNG_PATH, "already in media/: reused");
  assert.equal(blobUploads(), 1, "only the new photo was uploaded");
  assert.equal((await call("POST", "/api/news", item)).status, 409);

  for (const [images, why] of [
    [Array(6).fill({ src: PNG }), "six photos"],
    [[{ src: `data:image/jpeg;base64,${"A".repeat(700_001)}` }], "too large"],
    [[{ src: "data:image/svg+xml;base64,PHN2Zy8+" }], "svg"],
    [[{ src: "https://elsewhere/p.jpg" }], "linked photo"],
  ]) assert.equal((await call("PUT", "/api/news/n2", { ...item, images })).status, 400, why);

  const before = file(fake, "news/n2.json");
  const updated = await call("PUT", "/api/news/n2", { ...item, title: "Edited", addedAt: "1999-01-01T00:00:00" });
  assert.equal(updated.body.addedAt, before.addedAt, "addedAt is never changed by an update");
  assert.notEqual(updated.body.updatedAt, "");
  assert.equal((await call("GET", "/api/news")).body.length, 2, "drafts are listed for the owner");
  assert.equal((await call("DELETE", "/api/news/n1")).status, 204);
  assert.equal((await call("DELETE", "/api/news/n1")).status, 404);
});

test("what visitors will see: the projection of the edited data uses /media paths with matching hashes", async () => {
  const { fake, call, committer } = await setup();
  await call("POST", "/api/news", { id: "n3", title: "Public", sortDate: "2026-03-01", images: [{ src: JPG, caption: "" }] });
  await call("PUT", "/api/profile/me", { picture: JPG });
  await committer.flush();
  const head = fake.headFiles();
  const ds = datasetFromFiles(new Map([...head].filter(([p]) => !p.startsWith("media/"))));
  const view = project(ds, "dukhyun");
  const src = view.news.items.find((n) => n.id === "n3").images[0].src;
  assert.match(src, /^\/media\/[0-9a-f]{16}\.jpg$/);
  assert.equal(view.profile.picture, src);
  const bytes = head.get(src.slice(1));
  assert.equal(createHash("sha256").update(bytes).digest("hex").slice(0, 16), src.slice(7, 23), "publish.mjs accepts it (name = sha256 prefix)");
});
