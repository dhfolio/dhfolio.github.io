#!/usr/bin/env node
// Gate G3 harness: serve a built site (tools/dev-server.mjs) plus a fake GitHub
// at /__fake-github on the same origin, holding the hostile g3-fixture data.
// config.js is served with githubApi pointed at it. Local testing only.
//
//   node tools/build-site.mjs --out _preview
//   node tools/test/g3-server.mjs --dir _preview --port 8773
//
// Then unlock in the footer with any token and open every owner view.
import http from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createServer as createSiteServer } from "../dev-server.mjs";
import { createFakeGitHub } from "./fake-github.mjs";
import { g3Files } from "./g3-fixture.mjs";

const { values } = parseArgs({ options: { dir: { type: "string", default: "_preview" }, port: { type: "string", default: "8773" } } });
const dir = resolve(values.dir);
const site = createSiteServer(dir, { log: () => {} });
const PREFIX = "/__fake-github";
let fake = null;

const server = http.createServer(async (req, res) => {
  const base = `http://${req.headers.host}${PREFIX}`;
  if (req.url.startsWith(`${PREFIX}/`)) {
    fake ||= createFakeGitHub(g3Files(), { base });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try {
      const r = await fake.fetch(`${base}${req.url.slice(PREFIX.length)}`, {
        method: req.method, body: chunks.length ? Buffer.concat(chunks).toString() : undefined, headers: { Authorization: req.headers.authorization },
      });
      res.writeHead(r.status, { "Content-Type": "application/json" });
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
    return;
  }
  if (req.url.split("?")[0] === "/config.js") {
    const src = readFileSync(join(dir, "config.js"), "utf8");
    const body = `${src}\nwindow.RESEARCH_ATLAS_CONFIG.githubApi = ${JSON.stringify(base)};\n`;
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(body);
    return;
  }
  site.emit("request", req, res);
});
server.listen(Number(values.port), "127.0.0.1", () => console.log(`G3 site at http://127.0.0.1:${server.address().port}/ (fake GitHub at ${PREFIX})`));
