// In-memory stand-in for the slice of the GitHub API the owner engine uses:
// repo, ref (GET/PATCH), commits (GET/POST), trees (GET recursive/POST with
// base_tree, inline content and sha:null deletes), blobs (GET/POST), and
// GraphQL blob text. Behaviour follows what experiment E1 measured
// (plan file, 2026-11-10): a stale parent is 422 "Update is not a fast forward";
// deleting a path that does not exist is an error.
//
// faults: { offline, status, graphql: false, patchStatus } inject failures.
// remoteCommit(changes) simulates an edit pushed from another device.
import { createHash } from 'node:crypto';

const enc = new TextEncoder();
const dec = new TextDecoder();
const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex');

export function createFakeGitHub(files, { repo = 'dhfolio/atlas-data', base = 'https://api.github.com' } = {}) {
  const blobs = new Map(); // sha → bytes
  const trees = new Map(); // sha → Map<path, blobSha>
  const commits = new Map(); // sha → { tree, parents, message }
  const calls = [];
  const faults = {};
  let head = null;

  const putBlob = (bytes) => {
    const sha = sha1(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), Buffer.from(bytes)]));
    blobs.set(sha, bytes);
    return sha;
  };
  const putTree = (map) => {
    const sorted = new Map([...map].sort(([a], [b]) => (a < b ? -1 : 1)));
    const sha = sha1(enc.encode(`tree ${JSON.stringify([...sorted])}`));
    trees.set(sha, sorted);
    return sha;
  };
  const putCommit = (tree, parents, message) => {
    const sha = sha1(enc.encode(`commit ${tree} ${parents.join(',')} ${message} ${commits.size}`));
    commits.set(sha, { tree, parents, message });
    return sha;
  };
  const toBytes = (v) => (typeof v === 'string' ? enc.encode(v) : v);

  const initial = new Map(Object.entries(files).map(([p, v]) => [p, putBlob(toBytes(v))]));
  head = putCommit(putTree(initial), [], 'initial');

  const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  async function fetch(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method, url, auth: init.headers?.Authorization || '', body });
    if (faults.offline) throw new TypeError('Failed to fetch');
    if (!url.startsWith(`${base}/`)) throw new Error(`fake-github: unexpected host ${url}`);
    if (faults.status) return reply(faults.status, { message: `fault ${faults.status}` }, faults.headers || {});
    const path = url.slice(base.length);
    const repoPrefix = `/repos/${repo}`;
    if (method === 'POST' && path === '/graphql') {
      if (faults.graphql === false) return reply(502, { message: 'graphql down' });
      const repository = {};
      for (const m of body.query.matchAll(/(f\d+): object\(expression: ("(?:[^"\\]|\\.)*")\)/g)) {
        const expr = JSON.parse(m[2]);
        const i = expr.indexOf(':');
        const commit = commits.get(expr.slice(0, i));
        const sha = commit && trees.get(commit.tree).get(expr.slice(i + 1));
        repository[m[1]] = sha ? { text: dec.decode(blobs.get(sha)), isBinary: false } : null;
      }
      return reply(200, { data: { repository } });
    }
    if (!path.startsWith(repoPrefix)) return reply(404, { message: 'Not Found' });
    const rest = path.slice(repoPrefix.length);
    let m;
    if (method === 'GET' && rest === '') return reply(200, { full_name: repo, private: true });
    if (rest === '/git/ref/heads/main' && method === 'GET') return reply(200, { ref: 'refs/heads/main', object: { sha: head, type: 'commit' } });
    if (rest === '/git/refs/heads/main' && method === 'PATCH') {
      if (faults.patchStatus) return reply(faults.patchStatus, { message: 'fault' });
      const next = commits.get(body.sha);
      if (!next) return reply(422, { message: 'Object does not exist' });
      if (!body.force && !next.parents.includes(head)) return reply(422, { message: 'Update is not a fast forward' });
      head = body.sha;
      return reply(200, { ref: 'refs/heads/main', object: { sha: head, type: 'commit' } });
    }
    if ((m = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET' && commits.has(m[1])) {
      return reply(200, { sha: m[1], tree: { sha: commits.get(m[1]).tree }, parents: commits.get(m[1]).parents.map((sha) => ({ sha })) });
    }
    if (rest === '/git/commits' && method === 'POST') {
      if (!trees.has(body.tree) || !body.parents.every((p) => commits.has(p))) return reply(422, { message: 'Tree or parent not found' });
      const sha = putCommit(body.tree, body.parents, body.message);
      return reply(201, { sha, tree: { sha: body.tree } });
    }
    if ((m = /^\/git\/trees\/([0-9a-f]{40})\?recursive=1$/.exec(rest)) && method === 'GET' && trees.has(m[1])) {
      const tree = [...trees.get(m[1])].map(([p, sha]) => ({ path: p, mode: '100644', type: 'blob', sha }));
      return reply(200, { sha: m[1], tree, truncated: false });
    }
    if (rest === '/git/trees' && method === 'POST') {
      const map = new Map(trees.get(body.base_tree) || []);
      for (const e of body.tree) {
        if (e.sha === null) {
          if (!map.has(e.path)) return reply(422, { message: `GitRPC::BadObjectState: ${e.path} does not exist` });
          map.delete(e.path);
        } else if (typeof e.content === 'string') {
          map.set(e.path, putBlob(enc.encode(e.content)));
        } else if (blobs.has(e.sha)) {
          map.set(e.path, e.sha);
        } else {
          return reply(422, { message: `blob ${e.sha} not found` });
        }
      }
      return reply(201, { sha: putTree(map) });
    }
    if (rest === '/git/blobs' && method === 'POST') {
      if (body.encoding !== 'base64') return reply(422, { message: 'expected base64' });
      return reply(201, { sha: putBlob(Uint8Array.from(Buffer.from(body.content, 'base64'))) });
    }
    if ((m = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET' && blobs.has(m[1])) {
      return reply(200, { sha: m[1], content: Buffer.from(blobs.get(m[1])).toString('base64'), encoding: 'base64' });
    }
    return reply(404, { message: 'Not Found' });
  }

  /** The files at the branch head, as text (binary files as Uint8Array). */
  function headFiles() {
    return new Map([...trees.get(commits.get(head).tree)].map(([p, sha]) => [p, p.startsWith('media/') ? blobs.get(sha) : dec.decode(blobs.get(sha))]));
  }

  /** Commit straight to the branch, as another device would. null deletes. */
  function remoteCommit(changes, message = 'remote edit') {
    const map = new Map(trees.get(commits.get(head).tree));
    for (const [p, v] of Object.entries(changes)) {
      if (v === null) map.delete(p);
      else map.set(p, putBlob(toBytes(v)));
    }
    head = putCommit(putTree(map), [head], message);
    return head;
  }

  return {
    fetch,
    calls,
    faults,
    headFiles,
    remoteCommit,
    get head() { return head; },
    commitMessages: () => {
      const out = [];
      for (let c = head; c; c = commits.get(c).parents[0]) out.push(commits.get(c).message);
      return out;
    },
    // compatibility with 2.1 tests
    get commitSha() { return head; },
  };
}
