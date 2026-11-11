// Phase 2.4: Maps reference management and CSV export.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFakeGitHub } from "./fake-github.mjs";
import { createGitHub } from "../../js/localapi/owner/github.js";
import { createStore, memoryCache } from "../../js/localapi/owner/store.js";
import { createJournal, memoryJournalStorage } from "../../js/localapi/owner/journal.js";
import { createCommitter } from "../../js/localapi/owner/committer.js";
import { createEditor } from "../../js/localapi/owner/editor.js";
import { handle } from "../../js/localapi/index.js";
import { csvField, papersCsv } from "../../js/localapi/owner/export-csv.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "metadata");
const RECORDED = Object.assign({}, ...fs.readdirSync(FIX).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"))));
// Recorded provider answers; anything not recorded fails like an offline request.
const providers = async (url) => {
  const rec = RECORDED[url];
  if (!rec) throw new TypeError("Failed to fetch");
  const text = typeof rec.body === "string" ? rec.body : JSON.stringify(rec.body);
  return { ok: rec.status >= 200 && rec.status < 300, status: rec.status, statusText: rec.statusText, json: async () => JSON.parse(text), text: async () => text };
};

const j = (v) => `${JSON.stringify(v, null, 1)}\n`;
const T0 = "2026-01-01T00:00:00";
const paper = (id, o = {}) => ({ id, title: id, authors: "", affiliations: "", year: "", journal: "", shortJournal: "", volume: "", pages: "",
  citationCount: 0, citationSource: "", type: "paper", doi: "", url: "", pdfPath: "", tags: [], starred: false, pinned: false, isRead: false,
  status: "unread", notes: "", summary: "", sourceType: "manual", sourceName: "", addedAt: T0, updatedAt: T0, deletedAt: null, authorOrder: null,
  isCoFirst: false, correspondingRole: "none", isPublic: false, isMine: false, isLast: false, isSelected: false, inLibrary: true, showOnProfile: true,
  extraLinks: [], authorAnnotations: {}, profileTags: [], ...o });

const APL = "10.1063/5.0141987"; // recorded: Crossref work (with its reference list) + OpenAlex

async function setup(extra = {}) {
  const fake = createFakeGitHub(Object.fromEntries(Object.entries({
    "atlas.json": j({ schema: 1, ownerSlug: "dukhyun" }),
    "profile.json": j({ slug: "dukhyun", name: "Owner" }),
    "papers/apl.json": j(paper("apl", { doi: APL, isMine: true, inLibrary: false })),
    "papers/done.json": j(paper("done", { doi: "10.1/done" })),
    "references/done.json": j({ paperId: "done", rows: [
      { doi: APL, title: "", year: "", authors: "", journal: "", source: "crossref", fetchedAt: T0 },
      { doi: "10.1/x", title: "Kept", year: "2001", authors: "", journal: "", source: "crossref", fetchedAt: T0 }] }),
    "papers/nodoi.json": j(paper("nodoi")),
    "papers/binned.json": j(paper("binned", { doi: "10.1/b", deletedAt: T0 })),
    ...extra,
  }).filter(([, v]) => v !== null)));
  const gh = createGitHub({ token: "t", repo: "dhfolio/atlas-data", fetch: fake.fetch });
  const store = createStore({ gh, cache: memoryCache() });
  const journal = await createJournal(memoryJournalStorage());
  const committer = createCommitter({ store, journal, setTimer: () => ({}), clearTimer: () => {} });
  const editor = createEditor({ dataset: () => store.dataset(), journal, committer });
  const owner = { dataset: () => store.dataset(), mediaDataUrl: async () => "", editor };
  const call = (method, p, body, fetch = providers) => handle({ method, path: p, body: body === undefined ? undefined : JSON.stringify(body), ownerSlug: "dukhyun", fetch, owner });
  const file = (p) => { const t = fake.headFiles().get(p); return t == null ? undefined : JSON.parse(t); };
  return { call, committer, file };
}

test("refresh: only seeds without a cached list, at most 25, remaining counted", async () => {
  const { call, committer, file } = await setup();
  const res = await call("POST", "/api/citations/refresh", { scope: "all", limit: 99 });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.scope, res.body.papersRefreshed, res.body.papersRemaining], ["all", 1, 0], "apl only: 'done' is cached, no DOI and Bin are not seeds");
  assert.equal(res.body.details[0].paperId, "apl");
  assert.equal(res.body.details[0].source, "crossref");
  assert.ok(res.body.details[0].rowsWritten > 5);
  await committer.flush();
  const refs = file("references/apl.json");
  assert.equal(refs.rows.length, res.body.details[0].rowsWritten);
  assert.ok(refs.rows.every((r) => r.source === "crossref" && /^\d{4}-\d\d-\d\dT/.test(r.fetchedAt)));
  assert.equal((await call("POST", "/api/citations/refresh", { scope: "mine" })).body.papersRefreshed, 0, "now cached");
});

test("refresh-paper: replaces the list; nothing found is one placeholder row; unknown paper is 404", async () => {
  const { call, committer, file } = await setup();
  const offline = async () => { throw new TypeError("Failed to fetch"); };
  const res = await call("POST", "/api/citations/refresh-paper", { paperId: "done" }, offline);
  assert.deepEqual([res.status, res.body.referencesFetched, res.body.rowsWritten], [200, 0, 1]);
  await committer.flush();
  assert.deepEqual(file("references/done.json").rows.map((r) => [r.doi, r.title]), [["", ""]]);
  assert.equal((await call("POST", "/api/citations/refresh-paper", { paperId: "binned" })).status, 404);
});

test("enrich fills missing titles from the DOI's metadata; enrich-one heals every list with that DOI", async () => {
  const { call, committer, file } = await setup();
  const res = await call("POST", "/api/citations/references/enrich", { paperId: "done", limit: 30 });
  assert.deepEqual(res.body, { missing: 1, enriched: 1 });
  await committer.flush();
  const rows = file("references/done.json").rows;
  assert.match(rows[0].title, /Semiconducting nonperovskite ferroelectric oxynitride/);
  assert.equal(rows[1].title, "Kept", "rows that had a title are untouched");

  const second = await setup();
  const one = await second.call("POST", "/api/citations/references/enrich-one", { doi: APL.toUpperCase() });
  assert.equal(one.body.enriched, 1);
  assert.match(one.body.title, /oxynitride/);
  assert.equal((await second.call("POST", "/api/citations/references/enrich-one", { doi: " " })).status, 400);
});

test("references/add: an existing paper joins the Library; a new DOI becomes a metadata paper", async () => {
  const { call } = await setup();
  const existing = await call("POST", "/api/citations/references/add", { doi: APL.toUpperCase() });
  assert.equal(existing.body.paper.id, "apl");
  assert.equal(existing.body.paper.inLibrary, true);

  const fresh = await setup({ "papers/apl.json": null });
  const made = (await fresh.call("POST", "/api/citations/references/add", { doi: APL })).body.paper;
  assert.match(made.title, /oxynitride/);
  assert.deepEqual([made.doi, made.isMine, made.inLibrary, made.showOnProfile, made.sourceType], [APL, false, true, false, "metadata"]);
  assert.match(made.authors, /Qisheng Yu/);
  const failed = await fresh.call("POST", "/api/citations/references/add", { doi: "10.9999/none" }, async () => { throw new TypeError("Failed to fetch"); });
  assert.equal(failed.status, 502);
});

test("CSV export: the original's 20 columns, BOM, CRLF, minimal quoting, newest first", async () => {
  assert.equal(csvField('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvField("plain"), "plain");
  const csv = papersCsv([paper("old", { title: "Old" }), paper("new", { title: "x, y", updatedAt: "2026-05-01T00:00:00", tags: ["2D", "AI"], starred: true }), paper("gone", { deletedAt: T0 })]);
  const lines = csv.slice(1).split("\r\n");
  assert.equal(csv[0], "﻿");
  assert.equal(lines[0], "id,title,authors,affiliations,year,journal,type,doi,url,pdf_path,tags,starred,is_read,status,note,summary,source_type,source_name,added_at,updated_at");
  assert.match(lines[1], /^new,"x, y",.*,2D\|AI,true,false,unread,/);
  assert.match(lines[2], /^old,Old,/);
  assert.equal(lines.length, 4, "header, two active papers, trailing CRLF");

  const { call } = await setup();
  const res = await call("GET", "/api/exports/csv");
  assert.equal(res.status, 200);
  assert.equal(res.contentType, "text/csv; charset=utf-8");
  assert.ok(res.raw.startsWith("﻿id,title"));
});
