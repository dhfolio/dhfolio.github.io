// Read an atlas-data checkout into the in-memory dataset projection.js expects.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const COLLECTIONS = ['papers', 'talks', 'recognitions', 'news', 'tags', 'profile-tags', 'manual-links'];
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function jsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort(byName);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

export async function readDataset(root) {
  const atlas = await readJson(join(root, 'atlas.json'));
  if (atlas.schema !== 1) throw new Error(`atlas.json: unsupported schema ${atlas.schema}`);
  const ds = { ownerSlug: atlas.ownerSlug, profile: await readJson(join(root, 'profile.json')), references: {} };
  for (const name of COLLECTIONS) {
    const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    ds[key] = [];
    for (const f of await jsonFiles(join(root, name))) ds[key].push(await readJson(join(root, name, f)));
  }
  for (const f of await jsonFiles(join(root, 'references'))) {
    const r = await readJson(join(root, 'references', f));
    ds.references[r.paperId] = r.rows;
  }
  return ds;
}

/** Bytes of media/<name>, refusing a file whose content does not match its hash name. */
export async function readMedia(root, rel) {
  const m = /^media\/([0-9a-f]{16})\.(jpg|png|webp|gif|svg)$/.exec(rel);
  if (!m) throw new Error(`${rel}: not a media path`);
  const bytes = await readFile(join(root, rel));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  if (hash !== m[1]) throw new Error(`${rel}: content hash ${hash} does not match its name`);
  return bytes;
}
