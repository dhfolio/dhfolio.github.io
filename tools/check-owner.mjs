#!/usr/bin/env node
// Gate G2 (Phase 2): the in-browser engine's owner GET responses, computed from
// an atlas-data checkout, must equal the researchatlas.io responses captured at
// the same moment (tools/capture-legacy.mjs). Nothing is written.
//
//   node tools/check-owner.mjs --data <atlas-data> --capture <legacy-capture>
//
// Allowed differences are listed in ALLOWED with the reason; anything else fails.
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ownerRead } from '../js/localapi/owner/routes-read.js';
import { readDataset } from './lib/dataset.mjs';
import { firstDiffs } from './check-projection.mjs';

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

export const GOLDENS = {
  state: '/api/state',
  papers: '/api/papers',
  'papers-profile-only': '/api/papers?profile_only=true',
  'papers-library-only': '/api/papers?library_only=true',
  bin: '/api/bin',
  tags: '/api/tags',
  'profile-tags-general': '/api/profile-tags?scope=general',
  'profile-tags-recognition': '/api/profile-tags?scope=recognition',
  profile: '/api/profile',
  'profile-me': '/api/profile/me',
  talks: '/api/talks',
  recognitions: '/api/recognitions',
  news: '/api/news',
  'graph-all': '/api/citations/graph?scope=all',
  'graph-mine': '/api/citations/graph?scope=mine',
  'graph-library': '/api/citations/graph?scope=library',
};

// [golden name, JSON path prefix, reason]
export const ALLOWED = [
  ['state', '$.profile.notes', 'original returned "" when signed in (state_repository.py:19); the engine returns the notes'],
  ['profile-me', '$.username.changesRemaining', 'username changes are not ported; fixed slug'],
  ['profile-me', '$.username.windowResetsAt', 'username changes are not ported; fixed slug'],
];

const allowed = (name, diff) => ALLOWED.some(([n, p]) => n === name && diff.startsWith(p));

/** Graph node order came from an unordered SQL query; compare as sets. */
function canonicalGraph(g) {
  const key = (e) => `${e.type}|${e.source}|${e.target}`;
  return { ...g, nodes: [...g.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)), edges: [...g.edges].sort((a, b) => (key(a) < key(b) ? -1 : 1)) };
}

/** Rows that tie on every SQL sort key come back in arbitrary order; order them by id on both sides. */
function canonicalTies(list, keys) {
  if (!Array.isArray(list)) return list;
  const k = (r) => JSON.stringify(keys.map((f) => r?.[f]));
  const out = [];
  let run = [];
  for (const r of list) {
    if (run.length && k(run[0]) !== k(r)) out.push(...run.sort((a, b) => (a.id < b.id ? -1 : 1))), (run = []);
    run.push(r);
  }
  return [...out, ...run.sort((a, b) => (a.id < b.id ? -1 : 1))];
}
const TIES = { papers: ['updatedAt', 'title'], 'papers-profile-only': ['updatedAt', 'title'], 'papers-library-only': ['updatedAt', 'title'],
  bin: ['deletedAt'], talks: ['updatedAt', 'title'], recognitions: ['updatedAt', 'title'], news: ['sortDate', 'updatedAt'] };

// Tag lists: Postgres sorted with glibc en_US ("AI 반도체" < "AI & Work"), the
// engine with ICU; app.js re-sorts tag names with localeCompare on arrival
// (refreshTagsFromBackend), so only the set matters.
const byName = (a, b) => (String(a.name ?? a) < String(b.name ?? b) ? -1 : 1);

function canonical(name, body) {
  if (name.startsWith('graph-')) return canonicalGraph(body);
  if (name === 'state') return { ...body, tags: [...body.tags].sort(byName), papers: canonicalTies(body.papers, ['updatedAt', 'title']) };
  if (name === 'tags' || name.startsWith('profile-tags')) return [...body].sort(byName);
  if (TIES[name]) return canonicalTies(body, TIES[name]);
  return body;
}

// References were sorted by year only (stable over the table's physical row
// order, which Postgres changes when a row is updated); compare within a year as a set.
function canonicalReferences(body) {
  const year = (r) => (String(r.year).trim().replace(/-/g, '/').split('/')[0].match(/^\d+$/) || ['0'])[0];
  const key = (r) => `${year(r).padStart(6, '0')}|${r.doi}|${r.title}`;
  return { ...body, references: [...body.references].sort((a, b) => (key(a) < key(b) ? 1 : -1)) };
}

async function main() {
  const { values: opt } = parseArgs({ options: { data: { type: 'string' }, capture: { type: 'string' } } });
  if (!opt.data || !opt.capture) throw new Error('usage: node tools/check-owner.mjs --data <atlas-data> --capture <legacy-capture>');
  const data = resolve(opt.data);
  const capture = resolve(opt.capture);
  const ds = await readDataset(data);
  const owner = {
    dataset: async () => ds,
    mediaDataUrl: async (rel) => `data:${MIME[rel.split('.').pop()]};base64,${(await readFile(join(data, rel))).toString('base64')}`,
  };
  const call = async (path) => {
    const url = new URL(path, 'http://local');
    return ownerRead({ method: 'GET', pathname: url.pathname, query: url.searchParams, owner, ownerSlug: ds.ownerSlug });
  };

  let failures = 0;
  const check = async (name, path, golden) => {
    const res = await call(path);
    if (!res || res.status !== 200) {
      failures++;
      console.log(`DIFF  ${name}: engine answered ${res ? res.status : 'nothing'}`);
      return;
    }
    const diffs = firstDiffs(canonical(name, golden), canonical(name, res.body), '$', []);
    const bad = diffs.filter((d) => !allowed(name, d));
    console.log(`${bad.length ? 'DIFF ' : diffs.length ? 'SAME*' : 'SAME '} ${name}${diffs.length && !bad.length ? `  (allowed: ${diffs.length})` : ''}`);
    for (const d of bad) console.log(`    ${d}`);
    if (bad.length) failures++;
  };

  for (const [name, path] of Object.entries(GOLDENS)) {
    await check(name, path, JSON.parse(await readFile(join(capture, 'owner', `${name}.json`), 'utf8')));
  }
  let refs = 0;
  let refFailures = 0;
  for (const f of await readdir(join(capture, 'references'))) {
    const golden = JSON.parse(await readFile(join(capture, 'references', f), 'utf8'));
    const res = await call(`/api/citations/references/${f.replace(/\.json$/, '')}`);
    refs++;
    const d = firstDiffs(canonicalReferences(golden), canonicalReferences(res.body), '$', []);
    if (d.length) {
      refFailures++;
      if (refFailures <= 3) console.log(`DIFF  references/${f}\n    ${d.slice(0, 4).join('\n    ')}`);
    }
  }
  console.log(`${refFailures ? 'DIFF ' : 'SAME '} references (${refs - refFailures}/${refs})`);
  if (refFailures) failures++;
  console.log(failures ? `G2 FAIL: ${failures} endpoint(s) differ` : 'G2 PASS');
  process.exitCode = failures ? 1 : 0;
}

const isMain = (() => {
  try { return resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isMain) {
  main().catch((e) => {
    console.error(`check-owner: ${e.stack || e.message}`);
    process.exitCode = 1;
  });
}
