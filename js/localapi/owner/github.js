/**
 * js/localapi/owner/github.js
 * Minimal GitHub REST/GraphQL client for the private data repository.
 * DOM-free; fetch is injected. The token is only ever sent to `apiBase`
 * (https://api.github.com unless config.js says otherwise, which only the
 * site's own source can do).
 *
 * Every failure is a GitHubError whose `kind` the UI understands:
 *   offline · auth (401) · perm (403) · ratelimit · notfound · conflict · server · bad
 */

export class GitHubError extends Error {
  constructor(kind, status, message, extra = {}) {
    super(message);
    this.name = "GitHubError";
    this.kind = kind;
    this.status = status;
    Object.assign(this, extra);
  }
}

const B64 = /^[A-Za-z0-9+/=\s]*$/;

export function base64ToBytes(b64) {
  if (!B64.test(b64)) throw new GitHubError("bad", 0, "blob content is not base64");
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function createGitHub({ token, repo, fetch, apiBase = "https://api.github.com" }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new Error(`bad repository name: ${repo}`);
  const base = String(apiBase).replace(/\/+$/, "");
  const origin = new URL(base).origin;

  async function request(method, path, body) {
    const url = path.startsWith("/graphql") ? `${base}/graphql` : `${base}/repos/${repo}${path}`;
    if (new URL(url).origin !== origin) throw new GitHubError("bad", 0, "refusing to send the token elsewhere");
    let res;
    try {
      res = await fetch(url, {
        method,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new GitHubError("offline", 0, "GitHub is unreachable (offline?)");
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }
    if (res.ok) return data;
    const msg = (data && data.message) || `HTTP ${res.status}`;
    const retryAfter = Number(res.headers.get("retry-after")) || 0;
    if (res.status === 401) throw new GitHubError("auth", 401, "The GitHub token is invalid or expired.");
    if (res.status === 429 || (res.status === 403 && (retryAfter || res.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(msg)))) {
      throw new GitHubError("ratelimit", res.status, "GitHub rate limit reached.", { retryAfter: retryAfter || 60 });
    }
    if (res.status === 403) {
      throw new GitHubError("perm", 403, `The token lacks permission (${res.headers.get("x-accepted-github-permissions") || msg}).`);
    }
    if (res.status === 404) throw new GitHubError("notfound", 404, msg);
    // Verified 2026-11-10 (plan, experiment E1b): a stale parent is 422 "Update is not a fast forward".
    if (res.status === 409 || (res.status === 422 && /fast forward/i.test(msg))) throw new GitHubError("conflict", res.status, msg);
    throw new GitHubError(res.status >= 500 ? "server" : "bad", res.status, msg);
  }

  return {
    repo,
    request,
    /** Repository metadata; also the cheapest token check. */
    getRepo: () => request("GET", ""),
    async getHead(branch = "main") {
      const ref = await request("GET", `/git/ref/heads/${branch}`);
      return ref.object.sha;
    },
    async getCommit(sha) {
      const c = await request("GET", `/git/commits/${sha}`);
      return { sha: c.sha, tree: c.tree.sha };
    },
    /** Map<path, sha> of every blob under the tree. */
    async getTree(treeSha) {
      const t = await request("GET", `/git/trees/${treeSha}?recursive=1`);
      if (t.truncated) throw new GitHubError("bad", 0, "repository tree is too large to list in one request");
      return new Map(t.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]));
    },
    // ── writes (Git Data API; verified in experiment E1) ──
    async createBlobBase64(content) {
      return (await request("POST", "/git/blobs", { content, encoding: "base64" })).sha;
    },
    /** entries: [{path, mode, type:"blob", content} | {..., sha} | {..., sha: null}] */
    async createTree(baseTree, entries) {
      return (await request("POST", "/git/trees", { base_tree: baseTree, tree: entries })).sha;
    },
    async createCommit(message, tree, parents) {
      return (await request("POST", "/git/commits", { message, tree, parents })).sha;
    },
    /** Fast-forward only; a stale parent is a GitHubError of kind "conflict". */
    async updateRef(branch, sha) {
      return request("PATCH", `/git/refs/heads/${branch}`, { sha, force: false });
    },
    async getBlobBytes(sha) {
      const b = await request("GET", `/git/blobs/${sha}`);
      return base64ToBytes(b.content || "");
    },
    /** Texts of many blobs in one GraphQL request: Map<path, text>. */
    async getTexts(commitSha, paths) {
      if (!paths.length) return new Map();
      const [owner, name] = repo.split("/");
      const fields = paths.map((p, i) => `f${i}: object(expression: ${JSON.stringify(`${commitSha}:${p}`)}) { ... on Blob { text isBinary } }`);
      const data = await request("POST", "/graphql", {
        query: `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields.join(" ")} } }`,
      });
      if (data?.errors?.length) throw new GitHubError("bad", 200, `GraphQL: ${data.errors[0].message}`);
      const r = data?.data?.repository || {};
      const out = new Map();
      paths.forEach((p, i) => {
        const blob = r[`f${i}`];
        if (blob && !blob.isBinary && typeof blob.text === "string") out.set(p, blob.text);
      });
      return out;
    },
  };
}
