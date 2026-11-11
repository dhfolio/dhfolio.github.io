/**
 * js/localapi/shared/payload.js
 * Request-body normalization, ported from research-atlas-v2 so records are
 * stored exactly as the original API returned them (schemas.py field order
 * and defaults, papers_repository serializers, common.normalize_tag_names).
 * One addition: link fields must be http(s)/mailto (the projection refuses
 * anything else, so it is rejected here, when the owner can still fix it).
 */

export class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

/** common.utc_timestamp: UTC, seconds, no zone suffix. */
export const utcNow = () => new Date().toISOString().slice(0, 19);

const s = (v, d = "") => (v == null ? d : String(v));
const intOr = (v, d) => {
  if (v === null || v === undefined || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

export function parseBody(body) {
  if (body == null || body === "") return {};
  if (typeof body !== "string") throw new HttpError(415, "Expected a JSON body.");
  try {
    const v = JSON.parse(body);
    if (v && typeof v === "object") return v;
  } catch { /* fall through */ }
  throw new HttpError(422, "Request body is not valid JSON.");
}

/** common.normalize_tag_names: trimmed, empty dropped, case-insensitive dedupe, order kept. */
export function normalizeTagNames(names) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const clean = s(raw).trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/** paper_to_payload sorts tag names with key=str.casefold. */
export const sortCasefold = (list) => [...list].sort((a, b) => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
});

const LINK_OK = /^(https?:\/\/|mailto:)/i;
export function checkLink(field, value) {
  const v = s(value).trim();
  if (v && !LINK_OK.test(v)) throw new HttpError(400, `${field} must be an http(s) or mailto link.`);
  return s(value);
}

/** papers_repository._serialize_extra_links */
export function cleanExtraLinks(links) {
  const out = [];
  for (const item of Array.isArray(links) ? links : []) {
    if (!item || typeof item !== "object") continue;
    const label = s(item.label).trim();
    const url = s(item.url).trim();
    if (!label && !url) continue;
    checkLink("Link", url);
    out.push({ label, url });
  }
  return out;
}

/** papers_repository._serialize_author_annotations */
export function cleanAuthorAnnotations(ann) {
  const out = {};
  if (!ann || typeof ann !== "object" || Array.isArray(ann)) return out;
  for (const key of ["coFirst", "corresponding"]) {
    if (Array.isArray(ann[key])) out[key] = ann[key].filter((v) => typeof v === "number" && Number.isFinite(v)).map((v) => Math.trunc(v));
  }
  return out;
}

/** PaperPayload as stored and returned (schemas.py field order). */
export function normalizePaper(body, { id, deletedAt = null, now = utcNow() } = {}) {
  const b = body || {};
  const paperId = s(id ?? b.id).trim();
  if (!paperId) throw new HttpError(422, "Paper id is required.");
  if (typeof b.addedAt !== "string") throw new HttpError(422, "addedAt is required.");
  return {
    id: paperId,
    title: s(b.title),
    authors: s(b.authors),
    affiliations: s(b.affiliations),
    year: s(b.year),
    journal: s(b.journal),
    shortJournal: s(b.shortJournal),
    volume: s(b.volume),
    pages: s(b.pages),
    citationCount: intOr(b.citationCount, 0) || 0,
    citationSource: s(b.citationSource),
    type: s(b.type, "paper"),
    doi: s(b.doi),
    url: checkLink("URL", b.url),
    pdfPath: s(b.pdfPath),
    tags: sortCasefold(normalizeTagNames(b.tags)),
    starred: Boolean(b.starred),
    pinned: Boolean(b.pinned),
    isRead: Boolean(b.isRead),
    status: s(b.status, "unread"),
    notes: s(b.notes),
    summary: s(b.summary),
    sourceType: s(b.sourceType, "manual"),
    sourceName: s(b.sourceName),
    addedAt: b.addedAt,
    updatedAt: s(b.updatedAt) || now,
    deletedAt,
    authorOrder: intOr(b.authorOrder, null),
    isCoFirst: Boolean(b.isCoFirst),
    correspondingRole: s(b.correspondingRole) || "none",
    isPublic: Boolean(b.isPublic),
    isMine: Boolean(b.isMine),
    isLast: Boolean(b.isLast),
    isSelected: Boolean(b.isSelected),
    inLibrary: b.inLibrary === undefined ? true : Boolean(b.inLibrary),
    showOnProfile: b.showOnProfile === undefined ? true : Boolean(b.showOnProfile),
    extraLinks: cleanExtraLinks(b.extraLinks),
    authorAnnotations: cleanAuthorAnnotations(b.authorAnnotations),
    profileTags: sortCasefold(normalizeTagNames(b.profileTags)),
  };
}

/** TalkPayload (schemas.py order; isMine/showOnProfile default true). */
export function normalizeTalk(body, { id, deletedAt = null, now = utcNow() } = {}) {
  const b = body || {};
  const talkId = s(id ?? b.id).trim();
  if (!talkId) throw new HttpError(422, "Talk id is required.");
  if (typeof b.addedAt !== "string") throw new HttpError(422, "addedAt is required.");
  return {
    id: talkId,
    title: s(b.title),
    speakers: s(b.speakers),
    year: s(b.year),
    date: s(b.date),
    venue: s(b.venue),
    location: s(b.location),
    talkType: s(b.talkType),
    talkLink: checkLink("Talk link", b.talkLink),
    venueUrl: checkLink("Venue link", b.venueUrl),
    pdfPath: s(b.pdfPath),
    inviter: s(b.inviter),
    inviterUrl: checkLink("Inviter link", b.inviterUrl),
    tags: sortCasefold(normalizeTagNames(b.tags)),
    starred: Boolean(b.starred),
    pinned: Boolean(b.pinned),
    notes: s(b.notes),
    summary: s(b.summary),
    sourceType: s(b.sourceType, "manual"),
    sourceName: s(b.sourceName),
    addedAt: b.addedAt,
    updatedAt: s(b.updatedAt) || now,
    deletedAt,
    isPublic: Boolean(b.isPublic),
    isMine: b.isMine === undefined ? true : Boolean(b.isMine),
    isSelected: Boolean(b.isSelected),
    showOnProfile: b.showOnProfile === undefined ? true : Boolean(b.showOnProfile),
    extraLinks: cleanExtraLinks(b.extraLinks),
    profileTags: sortCasefold(normalizeTagNames(b.profileTags)),
  };
}

/** RecognitionPayload (schemas.py order). */
export function normalizeRecognition(body, { id, deletedAt = null, now = utcNow() } = {}) {
  const b = body || {};
  const recId = s(id ?? b.id).trim();
  if (!recId) throw new HttpError(422, "Recognition id is required.");
  if (typeof b.addedAt !== "string") throw new HttpError(422, "addedAt is required.");
  return {
    id: recId,
    title: s(b.title),
    authors: s(b.authors),
    year: s(b.year),
    journal: s(b.journal),
    type: s(b.type, "paper"),
    doi: s(b.doi),
    url: checkLink("URL", b.url),
    pdfPath: s(b.pdfPath),
    tags: sortCasefold(normalizeTagNames(b.tags)),
    starred: Boolean(b.starred),
    pinned: Boolean(b.pinned),
    notes: s(b.notes),
    summary: s(b.summary),
    sourceType: s(b.sourceType, "manual"),
    sourceName: s(b.sourceName),
    addedAt: b.addedAt,
    updatedAt: s(b.updatedAt) || now,
    deletedAt,
    isPublic: Boolean(b.isPublic),
    isMine: b.isMine === undefined ? true : Boolean(b.isMine),
    isSelected: Boolean(b.isSelected),
    showOnProfile: b.showOnProfile === undefined ? true : Boolean(b.showOnProfile),
    extraLinks: cleanExtraLinks(b.extraLinks),
    profileTags: sortCasefold(normalizeTagNames(b.profileTags)),
  };
}

// news_repository.py limits
export const NEWS = { images: 5, imageChars: 700_000, caption: 200, label: 200, url: 2000, links: 60, children: 60, body: 20_000 };

/** news_repository._clean_link (+ the link rule above) */
function newsLink(item) {
  if (!item || typeof item !== "object") return null;
  const label = s(item.label).trim().slice(0, NEWS.label);
  const url = s(item.url).trim().slice(0, NEWS.url);
  if (!label && !url) return null;
  checkLink("Link", url);
  return { label, url };
}

/** news_repository._serialize_links */
export function cleanNewsLinks(links) {
  const out = [];
  for (const item of (Array.isArray(links) ? links : []).slice(0, NEWS.links)) {
    const parent = newsLink(item);
    if (!parent) continue;
    const children = [];
    for (const child of (Array.isArray(item.children) ? item.children : []).slice(0, NEWS.children)) {
      const c = newsLink(child);
      if (c) children.push(c);
    }
    out.push({ ...parent, children });
  }
  return out;
}

/**
 * news_repository._serialize_images, minus storage: returns [{src, caption}]
 * with src as given (data: URL or media/ path) after the original's checks.
 * http(s) images are refused: the page CSP only shows this site's own files.
 */
export function checkNewsImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images)) throw new HttpError(400, "Images must be a list.");
  if (images.length > NEWS.images) throw new HttpError(400, `At most ${NEWS.images} images per news item.`);
  const out = [];
  for (const item of images) {
    if (!item || typeof item !== "object") continue;
    const src = s(item.src).trim();
    if (!src) continue;
    if (!/^data:image\//.test(src) && !/^media\/[0-9a-f]{16}\.(jpg|png|webp|gif)$/.test(src)) {
      throw new HttpError(400, "Upload the photo instead of linking to it.");
    }
    if (src.length > NEWS.imageChars) throw new HttpError(400, "Image is too large. Please use a smaller photo.");
    out.push({ src, caption: s(item.caption).trim().slice(0, NEWS.caption) });
  }
  return out;
}

// profile.py _SORT_MODES / _NUMBERING_MODES / _POSITION_FILTERS
const SORT_MODES = new Set(["year", "citations", "tag", "journal"]);
const NUMBERING = new Set(["off", "global", "per-year"]);
const POSITIONS = new Set(["main"]);

/** profile.py _sanitize_pub_view_prefs, stored in the decoded shape GET returns. */
export function cleanPubViewPrefs(p) {
  const v = p && typeof p === "object" ? p : {};
  const positions = [];
  for (const k of Array.isArray(v.positionFilters) ? v.positionFilters : []) if (POSITIONS.has(k) && !positions.includes(k)) positions.push(k);
  return {
    showAllPubs: typeof v.showAllPubs === "boolean" ? v.showAllPubs : null,
    sortMode: SORT_MODES.has(v.sortMode) ? v.sortMode : null,
    showNumbering: NUMBERING.has(v.showNumbering) ? v.showNumbering : null,
    positionFilters: positions,
  };
}

/** profile.py journalOrder / tagOrder cleaning: trimmed, case-insensitive dedupe. */
export const cleanOrder = (list) => normalizeTagNames(Array.isArray(list) ? list.map(String) : []);

/** TagsRepository._normalize_name */
export function tagName(raw) {
  const [name] = normalizeTagNames([raw]);
  if (!name) throw new HttpError(400, "Tag name is required.");
  return name;
}
