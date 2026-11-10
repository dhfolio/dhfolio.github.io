import { createHash } from 'node:crypto';

const EXT = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'], ['image/svg+xml', 'svg']]);
const HTTP = /^https?:\/\//i;
const DATA_IMG = /data:image\//i;
const SENSITIVE = /^(email|google_?sub|token|password|secret)$/i;
export const MEDIA_NAME = /^[0-9a-f]{16}\.(jpg|png|webp|gif|svg)$/;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const len = (v) => (Array.isArray(v) ? v.length : 0);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const at = (path, key) =>
  typeof key === 'number' ? `${path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
const fail = (path, msg) => {
  throw new Error(`${path}: ${msg}`);
};

function isBase64(s) {
  const body = s.replace(/={1,2}$/, '');
  if (!body || /[^A-Za-z0-9+/]/.test(body)) return false;
  return body.length === s.length ? body.length % 4 !== 1 : s.length % 4 === 0;
}

export function decodeDataImage(url) {
  const comma = url.indexOf(',');
  const [mime, ...params] = url.slice(5, comma < 0 ? 80 : comma).toLowerCase().split(';');
  const ext = EXT.get(mime);
  if (!ext) throw new Error(`unsupported image type "${mime.slice(0, 40)}"`);
  const b64 = url.slice(comma + 1);
  if (comma < 0 || params.at(-1) !== 'base64' || !isBase64(b64)) throw new Error('data URL is not base64');
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
  return { name, bytes };
}

function scrub(v, path, media) {
  if (typeof v === 'string') {
    if (!/^data:image\//i.test(v)) return v;
    let img;
    try {
      img = decodeDataImage(v);
    } catch (e) {
      fail(path, e.message);
    }
    const key = `media/${img.name}`;
    const seen = media.get(key);
    if (seen && Buffer.compare(seen, img.bytes)) fail(path, `hash collision on ${key}`);
    media.set(key, img.bytes);
    return `/${key}`;
  }
  if (Array.isArray(v)) return v.map((x, i) => scrub(x, at(path, i), media));
  if (!isObj(v)) return v;
  // fromEntries defines own properties, so a "__proto__" key survives the copy
  return Object.fromEntries(
    Object.entries(v).map(([k, x]) => {
      if (k === 'notes' || k === 'sourceName') return [k, ''];
      if (k === 'pdfPath') return [k, typeof x === 'string' && HTTP.test(x) ? x : ''];
      return [k, scrub(x, at(path, k), media)];
    }),
  );
}

export function assertPublic(v, path = '$') {
  if (typeof v === 'string') {
    if (DATA_IMG.test(v)) fail(path, 'string still contains an inline data:image/ URL');
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => assertPublic(x, at(path, i)));
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      // reported on the parent path so the message does not echo the whole URL
      if (DATA_IMG.test(k)) fail(path, 'an object key contains an inline data:image/ URL');
      const p = at(path, k);
      if (SENSITIVE.test(k)) fail(p, 'sensitive key must not be published');
      if (k === 'pdfPath' && x !== '' && !(typeof x === 'string' && HTTP.test(x))) fail(p, 'pdfPath is not an http(s) URL');
      assertPublic(x, p);
    }
  }
}

const sortBy = (arr, ...keys) =>
  arr.sort((a, b) => {
    for (const k of keys) {
      const c = cmp(String(a?.[k]), String(b?.[k]));
      if (c) return c;
    }
    return cmp(JSON.stringify(a), JSON.stringify(b));
  });

export const statsOf = ({ profile, news, library, graphAll } = {}) => ({
  publications: len(profile?.publications),
  talks: len(profile?.talks),
  newsItems: len(news?.items),
  newsImages: len(news?.items) && news.items.reduce((n, it) => n + len(it?.images), 0),
  libraryPapers: len(library?.papers),
  graphAllNodes: len(graphAll?.nodes),
  graphAllEdges: len(graphAll?.edges),
});

export function shrinkProblems(next, prev = {}) {
  return ['publications', 'libraryPapers', 'newsItems'].flatMap((k) => {
    const was = prev[k] || 0;
    if (!next[k]) return [`${k} is 0${was ? ` (was ${was})` : ''}`];
    return next[k] * 10 < was * 7 ? [`${k} dropped ${was} -> ${next[k]} (below 70%)`] : [];
  });
}

// Owner-side state the public pages never read. It is public through the old API
// today, but a git history keeps it for good, so it is not published here.
const READING = { isRead: false, starred: false, pinned: false, status: '' };
const PROVENANCE = { sourceType: '', citationSource: '', updatedAt: '' };
const DATE = /^\d{4}-\d{2}-\d{2}/;
const blank = (item, fields) => {
  for (const [k, v] of Object.entries(fields)) if (k in item) item[k] = v;
};
const items = (list) => (Array.isArray(list) ? list.filter(isObj) : []);

function dropOwnerState(out) {
  for (const key of ['publications', 'posts', 'talks', 'recognitions']) {
    for (const it of items(out.profile[key])) blank(it, { ...READING, ...PROVENANCE, addedAt: '' });
  }
  for (const it of items(out.news.items)) blank(it, { addedAt: '', updatedAt: '' });
  for (const p of items(out.library.papers)) {
    Object.assign(p, READING);
    blank(p, PROVENANCE);
    // the public list sorts by "recently added": the day is enough for that
    if (typeof p.addedAt === 'string' && DATE.test(p.addedAt)) p.addedAt = p.addedAt.slice(0, 10);
  }
}

export const mediaRefs = (texts) =>
  new Set(texts.flatMap((t) => [...t.matchAll(/\/media\/([0-9a-f]{16}\.(?:jpg|png|webp|gif|svg))(?![\w.])/g)].map((m) => `media/${m[1]}`)));

export function publicize({ profile, news, library, graphs } = {}) {
  const media = new Map();
  const clean = (root, label, arrays) => {
    if (!isObj(root)) fail(label, 'expected an object');
    for (const k of arrays) if (!Array.isArray(root[k])) fail(`${label}.${k}`, 'expected an array');
    const out = scrub(root, label, media);
    assertPublic(out, label);
    return out;
  };
  const graph = (scope) => {
    const g = clean(graphs?.[scope], `graphs.${scope}`, ['nodes', 'edges']);
    sortBy(g.nodes, 'id');
    sortBy(g.edges, 'source', 'target');
    return g;
  };

  const out = {
    profile: clean(profile, 'profile', ['publications', 'talks']),
    news: clean(news, 'news', ['items']),
    library: clean(library, 'library', ['papers']),
    'graph-all': graph('all'),
    'graph-mine': graph('mine'),
    'graph-library': graph('library'),
  };
  dropOwnerState(out);

  return {
    json: Object.fromEntries(Object.entries(out).map(([name, v]) => [`data/public/${name}.json`, `${JSON.stringify(v, null, 1)}\n`])),
    media: Object.fromEntries([...media].sort(([a], [b]) => cmp(a, b))),
    stats: statsOf({ ...out, graphAll: out['graph-all'] }),
  };
}
