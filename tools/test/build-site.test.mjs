import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build-site.mjs";
import { createServer } from "../dev-server.mjs";

const ROUTES = ["news", "library", "maps", "profile", "dukhyun", "dukhyun/news", "dukhyun/library", "dukhyun/maps"];
const ROUTE_FILES = ["404.html", ...ROUTES.flatMap((r) => [`${r}.html`, `${r}/index.html`])];
const DATA = ["profile", "news", "library", "graph-all", "graph-mine", "graph-library"].map((n) => `data/public/${n}.json`);

const INDEX = `<!doctype html>
<html><head><base href="/">
<link rel="icon" href="./favicon.svg?v=1.0.0">
<link rel="stylesheet" href="./css/base.css?v=1.0.0">
<!-- <script src="./removed.js?v=1.0.0"></script> -->
</head><body>
<a href="./news">News</a> <a href="./maps/">Maps</a> <a href="https://example.com/x.js">out</a>
<script src="./config.js?v=1.0.0"></script>
<script src="https://cdn.example.com/lib.js"></script>
<script src='./vendor/d3.min.js'></script>
<script src="./app.js?v=1.0.0"></script>
<script type="module" src="./js/main.js?v=1.0.0#x"></script>
</body></html>
`;

const DEPLOYED = {
  "index.html": INDEX,
  "app.js": "window.app = 1;\n",
  "config.js": "window.RESEARCH_ATLAS_CONFIG = {};\n",
  "journal-abbreviations.js": "window.abbr = {};\n",
  "favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
  "favicon-app.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
  "manifest.webmanifest": '{"name":"x"}',
  "css/base.css": "body{margin:0}",
  "css/pages/news.css": ".news{}",
  "js/main.js": "export {};\n",
  "js/localapi/boot.js": "// boot\n",
  "fonts/a.woff2": "wOF2",
  "vendor/d3.min.js": "var d3;",
  "media/0123456789abcdef.png": "PNG",
  ...Object.fromEntries(DATA.map((p) => [p, '{\n "ok": true\n}\n'])),
};

const NOT_DEPLOYED = {
  "README.md": "# readme",
  ".gitignore": "_site\n",
  "start-backend-server.bat": "set SECRET=1",
  "notes.txt": "x",
  "styles.css": "x",
  "paper-metadata.js": "x",
  "tools/bump_version.py": "x",
  "tools/lib/publicize.mjs": "x",
  ".github/workflows/pages.yml": "x",
  "data/private/raw.json": "{}",
  "data/secret.json": "{}",
};

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

// realpath: the CLI derives its root from import.meta.url, which is already resolved.
function tempDir(prefix) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

// A null value leaves that file out of the fake repo.
function makeRepo(changes = {}) {
  const root = tempDir("build-site-");
  for (const [rel, text] of Object.entries({ ...DEPLOYED, ...NOT_DEPLOYED, ...changes })) {
    if (text !== null) write(root, rel, text);
  }
  return root;
}

function list(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? list(join(dir, e.name), `${prefix}${e.name}/`) : [prefix + e.name]))
    .sort();
}

const read = (root, rel) => readFileSync(join(root, rel), "utf8");
const snapshot = (dir) => Object.fromEntries(list(dir).map((rel) => [rel, read(dir, rel)]));

describe("build", () => {
  test("copies the deploy set only, with route copies and .nojekyll", () => {
    const root = makeRepo();
    const r = build(root);
    const out = join(root, "_site");
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.ok, true);
    assert.equal(r.outDir, out);
    assert.deepEqual(list(out), [...Object.keys(DEPLOYED), ...ROUTE_FILES, ".nojekyll"].sort());
    for (const [rel, text] of Object.entries(DEPLOYED)) assert.equal(read(out, rel), text, rel);
    for (const rel of ROUTE_FILES) assert.equal(read(out, rel), INDEX, rel);
    assert.equal(read(out, ".nojekyll"), "");
    assert.deepEqual([...r.routeCopies].sort(), [...ROUTE_FILES].sort());
    assert.equal(r.files, list(out).length);
    assert.equal(r.bytes, list(out).reduce((n, rel) => n + statSync(join(out, rel)).size, 0));
  });

  test("rebuild replaces the previous output and is byte-identical", () => {
    const root = makeRepo();
    const out = join(root, "_site");
    build(root);
    const first = snapshot(out);
    write(out, "stale/old.js", "x");
    assert.equal(build(root).ok, true);
    assert.deepEqual(snapshot(out), first);
  });

  test("optional deploy entries may be absent", () => {
    const root = makeRepo({ "favicon-app.svg": null, "journal-abbreviations.js": null, "media/0123456789abcdef.png": null, "fonts/a.woff2": null });
    const r = build(root, join(root, "dist"));
    assert.deepEqual(r.problems, []);
    assert.equal(list(join(root, "dist")).includes("favicon-app.svg"), false);
  });

  test("refuses an output folder that is unsafe to delete", () => {
    const root = makeRepo();
    assert.throws(() => build(root, root), /refusing/);
    assert.throws(() => build(root, join(root, "..")), /refusing/);
    assert.throws(() => build(root, join(root, "..", "elsewhere")), /refusing/);
    assert.throws(() => build(root, join(root, "css")), /refusing/);
    assert.throws(() => build(root, join(root, "data", "out")), /refusing/);
    assert.throws(() => build(root, join(root, "tools")), /refusing/);
    assert.equal(read(root, "tools/bump_version.py"), "x");
    assert.equal(read(root, "css/base.css"), DEPLOYED["css/base.css"]);
  });

  test("fails when index.html is missing", () => {
    const r = build(makeRepo({ "index.html": null }));
    assert.equal(r.ok, false);
    assert.ok(r.problems.includes("index.html missing"));
    assert.deepEqual(r.routeCopies, []);
  });

  test("fails on every local reference missing from the output", () => {
    const html = INDEX.replace("</body>", '<script src="./paper-metadata.js?v=1.0.0"></script><img src="./auth-assets/g.svg"><a href="./admin/">a</a></body>');
    const r = build(makeRepo({ "index.html": html, "vendor/d3.min.js": null }));
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems, [
      "index.html references missing file: ./vendor/d3.min.js",
      "index.html references missing file: ./paper-metadata.js",
      "index.html references missing file: ./auth-assets/g.svg",
      "index.html references missing file: ./admin/",
    ]);
  });

  test("fails on forbidden file names in the output", () => {
    const bad = ["css/run.bat", "js/tool.py", "js/pages/NOTES.MD", "media/sync.log", "data/public/export.csv", "data/public/atlas.db", "css/base.css.bak", "js/.env", "media/.cache/x.png"];
    const r = build(makeRepo(Object.fromEntries(bad.map((rel) => [rel, "x"]))));
    assert.equal(r.ok, false);
    assert.deepEqual([...r.problems].sort(), bad.map((rel) => `forbidden file in output: ${rel}`).sort());
  });

  test("fails on missing data files unless allowMissingData", () => {
    const changes = { [DATA[1]]: null, [DATA[4]]: null };
    const missing = [`${DATA[1]} missing`, `${DATA[4]} missing`];
    const strict = build(makeRepo(changes));
    assert.equal(strict.ok, false);
    assert.deepEqual(strict.problems, missing);
    const lenient = build(makeRepo(changes), undefined, { allowMissingData: true });
    assert.equal(lenient.ok, true);
    assert.deepEqual(lenient.warnings, missing);
  });

  test("fails on invalid JSON even with allowMissingData", () => {
    const r = build(makeRepo({ [DATA[0]]: "{ nope", [DATA[5]]: "" }), undefined, { allowMissingData: true });
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 2);
    assert.match(r.problems[0], /^data\/public\/profile\.json is not valid JSON/);
    assert.match(r.problems[1], /^data\/public\/graph-library\.json is not valid JSON/);
  });

  test("CLI prints a summary and exits 1 listing every problem", () => {
    const root = makeRepo({ ...Object.fromEntries(DATA.map((p) => [p, null])), "css/todo.md": "x" });
    const cli = join(root, "tools", "build-site.mjs");
    copyFileSync(fileURLToPath(new URL("../build-site.mjs", import.meta.url)), cli);
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /^build-site: \d+ files, \d+ bytes, 17 route copies -> _site\r?\n$/);
    assert.match(failed.stderr, /FAILED, 7 problem\(s\)/);
    for (const p of DATA) assert.ok(failed.stderr.includes(` - ${p} missing`), p);
    assert.ok(failed.stderr.includes(" - forbidden file in output: css/todo.md"));

    rmSync(join(root, "css", "todo.md"));
    const ok = run("--allow-missing-data", "--out", join(root, "dist"));
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /17 route copies -> dist/);
    assert.equal(ok.stderr.match(/^warning: /gm).length, 6);
    assert.equal(read(root, "dist/dukhyun/maps/index.html"), INDEX);

    const refused = run("--out", join(root, ".."));
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refusing/);
  });
});

describe("dev-server", () => {
  let root, out, server, port;
  const logs = [];

  const request = (path, method = "GET", p = port) => new Promise((done, fail) => {
    const req = http.request({ host: "127.0.0.1", port: p, path, method, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", fail);
    req.end();
  });
  const listen = (s) => new Promise((done) => s.listen(0, "127.0.0.1", () => done(s.address().port)));
  const close = (s) => new Promise((done) => s.close(done));

  before(async () => {
    root = makeRepo();
    assert.equal(build(root).ok, true);
    out = join(root, "_site");
    write(root, "secret", "TOP SECRET");
    write(out, "plain", "exact file");
    write(out, "plain.html", "html twin");
    write(out, "only.html", "only html");
    write(out, "docs/index.html", "docs index");
    write(out, "docs/guide.txt", "guide");
    mkdirSync(join(out, "empty"));
    server = createServer(out, { log: (line) => logs.push(line) });
    port = await listen(server);
  });
  after(() => close(server));

  test("serves the root and ignores the query string", async () => {
    const r = await request("/");
    assert.equal(r.status, 200);
    assert.equal(r.body, INDEX);
    assert.equal(r.headers["cache-control"], "no-cache");
    const css = await request("/css/base.css?v=1.0.0&x=/../..");
    assert.equal(css.status, 200);
    assert.equal(css.body, DEPLOYED["css/base.css"]);
  });

  test("resolution order: exact file, then .html, then directory index", async () => {
    assert.equal((await request("/plain")).body, "exact file");
    assert.equal((await request("/only")).body, "only html");
    assert.equal((await request("/docs/")).body, "docs index");
    assert.equal((await request("/docs/index.html")).body, "docs index");
    // <route>.html wins over the <route>/ directory, so no redirect.
    for (const route of ROUTES) {
      for (const path of [`/${route}`, `/${route}/`, `/${route}.html`, `/${route}?paper=10.1/x`]) {
        const r = await request(path);
        assert.equal(r.status, 200, path);
        assert.equal(r.body, INDEX, path);
        assert.match(r.headers["content-type"], /^text\/html/, path);
      }
    }
  });

  test("301 to the trailing slash for a directory", async () => {
    const r = await request("/docs");
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, "/docs/");
    assert.equal((await request("/css?v=1")).headers.location, "/css/?v=1");
    assert.equal((await request("/data/public")).headers.location, "/data/public/");
  });

  test("unknown paths get 404.html with status 404", async () => {
    for (const path of ["/nope", "/bin", "/dukhyun/nope", "/a/b/c.js", "/css/", "/empty/", "/index.html/", "/CSS/base.css", "/News"]) {
      const r = await request(path);
      assert.equal(r.status, 404, path);
      assert.equal(r.body, INDEX, path);
      assert.match(r.headers["content-type"], /^text\/html/, path);
    }
  });

  test("plain Not found when 404.html is absent", async () => {
    const bare = tempDir("dev-server-");
    write(bare, "index.html", "home");
    const s = createServer(bare, { log: () => {} });
    const p = await listen(s);
    try {
      const r = await request("/nope", "GET", p);
      assert.equal(r.status, 404);
      assert.equal(r.body, "Not found");
      assert.match(r.headers["content-type"], /^text\/plain/);
      assert.equal((await request("/", "GET", p)).body, "home");
    } finally {
      await close(s);
    }
  });

  test("rejects paths that escape the served folder", async () => {
    const escaping = ["/..%2f..%2fsecret", "/%2e%2e/secret", "/..%2fsecret", "/../secret", "/%2e%2e%2fsecret", "/css/..%2f..%2fsecret", "/css/../../secret", "/..", "/%2e%2e", "/..%2f_site.html"];
    for (const path of escaping) {
      const r = await request(path);
      assert.equal(r.status, 400, path);
      assert.equal(r.body.includes("TOP SECRET"), false, path);
    }
    const backslash = await request("/..%5csecret");
    assert.notEqual(backslash.status, 200);
    assert.equal(backslash.body.includes("TOP SECRET"), false);
    assert.equal((await request("/%E0%A4%A")).status, 400);
    assert.equal((await request("/a%00b")).status, 400);
    // Dot segments that stay inside are not an escape.
    assert.equal((await request("/css/..%2fapp.js")).body, DEPLOYED["app.js"]);
  });

  test("content types", async () => {
    write(out, "media/a.jpg", "x");
    write(out, "media/a.jpeg", "x");
    write(out, "media/a.webp", "x");
    write(out, "media/a.gif", "x");
    write(out, "favicon.ico", "x");
    write(out, "tool.mjs", "x");
    const expected = {
      "/index.html": "text/html; charset=utf-8",
      "/news": "text/html; charset=utf-8",
      "/app.js": "text/javascript; charset=utf-8",
      "/tool.mjs": "text/javascript; charset=utf-8",
      "/css/base.css": "text/css; charset=utf-8",
      "/data/public/news.json": "application/json; charset=utf-8",
      "/favicon.svg": "image/svg+xml",
      "/media/0123456789abcdef.png": "image/png",
      "/media/a.jpg": "image/jpeg",
      "/media/a.jpeg": "image/jpeg",
      "/media/a.webp": "image/webp",
      "/media/a.gif": "image/gif",
      "/fonts/a.woff2": "font/woff2",
      "/manifest.webmanifest": "application/manifest+json",
      "/favicon.ico": "image/x-icon",
      "/docs/guide.txt": "text/plain; charset=utf-8",
      "/plain": "application/octet-stream",
    };
    for (const [path, type] of Object.entries(expected)) {
      const r = await request(path);
      assert.equal(r.status, 200, path);
      assert.equal(r.headers["content-type"], type, path);
      assert.equal(r.headers["cache-control"], "no-cache", path);
    }
  });

  test("HEAD sends headers only, other methods get 405", async () => {
    const head = await request("/app.js", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal(head.headers["content-length"], String(Buffer.byteLength(DEPLOYED["app.js"])));
    assert.equal((await request("/nope", "HEAD")).status, 404);
    const post = await request("/app.js", "POST");
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, "GET, HEAD");
  });

  test("logs one line per request", async () => {
    const start = logs.length;
    await request("/dukhyun/news?x=1");
    await request("/nope");
    await request("/docs");
    assert.deepEqual(logs.slice(start), ["GET /dukhyun/news?x=1 200 dukhyun/news.html", "GET /nope 404 404.html", "GET /docs 301 -> /docs/"]);
  });
});
