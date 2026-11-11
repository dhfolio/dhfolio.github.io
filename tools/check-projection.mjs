#!/usr/bin/env node
// Gate G1 (Phase 2): the projection of an atlas-data checkout must equal the
// public API responses captured from researchatlas.io at the same moment,
// after the same publicize() finish. Run before cutover; private data stays in
// the two folders given, nothing is written.
//
//   node tools/check-projection.mjs --data <atlas-data> --capture <legacy-capture>
//
// Allowed difference: the order of rows that tie on every SQL sort key. The
// old SQL had no final key, so Postgres returned those in arbitrary order; the
// projection orders them by id. Such rows are compared as a set.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildPublic } from './publish.mjs';
import { publicize } from './lib/publicize.mjs';

// Sort keys per list, as in the original ORDER BY (publicize keeps full values
// for these except library addedAt, so ties are found on the projected rows).
const LISTS = {
  'data/public/profile.json': { publications: ['year', 'updatedAt'], posts: ['updatedAt'], talks: ['year', 'updatedAt'], recognitions: ['year', 'updatedAt'] },
  'data/public/news.json': { items: ['sortDate', 'updatedAt'] },
  'data/public/library.json': { papers: ['addedAt', 'updatedAt'] },
};

/** Order rows inside each run of equal sort keys by id, so tie order cannot differ. */
export function normalizeTies(doc, rel, keysOf = () => null) {
  for (const [list, keys] of Object.entries(LISTS[rel] || {})) {
    const rows = doc[list];
    if (!Array.isArray(rows)) continue;
    const keyOf = (r) => JSON.stringify((keysOf(r) || keys.map((k) => r[k])));
    let start = 0;
    for (let i = 1; i <= rows.length; i++) {
      if (i < rows.length && keyOf(rows[i]) === keyOf(rows[start])) continue;
      const run = rows.slice(start, i).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      rows.splice(start, run.length, ...run);
      start = i;
    }
  }
  return doc;
}

export function firstDiffs(a, b, path = '$', out = []) {
  if (out.length >= 20 || JSON.stringify(a) === JSON.stringify(b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) firstDiffs(a[i], b[i], `${path}[${i}]`, out);
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.join() !== kb.join()) out.push(`${path}: keys [${ka}] vs [${kb}]`);
    for (const k of new Set([...ka, ...kb])) firstDiffs(a[k], b[k], `${path}.${k}`, out);
  } else {
    out.push(`${path}: ${JSON.stringify(a)?.slice(0, 100)} vs ${JSON.stringify(b)?.slice(0, 100)}`);
  }
  return out;
}

async function main() {
  const { values: opt } = parseArgs({ options: { data: { type: 'string' }, capture: { type: 'string' } } });
  if (!opt.data || !opt.capture) throw new Error('usage: node tools/check-projection.mjs --data <atlas-data> --capture <legacy-capture>');
  const capture = resolve(opt.capture);
  const exp = JSON.parse(await readFile(join(capture, 'export.json'), 'utf8'));
  const full = new Map(exp.papers.map((p) => [p.id, p]));
  const cap = async (n) => JSON.parse(await readFile(join(capture, 'public', `${n}.json`), 'utf8'));
  const live = publicize({
    profile: await cap('profile'), news: await cap('news'), library: await cap('library'),
    graphs: { all: await cap('graph-all'), mine: await cap('graph-mine'), library: await cap('graph-library') },
  });
  const mine = await buildPublic(resolve(opt.data));

  // publicize trims library addedAt to the day; the real tie is on the full value.
  const libraryKeys = (r) => (full.has(r.id) ? [full.get(r.id).addedAt, full.get(r.id).updatedAt] : null);
  let failures = 0;
  for (const rel of Object.keys(live.json)) {
    const keysOf = rel === 'data/public/library.json' ? libraryKeys : undefined;
    const a = normalizeTies(JSON.parse(live.json[rel]), rel, keysOf);
    const b = normalizeTies(JSON.parse(mine.json[rel]), rel, keysOf);
    const exact = live.json[rel] === mine.json[rel];
    const same = JSON.stringify(a) === JSON.stringify(b);
    console.log(`${exact ? 'SAME ' : same ? 'SAME*' : 'DIFF '} ${rel}${!exact && same ? '  (only tied rows ordered differently)' : ''}`);
    if (!same) {
      failures++;
      for (const d of firstDiffs(a, b)) console.log(`    ${d}`);
    }
  }
  const lm = Object.keys(live.media).sort();
  const mm = Object.keys(mine.media).sort();
  const mediaSame = lm.join() === mm.join() && lm.every((k) => Buffer.from(live.media[k]).equals(Buffer.from(mine.media[k])));
  console.log(`${mediaSame ? 'SAME ' : 'DIFF '} media/ (${lm.length} vs ${mm.length})`);
  if (!mediaSame) failures++;
  console.log(failures ? `G1 FAIL: ${failures} difference(s)` : 'G1 PASS');
  process.exitCode = failures ? 1 : 0;
}

const isMain = (() => {
  try { return resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isMain) {
  main().catch((e) => {
    console.error(`check-projection: ${e.message}`);
    process.exitCode = 1;
  });
}
