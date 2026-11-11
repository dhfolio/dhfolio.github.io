/**
 * js/localapi/owner/metadata.js
 * Browser port of backend/app/services/metadata.py → lookup_metadata()
 * (GET /api/metadata). DOM-free: all I/O goes through the injected fetch.
 *
 * Differences from the original, all forced by the browser:
 *  - No arXiv API (export.arxiv.org has no CORS). arXiv DOIs use DataCite +
 *    OpenAlex (what production returned anyway while arXiv was failing); the
 *    arxiv.org-URL path uses DataCite in place of the arXiv API.
 *  - No page scraping. Non-DOI, non-arXiv URLs are proxied to the old backend
 *    (researchatlas.io/api/metadata). If the proxy fails, the original's
 *    "page fetch failed" path runs locally (Crossref article-number, OpenAlex
 *    landing-page filter), then a minimal {incomplete: true} result.
 *  - No doi.org abstract fallback: doi.org redirects to the publisher page,
 *    which sends no CORS headers and is outside the page CSP.
 *  - Two crash fixes: extract_arxiv_id splits "arXiv." case-insensitively
 *    (the original raised IndexError on "10.48550/arxiv.…"), and null
 *    Crossref date-parts give "" instead of the year "None".
 */

const PROXY = "https://researchatlas.io/api/metadata?query=";

export const DOI_PATTERN = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;

// ---- Python semantics helpers ---------------------------------------------

/** Python truthiness. */
export function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "" || Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** Python `a or b or c`. */
export function or(...vals) {
  for (let i = 0; i < vals.length - 1; i += 1) if (truthy(vals[i])) return vals[i];
  return vals[vals.length - 1];
}

/** dict.get(key, default): a present-but-null key yields null; a non-dict raises like AttributeError. */
export function get(obj, key, dflt) {
  if (obj === null || obj === undefined || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError(`'${obj === null || obj === undefined ? "NoneType" : Array.isArray(obj) ? "list" : typeof obj}' object has no attribute 'get'`);
  }
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : dflt;
}

function strip(v) {
  if (typeof v !== "string") throw new TypeError(`'${v === null || v === undefined ? "NoneType" : typeof v}' object has no attribute 'strip'`);
  return v.trim();
}

function pyStr(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

function pyInt(v) {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && /^\s*[-+]?\d+\s*$/.test(v)) return parseInt(v, 10);
  throw new TypeError(`invalid literal for int(): '${v}'`);
}

const ALWAYS_SAFE = /[A-Za-z0-9_.\-~]/;

/** urllib.parse.quote(s, safe). */
export function pyQuote(s, safe = "/") {
  let out = "";
  for (const ch of String(s)) {
    if (ALWAYS_SAFE.test(ch) || safe.includes(ch)) { out += ch; continue; }
    for (const b of new TextEncoder().encode(ch)) out += `%${b.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/** urllib.parse.unquote(s): %XX runs decoded as UTF-8 with replacement, stray % kept. */
export function pyUnquote(s) {
  const text = String(s);
  if (!text.includes("%")) return text;
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16);
    return new TextDecoder("utf-8").decode(bytes);
  });
}

/** fetch_json: GET, no cookies, no custom headers; urllib-style error text. */
export async function fetchJson(fetch, url) {
  const init = { credentials: "omit" };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(15000);
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText || "Error"}`);
  return res.json();
}

// ---- normalizers -----------------------------------------------------------

export function firstText(value) {
  if (Array.isArray(value)) return value.length ? value[0] : "";
  return or(value, "");
}

export function normalizePartialDateParts(parts) {
  if (!truthy(parts)) return "";
  // Original: str(None) → "None"; nulls are treated as missing here.
  const values = parts.filter((p) => p !== null && p !== undefined).map((p) => pyStr(p).trim()).filter(Boolean);
  if (!values.length) return "";
  const year = values[0];
  const month = values.length > 1 ? values[1].padStart(2, "0") : "";
  const day = values.length > 2 ? values[2].padStart(2, "0") : "";
  if (year && month && day) return `${year}/${month}/${day}`;
  if (year && month) return `${year}/${month}`;
  return year;
}

export function normalizeIsoDateText(value) {
  const raw = (value || "").trim();
  if (!raw) return "";
  const m = raw.match(/((?:19|20)\d{2})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return "";
  const [, year, month, day] = m;
  if (year && month && day) return `${year}/${month.padStart(2, "0")}/${day.padStart(2, "0")}`;
  if (year && month) return `${year}/${month.padStart(2, "0")}`;
  return year;
}

export function publicationDatePrecision(value) {
  const normalized = (value || "").trim().replaceAll(".", "/").replaceAll("-", "/");
  if (!normalized) return 0;
  return Math.min(normalized.split("/").filter(Boolean).length, 3);
}

export function chooseMorePrecisePublicationDate(current, incoming) {
  const cur = (current || "").trim();
  const inc = (incoming || "").trim();
  if (!inc) return cur;
  if (!cur) return inc;
  return publicationDatePrecision(inc) > publicationDatePrecision(cur) ? inc : cur;
}

/** Strips every tag (JATS, MathML, HTML) and a leading "Abstract" label. Entities are left as-is, like the original. */
export function normalizeAbstract(raw) {
  if (!truthy(raw)) return "";
  let text = String(raw).replace(/<[^>]+>/g, "").trim();
  text = text.replace(/^[Aa][Bb][Ss][Tt][Rr][Aa][Cc][Tt]\s*[:.\-—]?\s*/, "").trim();
  return text;
}

export function normalizeJournalName(raw) {
  const value = strip(or(raw, ""));
  if (!value) return "";
  const lowered = value.toLowerCase();
  if (lowered === "arxiv.org" || lowered === "arxiv") return "arXiv";
  return value;
}

export function extractDoi(text) {
  if (!text) return "";
  const decoded = pyUnquote(text);
  const m = decoded.match(DOI_PATTERN);
  if (m) return m[0];
  if (decoded.toLowerCase().startsWith("doi:")) return decoded.slice(4).trim();
  if (decoded.startsWith("10.")) return decoded.trim();
  return "";
}

export function isArxivDoi(doi) {
  return normalizeAbstract(doi).toLowerCase().startsWith("10.48550/arxiv.");
}

export function extractArxivId(doiOrQuery) {
  const text = (doiOrQuery || "").trim();
  const doi = extractDoi(text);
  if (isArxivDoi(doi)) {
    const at = doi.search(/arxiv\./i);
    return doi.slice(at + "arxiv.".length);
  }
  const m = text.match(/arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/i);
  if (m) return m[1].replaceAll(".pdf", "");
  return "";
}

export function normalizePersonName(name) {
  let clean = (name || "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  if (clean.includes(",")) {
    const parts = clean.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) clean = [...parts.slice(1), parts[0]].join(" ");
  }
  return clean.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function canonicalPersonName(name) {
  const clean = (name || "").trim().replace(/\s+/g, " ");
  if (!clean) return "";
  if (clean.includes(",")) {
    const parts = clean.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return [...parts.slice(1), parts[0]].join(" ");
  }
  return clean;
}

export function mergeMetadata(base, incoming) {
  const merged = { ...base };
  for (const key of ["doi", "title", "journal", "shortJournal", "volume", "pages", "abstract", "citationSource", "crossrefType"]) {
    if (!truthy(merged[key]) && truthy(incoming[key])) merged[key] = incoming[key];
  }
  merged.year = chooseMorePrecisePublicationDate(merged.year ?? "", incoming.year ?? "");
  merged.citationCount = Math.max(pyInt(or(merged.citationCount, 0)), pyInt(or(incoming.citationCount, 0)));

  {
    const existing = (merged.authors || []).map(canonicalPersonName).filter(Boolean);
    const seen = new Set(existing.map(normalizePersonName));
    for (const item of incoming.authors || []) {
      const canonical = canonicalPersonName(item);
      const normalized = normalizePersonName(canonical);
      if (canonical && normalized && !seen.has(normalized)) { existing.push(canonical); seen.add(normalized); }
    }
    merged.authors = existing;
  }
  {
    const existing = [...(merged.affiliations || [])];
    const seen = new Set(existing.filter(Boolean).map((i) => i.toLowerCase().trim()));
    for (const item of incoming.affiliations || []) {
      const normalized = item.toLowerCase().trim();
      if (item && normalized && !seen.has(normalized)) { existing.push(item); seen.add(normalized); }
    }
    merged.affiliations = existing;
  }

  const sources = [...(merged.sources || [])];
  const name = incoming.source;
  if (name && !sources.includes(name)) sources.push(name);
  merged.sources = sources;
  merged.source = sources.length ? sources.join(" + ") : (merged.source ?? "");
  return merged;
}

// ---- providers -------------------------------------------------------------

function crossrefAuthors(list) {
  return (list || []).map((a) => [get(a, "given", ""), get(a, "family", "")].filter(truthy).join(" ").trim());
}

function crossrefAffiliations(list) {
  const out = [];
  for (const a of list || []) {
    for (const af of get(a, "affiliation", [])) {
      const name = strip(or(get(af, "name"), ""));
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

function crossrefIssued(item) {
  const issued = get(get(item, "issued", {}), "date-parts", [[]]);
  return normalizePartialDateParts(truthy(issued) ? issued[0] : []);
}

export async function fetchCrossref(fetch, doi) {
  const payload = get(await fetchJson(fetch, `https://api.crossref.org/works/${pyQuote(doi)}`), "message", {});
  const authorList = get(payload, "author", []);
  return {
    doi: get(payload, "DOI", doi),
    title: firstText(get(payload, "title")),
    authors: crossrefAuthors(authorList).filter(Boolean),
    affiliations: crossrefAffiliations(authorList),
    journal: normalizeJournalName(firstText(get(payload, "container-title"))),
    shortJournal: firstText(get(payload, "short-container-title")),
    volume: pyStr(or(get(payload, "volume"), "")),
    pages: pyStr(or(get(payload, "article-number"), get(payload, "page"), "")),
    citationCount: pyInt(or(get(payload, "is-referenced-by-count"), 0)),
    citationSource: "crossref",
    year: crossrefIssued(payload),
    abstract: normalizeAbstract(get(payload, "abstract", "")),
    source: "crossref",
    crossrefType: get(payload, "type", ""),
  };
}

export const DOMAIN_TO_CROSSREF_MEMBER = {
  "pubs.aip.org": "317",
  "iopscience.iop.org": "266",
  "www.nature.com": "339",
  "link.springer.com": "297",
  "pubs.acs.org": "316",
  "www.science.org": "221",
  "journals.aps.org": "16",
  "www.tandfonline.com": "301",
};

export async function searchCrossrefByArticleNumber(fetch, articleNumber, memberId) {
  const url = `https://api.crossref.org/works?filter=member:${memberId},article-number:${pyQuote(articleNumber)}&rows=1`;
  const items = get(get(await fetchJson(fetch, url), "message", {}), "items", []);
  if (!truthy(items)) return {};
  const best = items[0];
  const authorList = get(best, "author", []);
  return {
    doi: get(best, "DOI", ""),
    title: firstText(get(best, "title")),
    authors: crossrefAuthors(authorList).filter(Boolean),
    affiliations: crossrefAffiliations(authorList),
    journal: normalizeJournalName(firstText(get(best, "container-title"))),
    shortJournal: firstText(get(best, "short-container-title")),
    volume: pyStr(or(get(best, "volume"), "")),
    pages: pyStr(or(get(best, "article-number"), get(best, "page"), "")),
    citationCount: pyInt(or(get(best, "is-referenced-by-count"), 0)),
    citationSource: "crossref",
    year: crossrefIssued(best),
    abstract: normalizeAbstract(firstText(get(best, "abstract"))),
    source: "crossref-article-number",
  };
}

export async function fetchDatacite(fetch, doi) {
  const payload = get(get(await fetchJson(fetch, `https://api.datacite.org/dois/${pyQuote(doi)}`), "data", {}), "attributes", {});
  const creators = get(payload, "creators", []);
  const authors = creators.filter((c) => truthy(get(c, "name"))).map((c) => strip(get(c, "name", "")));
  const affiliations = [];
  for (const c of creators) {
    for (const af of or(get(c, "affiliation"), [])) {
      const name = strip(or(af && typeof af === "object" && !Array.isArray(af) ? get(af, "name") : pyStr(af), ""));
      if (name && !affiliations.includes(name)) affiliations.push(name);
    }
  }
  let abstract = "";
  for (const d of or(get(payload, "descriptions"), [])) {
    if (get(d, "descriptionType") === "Abstract") { abstract = get(d, "description", ""); break; }
  }
  const titles = or(get(payload, "titles"), []);
  let year = "";
  for (const item of or(get(payload, "dates"), [])) {
    if (or(get(item, "dateType"), "").toLowerCase() === "issued") {
      year = normalizeIsoDateText(get(item, "date"));
      if (year) break;
    }
  }
  if (!year) year = pyStr(or(get(payload, "publicationYear"), ""));
  return {
    doi,
    title: titles.length ? get(or(titles[0], {}), "title", "") : "",
    authors,
    affiliations,
    journal: normalizeJournalName(get(payload, "publisher", "")),
    shortJournal: "",
    volume: "",
    pages: "",
    citationCount: 0,
    citationSource: "",
    year,
    abstract: normalizeAbstract(abstract),
    source: "datacite",
  };
}

export function openalexAbstract(index) {
  if (!truthy(index)) return "";
  const ordered = [];
  for (const [word, positions] of Object.entries(index)) for (const p of positions) ordered.push([p, word]);
  ordered.sort((a, b) => a[0] - b[0]);
  return normalizeAbstract(ordered.map(([, w]) => w).join(" "));
}

export async function fetchOpenalexByUrl(fetch, urlOrDoi) {
  const doi = extractDoi(urlOrDoi);
  let url;
  if (doi) url = `https://api.openalex.org/works?filter=doi:${pyQuote(doi, ":/")}`;
  else if (urlOrDoi.startsWith("http")) url = `https://api.openalex.org/works?filter=primary_location.landing_page_url:${pyQuote(urlOrDoi, ":/")}`;
  else url = `https://api.openalex.org/works?search=${pyQuote(urlOrDoi, "")}`;
  const results = get(await fetchJson(fetch, url), "results", []);
  if (!truthy(results)) return {};

  const work = results[0];
  const authorships = get(work, "authorships", []);
  const authors = authorships.map((i) => or(get(i, "raw_author_name"), get(get(i, "author", {}), "display_name", ""))).filter(truthy);
  const affiliations = [];
  for (const a of authorships) {
    for (const inst of get(a, "institutions", [])) {
      const name = strip(or(get(inst, "display_name"), ""));
      if (name && !affiliations.includes(name)) affiliations.push(name);
    }
  }
  let year = normalizeIsoDateText(pyStr(or(get(work, "publication_date"), "")));
  if (!year) year = pyStr(or(get(work, "publication_year"), ""));
  const source = get(get(work, "primary_location", {}), "source", {});
  const biblio = get(work, "biblio", {});
  return {
    doi: or(get(work, "doi"), "").replaceAll("https://doi.org/", ""),
    title: get(work, "display_name", ""),
    authors,
    affiliations,
    journal: normalizeJournalName(get(source, "display_name", "")),
    shortJournal: or(get(get(get(work, "primary_location", {}), "source", {}), "abbreviated_title", ""), ""),
    volume: pyStr(or(get(biblio, "volume"), "")),
    pages: pyStr(or(get(biblio, "first_page"), get(biblio, "last_page"), "")),
    citationCount: pyInt(or(get(work, "cited_by_count"), 0)),
    citationSource: "openalex",
    year,
    abstract: openalexAbstract(or(get(work, "abstract_inverted_index"), {})),
    source: "openalex",
  };
}

// ---- lookup ----------------------------------------------------------------

const emptyCombined = (doi = "") => ({
  doi, title: "", authors: [], affiliations: [], journal: "", shortJournal: "", volume: "", pages: "",
  citationCount: 0, citationSource: "", year: "", abstract: "", source: "", sources: [],
});

const hasAny = (r) => truthy(r) && (truthy(r.title) || truthy(r.authors) || truthy(r.journal) || truthy(r.doi) || truthy(r.abstract));
const isComplete = (c) => truthy(c.title) || truthy(c.authors) || truthy(c.journal);

const s = (v) => (v === null || v === undefined ? "" : String(v));
const strList = (v) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).map(String) : []);

/** MetadataResponse.model_validate(): exactly the schema's fields, with its defaults. */
export function toMetadataResponse(c) {
  return {
    doi: s(c.doi),
    title: s(c.title),
    authors: strList(c.authors),
    affiliations: strList(c.affiliations),
    journal: s(c.journal),
    shortJournal: s(c.shortJournal),
    volume: s(c.volume),
    pages: s(c.pages),
    citationCount: Number.isFinite(Number(c.citationCount)) ? Math.trunc(Number(c.citationCount)) : 0,
    citationSource: s(c.citationSource),
    year: s(c.year),
    abstract: s(c.abstract),
    source: s(c.source),
    sources: strList(c.sources),
    input: s(c.input),
  };
}

function lookupError(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function runSources(combined, list, errors, stripAuthors) {
  for (const [name, loader] of list) {
    try {
      let result = await loader();
      if (hasAny(result)) {
        if (stripAuthors(name)) result = { ...result, authors: [] };
        combined = mergeMetadata(combined, result);
      }
    } catch (exc) {
      errors.push(`${name}: ${exc && exc.message ? exc.message : exc}`);
    }
  }
  return combined;
}

/** Non-DOI, non-arXiv URL: proxy, then the original's "page fetch failed" path. */
async function lookupUrl(fetch, query) {
  let pageError;
  try {
    const init = { credentials: "omit" };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(45000);
    const res = await fetch(`${PROXY}${encodeURIComponent(query)}`, init);
    const body = await res.json().catch(() => null);
    const isObj = body && typeof body === "object" && !Array.isArray(body);
    if (res.ok && isObj) return toMetadataResponse({ ...body, input: query });
    pageError = `page-meta: ${isObj && typeof body.detail === "string" ? body.detail : `HTTP Error ${res.status}: ${res.statusText || "Error"}`}`;
  } catch (exc) {
    pageError = `page-meta: ${exc && exc.message ? exc.message : exc}`;
  }

  const errors = [pageError];
  let host = "";
  try { host = new URL(query).hostname; } catch { host = ""; }
  const memberId = DOMAIN_TO_CROSSREF_MEMBER[host] || "";
  if (memberId) {
    const m = query.match(/\/article\/\d+\/\d+\/(\d{5,})\//);
    if (m) {
      try {
        const an = await searchCrossrefByArticleNumber(fetch, m[1], memberId);
        if (truthy(an) && (truthy(an.title) || truthy(an.doi))) {
          const combined = mergeMetadata(emptyCombined(), an);
          if (isComplete(combined)) return toMetadataResponse({ ...combined, input: query });
        }
      } catch (exc) {
        errors.push(`crossref-article-number: ${exc && exc.message ? exc.message : exc}`);
      }
    }
  }

  const loopErrors = [];
  const combined = await runSources(emptyCombined(), [["openalex-from-query", () => fetchOpenalexByUrl(fetch, query)]], loopErrors, () => false);
  if (isComplete(combined)) return toMetadataResponse({ ...combined, input: query });

  // The original raised here; the browser returns what the frontend can still use.
  return {
    ...toMetadataResponse({ ...emptyCombined(), input: query }),
    url: query,
    incomplete: true,
    errors: [...errors, ...loopErrors],
  };
}

/**
 * GET /api/metadata?query= → MetadataResponse.
 * Throws Error (err.status 502, message like the route's `detail`) on total failure,
 * err.status 422 for an empty query.
 */
export async function lookupMetadata(query, { fetch }) {
  query = (query || "").trim();
  if (!query) throw lookupError("query is required", 422);
  const doi = extractDoi(query);
  const arxivId = extractArxivId(query);
  const sources = [];

  if (doi) {
    if (isArxivDoi(doi)) {
      sources.push(["datacite", () => fetchDatacite(fetch, doi)]);
      // original: ("arxiv-api", fetch_arxiv_api(doi)) — no CORS on export.arxiv.org
      sources.push(["openalex", () => fetchOpenalexByUrl(fetch, doi)]);
    } else {
      sources.push(["crossref", () => fetchCrossref(fetch, doi)]);
      sources.push(["openalex", () => fetchOpenalexByUrl(fetch, doi)]);
    }
  } else if (arxivId && query.toLowerCase().includes("arxiv.org")) {
    const errors = [];
    // original: ("arxiv-api", fetch_arxiv_api(arxiv_id)); DataCite stands in for it.
    const arxivDoi = `10.48550/arXiv.${arxivId.replace(/v\d+$/i, "")}`;
    const combined = await runSources(emptyCombined(), [
      ["datacite", () => fetchDatacite(fetch, arxivDoi)],
      ["openalex", () => fetchOpenalexByUrl(fetch, `https://arxiv.org/abs/${arxivId}`)],
    ], errors, (name) => name === "openalex");
    if (isComplete(combined)) return toMetadataResponse({ ...combined, input: query });
    throw lookupError(errors.filter(Boolean).join("; ") || "No metadata found.");
  } else if (query.startsWith("http://") || query.startsWith("https://")) {
    return lookupUrl(fetch, query);
  } else {
    sources.push(["openalex-from-query", () => fetchOpenalexByUrl(fetch, query)]);
  }

  const errors = [];
  const combined = await runSources(emptyCombined(doi), sources, errors, (name) => isArxivDoi(doi) && name === "openalex");
  if (isComplete(combined)) {
    // original: doi.org publisher-page abstract fallback here (dropped, no CORS).
    combined.input = query;
    if (!truthy(combined.doi)) combined.doi = doi;
    return toMetadataResponse(combined);
  }
  throw lookupError(errors.join("; ") || "No metadata found.");
}
