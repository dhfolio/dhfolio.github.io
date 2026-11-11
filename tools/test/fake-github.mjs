// In-memory stand-in for the slice of the GitHub API the owner engine uses.
// Read side for now (2.1): repo, ref, commit, recursive tree, blob, GraphQL blob text.
// Fault injection through `faults`: { offline, status, graphql: false }.
import { createHash } from 'node:crypto';

const enc = new TextEncoder();
const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex');

export function createFakeGitHub(files, { repo = 'dhfolio/atlas-data', base = 'https://api.github.com' } = {}) {
  const blobs = new Map(); // sha → bytes
  const tree = [];
  for (const [path, value] of Object.entries(files)) {
    const bytes = typeof value === 'string' ? enc.encode(value) : value;
    const sha = sha1(bytes);
    blobs.set(sha, bytes);
    tree.push({ path, type: 'blob', sha });
  }
  const treeSha = sha1(enc.encode(JSON.stringify(tree)));
  const commitSha = sha1(enc.encode(`commit ${treeSha}`));
  const byPath = new Map(tree.map((e) => [e.path, e.sha]));
  const calls = [];
  const faults = {};

  const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  async function fetch(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ method, url, auth: init.headers?.Authorization || '' });
    if (faults.offline) throw new TypeError('Failed to fetch');
    if (!url.startsWith(`${base}/`)) throw new Error(`fake-github: unexpected host ${url}`);
    if (faults.status) return reply(faults.status, { message: `fault ${faults.status}` });
    const path = url.slice(base.length);
    const repoPrefix = `/repos/${repo}`;
    if (method === 'POST' && path === '/graphql') {
      if (faults.graphql === false) return reply(502, { message: 'graphql down' });
      const query = JSON.parse(init.body).query;
      const repository = {};
      for (const m of query.matchAll(/(f\d+): object\(expression: ("(?:[^"\\]|\\.)*")\)/g)) {
        const expr = JSON.parse(m[2]);
        const [ref, p] = [expr.slice(0, expr.indexOf(':')), expr.slice(expr.indexOf(':') + 1)];
        const sha = ref === commitSha ? byPath.get(p) : null;
        repository[m[1]] = sha ? { text: new TextDecoder().decode(blobs.get(sha)), isBinary: false } : null;
      }
      return reply(200, { data: { repository } });
    }
    if (!path.startsWith(repoPrefix)) return reply(404, { message: 'Not Found' });
    const rest = path.slice(repoPrefix.length);
    if (method === 'GET' && rest === '') return reply(200, { full_name: repo, private: true });
    if (method === 'GET' && rest === '/git/ref/heads/main') return reply(200, { ref: 'refs/heads/main', object: { sha: commitSha, type: 'commit' } });
    if (method === 'GET' && rest === `/git/commits/${commitSha}`) return reply(200, { sha: commitSha, tree: { sha: treeSha } });
    if (method === 'GET' && rest === `/git/trees/${treeSha}?recursive=1`) return reply(200, { sha: treeSha, tree, truncated: false });
    const blob = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest);
    if (method === 'GET' && blob && blobs.has(blob[1])) {
      return reply(200, { sha: blob[1], content: Buffer.from(blobs.get(blob[1])).toString('base64'), encoding: 'base64' });
    }
    return reply(404, { message: 'Not Found' });
  }

  return { fetch, calls, faults, commitSha, treeSha };
}
