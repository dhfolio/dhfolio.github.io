/**
 * js/localapi/owner/routes-read.js
 * Owner GET endpoints, answered from the private dataset. DOM-free.
 * Each handler names the research-atlas-v2 code it ports.
 *
 * ctx.owner = {
 *   dataset(): Promise<dataset>              (js/localapi/shared/dataset.js)
 *   mediaDataUrl(path): Promise<string>      "media/x.jpg" → data:image/… URL
 * }
 */

import { byDesc, project, yearOnly } from "../shared/projection.js?v=1.0.3";
import { lookupMetadata } from "./metadata.js?v=1.0.3";

// While the old site runs, its lookup still has what the browser cannot get:
// abstracts scraped from publisher pages (doi.org → publisher has no CORS).
const LEGACY_METADATA = "https://researchatlas.io/api/metadata?query=";

/** GET /api/metadata: the browser port, plus the old site's abstract when the port found none. */
async function metadataFor(query, fetch) {
  const result = await lookupMetadata(query, { fetch });
  if (!result.abstract && result.doi) {
    try {
      const res = await fetch(LEGACY_METADATA + encodeURIComponent(result.doi), { credentials: "omit" });
      const legacy = res.ok ? await res.json() : null;
      if (legacy && typeof legacy.abstract === "string" && legacy.abstract) result.abstract = legacy.abstract;
    } catch { /* abstract stays empty */ }
  }
  return result;
}

const str = (v) => (v == null ? "" : String(v));
const live = (r) => r && !r.deletedAt;

// Postgres compared text with an en_US collation: case and punctuation are
// secondary. Intl gives the same first-level order; code points break ties.
const collator = new Intl.Collator("en-US", { sensitivity: "variant", ignorePunctuation: true });
export function sqlTextCompare(a, b) {
  const x = str(a);
  const y = str(b);
  return collator.compare(x, y) || (x < y ? -1 : x > y ? 1 : 0);
}

/** ORDER BY updated_at DESC, title ASC (papers/talks/recognitions repositories). */
const byUpdatedThenTitle = (a, b) => {
  if (str(a.updatedAt) !== str(b.updatedAt)) return str(a.updatedAt) < str(b.updatedAt) ? 1 : -1;
  return sqlTextCompare(a.title, b.title) || (str(a.id) < str(b.id) ? -1 : str(a.id) > str(b.id) ? 1 : 0);
};

const ok = (body) => ({ status: 200, body });
const notFound = (detail) => ({ status: 404, body: { detail } });

async function withMedia(owner, value) {
  return typeof value === "string" && /^media\/[^/]+$/.test(value) ? owner.mediaDataUrl(value) : value;
}

function tagRead(t) {
  return { id: t.id, name: t.name, created_at: str(t.createdAt), updated_at: str(t.updatedAt) };
}

/** profile.py _profile_payload */
async function profilePayload(owner, p) {
  return {
    name: str(p.name), bio: str(p.bio), about: str(p.about), affiliation: str(p.affiliation),
    scholarUrl: str(p.scholarUrl), websiteUrl: str(p.websiteUrl), linkedinUrl: str(p.linkedinUrl),
    githubUrl: str(p.githubUrl), facebookUrl: str(p.facebookUrl), instagramUrl: str(p.instagramUrl),
    xUrl: str(p.xUrl), youtubeUrl: str(p.youtubeUrl), akaNames: str(p.akaNames), slug: str(p.slug),
    picture: await withMedia(owner, str(p.picture)), pictureCaption: str(p.pictureCaption),
    journalOrder: Array.isArray(p.journalOrder) ? p.journalOrder : [],
    tagOrder: Array.isArray(p.tagOrder) ? p.tagOrder : [],
    pubViewPrefs: { showAllPubs: null, sortMode: null, showNumbering: null, positionFilters: [], ...(p.pubViewPrefs || {}) },
  };
}

/** citations_repository.build_graph (owner graph: manual links, web nodes, tags). */
export function ownerGraph(ds, scope) {
  const active = ds.papers.filter(live);
  const inScope = (p) => (scope === "mine" ? p.isMine : scope === "library" ? p.inLibrary : p.isMine || p.inLibrary);
  const seeds = active.filter((p) => str(p.doi) !== "" && inScope(p));
  const seedByDoi = new Map();
  for (const p of seeds) {
    const doi = str(p.doi).trim().toLowerCase();
    if (doi) seedByDoi.set(doi, p);
  }
  const refCount = (p) => (ds.references[p.id] || []).filter((r) => str(r.doi) !== "" || str(r.title) !== "").length;
  const tagsOf = (p) => [...new Set([...(p.tags || []), ...(p.profileTags || [])].map((t) => str(t).trim()).filter(Boolean))]
    .sort((a, b) => sqlTextCompare(a.toLowerCase(), b.toLowerCase()));
  const node = (p, kind) => ({
    id: `p:${p.id}`,
    doi: str(p.doi).trim().toLowerCase(),
    title: str(p.title),
    year: yearOnly(p.year),
    authors: str(p.authors),
    journal: str(p.shortJournal) || str(p.journal),
    url: str(p.url),
    isMine: Boolean(p.isMine),
    inLibrary: Boolean(p.inLibrary),
    kind,
    type: str(p.type) || "paper",
    referenceCount: refCount(p),
    authorOrder: p.authorOrder ?? null,
    isCoFirst: Boolean(p.isCoFirst),
    correspondingRole: str(p.correspondingRole) || "none",
    tags: tagsOf(p),
  });
  const nodes = new Map(seeds.map((p) => [`p:${p.id}`, node(p, "academic")]));
  const edges = [];
  const seen = new Set();
  for (const p of seeds) {
    for (const row of ds.references[p.id] || []) {
      const doi = str(row.doi).trim().toLowerCase();
      if (!doi || !seedByDoi.has(doi)) continue;
      const target = seedByDoi.get(doi);
      if (target.id === p.id) continue;
      const key = `ref\u0000p:${p.id}\u0000p:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: `p:${p.id}`, target: `p:${target.id}`, type: "ref" });
    }
  }
  const byId = new Map(active.map((p) => [p.id, p]));
  for (const link of ds.manualLinks) {
    const a = byId.get(link.paperA);
    const b = byId.get(link.paperB);
    if (!a || !b || !(inScope(a) || inScope(b))) continue;
    for (const p of [a, b]) if (!nodes.has(`p:${p.id}`)) nodes.set(`p:${p.id}`, node(p, str(p.doi).trim() ? "academic" : "web"));
    const pair = [`p:${a.id}`, `p:${b.id}`].sort();
    const key = `manual\u0000${pair[0]}\u0000${pair[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source: `p:${a.id}`, target: `p:${b.id}`, type: "manual" });
  }
  return { nodes: [...nodes.values()], edges, scope };
}

/** citations_repository.references_for_paper */
export function referencesFor(ds, paperId) {
  const active = ds.papers.filter(live);
  const paper = active.find((p) => p.id === paperId);
  if (!paper) return { paperId, found: false, references: [] };
  const byDoi = new Map();
  for (const p of active) {
    const d = str(p.doi).trim().toLowerCase();
    if (!d) continue;
    const prev = byDoi.get(d) || [false, false];
    byDoi.set(d, [prev[0] || Boolean(p.isMine), prev[1] || Boolean(p.inLibrary)]);
  }
  const refs = [];
  for (const row of ds.references[paper.id] || []) {
    if (!row.doi && !row.title) continue;
    const doi = str(row.doi).trim().toLowerCase();
    const [isMine, inLibrary] = (doi && byDoi.get(doi)) || [false, false];
    refs.push({ doi, title: str(row.title), year: str(row.year).trim(), authors: str(row.authors), journal: str(row.journal), isMine, inLibrary });
  }
  const yr = (r) => yearOnly(r.year) || "0";
  refs.sort((a, b) => (yr(a) === yr(b) ? 0 : yr(a) < yr(b) ? 1 : -1));
  return { paperId: paper.id, found: true, references: refs };
}

/** manual_links_repository.list_for_paper */
export function manualLinksFor(ds, paperId) {
  const active = new Map(ds.papers.filter(live).map((p) => [p.id, p]));
  if (!active.has(paperId)) return null;
  const out = [];
  for (const link of ds.manualLinks) {
    if (link.paperA !== paperId && link.paperB !== paperId) continue;
    const other = active.get(link.paperA === paperId ? link.paperB : link.paperA);
    if (!other) continue;
    out.push({
      id: link.id,
      otherPaper: {
        id: other.id, title: str(other.title), authors: str(other.authors), year: str(other.year),
        journal: str(other.shortJournal) || str(other.journal), doi: str(other.doi).toLowerCase(), url: str(other.url),
        isMine: Boolean(other.isMine), inLibrary: Boolean(other.inLibrary),
      },
      createdAt: str(link.createdAt),
    });
  }
  return out.sort((a, b) => (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1));
}

const PROFILE_RE = /^\/api\/profiles\/([^/]+)(\/news|\/library|\/graph)?$/;

export async function ownerRead(ctx) {
  if (ctx.method !== "GET" || !ctx.owner) return null;
  const { pathname: path, query } = ctx;
  const owner = ctx.owner;
  let m;

  switch (path) {
    case "/api/state": {
      const ds = await owner.dataset();
      return ok({
        // The original returned "" here when signed in (state_repository.py:19); the notes are the owner's.
        profile: { notes: str(ds.profile.notes) },
        tags: ds.tags.map((t) => t.name).sort(sqlTextCompare),
        papers: ds.papers.filter((p) => live(p) && p.inLibrary).sort(byUpdatedThenTitle),
      });
    }
    case "/api/papers": {
      const ds = await owner.dataset();
      let rows = ds.papers.filter(live);
      if (query.get("library_only") === "true") rows = rows.filter((p) => p.inLibrary);
      if (query.get("profile_only") === "true") rows = rows.filter((p) => !p.inLibrary);
      return ok(rows.sort(byUpdatedThenTitle));
    }
    case "/api/bin": {
      const ds = await owner.dataset();
      return ok(ds.papers.filter((p) => p.deletedAt).sort(byDesc("deletedAt")));
    }
    case "/api/tags": {
      const ds = await owner.dataset();
      return ok([...ds.tags].sort((a, b) => sqlTextCompare(a.name, b.name)).map(tagRead));
    }
    case "/api/profile-tags": {
      const ds = await owner.dataset();
      const scope = query.get("scope") || "general";
      return ok(ds.profileTags.filter((t) => (t.scope || "general") === scope)
        .sort((a, b) => sqlTextCompare(a.name, b.name))
        .map((t) => ({ id: t.id, name: t.name, scope: t.scope || "general", created_at: str(t.createdAt), updated_at: str(t.updatedAt) })));
    }
    case "/api/profile": {
      const ds = await owner.dataset();
      return ok({ notes: str(ds.profile.notes) });
    }
    case "/api/profile/me": {
      const ds = await owner.dataset();
      const lib = ds.papers.filter((p) => live(p) && p.inLibrary);
      return ok({
        profile: await profilePayload(owner, ds.profile),
        stats: { papers: lib.length, publications: lib.filter((p) => p.isMine).length, posts: lib.filter((p) => p.isPublic).length },
        // Username changes are not part of this site; the slug is fixed.
        username: { slug: str(ds.profile.slug), changesRemaining: 0, windowResetsAt: "", windowDays: 365 },
        visibility: { profilePublic: Boolean(ds.profile.profilePublic), achievementsPublic: Boolean(ds.profile.achievementsPublic) },
      });
    }
    case "/api/talks": {
      const ds = await owner.dataset();
      return ok(ds.talks.filter(live).sort(byUpdatedThenTitle));
    }
    case "/api/recognitions": {
      const ds = await owner.dataset();
      return ok(ds.recognitions.filter(live).sort(byUpdatedThenTitle));
    }
    case "/api/news": {
      const ds = await owner.dataset();
      const items = ds.news.filter(live).sort(byDesc("sortDate", "updatedAt"));
      return ok(await Promise.all(items.map(async ({ deletedAt, ...item }) => ({
        ...item,
        images: await Promise.all((item.images || []).map(async (img) => ({ ...img, src: await withMedia(owner, img.src) }))),
      }))));
    }
    case "/api/metadata": {
      try {
        return ok(await metadataFor(query.get("query") || "", ctx.fetch));
      } catch (err) {
        return { status: err.status || 502, body: { detail: err.message || "Lookup failed." } };
      }
    }
    case "/api/citations/graph": {
      const scope = ["all", "mine", "library"].includes(query.get("scope")) ? query.get("scope") : "all";
      return ok(ownerGraph(await owner.dataset(), scope));
    }
    default:
      break;
  }

  if ((m = /^\/api\/citations\/references\/([^/]+)$/.exec(path))) {
    return ok(referencesFor(await owner.dataset(), decodeURIComponent(m[1])));
  }
  if ((m = /^\/api\/papers\/([^/]+)\/manual-links$/.exec(path))) {
    const links = manualLinksFor(await owner.dataset(), decodeURIComponent(m[1]));
    return links ? ok(links) : notFound("Paper not found.");
  }
  if ((m = /^\/api\/papers\/([^/]+)$/.exec(path))) {
    const id = decodeURIComponent(m[1]);
    const paper = (await owner.dataset()).papers.find((p) => p.id === id);
    return paper ? ok(paper) : notFound("Paper not found.");
  }
  if ((m = PROFILE_RE.exec(path)) && decodeURIComponent(m[1]).toLowerCase() === ctx.ownerSlug) {
    // The owner sees the public view of the current dataset, published or not.
    const view = project(await owner.dataset(), ctx.ownerSlug);
    const sub = m[2] || "";
    if (sub === "/graph") {
      const scope = ["all", "mine", "library"].includes(query.get("scope")) ? query.get("scope") : "all";
      return ok(view.graphs[scope]);
    }
    return ok(sub === "/news" ? view.news : sub === "/library" ? view.library : view.profile);
  }
  return null;
}
