// Read an atlas-data checkout from disk into the dataset (js/localapi/shared/dataset.js).
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { COLLECTIONS, datasetFromFiles } from '../../js/localapi/shared/dataset.js';

async function jsonFiles(root, dir) {
  const entries = await readdir(join(root, dir), { withFileTypes: true }).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => `${dir}/${e.name}`);
}

/** Map<path, text> of every dataset file in a checkout. */
export async function readDatasetFiles(root) {
  const paths = ['atlas.json', 'profile.json'];
  for (const dir of [...Object.keys(COLLECTIONS), 'references']) paths.push(...(await jsonFiles(root, dir)));
  const files = new Map();
  for (const p of paths) files.set(p, await readFile(join(root, p), 'utf8'));
  return files;
}

export async function readDataset(root) {
  return datasetFromFiles(await readDatasetFiles(root));
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
