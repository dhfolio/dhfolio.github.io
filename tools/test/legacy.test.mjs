import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileStem, splitExport, toJson } from "../import-legacy.mjs";
import { insideRepo, metadataQueries } from "../capture-legacy.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function sampleExport() {
  return {
    schemaVersion: 1,
    exportedAt: "2026-11-10T00:00:00",
    profile: { name: "Owner", picture: PNG, notes: "private" },
    papers: [
      { id: "p1", title: "A", doi: "10.1/a", deletedAt: null },
      { id: "profile-1700000000", title: "B", doi: "", deletedAt: "2026-01-01T00:00:00" },
      { id: "has space/slash", title: "C", deletedAt: null },
    ],
    talks: [{ id: "t1", title: "T", deletedAt: null }],
    recognitions: [],
    news: [{ id: "news_1", title: "N", images: [{ src: PNG, caption: "x" }, { src: "https://e.x/a.jpg", caption: "" }], deletedAt: null }],
    tags: [{ id: 3, name: "2D", createdAt: "", updatedAt: "" }],
    profileTags: [{ id: 7, name: "Selected", scope: "general", createdAt: "", updatedAt: "" }],
    references: { p1: [{ doi: "10.1/b", title: "", year: "", authors: "", journal: "", source: "crossref", fetchedAt: "" }], gone: [] },
    manualLinks: [{ id: "L1", paperA: "p1", paperB: "profile-1700000000", createdAt: "" }, { id: "L2", paperA: "p1", paperB: "nope", createdAt: "" }],
  };
}

test("fileStem keeps safe ids, %-encodes the rest, hashes only the unusable", () => {
  assert.equal(fileStem("p1"), "p1");
  assert.equal(fileStem(42), "42");
  assert.equal(fileStem("profile-1700000000"), "profile-1700000000");
  assert.equal(fileStem("scholar-2026-04-10T04:10:27-0"), "scholar-2026-04-10T04%3A10%3A27-0");
  assert.equal(fileStem("has space/slash"), "has%20space%2Fslash");
  assert.equal(fileStem("논문"), "%EB%85%BC%EB%AC%B8");
  assert.equal(decodeURIComponent(fileStem("a:b/c d")), "a:b/c d");
  assert.notEqual(fileStem("a:b"), fileStem("a_b"));
  assert.match(fileStem(".."), /^x-[0-9a-f]{16}$/);
  assert.match(fileStem("x".repeat(151)), /^x-[0-9a-f]{16}$/);
});

test("splitExport writes one file per record with media extracted", () => {
  const { files, report } = splitExport(sampleExport());
  const paths = [...files.keys()];
  for (const p of ["atlas.json", "profile.json", "papers/p1.json", "papers/profile-1700000000.json", "talks/t1.json",
    "news/news_1.json", "tags/3.json", "profile-tags/7.json", "references/p1.json", "manual-links/L1.json"]) {
    assert.ok(files.has(p), p);
  }
  assert.ok(!paths.some((p) => p.includes("L2")), "link to a missing paper is skipped");
  assert.deepEqual(report.orphanLinks, ["L2"]);
  assert.deepEqual(report.orphanReferences, ["gone"]);
  assert.equal(report.renamed.length, 1);

  const media = paths.filter((p) => p.startsWith("media/"));
  assert.equal(media.length, 1, "same image in profile and news is stored once");
  assert.match(media[0], /^media\/[0-9a-f]{16}\.png$/);
  assert.ok(Buffer.isBuffer(files.get(media[0])));
  const news = JSON.parse(files.get("news/news_1.json"));
  assert.deepEqual(news.images.map((i) => i.src), [media[0], "https://e.x/a.jpg"]);
  assert.equal(JSON.parse(files.get("profile.json")).picture, media[0]);
  assert.equal(JSON.parse(files.get("papers/profile-1700000000.json")).deletedAt, "2026-01-01T00:00:00");
  assert.deepEqual(JSON.parse(files.get("references/p1.json")), { paperId: "p1", rows: sampleExport().references.p1 });
  assert.equal(report.counts.papers, 3);
});

test("splitExport output is deterministic and stable-formatted", () => {
  const a = splitExport(sampleExport()).files;
  const b = splitExport(sampleExport()).files;
  assert.deepEqual([...a.keys()], [...b.keys()]);
  for (const [k, v] of a) assert.ok(Buffer.isBuffer(v) ? v.equals(b.get(k)) : v === b.get(k), k);
  assert.equal(a.get("tags/3.json"), toJson({ id: 3, name: "2D", createdAt: "", updatedAt: "" }));
  assert.ok(a.get("tags/3.json").endsWith("}\n"));
});

test("splitExport refuses unknown schema and duplicate ids", () => {
  assert.throws(() => splitExport({ ...sampleExport(), schemaVersion: 2 }), /schemaVersion/);
  const dup = sampleExport();
  dup.talks.push({ id: "t1", title: "again" });
  assert.throws(() => splitExport(dup), /duplicate id "t1"/);
});

test("capture-legacy refuses an output folder inside the public repo", () => {
  const repo = join(tmpdir(), "repo");
  assert.equal(insideRepo(repo, repo), true);
  assert.equal(insideRepo(join(repo, "data"), repo), true);
  assert.equal(insideRepo(join(repo, "..", "legacy-capture"), repo), false);
});

test("metadataQueries covers DOI, doi.org URL, arXiv DOI, arXiv URL, other URL and free text", () => {
  const q = metadataQueries([
    { doi: "10.1/a", url: "https://journal.example/a", title: "A sufficiently long paper title here" },
    { doi: "10.48550/arXiv.2401.00001", url: "https://arxiv.org/abs/2401.00001" },
  ]);
  assert.deepEqual(q, ["10.1/a", "https://doi.org/10.1/a", "10.48550/arXiv.2401.00001", "https://arxiv.org/abs/2401.00001",
    "https://journal.example/a", "A sufficiently long paper title here"]);
});
