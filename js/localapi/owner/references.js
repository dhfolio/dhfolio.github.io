/**
 * js/localapi/owner/references.js
 * Browser port of backend/app/services/references.py: fetch_paper_references
 * + cache_references (rows as they would be stored) and
 * lookup_reference_metadata (enrichReference).
 *
 * Difference: OpenAlex referenced works are resolved with batched
 * filter=openalex_id:W1|W2|… requests (≤50 ids each) instead of one request
 * per work; the 80-work cap and input order are kept.
 * Not ported: refresh_paper's automatic enrich pass afterwards — call
 * enrichReference(doi) for rows that have a DOI but no title.
 */

import { fetchCrossref, fetchJson, fetchOpenalexByUrl, get, isArxivDoi, or, pyQuote, truthy } from "./metadata.js?v=1.0.3";

// No mailto: OpenAlex does not require it, and an address in a public page would be published.
const OPENALEX_CAP = 80;
const OPENALEX_BATCH = 50;
const OPENALEX_SELECT = "id,doi,display_name,publication_year,authorships,primary_location";

const strip = (v) => (typeof v === "string" ? v.trim() : String(v).trim());
const str = (v) => (v === null || v === undefined ? "" : String(v));
/** Python slice by code points. */
const cut = (v, n) => { const t = str(v); return t.length <= n ? t : Array.from(t).slice(0, n).join(""); };

/** datetime.utcnow().replace(microsecond=0).isoformat() */
export function utcTimestamp(date = new Date()) {
  return date.toISOString().slice(0, 19);
}

export async function fetchCrossrefReferences(fetch, doi) {
  const payload = get(await fetchJson(fetch, `https://api.crossref.org/works/${pyQuote(doi)}`), "message", {});
  const out = [];
  for (const entry of or(get(payload, "reference"), [])) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const refDoi = strip(or(get(entry, "DOI"), "")).toLowerCase();
    let title = strip(or(get(entry, "article-title"), get(entry, "volume-title"), ""));
    if (!title && !refDoi && truthy(get(entry, "unstructured"))) {
      title = cut(entry.unstructured.replace(/\s+/g, " ").trim(), 240);
    }
    const year = strip(str(or(get(entry, "year"), "")));
    const author = strip(or(get(entry, "author"), ""));
    const journal = strip(or(get(entry, "journal-title"), ""));
    if (!refDoi && !title) continue;
    out.push({ doi: refDoi, title, year, authors: author, journal });
  }
  return out;
}

function openalexRefRow(ref) {
  const refDoi = strip(or(get(ref, "doi"), "").replaceAll("https://doi.org/", "")).toLowerCase();
  const title = strip(or(get(ref, "display_name"), ""));
  if (!refDoi && !title) return null;
  const year = strip(str(or(get(ref, "publication_year"), "")));
  const authors = or(get(ref, "authorships"), [])
    .map((a) => strip(or(get(a, "raw_author_name"), get(or(get(a, "author"), {}), "display_name"), "")))
    .filter(Boolean);
  const source = or(get(or(get(ref, "primary_location"), {}), "source"), {});
  return { doi: refDoi, title, year, authors: authors.slice(0, 6).join(", "), journal: strip(or(get(source, "display_name"), "")) };
}

export async function fetchOpenalexReferences(fetch, doi) {
  let work;
  try {
    work = await fetchJson(fetch, `https://api.openalex.org/works/doi:${pyQuote(doi, ":/")}`);
  } catch {
    return [];
  }
  const referenced = or(get(work, "referenced_works"), []);
  if (!referenced.length) return [];

  const ids = referenced.slice(0, OPENALEX_CAP).map((id) => strip(str(or(id, "")).split("/").pop())).filter(Boolean);
  const byId = new Map();
  for (let i = 0; i < ids.length; i += OPENALEX_BATCH) {
    const batch = [...new Set(ids.slice(i, i + OPENALEX_BATCH))];
    const url = `https://api.openalex.org/works?filter=openalex_id:${batch.map((id) => pyQuote(id)).join("|")}&per_page=${OPENALEX_BATCH}&select=${OPENALEX_SELECT}`;
    let results;
    try {
      results = or(get(await fetchJson(fetch, url), "results"), []);
    } catch {
      continue; // original: a failed per-work request is skipped
    }
    for (const r of results) byId.set(str(get(r, "id")).split("/").pop().toUpperCase(), r);
  }

  const out = [];
  for (const id of ids) {
    const ref = byId.get(id.toUpperCase());
    if (!ref) continue;
    const row = openalexRefRow(ref);
    if (row) out.push(row);
  }
  return out;
}

export async function fetchSemanticscholarReferences(fetch, doi) {
  doi = (doi || "").trim().toLowerCase();
  if (!doi) return [];
  let paperRef;
  if (isArxivDoi(doi)) {
    const m = doi.match(/arxiv\.(.+)$/i);
    if (!m) return [];
    paperRef = `ARXIV:${m[1]}`;
  } else {
    paperRef = `DOI:${doi}`;
  }
  let payload;
  try {
    payload = await fetchJson(fetch, `https://api.semanticscholar.org/graph/v1/paper/${pyQuote(paperRef)}/references?fields=externalIds,title,year,authors,venue&limit=100`);
  } catch {
    return [];
  }
  const out = [];
  for (const item of or(get(payload, "data"), [])) {
    const cited = or(get(or(item, {}), "citedPaper"), {});
    const ext = or(get(cited, "externalIds"), {});
    let refDoi = strip(or(get(ext, "DOI"), "")).toLowerCase();
    if (!refDoi) {
      const arxivId = strip(or(get(ext, "ArXiv"), ""));
      if (arxivId) refDoi = `10.48550/arxiv.${arxivId.toLowerCase()}`;
    }
    const title = strip(or(get(cited, "title"), ""));
    if (!refDoi && !title) continue;
    const authors = or(get(cited, "authors"), []).map((a) => strip(or(get(a, "name"), ""))).filter(Boolean);
    out.push({
      doi: refDoi,
      title,
      year: strip(str(or(get(cited, "year"), ""))),
      authors: authors.slice(0, 6).join(", "),
      journal: strip(or(get(cited, "venue"), "")),
    });
  }
  return out;
}

/** fetch_paper_references: Crossref (not for arXiv DOIs) → OpenAlex → Semantic Scholar. */
export async function fetchPaperReferences(paper, { fetch }) {
  const doi = str(paper && paper.doi).trim().toLowerCase();
  if (!doi) return { refs: [], source: "" };
  if (!isArxivDoi(doi)) {
    let refs = [];
    try { refs = await fetchCrossrefReferences(fetch, doi); } catch { refs = []; }
    if (refs.length) return { refs, source: "crossref" };
  }
  let oa = [];
  try { oa = await fetchOpenalexReferences(fetch, doi); } catch { oa = []; }
  if (oa.length) return { refs: oa, source: "openalex" };
  let s2 = [];
  try { s2 = await fetchSemanticscholarReferences(fetch, doi); } catch { s2 = []; }
  if (s2.length) return { refs: s2, source: "semanticscholar" };
  return { refs: [], source: "" };
}

/** cache_references(): deduped on (doi, lower(title)), truncated like the DB columns. */
export function toReferenceRows(refs, source, fetchedAt) {
  const seen = new Set();
  const rows = [];
  for (const entry of refs) {
    const doi = str(entry.doi).trim().toLowerCase();
    const title = str(entry.title).trim();
    const key = `${doi}\u0000${title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      doi,
      title: cut(title, 1024),
      year: cut(entry.year, 32),
      authors: cut(entry.authors, 512),
      journal: cut(entry.journal, 512),
      source,
      fetchedAt,
    });
  }
  return rows;
}

/**
 * Collect a paper's reference list.
 * → { source, rows, fetchedAt }. Nothing found: { source: "none", rows: [] }
 * (the original stored a placeholder row with source "none" meaning "fetched, nothing found").
 */
export async function fetchReferences(paper, { fetch, now = () => new Date() }) {
  const { refs, source } = await fetchPaperReferences(paper, { fetch });
  const fetchedAt = utcTimestamp(now());
  if (!refs.length) return { source: source || "none", rows: [], fetchedAt };
  return { source, rows: toReferenceRows(refs, source, fetchedAt), fetchedAt };
}

/** lookup_reference_metadata(): {title, year, authors (first 6), journal} or {} on failure. */
export async function enrichReference(doi, { fetch }) {
  const norm = str(doi).trim().toLowerCase();
  if (!norm) return {};
  let data;
  if (isArxivDoi(norm)) {
    try { data = await fetchOpenalexByUrl(fetch, norm); } catch { data = {}; }
  } else {
    try {
      data = await fetchCrossref(fetch, norm);
    } catch {
      try { data = await fetchOpenalexByUrl(fetch, norm); } catch { data = {}; }
    }
  }
  if (!truthy(data)) return {};
  const authors = or(data.authors, []);
  return {
    title: or(data.title, ""),
    year: or(data.year, ""),
    authors: truthy(authors) ? authors.slice(0, 6).join(", ") : "",
    journal: or(data.shortJournal, data.journal, ""),
  };
}
