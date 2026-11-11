/**
 * js/localapi/owner/routes-write.js
 * Owner write endpoints for the Library (Phase 2.2), ported from
 * research-atlas-v2 repositories. Each handler names its source.
 * ctx.editor (owner/editor.js) is the only thing that changes data.
 */

import { manualLinksFor } from "./routes-read.js?v=1.0.4";
import { fetchReferences } from "./references.js?v=1.0.4";
import { HttpError, normalizePaper, parseBody, sortCasefold, tagName, utcNow } from "../shared/payload.js?v=1.0.4";

const ok = (body) => ({ status: 200, body });
const noContent = () => ({ status: 204, body: null });
const live = (r) => r && !r.deletedAt;
const ids = (v) => (Array.isArray(v) ? v.map(String) : []);
const tagRead = (t) => ({ id: t.id, name: t.name, created_at: t.createdAt, updated_at: t.updatedAt });
const profileTagRead = (t) => ({ id: t.id, name: t.name, scope: t.scope, created_at: t.createdAt, updated_at: t.updatedAt });
export const nextId = (list) => list.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1;

/** common.ensure_tags / ensure_profile_tags: create the tag rows a saved record names. */
export async function ensureTags(editor, ds, names, now) {
  for (const name of names) {
    if (ds.tags.some((t) => t.name === name)) continue;
    await editor.put("tags", { id: nextId(ds.tags), name, createdAt: now, updatedAt: now });
  }
}
export async function ensureProfileTags(editor, ds, names, scope, now) {
  for (const name of names) {
    if (ds.profileTags.some((t) => t.name === name && (t.scope || "general") === scope)) continue;
    await editor.put("profile-tags", { id: nextId(ds.profileTags), name, scope, createdAt: now, updatedAt: now });
  }
}

/** Rename or drop a tag name on every record that carries it (the M2M rows did this in SQL). */
async function retag(editor, ds, field, collections, from, to) {
  for (const dir of collections) {
    const list = { papers: ds.papers, talks: ds.talks, recognitions: ds.recognitions }[dir];
    for (const rec of [...list]) {
      const names = rec[field] || [];
      if (!names.includes(from)) continue;
      const next = to == null ? names.filter((n) => n !== from) : [...new Set(names.map((n) => (n === from ? to : n)))];
      await editor.put(dir, { ...rec, [field]: sortCasefold(next) });
    }
  }
}

async function savePaper(editor, ds, record, now) {
  await ensureTags(editor, ds, record.tags, now);
  await ensureProfileTags(editor, ds, record.profileTags, "general", now);
  return editor.put("papers", record);
}

/** Hard delete of a binned paper: the row, its cached references and its manual links (FK cascade). */
async function purgePaper(editor, ds, paper) {
  await editor.remove("papers", paper.id);
  await editor.removeReferences(paper.id);
  for (const link of ds.manualLinks.filter((l) => l.paperA === paper.id || l.paperB === paper.id)) {
    await editor.remove("manual-links", link.id);
  }
}

/**
 * A newly added paper with a DOI gets its reference list in the background
 * (Maps uses it), saved in the same way as citations "refresh" did. The
 * request has already been answered; a failure only means no list yet.
 */
export function collectReferences(editor, ds, paper, fetch) {
  if (!String(paper.doi || "").trim() || ds.references[paper.id] || typeof fetch !== "function") return null;
  return fetchReferences(paper, { fetch })
    .then(({ source, rows, fetchedAt }) => editor.putReferences(paper.id, rows.length ? rows
      // cache_references: "fetched, nothing found" is one empty row
      : [{ doi: "", title: "", year: "", authors: "", journal: "", source, fetchedAt }]))
    .catch((err) => { console.warn("[references]", paper.id, err); });
}

export const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (Math.random() * 16) >> (c / 4)).toString(16)));

export async function ownerWrite(ctx) {
  const { method, pathname: path } = ctx;
  if (method === "GET" || !ctx.editor) return null;
  const editor = ctx.editor;
  if (editor.readOnly) return { status: 423, body: { detail: editor.readOnly } };
  const ds = await editor.dataset();
  const now = utcNow();
  const body = () => parseBody(ctx.body);
  const findPaper = (id) => ds.papers.find((p) => p.id === id);
  let m;

  try {
    // ── papers (papers_repository.py) ──
    if (path === "/api/papers" && method === "POST") {
      const record = normalizePaper(body(), { now });
      if (findPaper(record.id)) throw new HttpError(409, "Paper id already exists.");
      const saved = await savePaper(editor, ds, record, now);
      ctx.pending = collectReferences(editor, ds, saved, ctx.fetch);
      return ok(saved);
    }
    if (path === "/api/papers/bulk-status" && method === "POST") {
      const { paperIds, status } = body();
      let count = 0;
      for (const id of ids(paperIds)) {
        const p = findPaper(id);
        if (!live(p)) continue;
        await editor.put("papers", { ...p, status: String(status ?? ""), updatedAt: now });
        count++;
      }
      return ok({ count });
    }
    if (path === "/api/papers/bulk-delete" && method === "POST") {
      let count = 0;
      for (const id of ids(body().paperIds)) {
        const p = findPaper(id);
        if (!live(p)) continue;
        await editor.put("papers", { ...p, deletedAt: now });
        count++;
      }
      return ok({ count });
    }
    if (path === "/api/papers/bulk-profile-visibility" && method === "POST") {
      const { paperIds, showOnProfile } = body();
      let count = 0;
      for (const id of ids(paperIds)) {
        const p = findPaper(id);
        if (!live(p)) continue;
        await editor.put("papers", { ...p, showOnProfile: Boolean(showOnProfile), updatedAt: now });
        count++;
      }
      return ok({ count });
    }
    if ((m = /^\/api\/papers\/([^/]+)\/manual-links$/.exec(path)) && method === "POST") {
      // manual_links_repository.create
      const source = decodeURIComponent(m[1]);
      const target = String(body().targetPaperId || "");
      if (!target || target === source) throw new HttpError(400, "A paper cannot link to itself.");
      if (!live(findPaper(source)) || !live(findPaper(target))) throw new HttpError(404, "Paper not found.");
      const [a, b] = source <= target ? [source, target] : [target, source];
      if (ds.manualLinks.some((l) => l.paperA === a && l.paperB === b)) throw new HttpError(409, "Link already exists.");
      const link = { id: uuid(), paperA: a, paperB: b, createdAt: now };
      await editor.put("manual-links", link);
      return ok(manualLinksFor(ds, source).find((l) => l.id === link.id));
    }
    if ((m = /^\/api\/papers\/([^/]+)\/manual-links\/([^/]+)$/.exec(path)) && method === "DELETE") {
      const source = decodeURIComponent(m[1]);
      const linkId = decodeURIComponent(m[2]);
      if (!live(findPaper(source))) throw new HttpError(404, "Paper not found.");
      const link = ds.manualLinks.find((l) => l.id === linkId && (l.paperA === source || l.paperB === source));
      if (!link) throw new HttpError(404, "Link not found.");
      await editor.remove("manual-links", link.id);
      return noContent();
    }
    if ((m = /^\/api\/papers\/([^/]+)$/.exec(path))) {
      const id = decodeURIComponent(m[1]);
      const existing = findPaper(id);
      if (!existing) throw new HttpError(404, "Paper not found.");
      if (method === "PUT") {
        // update_paper: full overwrite; Bin state is kept as it was
        const record = normalizePaper(body(), { id, deletedAt: existing.deletedAt ?? null, now });
        return ok(await savePaper(editor, ds, record, now));
      }
      if (method === "DELETE") {
        // delete_paper: soft delete into the Bin
        await editor.put("papers", { ...existing, deletedAt: now });
        return noContent();
      }
    }

    // ── bin (bin_repository.py) ──
    if ((m = /^\/api\/bin\/([^/]+)\/restore$/.exec(path)) && method === "POST") {
      const p = findPaper(decodeURIComponent(m[1]));
      if (!p || !p.deletedAt) throw new HttpError(404, "Paper not found in Bin.");
      return ok(await editor.put("papers", { ...p, deletedAt: null }));
    }
    if (path === "/api/bin/bulk-restore" && method === "POST") {
      let count = 0;
      for (const id of ids(body().paperIds)) {
        const p = findPaper(id);
        if (!p || !p.deletedAt) continue;
        await editor.put("papers", { ...p, deletedAt: null });
        count++;
      }
      return ok({ count });
    }
    if (path === "/api/bin/bulk-delete" && method === "POST") {
      const victims = ids(body().paperIds).map(findPaper).filter((p) => p && p.deletedAt);
      editor.allowMassDelete();
      for (const p of victims) await purgePaper(editor, ds, p);
      return ok({ count: victims.length });
    }
    if (path === "/api/bin" && method === "DELETE") {
      const victims = ds.papers.filter((p) => p.deletedAt);
      editor.allowMassDelete();
      for (const p of victims) await purgePaper(editor, ds, p);
      return ok({ count: victims.length });
    }
    if ((m = /^\/api\/bin\/([^/]+)$/.exec(path)) && method === "DELETE") {
      const p = findPaper(decodeURIComponent(m[1]));
      if (!p || !p.deletedAt) throw new HttpError(404, "Paper not found in Bin.");
      await purgePaper(editor, ds, p);
      return noContent();
    }

    // ── tags (tags_repository.py); Library tags are shared with talks and recognitions ──
    if (path === "/api/tags" && method === "POST") {
      const name = tagName(body().name);
      if (ds.tags.some((t) => t.name === name)) throw new HttpError(409, "Tag already exists.");
      return ok(tagRead(await editor.put("tags", { id: nextId(ds.tags), name, createdAt: now, updatedAt: now })));
    }
    if ((m = /^\/api\/tags\/(\d+)$/.exec(path))) {
      const tag = ds.tags.find((t) => Number(t.id) === Number(m[1]));
      if (!tag) throw new HttpError(404, "Tag not found.");
      if (method === "PUT") {
        const name = tagName(body().name);
        if (ds.tags.some((t) => t.name === name && t.id !== tag.id)) throw new HttpError(409, "Tag already exists.");
        if (name !== tag.name) await retag(editor, ds, "tags", ["papers", "talks", "recognitions"], tag.name, name);
        return ok(tagRead(await editor.put("tags", { ...tag, name, updatedAt: now })));
      }
      if (method === "DELETE") {
        await retag(editor, ds, "tags", ["papers", "talks", "recognitions"], tag.name, null);
        await editor.remove("tags", tag.id);
        return noContent();
      }
    }

    // ── profile tags (profile_tags_repository.py); "recognition" scope belongs to recognitions ──
    const carriers = (scope) => (scope === "recognition" ? ["recognitions"] : ["papers", "talks"]);
    if (path === "/api/profile-tags" && method === "POST") {
      const b = body();
      const scope = String(b.scope || "general");
      const name = tagName(b.name);
      if (ds.profileTags.some((t) => t.name === name && (t.scope || "general") === scope)) throw new HttpError(409, "Profile tag already exists.");
      return ok(profileTagRead(await editor.put("profile-tags", { id: nextId(ds.profileTags), name, scope, createdAt: now, updatedAt: now })));
    }
    if ((m = /^\/api\/profile-tags\/(\d+)$/.exec(path))) {
      const tag = ds.profileTags.find((t) => Number(t.id) === Number(m[1]));
      if (!tag) throw new HttpError(404, "Profile tag not found.");
      const scope = tag.scope || "general";
      if (method === "PUT") {
        const name = tagName(body().name);
        if (ds.profileTags.some((t) => t.name === name && (t.scope || "general") === scope && t.id !== tag.id)) {
          throw new HttpError(409, "Profile tag already exists.");
        }
        if (name !== tag.name) await retag(editor, ds, "profileTags", carriers(scope), tag.name, name);
        return ok(profileTagRead(await editor.put("profile-tags", { ...tag, name, updatedAt: now })));
      }
      if (method === "DELETE") {
        await retag(editor, ds, "profileTags", carriers(scope), tag.name, null);
        await editor.remove("profile-tags", tag.id);
        return noContent();
      }
    }

    // ── profile notes (profile_repository.py) ──
    if (path === "/api/profile" && method === "PUT") {
      const notes = String(body().notes ?? "");
      await editor.putProfile({ ...ds.profile, notes, updatedAt: now });
      return ok({ notes });
    }
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { detail: err.detail } };
    throw err;
  }
  return null;
}
