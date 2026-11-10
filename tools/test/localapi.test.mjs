import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../js/localapi/index.js";

const DATA = {
  "/data/public/profile.json": { slug: "dukhyun", publications: [] },
  "/data/public/news.json": { items: [] },
  "/data/public/library.json": { papers: [] },
  "/data/public/graph-all.json": { scope: "all" },
  "/data/public/graph-mine.json": { scope: "mine" },
  "/data/public/graph-library.json": { scope: "library" }
};

function fakeFetch(seen = []) {
  return async (url, options) => {
    seen.push({ url, options });
    const body = DATA[url];
    return body
      ? { ok: true, status: 200, json: async () => body }
      : { ok: false, status: 404, json: async () => ({}) };
  };
}

const call = (method, path, fetch = fakeFetch()) => handle({ method, path, ownerSlug: "dukhyun", fetch });

test("profile, news and library map to their data files", async () => {
  const seen = [];
  const fetch = fakeFetch(seen);
  assert.deepEqual(await call("GET", "/api/profiles/dukhyun", fetch), { status: 200, body: DATA["/data/public/profile.json"] });
  assert.deepEqual((await call("GET", "/api/profiles/dukhyun/news", fetch)).body, DATA["/data/public/news.json"]);
  assert.deepEqual((await call("GET", "/api/profiles/dukhyun/library", fetch)).body, DATA["/data/public/library.json"]);
  assert.deepEqual(seen.map(s => s.url), ["/data/public/profile.json", "/data/public/news.json", "/data/public/library.json"]);
  assert.ok(seen.every(s => s.options.cache === "no-cache"));
});

test("graph scope picks the file; unknown or missing scope falls back to all", async () => {
  for (const [query, scope] of [["?scope=all", "all"], ["?scope=mine", "mine"], ["?scope=library", "library"], ["?scope=../x", "all"], ["", "all"]]) {
    const res = await call("GET", `/api/profiles/dukhyun/graph${query}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.scope, scope);
  }
});

test("slug match is case-insensitive; any other slug is the not-found the pages expect", async () => {
  assert.equal((await call("GET", "/api/profiles/DukHyun")).status, 200);
  const res = await call("GET", "/api/profiles/alice/news");
  assert.equal(res.status, 404);
  assert.match(res.body.detail, /not found/i);
});

test("everything else is refused as read-only, never thrown", async () => {
  for (const [method, path] of [
    ["POST", "/api/papers"],
    ["PUT", "/api/state"],
    ["DELETE", "/api/bin"],
    ["POST", "/api/profiles/dukhyun"],
    ["GET", "/api/papers"],
    ["GET", "/api/state"],
    ["GET", "/api/health"],
    ["GET", "/api/metadata?query=10.1/x"],
    ["GET", "/api/profiles/dukhyun/graph/extra"]
  ]) {
    assert.deepEqual(await call(method, path), { status: 403, body: { detail: "Read-only mirror" } }, `${method} ${path}`);
  }
});

test("missing data or a malformed path is a JSON 503, not an exception", async () => {
  const empty = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const res = await call("GET", "/api/profiles/dukhyun", empty);
  assert.equal(res.status, 503);
  assert.equal(typeof res.body.detail, "string");
  assert.equal((await call("GET", "/api/profiles/%E0%A4%A")).status, 503);
  const throwing = async () => { throw new Error("offline"); };
  assert.equal((await call("GET", "/api/profiles/dukhyun/news", throwing)).status, 503);
});
