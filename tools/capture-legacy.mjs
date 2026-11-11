#!/usr/bin/env node
// Capture everything the Phase 2 migration needs from researchatlas.io, once:
// the owner export, owner GET responses (golden files for the engine), the
// public responses, and a handful of /api/metadata lookups.
//
//   $env:RA_TOKEN = '<research-atlas-auth-token from researchatlas.io localStorage>'
//   node tools/capture-legacy.mjs --out ..\legacy-capture
//   Remove-Item Env:RA_TOKEN
//
// The output is private data. It must live outside this (public) repository;
// the script refuses an --out inside it. The token is only ever sent to --base.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 60_000;
const CONCURRENCY = 4;
const cancel = new AbortController();

export function insideRepo(dir, repo = REPO) {
  const rel = relative(repo, resolve(dir));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** ~15 lookups that cover every branch of lookup_metadata, drawn from the export. */
export function metadataQueries(papers) {
  const dois = papers.map((p) => String(p.doi || '').trim()).filter(Boolean);
  const arxiv = dois.filter((d) => /^10\.48550\/arxiv\./i.test(d));
  const regular = dois.filter((d) => !/^10\.48550\//i.test(d));
  const urls = papers.map((p) => String(p.url || '').trim()).filter((u) => /^https?:\/\//i.test(u) && !/doi\.org\//i.test(u));
  const arxivUrls = urls.filter((u) => /arxiv\.org\//i.test(u));
  const otherUrls = urls.filter((u) => !/arxiv\.org\//i.test(u));
  const titles = papers.map((p) => String(p.title || '').trim()).filter((t) => t.length > 20);
  const pick = (list, n) => [...new Set(list)].slice(0, n);
  return [
    ...pick(regular, 6),
    ...pick(regular, 1).map((d) => `https://doi.org/${d}`),
    ...pick(arxiv, 2),
    ...pick(arxivUrls, 2),
    ...pick(otherUrls, 3),
    ...pick(titles, 1),
  ];
}

async function main() {
  const { values: opt } = parseArgs({
    options: {
      base: { type: 'string', default: 'https://researchatlas.io' },
      slug: { type: 'string', default: 'dukhyun' },
      out: { type: 'string' },
    },
  });
  if (!opt.out) throw new Error('--out <dir outside the repo> is required');
  const out = resolve(opt.out);
  if (insideRepo(out)) throw new Error(`--out ${out} is inside the public repository; choose a folder outside it`);
  const token = String(process.env.RA_TOKEN || '').trim();
  if (!token) throw new Error('set RA_TOKEN to the research-atlas-auth-token value first');
  const base = opt.base.replace(/\/+$/, '');

  async function get(path, { auth = true } = {}) {
    const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const headers = { accept: 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) };
    const res = await fetch(`${base}${path}`, { headers, signal });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { nonJson: text.slice(0, 200) };
    }
    return { status: res.status, body };
  }
  async function must(path, opts) {
    const r = await get(path, opts);
    if (r.status === 401) throw new Error(`${path}: 401 - RA_TOKEN is missing, expired or wrong`);
    if (r.status !== 200) throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  }
  const save = async (rel, data) => {
    const file = join(out, rel);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(data, null, 1)}\n`);
  };
  async function pool(items, fn) {
    const queue = [...items];
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) await fn(queue.shift());
    }));
  }

  const exp = await must('/api/owner/export');
  await save('export.json', exp);
  console.log(`export: papers=${exp.papers.length} talks=${exp.talks.length} recognitions=${exp.recognitions.length} news=${exp.news.length} tags=${exp.tags.length} profileTags=${exp.profileTags.length} referencedPapers=${Object.keys(exp.references).length} manualLinks=${exp.manualLinks.length}`);

  const owner = {
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
  await pool(Object.entries(owner), async ([name, path]) => save(`owner/${name}.json`, await must(path)));

  const api = `/api/profiles/${encodeURIComponent(opt.slug)}`;
  const pub = {
    profile: api, news: `${api}/news`, library: `${api}/library`,
    'graph-all': `${api}/graph?scope=all`, 'graph-mine': `${api}/graph?scope=mine`, 'graph-library': `${api}/graph?scope=library`,
  };
  await pool(Object.entries(pub), async ([name, path]) => save(`public/${name}.json`, await must(path, { auth: false })));

  const live = exp.papers.filter((p) => !p.deletedAt).map((p) => p.id);
  await pool(live, async (id) => save(`references/${encodeURIComponent(id)}.json`, await must(`/api/citations/references/${encodeURIComponent(id)}`)));
  const linked = [...new Set(exp.manualLinks.flatMap((l) => [l.paperA, l.paperB]))];
  await pool(linked, async (id) => save(`manual-links/${encodeURIComponent(id)}.json`, await must(`/api/papers/${encodeURIComponent(id)}/manual-links`)));

  // Lookups hit Crossref/OpenAlex through the backend: keep them few and sequential.
  const queries = metadataQueries(exp.papers);
  for (const [i, query] of queries.entries()) {
    const r = await get(`/api/metadata?query=${encodeURIComponent(query)}`);
    await save(`metadata/${String(i).padStart(2, '0')}.json`, { query, status: r.status, body: r.body });
  }

  await save('capture.json', {
    base, slug: opt.slug, capturedAt: new Date().toISOString(),
    owner: Object.keys(owner).length, public: Object.keys(pub).length,
    references: live.length, manualLinks: linked.length, metadata: queries.length,
  });
  console.log(`capture-legacy: wrote ${out} (references ${live.length}, manual-links ${linked.length}, metadata ${queries.length})`);
}

const isMain = (() => {
  try { return resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isMain) {
  main()
    .catch((e) => {
      console.error(`capture-legacy: ${e.message}`);
      process.exitCode = 1;
    })
    .finally(() => cancel.abort());
}
