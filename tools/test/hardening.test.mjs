// Phase 2.0 guards: the page must be safe to hold an owner token before any
// editing code exists. These check the real source tree, not a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function jsFiles(dir = "js") {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return jsFiles(rel);
    return e.name.endsWith(".js") ? [rel] : [];
  });
}
const SOURCES = ["app.js", "config.js", "journal-abbreviations.js", ...jsFiles()];

function loadEscape() {
  const sandbox = { window: {} };
  vm.runInNewContext(read("js/utils/escape.js"), sandbox);
  return sandbox.window.RAEscape;
}

test("escapeHtml escapes all five HTML-significant characters", () => {
  const { escapeHtml } = loadEscape();
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  assert.equal(escapeHtml(`x" autofocus onfocus="alert(1)`), "x&quot; autofocus onfocus=&quot;alert(1)");
});

test("safeHref keeps http(s), mailto and relative links and drops every other scheme", () => {
  const { safeHref } = loadEscape();
  for (const ok of ["https://doi.org/10.1/x", "http://a.b", "mailto:a@b.c", "/media/x.jpg", "news", "?paper=1", "#top", "//cdn.example/x"]) {
    assert.equal(safeHref(ok), ok, ok);
  }
  assert.equal(safeHref("  https://a.b  "), "https://a.b");
  for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "java\tscript:alert(1)",
    "java\nscript:alert(1)", "\u0001javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:x", "file:///C:/x"]) {
    assert.equal(safeHref(bad), "", JSON.stringify(bad));
  }
  assert.equal(safeHref(null), "");
  assert.equal(safeHref(undefined), "");
});

test("every page-local escapeHtml delegates to the shared one", () => {
  const defs = SOURCES.flatMap((rel) => {
    const src = read(rel);
    return [...src.matchAll(/function escapeHtml\([^)]*\)\s*\{([^}]*)\}/g)].map((m) => ({ rel, body: m[1] }));
  });
  assert.ok(defs.length >= 7, `found ${defs.length} definitions`);
  for (const { rel, body } of defs) {
    if (rel === "js/utils/escape.js") continue;
    assert.match(body, /window\.RAEscape\.escapeHtml\(/, `${rel} has its own escaper`);
  }
});

test("no inline event handlers, inline styles or javascript: URLs in generated markup", () => {
  for (const rel of [...SOURCES, "index.html"]) {
    const src = read(rel);
    assert.doesNotMatch(src, /<[a-z][^>]*\son[a-z]+\s*=\s*["']/i, `${rel}: inline on*= handler`);
    assert.doesNotMatch(src, /<[a-z][^>]*\sstyle\s*=\s*["']/i, `${rel}: inline style=""`);
    assert.doesNotMatch(src, /["'`]javascript:/i, `${rel}: javascript: URL literal`);
    assert.doesNotMatch(src, /setAttribute\(\s*["']style["']|\.attr\(\s*["']style["']/, `${rel}: style attribute via script`);
  }
});

test("index.html: CSP is the first thing after the charset and allows no inline or eval script", () => {
  const html = read("index.html");
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  const tags = [...head.matchAll(/<(meta|link|script|base|title|style)\b[^>]*>/gi)].map((m) => m[0]);
  assert.match(tags[0], /<meta charset=/i);
  assert.match(tags[1], /http-equiv="Content-Security-Policy"/i);
  assert.match(tags[2], /<script src="\.\/js\/frame-guard\.js/);
  const csp = /content="([^"]+)"/.exec(tags[1])[1];
  const dir = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(dir["default-src"], ["'none'"]);
  assert.deepEqual(dir["script-src"], ["'self'"]);
  assert.deepEqual(dir["style-src"], ["'self'"]);
  assert.deepEqual(dir["object-src"], ["'none'"]);
  assert.ok(dir["connect-src"].includes("https://api.github.com"));
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, "inline <script> block");
  assert.doesNotMatch(html, /<style\b/i, "inline <style> block");
});

test("index.html: the shared escaper loads before app.js and the page modules", () => {
  const html = read("index.html");
  const at = (needle) => html.indexOf(needle);
  assert.ok(at("js/utils/escape.js") > 0);
  assert.ok(at("js/utils/escape.js") < at("./app.js"));
  assert.ok(at("js/utils/escape.js") < at("js/main.js"));
});

test("app.js has no localStorage fallback and never writes a whole state", () => {
  const src = read("app.js");
  for (const gone of ["switchToLocalMode", "localStorageAdapter", "scheduleFullStateSync", "STORAGE_MODE_KEY", "isAvailable()"]) {
    assert.ok(!src.includes(gone), `${gone} is still referenced`);
  }
  assert.doesNotMatch(src, /method:\s*"PUT"[^}]*\/api\/state|\/api\/state"[^)]*method:\s*"PUT"/s, "PUT /api/state");
  assert.match(src, /const activeStorageMode = "backend";/);
});

// ── Router: /bin is reachable only by the unlocked owner ─────────────────────
async function loadRouter(pathname, authSlug) {
  const replaced = [];
  const loc = { pathname, search: "", hash: "" };
  globalThis.window = {
    RESEARCH_ATLAS_CONFIG: { ownerSlug: "dukhyun" },
    location: loc,
    history: { replaceState: (_s, _t, url) => { replaced.push(url); loc.pathname = url.split("?")[0]; }, pushState() {} },
    addEventListener() {},
    __appInitPromise: Promise.resolve(),
    __appAuthSlug: authSlug,
  };
  globalThis.document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { classList: { add() {}, remove() {} } },
  };
  const mod = await import(`../../js/router.js?case=${encodeURIComponent(pathname + authSlug)}`);
  return { mod, replaced, loc };
}

test("router: /bin parses as the Bin page and keeps its URL", async () => {
  const { mod } = await loadRouter("/bin", "");
  assert.equal(mod.getCurrentPageName(), "bin");
  window.location.pathname = "/dukhyun/bin";
  assert.equal(mod.getCurrentPageName(), "bin");
  window.location.pathname = "/someone/bin";
  assert.equal(mod.getCurrentPageName(), "profile");
});

test("router: a visitor on /bin is sent to the profile at /", async () => {
  const { mod, replaced } = await loadRouter("/bin", "");
  await mod.showPage("bin", null);
  assert.deepEqual(replaced, ["/"]);
  assert.equal(mod.getCurrentPage(), "profile");
});

test("router: the unlocked owner stays on /bin", async () => {
  const { mod, replaced } = await loadRouter("/bin", "dukhyun");
  await mod.showPage("bin", null);
  assert.deepEqual(replaced, []);
  assert.equal(mod.getCurrentPage(), "bin");
});

test("sources list is not empty (guards the walker itself)", () => {
  assert.ok(SOURCES.some((p) => relative("js", p).startsWith("pages")), SOURCES.join(","));
});
