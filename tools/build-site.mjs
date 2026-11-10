#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const DEPLOY_FILES = ["index.html", "app.js", "config.js", "journal-abbreviations.js", "favicon.svg", "favicon-app.svg", "manifest.webmanifest"];
export const DEPLOY_DIRS = ["css", "js", "fonts", "vendor", "media", "data/public"];
export const ROUTES = ["news", "library", "maps", "profile", "dukhyun", "dukhyun/news", "dukhyun/library", "dukhyun/maps"];
export const DATA_FILES = ["profile", "news", "library", "graph-all", "graph-mine", "graph-library"].map((n) => `data/public/${n}.json`);
const BANNED_EXT = [".bat", ".py", ".md", ".log", ".csv", ".db", ".bak", ".tmp-sync"];

function copyTree(src, dest) {
  const st = statSync(src, { throwIfNoEntry: false });
  if (st?.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src).sort()) copyTree(join(src, name), join(dest, name));
  } else if (st?.isFile()) {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

function walk(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((e) => (e.isDirectory()
      ? walk(join(dir, e.name), `${prefix}${e.name}/`)
      : [{ path: prefix + e.name, size: statSync(join(dir, e.name)).size }]));
}

// Real path of p, resolving links in the part that exists, so a junction inside
// the repo cannot point the delete-and-rebuild at a folder outside it.
function realOf(p) {
  const rest = [];
  for (let cur = p; ; cur = dirname(cur)) {
    try {
      return join(realpathSync.native(cur), ...rest);
    } catch (e) {
      if (e.code !== "ENOENT" || dirname(cur) === cur) throw e;
      rest.unshift(basename(cur));
    }
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Sync tools and antivirus hold freshly written files for a second or so on Windows.
function retry(fn) {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (i >= 12 || !["EPERM", "EACCES", "EBUSY", "ENOTEMPTY"].includes(e.code)) throw e;
      sleep(250);
    }
  }
}

export function build(rootDir, outDir, { allowMissingData = false } = {}) {
  const root = realOf(resolve(rootDir));
  const out = realOf(resolve(outDir ?? join(root, "_site")));
  const rel = relative(root, out);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) {
    throw new Error(`refusing output folder outside (or equal to) the repo root: ${out}`);
  }
  // The output folder is deleted first, so it must never overlap the sources.
  const top = rel.split(sep)[0].toLowerCase();
  if ([...DEPLOY_FILES, ...DEPLOY_DIRS].some((p) => p.split("/")[0] === top)) {
    throw new Error(`refusing output folder inside the deploy set: ${out}`);
  }
  if (existsSync(out) && !existsSync(join(out, ".nojekyll")) && readdirSync(out).length) {
    throw new Error(`refusing to delete ${out}: not a previous build (no .nojekyll)`);
  }

  // Empty the folder instead of removing it, and keep the .nojekyll marker until
  // last: a delete that fails half-way must not lock out the next build.
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, ".nojekyll"), "");
  for (const name of readdirSync(out)) {
    if (name !== ".nojekyll") retry(() => rmSync(join(out, name), { recursive: true, force: true }));
  }
  for (const p of [...DEPLOY_FILES, ...DEPLOY_DIRS]) copyTree(join(root, p), join(out, p));

  const index = join(out, "index.html");
  const hasIndex = existsSync(index);
  const routeCopies = [];
  if (hasIndex) {
    for (const p of ["404.html", ...ROUTES.flatMap((r) => [`${r}.html`, `${r}/index.html`])]) {
      mkdirSync(dirname(join(out, p)), { recursive: true });
      copyFileSync(index, join(out, p));
      routeCopies.push(p);
    }
  }

  const files = walk(out);
  const names = new Set(files.map((f) => f.path));
  const problems = [];
  const warnings = [];

  if (!hasIndex) problems.push("index.html missing");
  else {
    // Only markup counts: comments and inline script/style bodies are dropped first.
    const html = readFileSync(index, "utf8")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1>/gi, "<$1$2>");
    const refs = new Set();
    for (const m of html.matchAll(/\b(?:href|src)\s*=\s*(?:(["'])\.\/(.*?)\1|\.\/([^\s>]*))/gi)) {
      refs.add((m[2] ?? m[3]).split(/[?#]/)[0]);
    }
    if (refs.size && !/<base\s[^>]*\bhref\s*=\s*(["'])\/\1/i.test(html)) {
      problems.push('index.html has ./ references but no <base href="/">, so the route copies cannot load them');
    }
    for (const ref of refs) {
      let p = ref;
      try { p = decodeURI(ref); } catch {}
      // A reference counts as present when Pages would answer it with a 200.
      const found = p === "" || p.endsWith("/")
        ? names.has(`${p}index.html`)
        : names.has(p) || names.has(`${p}.html`) || names.has(`${p}/index.html`);
      if (!found) problems.push(`index.html references missing file: ./${ref}`);
    }
  }

  for (const { path } of files) {
    if (path === ".nojekyll") continue;
    const segs = path.split("/");
    const name = segs.at(-1).toLowerCase();
    if (segs.some((s) => s.startsWith(".")) || BANNED_EXT.some((e) => name.endsWith(e))) {
      problems.push(`forbidden file in output: ${path}`);
    }
  }

  for (const p of DATA_FILES) {
    if (!names.has(p)) (allowMissingData ? warnings : problems).push(`${p} missing`);
    else {
      try { JSON.parse(readFileSync(join(out, p), "utf8")); } catch (e) { problems.push(`${p} is not valid JSON: ${e.message}`); }
    }
  }

  return { ok: problems.length === 0, outDir: out, files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), routeCopies, problems, warnings };
}

function isMain() {
  try { return relative(realpathSync(process.argv[1]), fileURLToPath(import.meta.url)) === ""; } catch { return false; }
}

if (isMain()) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let r;
  try {
    const { values } = parseArgs({ options: { out: { type: "string" }, "allow-missing-data": { type: "boolean" } } });
    if (values.out === "") throw new Error("--out must not be empty");
    r = build(root, values.out && resolve(values.out), { allowMissingData: values["allow-missing-data"] });
  } catch (e) {
    console.error(`build-site: ${e.message}`);
    process.exit(1);
  }
  console.log(`build-site: ${r.files} files, ${r.bytes} bytes, ${r.routeCopies.length} route copies -> ${relative(root, r.outDir)}`);
  for (const w of r.warnings) console.error(`warning: ${w}`);
  if (!r.ok) {
    console.error(`build-site: FAILED, ${r.problems.length} problem(s):\n${r.problems.map((p) => ` - ${p}`).join("\n")}`);
    process.exit(1);
  }
}
