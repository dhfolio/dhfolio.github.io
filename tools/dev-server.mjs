#!/usr/bin/env node
import http from "node:http";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const TEXT = "text/plain; charset=utf-8";
const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";
const TYPES = {
  html: HTML, js: JS, mjs: JS, css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  woff2: "font/woff2", webmanifest: "application/manifest+json", ico: "image/x-icon", txt: TEXT,
};

// Pages is case-sensitive but Windows/macOS file systems are not, so every
// segment has to match a real directory entry exactly.
function kind(root, p) {
  try {
    let dir = root;
    for (const seg of relative(root, p).split(sep).filter(Boolean)) {
      if (!readdirSync(dir).includes(seg)) return "";
      dir = join(dir, seg);
    }
    const st = statSync(p);
    return st.isFile() ? "file" : st.isDirectory() ? "dir" : "";
  } catch {
    return "";
  }
}

function locate(root, rawPath) {
  let path;
  try { path = decodeURIComponent(rawPath); } catch { return { status: 400 }; }
  if (!path.startsWith("/") || path.includes("\0")) return { status: 400 };
  if (path.includes("\\")) return { status: 404 }; // a separator on Windows, an ordinary character on Pages
  const full = resolve(root, `.${path}`);
  const rel = relative(root, full);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) return { status: 400 };
  const slash = path.endsWith("/");
  if (!slash && rel) {
    if (kind(root, full) === "file") return { status: 200, file: full };
    if (kind(root, `${full}.html`) === "file") return { status: 200, file: `${full}.html` };
  }
  if (kind(root, full) === "dir") {
    if (!slash) return { status: 301 };
    const index = join(full, "index.html");
    if (kind(root, index) === "file") return { status: 200, file: index };
  }
  return { status: 404 };
}

export function createServer(dir, { log = console.log } = {}) {
  const root = resolve(dir);
  return http.createServer((req, res) => {
    const q = req.url.indexOf("?");
    const rawPath = q < 0 ? req.url : req.url.slice(0, q);
    const send = (status, type, body, extra = {}, note = "") => {
      res.writeHead(status, { "Content-Type": type, "Content-Length": body.length, "Cache-Control": "no-cache", ...extra });
      res.end(req.method === "HEAD" ? undefined : body);
      log(`${req.method} ${req.url} ${status}${note && ` ${note}`}`);
    };
    const text = (status, message, extra, note) => send(status, TEXT, Buffer.from(message), extra, note);
    const served = (file) => relative(root, file).split(sep).join("/");

    if (req.method !== "GET" && req.method !== "HEAD") return text(405, "Method not allowed", { Allow: "GET, HEAD" });
    try {
      const hit = locate(root, rawPath);
      if (hit.status === 400) return text(400, "Bad request");
      if (hit.status === 301) {
        const location = `/${rawPath.replace(/^\/+/, "")}/${q < 0 ? "" : req.url.slice(q)}`;
        return text(301, "Moved permanently", { Location: location }, `-> ${location}`);
      }
      if (hit.status === 200) {
        const type = TYPES[extname(hit.file).slice(1).toLowerCase()] ?? "application/octet-stream";
        return send(200, type, readFileSync(hit.file), {}, served(hit.file));
      }
      const page = join(root, "404.html");
      if (kind(root, page) === "file") return send(404, HTML, readFileSync(page), {}, "404.html");
      return text(404, "Not found");
    } catch (e) {
      return text(500, "Server error", {}, e.message);
    }
  });
}

function isMain() {
  try { return relative(realpathSync(process.argv[1]), fileURLToPath(import.meta.url)) === ""; } catch { return false; }
}

if (isMain()) {
  const fail = (message) => { console.error(`dev-server: ${message}`); process.exit(1); };
  let values;
  try {
    ({ values } = parseArgs({ options: { port: { type: "string", default: "8770" }, dir: { type: "string" } } }));
  } catch (e) {
    fail(e.message);
  }
  const dir = values.dir ? resolve(values.dir) : resolve(dirname(fileURLToPath(import.meta.url)), "..", "_site");
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`invalid port: ${values.port}`);
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) fail(`no such folder: ${dir} (run node tools/build-site.mjs first)`);
  const server = createServer(dir);
  server.on("error", (e) => fail(e.message));
  server.listen(port, "127.0.0.1", () => console.log(`Serving ${dir} at http://127.0.0.1:${server.address().port}/`));
}
