import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build } from "../build-site.mjs";

const DATA = ["profile", "news", "library", "graph-all", "graph-mine", "graph-library"].map((n) => `data/public/${n}.json`);
const index = (head, body = "") => `<!doctype html><html><head>${head}</head><body>${body}<script src="./app.js?v=1"></script></body></html>\n`;
const BASE = '<base href="/"><link rel="stylesheet" href="./css/base.css?v=1">';

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

function tempDir(prefix) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

function makeRepo(html = index(BASE)) {
  const root = tempDir("build-hard-");
  const files = { "index.html": html, "app.js": "1;\n", "css/base.css": "body{}", "js/main.js": "export {};\n", ...Object.fromEntries(DATA.map((p) => [p, "{}\n"])) };
  for (const [rel, text] of Object.entries(files)) write(root, rel, text);
  return root;
}

const list = (dir, prefix = "") => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? list(join(dir, e.name), `${prefix}${e.name}/`) : [prefix + e.name]))
  .sort();

test("a half-deleted previous build is rebuilt, not locked out", () => {
  const root = makeRepo();
  const out = join(root, "_site");
  assert.equal(build(root).ok, true);
  const clean = list(out);
  // what an interrupted delete leaves behind: the marker plus a few stragglers
  for (const rel of clean) if (rel !== ".nojekyll" && !rel.startsWith("css/")) rmSync(join(out, rel), { force: true });
  write(out, "stale/left.js", "x");
  const r = build(root);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(list(out), clean);
});

test("an output folder reached through a junction outside the repo is refused", () => {
  const root = makeRepo();
  const outside = tempDir("build-outside-");
  write(outside, "othersite/.nojekyll", "");
  write(outside, "othersite/precious.txt", "KEEP");
  symlinkSync(outside, join(root, "link"), "junction");
  assert.throws(() => build(root, join(root, "link", "othersite")), /refusing/);
  assert.throws(() => build(root, join(root, "link", "new")), /refusing/);
  assert.equal(readFileSync(join(outside, "othersite", "precious.txt"), "utf8"), "KEEP");
  assert.equal(existsSync(join(outside, "new")), false);
});

test("./ references without <base href=\"/\"> fail the build", () => {
  const r = build(makeRepo(index('<link rel="stylesheet" href="./css/base.css?v=1">')));
  assert.equal(r.ok, false);
  assert.match(r.problems.join("\n"), /no <base href="\/">/);
});

test("only markup references are checked: inline script text is ignored, odd attribute forms are not", () => {
  const inline = build(makeRepo(index(BASE, '<script>img.src = "./media/" + id;</script><style>a{background:url("./x.png")}</style>')));
  assert.deepEqual(inline.problems, []);
  const upper = build(makeRepo(index(BASE, '<SCRIPT SRC="./missing-upper.js"></SCRIPT>')));
  assert.match(upper.problems.join("\n"), /missing-upper\.js/);
  const bare = build(makeRepo(index(BASE, "<script src=./missing-bare.js></script>")));
  assert.match(bare.problems.join("\n"), /missing-bare\.js/);
});
