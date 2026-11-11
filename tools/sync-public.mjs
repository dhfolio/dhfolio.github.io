#!/usr/bin/env node
import { constants } from 'node:fs';
import { access, lstat, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { MEDIA_NAME, mediaRefs, publicize, shrinkProblems, statsOf } from './lib/publicize.mjs';

const USAGE = 'usage: node tools/sync-public.mjs [--base https://researchatlas.io] [--slug dukhyun] [--out <repo root>] [--force]';
const TIMEOUT_MS = 30_000;

// One failure cancels the sibling requests so the process can drain and exit by itself;
// process.exit() right after fetch trips a libuv assertion on Windows.
const cancel = new AbortController();

async function getJson(url) {
  let reason;
  for (let attempt = 0; attempt < 2 && !cancel.signal.aborted; attempt++) {
    try {
      const signal = AbortSignal.any([cancel.signal, AbortSignal.timeout(TIMEOUT_MS)]);
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal });
      const text = await res.text();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('response is not valid JSON');
      }
    } catch (e) {
      reason = e.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000} s` : (e.cause?.code ?? e.message);
    }
  }
  throw new Error(`${url}: ${reason}`);
}

async function main() {
  const { values: opt } = parseArgs({
    options: {
      base: { type: 'string', default: 'https://researchatlas.io' },
      slug: { type: 'string', default: 'dukhyun' },
      out: { type: 'string' },
      force: { type: 'boolean', default: false },
    },
  });
  for (const k of ['base', 'slug', 'out']) {
    if (opt[k] === '') throw Object.assign(new Error(`--${k} must not be empty`), { code: 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' });
  }
  const out = resolve(opt.out ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  // After the Phase 2 cutover atlas-data publishes data/public; mirroring the old site would overwrite it.
  if (await access(join(out, '.publish-enabled')).then(() => true, () => false)) {
    throw new Error('.publish-enabled exists: this site is published from atlas-data, not mirrored');
  }
  const api =`${opt.base.replace(/\/+$/, '')}/api/profiles/${encodeURIComponent(opt.slug)}`;
  const urls = [api, `${api}/news`, `${api}/library`, `${api}/graph?scope=all`, `${api}/graph?scope=mine`, `${api}/graph?scope=library`];

  const payloads = await Promise.all(urls.map(getJson)).finally(() => cancel.abort());
  const hidden = urls.filter((_, i) => payloads[i]?.isPrivate === true);
  if (hidden.length) throw new Error(`profile is private (isPrivate=true): ${hidden.join(', ')}`);
  const [profile, news, library, all, mine, lib] = payloads;
  const { json, media, stats } = publicize({ profile, news, library, graphs: { all, mine, library: lib } });

  const read = (rel) =>
    readFile(join(out, rel)).catch((e) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
  // A file that exists but does not parse gives no baseline; that must trip the guard, not disable it.
  const unreadable = [];
  const previous = async (name) => {
    const buf = await read(`data/public/${name}.json`);
    if (buf === null) return null;
    try {
      return JSON.parse(buf);
    } catch {
      unreadable.push(`data/public/${name}.json on disk is not valid JSON, so there is no baseline`);
      return null;
    }
  };
  const prev = statsOf({ profile: await previous('profile'), news: await previous('news'), library: await previous('library'), graphAll: await previous('graph-all') });
  const problems = [...unreadable, ...shrinkProblems(stats, prev)];
  if (problems.length && !opt.force) throw new Error(`shrink guard: ${problems.join('; ')} - nothing written, pass --force to override`);
  if (problems.length) console.error(`sync-public: --force overrides shrink guard: ${problems.join('; ')}`);

  // media before json, so a json file never points at an image that is not on disk yet
  const pending = [];
  let unchanged = 0;
  for (const [rel, data] of [...Object.entries(media), ...Object.entries(json)]) {
    const buf = Buffer.from(data);
    if ((await read(rel))?.equals(buf)) unchanged++;
    else pending.push([join(out, rel), buf]);
  }
  const keep = new Set([...Object.keys(media), ...mediaRefs(Object.values(json))]);
  const listed = await readdir(join(out, 'media'), { withFileTypes: true }).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  });
  // On Windows a freshly synced file can briefly report as a link; lstat settles it.
  const stale = [];
  for (const d of listed) {
    if (d.isDirectory() || !MEDIA_NAME.test(d.name) || keep.has(`media/${d.name}`)) continue;
    const file = join(out, 'media', d.name);
    if (d.isFile() || (await lstat(file)).isFile()) stale.push(file);
  }

  // Stage every file next to its target, then swap, so an I/O error cannot leave a half-updated set.
  const tmp = (file) => `${file}.tmp-sync`;
  try {
    for (const [file, buf] of pending) {
      await mkdir(dirname(file), { recursive: true });
      await access(file, constants.W_OK).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
      await writeFile(tmp(file), buf);
    }
  } catch (e) {
    await Promise.all(pending.map(([file]) => rm(tmp(file), { force: true })));
    throw e;
  }
  for (const [file] of pending) await rename(tmp(file), file);
  for (const file of stale) await unlink(file);

  const counts = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`sync-public: ${counts} | written=${pending.length} deleted=${stale.length} unchanged=${unchanged}`);
}

main().catch((e) => {
  const usage = e.code?.startsWith?.('ERR_PARSE_ARGS') ? `\n${USAGE}` : '';
  console.error(`sync-public: ${e.message}${usage}`);
  process.exitCode = 1;
});
