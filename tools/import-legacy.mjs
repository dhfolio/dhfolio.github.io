#!/usr/bin/env node
// Split a researchatlas.io owner export (GET /api/owner/export) into the
// per-record layout of the private data repository (dhfolio/atlas-data):
//
//   atlas.json  profile.json  papers/<id>.json  references/<paperId>.json
//   manual-links/<id>.json  talks/  recognitions/  news/  tags/  profile-tags/
//   media/<sha256:16>.<ext>   (inline data:image/ URLs, extracted)
//
//   node tools/import-legacy.mjs <export.json> <atlas-data checkout>
//
// Re-running with the same export changes nothing; files of records that are
// no longer in the export are removed (only inside the managed folders).
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeDataImage } from './lib/publicize.mjs';

export const SCHEMA = 1;
export const DIRS = ['papers', 'references', 'manual-links', 'talks', 'recognitions', 'news', 'tags', 'profile-tags', 'media'];
/**
 * File stem for a record id. Characters outside [A-Za-z0-9._-] are written
 * %XX (UTF-8), which is readable, reversible and legal on every OS (ids like
 * "scholar-2026-04-10T04:10:27-0" contain ':'). Only an id that would still
 * be too long, or is "." / "..", falls back to a hash.
 */
export function fileStem(id) {
  const s = String(id);
  const encoded = [...new TextEncoder().encode(s)]
    .map((b) => (/[A-Za-z0-9._-]/.test(String.fromCharCode(b)) && b < 128 ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`))
    .join('');
  if (encoded && encoded.length <= 150 && encoded !== '.' && encoded !== '..') return encoded;
  return `x-${createHash('sha1').update(s).digest('hex').slice(0, 16)}`;
}

export const toJson = (value) => `${JSON.stringify(value, null, 1)}\n`;

/** Turn every inline data:image/ URL in `value` (recursively) into "media/<name>". */
function extractMedia(value, media) {
  if (typeof value === 'string') {
    if (!/^data:image\//i.test(value)) return value;
    const { name, bytes } = decodeDataImage(value);
    media.set(`media/${name}`, Buffer.from(bytes));
    return `media/${name}`;
  }
  if (Array.isArray(value)) return value.map((v) => extractMedia(v, media));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, extractMedia(v, media)]));
  }
  return value;
}

/**
 * Pure split: export object → { files: Map<path, string|Buffer>, report }.
 * Throws on anything that would make the repository ambiguous.
 */
export function splitExport(exp, { ownerSlug = 'dukhyun' } = {}) {
  if (!exp || exp.schemaVersion !== SCHEMA) throw new Error(`unsupported export schemaVersion ${exp?.schemaVersion}`);
  for (const k of ['papers', 'talks', 'recognitions', 'news', 'tags', 'profileTags', 'manualLinks']) {
    if (!Array.isArray(exp[k])) throw new Error(`export.${k} is not an array`);
  }
  const files = new Map();
  const media = new Map();
  const report = { renamed: [], orphanReferences: [], orphanLinks: [], counts: {} };

  const put = (dir, id, record) => {
    const stem = fileStem(id);
    if (stem !== String(id)) report.renamed.push(`${dir}/${id} -> ${stem}.json`);
    const path = `${dir}/${stem}.json`;
    if (files.has(path)) throw new Error(`two ${dir} records map to ${path} (duplicate id "${id}")`);
    files.set(path, toJson(extractMedia(record, media)));
  };

  files.set('atlas.json', toJson({ schema: SCHEMA, ownerSlug }));
  files.set('profile.json', toJson(extractMedia(exp.profile || {}, media)));

  const paperIds = new Set();
  for (const p of exp.papers) {
    paperIds.add(String(p.id));
    put('papers', p.id, p);
  }
  for (const [paperId, rows] of Object.entries(exp.references || {})) {
    if (!paperIds.has(paperId)) {
      report.orphanReferences.push(paperId);
      continue;
    }
    put('references', paperId, { paperId, rows });
  }
  for (const link of exp.manualLinks) {
    if (!paperIds.has(String(link.paperA)) || !paperIds.has(String(link.paperB))) {
      report.orphanLinks.push(link.id);
      continue;
    }
    put('manual-links', link.id, link);
  }
  for (const t of exp.talks) put('talks', t.id, t);
  for (const r of exp.recognitions) put('recognitions', r.id, r);
  for (const n of exp.news) put('news', n.id, n);
  for (const t of exp.tags) put('tags', t.id, t);
  for (const t of exp.profileTags) put('profile-tags', t.id, t);
  for (const [path, bytes] of [...media].sort(([a], [b]) => (a < b ? -1 : 1))) files.set(path, bytes);

  for (const dir of DIRS) report.counts[dir] = [...files.keys()].filter((p) => p.startsWith(`${dir}/`)).length;
  return { files, report };
}

async function listManaged(root) {
  const found = [];
  for (const dir of DIRS) {
    const entries = await readdir(join(root, dir), { withFileTypes: true }).catch((e) => {
      if (e.code === 'ENOENT') return [];
      throw e;
    });
    for (const e of entries) if (e.isFile()) found.push(`${dir}/${e.name}`);
  }
  return found;
}

async function main(argv) {
  const [exportPath, target] = argv;
  if (!exportPath || !target) throw new Error('usage: node tools/import-legacy.mjs <export.json> <atlas-data checkout>');
  const root = resolve(target);
  const exp = JSON.parse(await readFile(exportPath, 'utf8'));
  const { files, report } = splitExport(exp);

  let written = 0;
  let unchanged = 0;
  for (const [rel, data] of files) {
    const file = join(root, rel);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const old = await readFile(file).catch(() => null);
    if (old && old.equals(buf)) {
      unchanged++;
      continue;
    }
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, buf);
    written++;
  }
  const stale = (await listManaged(root)).filter((rel) => !files.has(rel));
  for (const rel of stale) await rm(join(root, rel));

  console.log(`import-legacy: written=${written} unchanged=${unchanged} removed=${stale.length}`);
  console.log(`  ${Object.entries(report.counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  for (const [label, list] of [['renamed (unsafe id)', report.renamed], ['orphan references (skipped)', report.orphanReferences], ['orphan links (skipped)', report.orphanLinks]]) {
    if (list.length) console.log(`  ${label}: ${list.length}\n    ${list.slice(0, 20).join('\n    ')}`);
  }
}

const isMain = (() => {
  try { return resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isMain) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`import-legacy: ${e.message}`);
    process.exitCode = 1;
  });
}
