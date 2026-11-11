// Rules ported from research-atlas-v2 public_profiles.py / public.py / news.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { project, projectGraph, yearOnly } from "../../js/localapi/shared/projection.js";
import { assertPublic, publicize } from "../lib/publicize.mjs";
import { normalizeTies } from "../check-projection.mjs";

const paper = (id, o = {}) => ({
  id, title: id, authors: "", year: "", journal: "", shortJournal: "", doi: "", url: "", pdfPath: "", notes: "n", sourceName: "s",
  addedAt: "2026-01-01T00:00:00", updatedAt: "2026-01-01T00:00:00", deletedAt: null,
  isPublic: false, isMine: false, inLibrary: true, showOnProfile: true, authorOrder: null, isCoFirst: false, correspondingRole: "none", type: "paper", ...o,
});

function dataset() {
  return {
    ownerSlug: "dukhyun",
    profile: { slug: "dukhyun", name: "Owner", picture: "media/0123456789abcdef.jpg", notes: "secret", akaNames: "x",
      achievementsPublic: true, journalOrder: ["Nature"], tagOrder: [], pubViewPrefs: { showAllPubs: null, sortMode: "year", showNumbering: null, positionFilters: [] } },
    papers: [
      paper("pub-old", { isMine: true, inLibrary: false, year: "2019", doi: "10.1/OLD" }),
      paper("pub-new", { isMine: true, inLibrary: false, year: "2024/05/01", doi: "10.1/new" }),
      paper("pub-hidden", { isMine: true, showOnProfile: false, year: "2025", doi: "10.1/hidden" }),
      paper("lib-a", { addedAt: "2026-02-01T00:00:00", doi: "10.1/a" }),
      paper("lib-b", { addedAt: "2026-03-01T00:00:00" }),
      paper("binned", { deletedAt: "2026-04-01T00:00:00", isMine: true, doi: "10.1/binned" }),
      paper("post", { isPublic: true, inLibrary: false, updatedAt: "2026-05-01T00:00:00" }),
    ],
    talks: [
      { id: "t1", year: "2020", updatedAt: "a", showOnProfile: true, deletedAt: null },
      { id: "t2", year: "2023", updatedAt: "a", showOnProfile: true, deletedAt: null },
      { id: "t3", year: "2024", updatedAt: "a", showOnProfile: false, deletedAt: null },
      { id: "t4", year: "2025", updatedAt: "a", showOnProfile: true, deletedAt: "x" },
    ],
    recognitions: [],
    news: [
      { id: "n1", sortDate: "2025-01-01", updatedAt: "a", isPublic: true, images: [{ src: "media/0123456789abcdef.jpg", caption: "c" }], deletedAt: null },
      { id: "n2", sortDate: "2026-01-01", updatedAt: "a", isPublic: false, images: [], deletedAt: null },
      { id: "n3", sortDate: "2026-02-01", updatedAt: "a", isPublic: true, images: [], deletedAt: "x" },
    ],
    references: {
      "pub-new": [{ doi: "10.1/old" }, { doi: "10.1/OLD" }, { doi: "10.1/new" }, { doi: "" }, { doi: "10.1/binned" }],
      "lib-a": [{ doi: "10.1/new" }, { doi: "10.1/hidden" }],
    },
  };
}

test("profile: own publications shown on profile, newest year first, bin and hidden excluded", () => {
  const { profile } = project(dataset(), "dukhyun");
  assert.deepEqual(profile.publications.map((p) => p.id), ["pub-new", "pub-old"]);
  assert.deepEqual(profile.posts.map((p) => p.id), ["post"]);
  assert.deepEqual(profile.talks.map((t) => t.id), ["t2", "t1"]);
  assert.deepEqual(profile.stats, { publications: 2, posts: 1, talks: 2, recognitions: 0 });
  assert.equal(profile.picture, "/media/0123456789abcdef.jpg");
  assert.equal(profile.isPrivate, false);
  assert.ok(!("notes" in profile) && !("akaNames" in profile), "private profile fields are not projected");
  assert.deepEqual(Object.keys(profile).slice(0, 3), ["slug", "name", "bio"]);
});

test("news: public, not deleted, newest sortDate first; images point at /media; no deletedAt key", () => {
  const { news } = project(dataset(), "dukhyun");
  assert.deepEqual(news.items.map((n) => n.id), ["n1"]);
  assert.equal(news.items[0].images[0].src, "/media/0123456789abcdef.jpg");
  assert.ok(!("deletedAt" in news.items[0]));
  assert.deepEqual(Object.keys(news), ["slug", "name", "isPrivate", "items"]);
});

test("library: inLibrary and not binned, newest addedAt first, owner fields blanked", () => {
  const { library } = project(dataset(), "dukhyun");
  assert.deepEqual(library.papers.map((p) => p.id), ["lib-b", "lib-a", "pub-hidden"]);
  assert.ok(library.papers.every((p) => p.notes === "" && p.pdfPath === "" && p.sourceName === ""));
});

test("ties on every sort key are ordered by id", () => {
  const ds = dataset();
  ds.papers.push(paper("lib-z", { addedAt: "2026-03-01T00:00:00" }), paper("lib-c", { addedAt: "2026-03-01T00:00:00" }));
  const ids = project(ds, "dukhyun").library.papers.map((p) => p.id);
  assert.deepEqual(ids.slice(0, 3), ["lib-b", "lib-c", "lib-z"]);
});

test("graph: scopes, lowercased DOI edges, no self or duplicate edges, year trimmed", () => {
  const ds = dataset();
  const all = projectGraph(ds, "all");
  assert.deepEqual(all.nodes.map((n) => n.id).sort(), ["p:lib-a", "p:pub-hidden", "p:pub-new", "p:pub-old"]);
  assert.deepEqual(all.edges, [{ source: "p:pub-new", target: "p:pub-old" }, { source: "p:lib-a", target: "p:pub-new" }, { source: "p:lib-a", target: "p:pub-hidden" }]);
  assert.deepEqual(projectGraph(ds, "mine").nodes.map((n) => n.id).sort(), ["p:pub-new", "p:pub-old"]);
  assert.deepEqual(projectGraph(ds, "library").nodes.map((n) => n.id).sort(), ["p:lib-a", "p:pub-hidden"]);
  const node = all.nodes.find((n) => n.id === "p:pub-new");
  assert.equal(node.year, "2024");
  assert.equal(node.isMine, true);
  assert.equal(all.nodes.find((n) => n.id === "p:pub-hidden").isMine, false, "isMine needs showOnProfile");
  assert.deepEqual(Object.keys(all).slice(-3), ["scope", "isPrivate", "name"]);
});

test("yearOnly matches public.py _year_only", () => {
  assert.equal(yearOnly("2023/05/12"), "2023");
  assert.equal(yearOnly("2023-05"), "2023");
  assert.equal(yearOnly(" 2021 "), "2021");
  assert.equal(yearOnly("in press"), "");
  assert.equal(yearOnly(""), "");
});

test("the projection passes publicize, and publicize refuses script links", () => {
  const { profile, news, library, graphs } = project(dataset(), "dukhyun");
  assert.doesNotThrow(() => publicize({ profile, news, library, graphs }));
  for (const bad of [{ url: "javascript:alert(1)" }, { websiteUrl: " JavaScript:x" }, { talkLink: "data:text/html,x" },
    { src: "media/0123456789abcdef.jpg" }, { picture: "/etc/passwd" }, { links: [{ url: "vbscript:x" }] }]) {
    assert.throws(() => assertPublic(bad), /link is not http/, JSON.stringify(bad));
  }
  for (const ok of [{ url: "" }, { url: "https://a.b" }, { scholarUrl: "http://x" }, { url: "mailto:a@b.c" }, { src: "/media/0123456789abcdef.png" }]) {
    assert.doesNotThrow(() => assertPublic(ok), JSON.stringify(ok));
  }
});

test("check-projection normalizes only runs of equal sort keys", () => {
  const doc = { papers: [{ id: "b", addedAt: "2", updatedAt: "1" }, { id: "a", addedAt: "2", updatedAt: "1" }, { id: "c", addedAt: "1", updatedAt: "1" }] };
  assert.deepEqual(normalizeTies(doc, "data/public/library.json").papers.map((p) => p.id), ["a", "b", "c"]);
  const strict = { papers: [{ id: "b", addedAt: "3", updatedAt: "1" }, { id: "a", addedAt: "2", updatedAt: "1" }] };
  assert.deepEqual(normalizeTies(strict, "data/public/library.json").papers.map((p) => p.id), ["b", "a"]);
});
