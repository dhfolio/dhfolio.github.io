/**
 * js/localapi/owner/routes-profile.js
 * Owner write endpoints for what visitors see (Phase 2.3): profile, talks,
 * recognitions, news. Ported from research-atlas-v2 (profile.py,
 * talks_repository.py, recognitions_repository.py, news_repository.py).
 * Photos become media/ files via editor.putMedia (shared/media.js).
 */

import { ownerRead } from "./routes-read.js?v=1.0.5";
import { ensureProfileTags, ensureTags } from "./routes-write.js?v=1.0.5";
import { MediaError } from "../shared/media.js?v=1.0.5";
import {
  HttpError, NEWS, checkLink, checkNewsImages, cleanNewsLinks, cleanOrder, cleanPubViewPrefs,
  normalizeRecognition, normalizeTalk, parseBody, utcNow,
} from "../shared/payload.js?v=1.0.5";

const ok = (body) => ({ status: 200, body });
const noContent = () => ({ status: 204, body: null });
const live = (r) => r && !r.deletedAt;
const ids = (v) => (Array.isArray(v) ? v.map(String) : []);
const s = (v) => (v == null ? "" : String(v));

/** The GET answer for a path, so writes return exactly what a reload would show. */
async function read(ctx, path) {
  const url = new URL(path, "http://local");
  return (await ownerRead({ ...ctx, method: "GET", pathname: url.pathname, query: url.searchParams })).body;
}

const PROFILE_URLS = ["scholarUrl", "websiteUrl", "linkedinUrl", "githubUrl", "facebookUrl", "instagramUrl", "xUrl", "youtubeUrl"];

/** profile.py put_profile_me: every field optional, only given ones change. */
async function updateProfile(editor, current, b, now) {
  const p = { ...current };
  if (b.name != null) p.name = s(b.name).trim();
  if (b.bio != null) p.bio = s(b.bio);
  if (b.about != null) p.about = s(b.about);
  if (b.affiliation != null) p.affiliation = s(b.affiliation).trim();
  for (const k of PROFILE_URLS) if (b[k] != null) p[k] = checkLink("Profile link", b[k]);
  if (b.akaNames != null) {
    const parts = s(b.akaNames).split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length > 5) throw new HttpError(400, "At most 5 alternate names are allowed.");
    p.akaNames = parts.join(", ");
  }
  if (b.picture != null) {
    const pic = s(b.picture).trim();
    if (pic.length > 3_000_000) throw new HttpError(400, "Profile photo is too large.");
    if (pic && !/^data:image\//.test(pic) && !/^media\//.test(pic)) throw new HttpError(400, "Invalid profile photo.");
    p.picture = pic ? await editor.putMedia(pic) : "";
  }
  if (b.pictureCaption != null) p.pictureCaption = s(b.pictureCaption).trim().slice(0, 140);
  if (b.journalOrder != null) p.journalOrder = cleanOrder(b.journalOrder);
  if (b.tagOrder != null) p.tagOrder = cleanOrder(b.tagOrder);
  if (b.pubViewPrefs != null) p.pubViewPrefs = cleanPubViewPrefs(b.pubViewPrefs);
  p.updatedAt = now;
  return editor.putProfile(p);
}

/** news_repository create/update: lengths cut, links cleaned, photos stored as media/. */
async function newsRecord(editor, b, base, now) {
  const images = [];
  for (const img of checkNewsImages(b.images)) images.push({ src: await editor.putMedia(img.src), caption: img.caption });
  return {
    id: base.id,
    dateLabel: s(b.dateLabel).slice(0, 200),
    sortDate: s(b.sortDate).slice(0, 32),
    endDate: s(b.endDate).slice(0, 32),
    title: s(b.title).slice(0, 500),
    body: s(b.body).slice(0, NEWS.body),
    links: cleanNewsLinks(b.links),
    images,
    isPublic: b.isPublic === undefined ? true : Boolean(b.isPublic),
    addedAt: base.addedAt,
    updatedAt: base.updatedAt,
    deletedAt: null,
  };
}

/** One collection of talk-like records (talks, recognitions) with the same five endpoints. */
const KINDS = {
  talks: { dir: "talks", normalize: normalizeTalk, scope: "general", noun: "Talk", idsKey: "talkIds" },
  recognitions: { dir: "recognitions", normalize: normalizeRecognition, scope: "recognition", noun: "Recognition", idsKey: "recognitionIds" },
};

export async function ownerWriteProfile(ctx) {
  const { method, pathname: path } = ctx;
  if (method === "GET" || !ctx.editor) return null;
  const editor = ctx.editor;
  if (editor.readOnly) return { status: 423, body: { detail: editor.readOnly } };
  const ds = await editor.dataset();
  const now = utcNow();
  const body = () => parseBody(ctx.body);
  let m;

  try {
    if (path === "/api/profile/me" && method === "PUT") {
      await updateProfile(editor, ds.profile, body(), now);
      return ok(await read(ctx, "/api/profile/me"));
    }
    if (path === "/api/profile/me/visibility" && method === "PATCH") {
      // profile.py patch_visibility. This site is the public profile, so it cannot be made private.
      const b = body();
      if (b.profilePublic === false) throw new HttpError(400, "This site is the public profile and cannot be made private.");
      const p = { ...ds.profile };
      if (b.achievementsPublic != null) p.achievementsPublic = Boolean(b.achievementsPublic);
      p.updatedAt = now;
      await editor.putProfile(p);
      return ok({ profilePublic: Boolean(p.profilePublic), achievementsPublic: Boolean(p.achievementsPublic) });
    }

    for (const [route, kind] of Object.entries(KINDS)) {
      const list = ds[route];
      const find = (id) => list.find((r) => String(r.id) === id);
      if (path === `/api/${route}` && method === "POST") {
        const record = kind.normalize(body(), { now });
        if (find(record.id)) throw new HttpError(409, `${kind.noun} id already exists.`);
        await ensureTags(editor, ds, record.tags, now);
        await ensureProfileTags(editor, ds, record.profileTags, kind.scope, now);
        return ok(await editor.put(kind.dir, record));
      }
      if (path === `/api/${route}/bulk-delete` && method === "POST") {
        let count = 0;
        for (const id of ids(body()[kind.idsKey])) {
          const r = find(id);
          if (!live(r)) continue;
          await editor.put(kind.dir, { ...r, deletedAt: now });
          count++;
        }
        return ok({ count });
      }
      if (path === `/api/${route}/bulk-profile-visibility` && method === "POST") {
        const b = body();
        let count = 0;
        for (const id of ids(b[kind.idsKey])) {
          const r = find(id);
          if (!live(r)) continue;
          await editor.put(kind.dir, { ...r, showOnProfile: Boolean(b.showOnProfile), updatedAt: now });
          count++;
        }
        return ok({ count });
      }
      if ((m = new RegExp(`^/api/${route}/([^/]+)$`).exec(path))) {
        const id = decodeURIComponent(m[1]);
        const existing = find(id);
        if (!existing) throw new HttpError(404, `${kind.noun} not found.`);
        if (method === "PUT") {
          const record = kind.normalize(body(), { id, deletedAt: existing.deletedAt ?? null, now });
          await ensureTags(editor, ds, record.tags, now);
          await ensureProfileTags(editor, ds, record.profileTags, kind.scope, now);
          return ok(await editor.put(kind.dir, record));
        }
        if (method === "DELETE") {
          await editor.put(kind.dir, { ...existing, deletedAt: now });
          return noContent();
        }
      }
    }

    // ── news (news_repository.py) ──
    if (path === "/api/news" && method === "POST") {
      const b = body();
      const id = s(b.id).trim();
      if (!id) throw new HttpError(400, "News item id is required.");
      if (ds.news.some((n) => String(n.id) === id)) throw new HttpError(409, "News item id already exists.");
      const record = await newsRecord(editor, b, { id, addedAt: s(b.addedAt) || now, updatedAt: s(b.updatedAt) || now }, now);
      await editor.put("news", record);
      return ok(await read(ctx, `/api/news/${encodeURIComponent(id)}`));
    }
    if ((m = /^\/api\/news\/([^/]+)$/.exec(path))) {
      const id = decodeURIComponent(m[1]);
      const existing = ds.news.find((n) => String(n.id) === id && live(n));
      if (!existing) throw new HttpError(404, "News item not found.");
      if (method === "PUT") {
        // update_news keeps addedAt and always stamps updatedAt
        const record = await newsRecord(editor, body(), { id, addedAt: existing.addedAt, updatedAt: now }, now);
        await editor.put("news", record);
        return ok(await read(ctx, `/api/news/${encodeURIComponent(id)}`));
      }
      if (method === "DELETE") {
        await editor.put("news", { ...existing, deletedAt: now });
        return noContent();
      }
    }
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { detail: err.detail } };
    if (err instanceof MediaError) return { status: 400, body: { detail: err.message } };
    throw err;
  }
  return null;
}
