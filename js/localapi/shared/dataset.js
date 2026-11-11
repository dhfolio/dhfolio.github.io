/**
 * js/localapi/shared/dataset.js
 * atlas-data file contents → the in-memory dataset. Shared by the browser
 * store (files fetched from GitHub) and tools/lib/dataset.mjs (files on disk).
 *
 *   files: Map<path, text>  (JSON files only; media/ is never read here)
 */

export const COLLECTIONS = {
  papers: "papers",
  talks: "talks",
  recognitions: "recognitions",
  news: "news",
  tags: "tags",
  "profile-tags": "profileTags",
  "manual-links": "manualLinks",
};

/** Folder of a record file, or null for paths the dataset does not hold. */
export function collectionOf(path) {
  const m = /^([a-z-]+)\/[^/]+\.json$/.exec(path);
  if (!m) return null;
  if (m[1] === "references") return "references";
  return COLLECTIONS[m[1]] ? m[1] : null;
}

/** Record files: indent 1, trailing newline (stable diffs; same as tools/import-legacy.mjs). */
export const toJson = (value) => `${JSON.stringify(value, null, 1)}\n`;

/**
 * File stem for a record id. Characters outside [A-Za-z0-9._-] are written
 * %XX (UTF-8): readable, reversible, legal on every OS. Ids that would still
 * be unusable ("." / "..", over 150 chars) get "x-" + a hash, which only
 * the import tool (Node, sync) computes; the editor never creates such ids.
 */
export function encodeStem(id) {
  const s = String(id);
  const encoded = [...new TextEncoder().encode(s)]
    .map((b) => (b < 128 && /[A-Za-z0-9._-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, "0")}`))
    .join("");
  return encoded && encoded.length <= 150 && encoded !== "." && encoded !== ".." ? encoded : null;
}

/** Path of a record: the file it was loaded from, or a new one from its id. */
export function recordPath(ds, dir, id) {
  const known = ds.paths.get(`${dir}:${id}`);
  if (known) return known;
  const stem = encodeStem(id);
  if (!stem) throw new Error(`id cannot be stored as a file name: ${String(id).slice(0, 40)}`);
  return `${dir}/${stem}.json`;
}

export function isDatasetPath(path) {
  return path === "atlas.json" || path === "profile.json" || collectionOf(path) !== null;
}

function parse(path, text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${path}: ${err.message}`);
  }
}

/**
 * Apply one file change to a loaded dataset in place: a local edit, a journal
 * replay or a commit from another device. text === null deletes.
 */
export function applyFile(ds, path, text) {
  if (path === "atlas.json") return;
  if (path === "profile.json") {
    if (text != null) ds.profile = parse(path, text);
    return;
  }
  const dir = collectionOf(path);
  if (!dir) return;
  const keyOf = () => [...ds.paths].find(([, p]) => p === path)?.[0];
  if (dir === "references") {
    const old = keyOf();
    if (old) {
      delete ds.references[old.slice("references:".length)];
      ds.paths.delete(old);
    }
    if (text == null) return;
    const r = parse(path, text);
    ds.references[r.paperId] = Array.isArray(r.rows) ? r.rows : [];
    ds.paths.set(`references:${r.paperId}`, path);
    return;
  }
  const list = ds[COLLECTIONS[dir]];
  const old = keyOf();
  if (old) {
    const id = old.slice(dir.length + 1);
    const i = list.findIndex((rec) => String(rec.id) === id);
    if (i >= 0) list.splice(i, 1);
    ds.paths.delete(old);
  }
  if (text == null) return;
  const record = parse(path, text);
  const j = list.findIndex((rec) => String(rec.id) === String(record.id));
  if (j >= 0) list.splice(j, 1, record);
  else list.push(record);
  ds.paths.set(`${dir}:${record.id}`, path);
}

export function datasetFromFiles(files) {
  const atlas = parse("atlas.json", files.get("atlas.json") ?? "null");
  if (!atlas || atlas.schema !== 1) throw new Error(`atlas.json: unsupported schema ${atlas?.schema}`);
  const profileText = files.get("profile.json");
  if (profileText == null) throw new Error("profile.json is missing");
  const ds = { ownerSlug: atlas.ownerSlug, profile: parse("profile.json", profileText), references: {}, paths: new Map() };
  for (const key of Object.values(COLLECTIONS)) ds[key] = [];
  // Sorted paths: the same dataset order in the browser and in Node.
  for (const path of [...files.keys()].sort()) {
    const dir = collectionOf(path);
    if (!dir) continue;
    const record = parse(path, files.get(path));
    if (dir === "references") {
      ds.references[record.paperId] = Array.isArray(record.rows) ? record.rows : [];
      ds.paths.set(`references:${record.paperId}`, path);
      continue;
    }
    ds[COLLECTIONS[dir]].push(record);
    ds.paths.set(`${dir}:${record.id}`, path);
  }
  return ds;
}
