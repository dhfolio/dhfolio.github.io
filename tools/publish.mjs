#!/usr/bin/env node
// Publish the visitor projection of an atlas-data checkout into this site:
// data/public/*.json + media/. Runs in atlas-data's publish workflow (and
// locally). Same finishing step and file writing rules as sync-public.mjs.
//
//   node tools/publish.mjs --data <atlas-data> [--out <site root>] [--check] [--force]
//
// --check  write nothing; print what would change and exit 1 if anything would.
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { project } from '../js/localapi/shared/projection.js';
import { readDataset, readMedia } from './lib/dataset.mjs';
import { MEDIA_NAME, mediaRefs, publicize, shrinkProblems, statsOf } from './lib/publicize.mjs';

/** Projection + publicize + the media files it references, all in memory. */
export async function buildPublic(dataDir) {
  const ds = await readDataset(dataDir);
  if (ds.profile?.profilePublic === false) throw new Error('profile.json has profilePublic=false; refusing to publish');
  const { profile, news, library, graphs } = project(ds, ds.ownerSlug);
  const { json, media: inline, stats } = publicize({ profile, news, library, graphs });
  if (Object.keys(inline).length) throw new Error(`inline data: images in the dataset: ${Object.keys(inline).join(', ')}`);
  const media = {};
  for (const rel of [...mediaRefs(Object.values(json))].sort()) media[rel] = await readMedia(dataDir, rel);
  return { json, media, stats };
}

async function main() {
  const { values: opt } = parseArgs({
    options: {
      data: { type: 'string' },
      out: { type: 'string' },
      check: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  });
  if (!opt.data) throw new Error('--data <atlas-data checkout> is required');
  const out = resolve(opt.out ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const { json, media, stats } = await buildPublic(resolve(opt.data));

  const read = (rel) => readFile(join(out, rel)).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  const previous = async (name) => {
    const buf = await read(`data/public/${name}.json`);
    return buf === null ? null : JSON.parse(buf);
  };
  const prev = statsOf({ profile: await previous('profile'), news: await previous('news'), library: await previous('library'), graphAll: await previous('graph-all') });
  const problems = shrinkProblems(stats, prev);
  if (problems.length && !opt.force) throw new Error(`shrink guard: ${problems.join('; ')} - nothing written, pass --force to override`);

  const pending = [];
  for (const [rel, data] of [...Object.entries(media), ...Object.entries(json)]) {
    const buf = Buffer.from(data);
    if (!(await read(rel))?.equals(buf)) pending.push([rel, buf]);
  }
  const keep = new Set(Object.keys(media));
  const listed = await readdir(join(out, 'media'), { withFileTypes: true }).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e)));
  const stale = [];
  for (const d of listed) {
    if (d.isDirectory() || !MEDIA_NAME.test(d.name) || keep.has(`media/${d.name}`)) continue;
    if (d.isFile() || (await lstat(join(out, 'media', d.name))).isFile()) stale.push(`media/${d.name}`);
  }

  const counts = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(' ');
  if (opt.check) {
    for (const [rel] of pending) console.log(`would write ${rel}`);
    for (const rel of stale) console.log(`would delete ${rel}`);
    console.log(`publish --check: ${counts} | changed=${pending.length} stale=${stale.length}`);
    if (pending.length || stale.length) process.exitCode = 1;
    return;
  }

  // media before json; stage everything, then swap (see sync-public.mjs).
  const tmp = (file) => `${file}.tmp-sync`;
  try {
    for (const [rel, buf] of pending) {
      const file = join(out, rel);
      await mkdir(dirname(file), { recursive: true });
      await access(file, constants.W_OK).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
      await writeFile(tmp(file), buf);
    }
  } catch (e) {
    await Promise.all(pending.map(([rel]) => rm(tmp(join(out, rel)), { force: true })));
    throw e;
  }
  for (const [rel] of pending) await rename(tmp(join(out, rel)), join(out, rel));
  for (const rel of stale) await unlink(join(out, rel));
  console.log(`publish: ${counts} | written=${pending.length} deleted=${stale.length}`);
}

const isMain = (() => {
  try { return resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isMain) {
  main().catch((e) => {
    console.error(`publish: ${e.message}`);
    process.exitCode = 1;
  });
}
