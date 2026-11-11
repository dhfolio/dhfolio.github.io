/**
 * js/localapi/shared/projection.js
 * The visitor projection of the private dataset: the exact payloads the old
 * public endpoints returned, rebuilt from atlas-data records. DOM-free and
 * Node-free, so tools/publish.mjs and the browser share it.
 *
 * Ported from research-atlas-v2:
 *   GET /api/profiles/{slug}          public_profiles.py:160-289
 *   GET /api/profiles/{slug}/library  public_profiles.py:47-83
 *   GET /api/profiles/{slug}/news     news.py:69-96
 *   GET /api/profiles/{slug}/graph    public.py:148-267
 *
 * Image fields hold "media/<name>" in the dataset and "/media/<name>" here.
 * Owner-only fields (notes, pdfPath, sourceName, reading state) are left as
 * they come; tools/lib/publicize.mjs blanks them afterwards, as it does for
 * the mirror.
 */

const live = (r) => r && !r.deletedAt;
const str = (v) => (v == null ? "" : String(v));

/**
 * ORDER BY a DESC, b DESC on strings, then id ASC. The original SQL had no
 * final key, so Postgres returned fully tied rows (e.g. a bulk import with one
 * addedAt) in arbitrary order; the id makes this projection deterministic.
 */
export function byDesc(...keys) {
  return (a, b) => {
    for (const k of keys) {
      const x = str(a[k]);
      const y = str(b[k]);
      if (x !== y) return x < y ? 1 : -1;
    }
    const x = str(a.id);
    const y = str(b.id);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

/** "media/x.jpg" → "/media/x.jpg"; anything else unchanged. */
export function publicMediaPath(value) {
  return typeof value === "string" && /^media\/[^/]+$/.test(value) ? `/${value}` : value;
}

function withoutDeletedAt(record) {
  const { deletedAt, ...rest } = record;
  return rest;
}

function profileHeader(profile, slug) {
  const p = profile || {};
  return {
    slug: str(p.slug) || slug,
    name: str(p.name),
    bio: str(p.bio),
    about: str(p.about),
    affiliation: str(p.affiliation),
    picture: publicMediaPath(str(p.picture)),
    pictureCaption: str(p.pictureCaption),
    scholarUrl: str(p.scholarUrl),
    websiteUrl: str(p.websiteUrl),
    linkedinUrl: str(p.linkedinUrl),
    githubUrl: str(p.githubUrl),
    facebookUrl: str(p.facebookUrl),
    instagramUrl: str(p.instagramUrl),
    xUrl: str(p.xUrl),
    youtubeUrl: str(p.youtubeUrl),
  };
}

const PREFS_DEFAULT = { showAllPubs: null, sortMode: null, showNumbering: null, positionFilters: [] };

export function projectProfile(ds, slug) {
  const papers = ds.papers.filter(live);
  const publications = papers.filter((p) => p.isMine && p.showOnProfile).sort(byDesc("year", "updatedAt"));
  const posts = papers.filter((p) => p.isPublic).sort(byDesc("updatedAt"));
  const talks = ds.talks.filter((t) => live(t) && t.showOnProfile).sort(byDesc("year", "updatedAt"));
  const recognitions = ds.recognitions.filter((r) => live(r) && r.showOnProfile).sort(byDesc("year", "updatedAt"));
  const p = ds.profile || {};
  return {
    ...profileHeader(p, slug),
    stats: { publications: publications.length, posts: posts.length, talks: talks.length, recognitions: recognitions.length },
    publications,
    posts,
    talks,
    recognitions,
    achievementsPublic: Boolean(p.achievementsPublic),
    journalOrder: Array.isArray(p.journalOrder) ? p.journalOrder : [],
    tagOrder: Array.isArray(p.tagOrder) ? p.tagOrder : [],
    pubViewPrefs: { ...PREFS_DEFAULT, ...(p.pubViewPrefs || {}) },
    isPrivate: false,
  };
}

export function projectNews(ds, slug) {
  const items = ds.news
    .filter((n) => live(n) && n.isPublic)
    .sort(byDesc("sortDate", "updatedAt"))
    .map((n) => {
      const item = withoutDeletedAt(n);
      return { ...item, images: (item.images || []).map((img) => ({ ...img, src: publicMediaPath(img.src) })) };
    });
  return { slug: str(ds.profile?.slug) || slug, name: str(ds.profile?.name), isPrivate: false, items };
}

export function projectLibrary(ds, slug) {
  const papers = ds.papers
    .filter((p) => live(p) && p.inLibrary)
    .sort(byDesc("addedAt", "updatedAt"))
    .map((p) => ({ ...p, notes: "", pdfPath: "", sourceName: "" }));
  return { slug: str(ds.profile?.slug) || slug, name: str(ds.profile?.name), isPrivate: false, papers };
}

/** public.py _year_only */
export function yearOnly(value) {
  const text = str(value).trim().replace(/-/g, "/");
  if (!text) return "";
  const head = text.split("/", 1)[0];
  return /^\d+$/.test(head) ? head : "";
}

/** public.py _build_user_graph + the isPrivate/name the route adds. */
export function projectGraph(ds, scope) {
  const inScope = (p) => {
    if (scope === "mine") return p.isMine && p.showOnProfile;
    if (scope === "library") return p.inLibrary;
    return p.inLibrary || (p.isMine && p.showOnProfile);
  };
  const seeds = ds.papers.filter((p) => live(p) && str(p.doi) !== "" && inScope(p));
  const seedByDoi = new Map();
  for (const p of seeds) {
    const doi = str(p.doi).trim().toLowerCase();
    if (doi) seedByDoi.set(doi, p);
  }
  const nodes = seeds.map((p) => ({
    id: `p:${p.id}`,
    doi: str(p.doi).trim().toLowerCase(),
    title: str(p.title),
    year: yearOnly(p.year),
    authors: str(p.authors),
    journal: str(p.shortJournal) || str(p.journal),
    isMine: Boolean(p.isMine) && Boolean(p.showOnProfile),
    inLibrary: Boolean(p.inLibrary),
    kind: "seed",
    type: str(p.type) || "paper",
    referenceCount: 0,
    authorOrder: p.authorOrder ?? null,
    isCoFirst: Boolean(p.isCoFirst),
    correspondingRole: str(p.correspondingRole) || "none",
  }));
  const edges = [];
  const seen = new Set();
  for (const p of seeds) {
    for (const row of ds.references?.[p.id] || []) {
      const refDoi = str(row.doi).trim().toLowerCase();
      if (!refDoi || !seedByDoi.has(refDoi)) continue;
      const target = seedByDoi.get(refDoi);
      if (target.id === p.id) continue;
      const source = `p:${p.id}`;
      const targetId = `p:${target.id}`;
      const key = `${source}\u0000${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target: targetId });
    }
  }
  return { nodes, edges, scope, isPrivate: false, name: str(ds.profile?.name) };
}

/** Everything the public site serves, before publicize(). */
export function project(ds, slug) {
  return {
    profile: projectProfile(ds, slug),
    news: projectNews(ds, slug),
    library: projectLibrary(ds, slug),
    graphs: { all: projectGraph(ds, "all"), mine: projectGraph(ds, "mine"), library: projectGraph(ds, "library") },
  };
}
