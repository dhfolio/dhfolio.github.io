/**
 * js/localapi/owner/routes-citations.js
 * Maps reference management (Phase 2.4), ported from research-atlas-v2
 * api/routes/citations.py, repositories/citations_repository.py and
 * services/references.py. Reference lists live in references/<paperId>.json
 * as {paperId, rows}; an empty-DOI-and-title row means "fetched, none found".
 */

import { metadataFor } from "./routes-read.js?v=1.0.5";
import { enrichReference, fetchReferences } from "./references.js?v=1.0.5";
import { HttpError, normalizePaper, parseBody, utcNow } from "../shared/payload.js?v=1.0.5";
import { uuid } from "./routes-write.js?v=1.0.5";

const ok = (body) => ({ status: 200, body });
const live = (r) => r && !r.deletedAt;
const s = (v) => (v == null ? "" : String(v));
const SCOPES = new Set(["mine", "library", "all"]);
const MAX_REFRESH = 25;

const scopeOf = (v) => (SCOPES.has(s(v || "all").trim().toLowerCase()) ? s(v || "all").trim().toLowerCase() : "all");

/** citations_repository.seed_papers */
function seeds(ds, scope) {
  return ds.papers.filter((p) => live(p) && s(p.doi) !== ""
    && (scope === "mine" ? p.isMine : scope === "library" ? p.inLibrary : p.isMine || p.inLibrary));
}

/**
 * references.enrich_reference_rows: one lookup per unique DOI, applied to every
 * row with it. force → overwrite with whatever came back; otherwise set the
 * title and fill only empty fields. Returns the number of rows updated.
 */
async function enrichRows(rows, force, fetch) {
  const byDoi = new Map();
  for (const row of rows) {
    const doi = s(row.doi).trim().toLowerCase();
    if (!doi || (!force && row.title)) continue;
    if (!byDoi.has(doi)) byDoi.set(doi, []);
    byDoi.get(doi).push(row);
  }
  let updated = 0;
  for (const [doi, group] of byDoi) {
    const meta = await enrichReference(doi, { fetch });
    if (!meta || !meta.title) continue;
    const v = { title: s(meta.title).slice(0, 1024), year: s(meta.year).slice(0, 32), authors: s(meta.authors).slice(0, 512), journal: s(meta.journal).slice(0, 512) };
    for (const row of group) {
      if (force) {
        for (const k of ["title", "year", "authors", "journal"]) if (v[k]) row[k] = v[k];
      } else {
        row.title = v.title;
        for (const k of ["year", "authors", "journal"]) if (!row[k]) row[k] = v[k];
      }
      updated++;
    }
  }
  return updated;
}

/** references.refresh_paper: fetch, replace the cached list, then fill missing titles (≤100). */
async function refreshPaper(editor, paper, fetch) {
  const { source, rows, fetchedAt } = await fetchReferences(paper, { fetch });
  const stored = rows.length ? rows.map((r) => ({ ...r }))
    : [{ doi: "", title: "", year: "", authors: "", journal: "", source: source || "none", fetchedAt }];
  try {
    await enrichRows(stored.filter((r) => r.doi && !r.title).slice(0, 100), false, fetch);
  } catch { /* the original ignored enrich failures here too */ }
  await editor.putReferences(paper.id, stored);
  return { paperId: paper.id, referencesFetched: rows.length, rowsWritten: stored.length, source };
}

export async function ownerCitations(ctx) {
  const { method, pathname: path } = ctx;
  if (method !== "POST" || !path.startsWith("/api/citations/") || !ctx.editor) return null;
  const editor = ctx.editor;
  if (editor.readOnly) return { status: 423, body: { detail: editor.readOnly } };
  const ds = await editor.dataset();
  const fetch = ctx.fetch;
  const findLive = (id) => ds.papers.find((p) => p.id === s(id) && live(p));

  try {
    if (path === "/api/citations/refresh") {
      const b = parseBody(ctx.body);
      const scope = scopeOf(b.scope);
      const limit = Math.max(1, Math.min(Number(b.limit) || MAX_REFRESH, MAX_REFRESH));
      const queue = seeds(ds, scope).filter((p) => !ds.references[p.id]);
      const batch = queue.slice(0, limit);
      const details = [];
      for (const paper of batch) {
        try {
          details.push(await refreshPaper(editor, paper, fetch));
        } catch (err) {
          details.push({ paperId: paper.id, referencesFetched: 0, rowsWritten: 0, source: "", error: s(err.message).slice(0, 200) });
        }
      }
      return ok({ scope, papersRefreshed: batch.length, papersRemaining: Math.max(0, queue.length - batch.length), details });
    }
    if (path === "/api/citations/refresh-paper") {
      const paper = findLive(parseBody(ctx.body).paperId);
      if (!paper) throw new HttpError(404, "Paper not found.");
      try {
        return ok(await refreshPaper(editor, paper, fetch));
      } catch (err) {
        throw new HttpError(502, `Refresh failed: ${err.message}`);
      }
    }
    if (path === "/api/citations/references/enrich") {
      const b = parseBody(ctx.body);
      const paper = findLive(b.paperId);
      if (!paper) throw new HttpError(404, "Paper not found.");
      const force = Boolean(b.force);
      const limit = Math.max(1, Math.min(Number(b.limit) || 30, force ? 250 : 100));
      const all = (ds.references[paper.id] || []).map((r) => ({ ...r }));
      const picked = all.filter((r) => s(r.doi) !== "" && (force || !r.title)).slice(0, limit);
      if (!picked.length) return ok({ missing: 0, enriched: 0 });
      const enriched = await enrichRows(picked, force, fetch);
      if (enriched) await editor.putReferences(paper.id, all);
      return ok({ missing: picked.length, enriched });
    }
    if (path === "/api/citations/references/enrich-one") {
      const doi = s(parseBody(ctx.body).doi).trim().toLowerCase();
      if (!doi) throw new HttpError(400, "doi is required.");
      // Every cached list with this DOI and no title (the original healed all of them at once).
      const lists = Object.entries(ds.references)
        .map(([paperId, rows]) => [paperId, rows.map((r) => ({ ...r }))])
        .filter(([, rows]) => rows.some((r) => s(r.doi).trim().toLowerCase() === doi && !r.title));
      const meta = await enrichReference(doi, { fetch });
      const fields = { title: s(meta.title), year: s(meta.year), authors: s(meta.authors), journal: s(meta.journal) };
      if (!lists.length) return ok({ enriched: 0, ...fields });
      if (!meta.title) return ok({ enriched: 0, title: "", year: "", authors: "", journal: "" });
      let enriched = 0;
      for (const [paperId, rows] of lists) {
        for (const row of rows) {
          if (s(row.doi).trim().toLowerCase() !== doi || row.title) continue;
          row.title = fields.title.slice(0, 1024);
          if (!row.year) row.year = fields.year.slice(0, 32);
          if (!row.authors) row.authors = fields.authors.slice(0, 512);
          if (!row.journal) row.journal = fields.journal.slice(0, 512);
          enriched++;
        }
        await editor.putReferences(paperId, rows);
      }
      return ok({ enriched, ...fields });
    }
    if (path === "/api/citations/references/add") {
      // citations.py add_reference_to_library
      const doi = s(parseBody(ctx.body).doi).trim();
      if (!doi) throw new HttpError(400, "doi is required.");
      const norm = doi.toLowerCase();
      const existing = ds.papers.find((p) => live(p) && s(p.doi).trim().toLowerCase() === norm);
      if (existing) {
        if (existing.inLibrary) return ok({ paper: existing });
        return ok({ paper: await editor.put("papers", { ...existing, inLibrary: true, updatedAt: utcNow() }) });
      }
      let meta;
      try {
        meta = await metadataFor(doi, fetch);
      } catch (err) {
        throw new HttpError(502, `Metadata lookup failed: ${err.message}`);
      }
      const now = utcNow();
      const record = normalizePaper({
        id: uuid(),
        title: s(meta.title),
        authors: (meta.authors || []).join(", "),
        affiliations: (meta.affiliations || []).join(", "),
        year: s(meta.year),
        journal: s(meta.journal),
        shortJournal: s(meta.shortJournal),
        volume: s(meta.volume),
        pages: s(meta.pages),
        citationCount: Number(meta.citationCount) || 0,
        citationSource: s(meta.citationSource),
        type: s(meta.crossrefType) || "paper",
        doi: norm,
        url: /^https?:\/\//i.test(s(meta.url)) ? s(meta.url) : `https://doi.org/${norm}`,
        summary: s(meta.abstract),
        sourceType: "metadata",
        sourceName: s(meta.source) || "citation-map",
        addedAt: now,
        updatedAt: now,
        isMine: false,
        inLibrary: true,
        showOnProfile: false,
      }, { now });
      return ok({ paper: await editor.put("papers", record) });
    }
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { detail: err.detail } };
    throw err;
  }
  return null;
}
