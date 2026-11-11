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
