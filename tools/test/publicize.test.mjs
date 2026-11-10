import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { MEDIA_NAME, assertPublic, decodeDataImage, mediaRefs, publicize, shrinkProblems, statsOf } from '../lib/publicize.mjs';

const bytesA = Buffer.from('image-bytes-A');
const bytesB = Buffer.from('image-bytes-B!');
const dataUrl = (bytes, mime = 'image/png') => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const nameOf = (bytes, ext) => `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
const PNG_A = dataUrl(bytesA);
const JPG_B = dataUrl(bytesB, 'image/jpeg');

const paper = (over = {}) => ({ id: 'p1', title: 'T', pdfPath: '', starred: true, pinned: true, isRead: true, status: 'read', notes: 'private', sourceName: 'Zotero', ...over });

const fixture = () => ({
  profile: {
    slug: 'me',
    name: 'Me',
    picture: PNG_A,
    stats: { publications: 2 },
    publications: [paper({ id: 'a', pdfPath: '/uploads/x.pdf' }), paper({ id: 'b', pdfPath: 'https://x/y.pdf', extraLinks: [{ label: 'arXiv', url: 'http://arxiv.org/abs/1', notes: 'deep' }] })],
    posts: [],
    talks: [{ id: 't1', title: 'Talk', pdfPath: '../x.pdf', notes: 'talk note', sourceName: 'profile-manual', starred: true }],
    recognitions: [{ id: 'r1', title: 'Award', notes: 'rec note', detail: { notes: 'nested', sourceName: 's', keep: 'kept' } }],
    isPrivate: false,
  },
  news: {
    slug: 'me',
    isPrivate: false,
    items: [
      { id: 'n1', title: 'One', images: [{ src: PNG_A, caption: 'same as picture' }, { src: JPG_B, caption: 'b' }] },
      { id: 'n2', title: 'Two', images: [] },
      { id: 'n3', title: 'Three', images: [{ src: JPG_B, caption: 'dup' }] },
    ],
  },
  library: {
    slug: 'me',
    isPrivate: false,
    papers: [paper({ id: 'l1', pdfPath: 'HTTPS://cdn.example/z.pdf', meta: { status: 'inner', starred: true } }), paper({ id: 'l2', pdfPath: 'uploads/local.pdf' }), { id: 'l3', title: 'bare' }],
  },
  graphs: {
    all: {
      nodes: [{ id: 'p:b', notes: 'n' }, { id: 'p:a' }, { id: 'p:Z' }, { id: 'p:10' }, { id: 'p:9' }, { id: 'p:é' }],
      edges: [{ source: 'p:b', target: 'p:a' }, { source: 'p:a', target: 'p:b' }, { source: 'p:a', target: 'p:Z' }, { source: 'p:Z', target: 'p:b' }],
      scope: 'all',
      isPrivate: false,
    },
    mine: { nodes: [{ id: 'p:b' }, { id: 'p:a' }], edges: [], scope: 'mine' },
    library: { nodes: [], edges: [], scope: 'library' },
  },
});

const run = (input = fixture()) => {
  const res = publicize(input);
  const parsed = Object.fromEntries(Object.entries(res.json).map(([k, v]) => [k.slice('data/public/'.length, -'.json'.length), JSON.parse(v)]));
  return { ...res, ...parsed, all: parsed['graph-all'], mine: parsed['graph-mine'] };
};
const withProfile = (patch) => {
  const f = fixture();
  Object.assign(f.profile, patch);
  return f;
};
const deepFreeze = (v) => {
  if (v && typeof v === 'object') Object.values(v).forEach(deepFreeze);
  return Object.freeze(v);
};

test('returns the six json files, media and stats', () => {
  const { json, stats } = run();
  assert.deepEqual(Object.keys(json), ['profile', 'news', 'library', 'graph-all', 'graph-mine', 'graph-library'].map((n) => `data/public/${n}.json`));
  assert.deepEqual(stats, { publications: 2, talks: 1, newsItems: 3, newsImages: 3, libraryPapers: 3, graphAllNodes: 6, graphAllEdges: 4 });
});

test('notes and sourceName are blanked at every depth', () => {
  const { json, profile, all } = run();
  assert.equal(profile.publications[0].notes, '');
  assert.equal(profile.publications[0].sourceName, '');
  assert.equal(profile.publications[1].extraLinks[0].notes, '');
  assert.equal(profile.talks[0].notes, '');
  assert.equal(profile.talks[0].sourceName, '');
  assert.equal(profile.recognitions[0].notes, '');
  assert.deepEqual(profile.recognitions[0].detail, { notes: '', sourceName: '', keep: 'kept' });
  assert.equal(all.nodes.find((n) => n.id === 'p:b').notes, '');
  for (const text of Object.values(json)) assert.doesNotMatch(text, /private|Zotero|profile-manual|talk note|rec note|nested|deep/);
});

test('non-string notes are blanked too', () => {
  const { profile } = run(withProfile({ notes: { token: 'x' }, extra: { notes: null, sourceName: 7 } }));
  assert.equal(profile.notes, '');
  assert.deepEqual(profile.extra, { notes: '', sourceName: '' });
});

test('pdfPath survives only as an http(s) URL', () => {
  const { profile, library } = run();
  assert.equal(profile.publications[0].pdfPath, '');
  assert.equal(profile.publications[1].pdfPath, 'https://x/y.pdf');
  assert.equal(profile.talks[0].pdfPath, '');
  assert.equal(library.papers[0].pdfPath, 'HTTPS://cdn.example/z.pdf');
  assert.equal(library.papers[1].pdfPath, '');
  const variants = ['/uploads/x.pdf', '../x.pdf', 'C:\\docs\\x.pdf', 'file:///x.pdf', 'ftp://x/y.pdf', '//x/y.pdf', ' https://x/y.pdf', PNG_A, 'data:application/pdf;base64,AAAA', null, 5, { a: 1 }];
  const out = run(withProfile({ recognitions: variants.map((pdfPath) => ({ pdfPath })) })).profile.recognitions;
  assert.deepEqual(out, variants.map(() => ({ pdfPath: '' })));
  assert.equal(run(withProfile({ recognitions: [{ pdfPath: 'http://x/y.pdf' }] })).profile.recognitions[0].pdfPath, 'http://x/y.pdf');
});

test('reading state is reset on every listed item, never inside nested objects', () => {
  const { profile, library } = run();
  for (const p of [...library.papers, ...profile.publications]) assert.deepEqual([p.isRead, p.starred, p.pinned, p.status], [false, false, false, '']);
  assert.equal(profile.talks[0].starred, false);
  assert.deepEqual(library.papers[0].meta, { status: 'inner', starred: true });
  assert.deepEqual(Object.keys(library.papers[0]), [...Object.keys(paper()), 'meta']);
  // missing keys are added in the library only
  assert.deepEqual(Object.keys(library.papers[2]), ['id', 'title', 'isRead', 'starred', 'pinned', 'status']);
  assert.deepEqual(Object.keys(profile.talks[0]), ['id', 'title', 'pdfPath', 'notes', 'sourceName', 'starred']);
});

test('activity timestamps and provenance are blanked; the library keeps the added day only', () => {
  const f = fixture();
  const stamp = { addedAt: '2026-09-09T00:12:33.123Z', updatedAt: '2026-09-24T17:41:00Z', sourceType: 'metadata', citationSource: 'crossref' };
  Object.assign(f.profile.publications[0], stamp);
  Object.assign(f.profile.talks[0], stamp);
  Object.assign(f.profile.recognitions[0], stamp);
  f.profile.posts.push({ id: 'post', ...stamp });
  Object.assign(f.news.items[0], { addedAt: stamp.addedAt, updatedAt: stamp.updatedAt, sortDate: '2026-09-23' });
  Object.assign(f.library.papers[0], stamp);
  f.library.papers[1].addedAt = 'last week';
  const { profile, news, library, json } = run(f);
  for (const it of [profile.publications[0], profile.talks[0], profile.recognitions[0], profile.posts[0]]) {
    assert.deepEqual([it.addedAt, it.updatedAt, it.sourceType, it.citationSource], ['', '', '', '']);
  }
  assert.deepEqual([news.items[0].addedAt, news.items[0].updatedAt, news.items[0].sortDate], ['', '', '2026-09-23']);
  const l = library.papers[0];
  assert.deepEqual([l.addedAt, l.updatedAt, l.sourceType, l.citationSource], ['2026-09-09', '', '', '']);
  assert.equal(library.papers[1].addedAt, 'last week');
  assert.ok(!('addedAt' in profile.publications[1]));
  for (const text of Object.values(json)) assert.doesNotMatch(text, /T00:12|17:41|crossref|metadata/);
});

test('data URL images become deduplicated /media files', () => {
  const { media, profile, news, json } = run();
  const a = nameOf(bytesA, 'png');
  const b = nameOf(bytesB, 'jpg');
  assert.deepEqual(Object.keys(media), [`media/${a}`, `media/${b}`].sort());
  assert.ok(media[`media/${a}`] instanceof Uint8Array);
  assert.deepEqual(Buffer.from(media[`media/${a}`]), bytesA);
  assert.deepEqual(Buffer.from(media[`media/${b}`]), bytesB);
  assert.equal(profile.picture, `/media/${a}`);
  assert.deepEqual(news.items.flatMap((it) => it.images.map((im) => im.src)), [`/media/${a}`, `/media/${b}`, `/media/${b}`]);
  assert.equal(news.items[0].images[0].caption, 'same as picture');
  for (const text of Object.values(json)) assert.doesNotMatch(text, /data:image/i);
  for (const key of Object.keys(media)) assert.match(key.slice('media/'.length), MEDIA_NAME);
});

test('images are extracted wherever they appear, with the extension from the mime type', () => {
  const kinds = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
  const f = fixture();
  f.library.papers[0].thumbs = Object.keys(kinds).map((m) => dataUrl(bytesA, m));
  f.graphs.mine.nodes[0].icon = `DATA:Image/PNG;charset=utf-8;BASE64,${bytesB.toString('base64')}`;
  f.profile.deep = [[{ x: { y: dataUrl(Buffer.from('ab')) } }]];
  const { library, mine, profile, media } = run(f);
  assert.deepEqual(library.papers[0].thumbs, Object.values(kinds).map((ext) => `/media/${nameOf(bytesA, ext)}`));
  assert.equal(mine.nodes.find((n) => n.id === 'p:b').icon, `/media/${nameOf(bytesB, 'png')}`);
  assert.equal(profile.deep[0][0].x.y, `/media/${nameOf(Buffer.from('ab'), 'png')}`);
  assert.equal(Object.keys(media).length, 8);
});

test('decodeDataImage', () => {
  const { name, bytes } = decodeDataImage(PNG_A);
  assert.equal(name, nameOf(bytesA, 'png'));
  assert.deepEqual(Buffer.from(bytes), bytesA);
  assert.deepEqual(Buffer.from(decodeDataImage('data:image/png;base64,YWI').bytes), Buffer.from('ab'));
  assert.throws(() => decodeDataImage('data:image/constructor;base64,AAAA'), /unsupported image type/);
  assert.throws(() => decodeDataImage('data:image/png;charset=utf-8,AAAA'), /not base64/);
});

test('media keys come out sorted, whatever order the images were met in', () => {
  const imgs = ['x1', 'x2', 'x3', 'x4'].map((s) => Buffer.from(s));
  const byNameDesc = imgs.map((b) => [nameOf(b, 'png'), b]).sort(([a], [b]) => (a < b ? 1 : -1));
  const f = fixture();
  f.profile.gallery = byNameDesc.map(([, b]) => dataUrl(b));
  const keys = Object.keys(publicize(f).media);
  assert.equal(keys.length, 6);
  assert.deepEqual(keys, [...keys].sort());
});

test('graph nodes and edges are sorted by code units', () => {
  const { all, mine } = run();
  assert.deepEqual(all.nodes.map((n) => n.id), ['p:10', 'p:9', 'p:Z', 'p:a', 'p:b', 'p:é']);
  assert.deepEqual(all.edges, [{ source: 'p:Z', target: 'p:b' }, { source: 'p:a', target: 'p:Z' }, { source: 'p:a', target: 'p:b' }, { source: 'p:b', target: 'p:a' }]);
  assert.deepEqual(mine.nodes.map((n) => n.id), ['p:a', 'p:b']);
  assert.deepEqual(Object.keys(all), ['nodes', 'edges', 'scope', 'isPrivate']);
  // target decides between edges that share a source, before any other field
  const f = fixture();
  f.graphs.mine.edges = [{ w: 1, source: 'a', target: 'c' }, { w: 2, source: 'a', target: 'b' }];
  assert.deepEqual(run(f).mine.edges.map((e) => e.target), ['b', 'c']);
});

test('graph output does not depend on the order received', () => {
  const f = fixture();
  f.graphs.all.nodes.push({ id: 'p:a', title: 'dup' });
  const g = structuredClone(f);
  g.graphs.all.nodes.reverse();
  g.graphs.all.edges.reverse();
  assert.equal(publicize(g).json['data/public/graph-all.json'], publicize(f).json['data/public/graph-all.json']);
});

test('serialises with one-space indent, trailing newline and the key order received', () => {
  const { json } = run();
  const text = json['data/public/graph-library.json'];
  assert.equal(text, '{\n "nodes": [],\n "edges": [],\n "scope": "library"\n}\n');
  const profile = JSON.parse(json['data/public/profile.json']);
  assert.equal(json['data/public/profile.json'], `${JSON.stringify(profile, null, 1)}\n`);
  assert.deepEqual(Object.keys(profile), Object.keys(fixture().profile));
  assert.deepEqual(Object.keys(profile.publications[0]), Object.keys(paper()));
});

test('is deterministic', () => {
  const a = publicize(fixture());
  const b = publicize(fixture());
  assert.deepEqual(a.json, b.json);
  assert.deepEqual(a.media, b.media);
  assert.deepEqual(a.stats, b.stats);
});

test('does not mutate its input', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  publicize(deepFreeze(input));
  assert.equal(JSON.stringify(input), before);
});

test('throws when a string still embeds a data:image URL', () => {
  assert.throws(() => publicize(withProfile({ about: `<img src="${PNG_A}">` })), /^Error: profile\.about: .*data:image/);
  const f = fixture();
  f.news.items[1].body = ` ${PNG_A}`;
  assert.throws(() => publicize(f), /^Error: news\.items\[1\]\.body: /);
  f.news.items[1].body = 'see Data:Image/png;base64,AAAA';
  assert.throws(() => publicize(f), /^Error: news\.items\[1\]\.body: /);
});

test('throws on sensitive keys, naming the path', () => {
  for (const key of ['email', 'Email', 'googleSub', 'google_sub', 'GOOGLE_SUB', 'token', 'password', 'secret']) {
    const f = fixture();
    f.library.papers[1].owner = { [key]: 'x' };
    assert.throws(() => publicize(f), new RegExp(`^Error: library\\.papers\\[1\\]\\.owner\\.${key}: sensitive key`), key);
  }
  const g = fixture();
  g.graphs.mine.nodes[1]['e-mail'] = { token: null };
  assert.throws(() => publicize(g), /^Error: graphs\.mine\.nodes\[1\]\["e-mail"\]\.token: /);
  for (const key of ['emailVerified', 'tokens', 'secretSauce', 'subtitle']) assert.doesNotThrow(() => publicize(withProfile({ [key]: 'x' })), key);
});

test('throws on unsupported image types', () => {
  for (const mime of ['image/bmp', 'image/tiff', 'image/jpg', 'image/x-icon']) {
    assert.throws(() => publicize(withProfile({ picture: dataUrl(bytesA, mime) })), /^Error: profile\.picture: unsupported image type/, mime);
  }
});

test('throws on data URLs that are not base64', () => {
  for (const url of ['data:image/svg+xml;utf8,<svg/>', 'data:image/svg+xml,%3Csvg%2F%3E', 'data:image/png;base64,', 'data:image/png;base64,@@@@', 'data:image/png;base64,AAA A', 'data:image/png;base64,AAAAA', 'data:image/png;base64,AA=A', 'data:image/png;base64']) {
    const f = fixture();
    f.news.items[0].images[1].src = url;
    assert.throws(() => publicize(f), /^Error: news\.items\[0\]\.images\[1\]\.src: data URL is not base64/, url);
  }
});

test('throws when a payload has the wrong shape', () => {
  assert.throws(() => publicize({ ...fixture(), news: null }), /^Error: news: expected an object/);
  assert.throws(() => publicize({ ...fixture(), library: { detail: 'Not found' } }), /^Error: library\.papers: expected an array/);
  assert.throws(() => publicize({ ...fixture(), graphs: { all: fixture().graphs.all } }), /^Error: graphs\.mine: expected an object/);
  assert.throws(() => publicize(withProfile({ publications: {} })), /^Error: profile\.publications: expected an array/);
});

test('assertPublic rejects what must never be published', () => {
  assert.doesNotThrow(() => assertPublic({ a: [{ pdfPath: '' }, { pdfPath: 'https://x/y.pdf' }], picture: '/media/0123456789abcdef.png' }));
  assert.throws(() => assertPublic({ a: [{ pdfPath: '/uploads/x.pdf' }] }, 'x'), /^Error: x\.a\[0\]\.pdfPath: pdfPath is not an http\(s\) URL/);
  assert.throws(() => assertPublic({ pdfPath: '../x.pdf' }), /^Error: \$\.pdfPath: /);
  assert.throws(() => assertPublic({ pdfPath: null }), /^Error: \$\.pdfPath: /);
  assert.throws(() => assertPublic([{ src: PNG_A }], 'n'), /^Error: n\[0\]\.src: .*data:image/);
  assert.throws(() => assertPublic({ user: { password: '' } }), /^Error: \$\.user\.password: sensitive key/);
  assert.throws(() => assertPublic({ a: { 'data:image/png;base64,eA==': 1 } }), /^Error: \$\.a: an object key contains an inline data:image/);
});

test('statsOf tolerates missing payloads', () => {
  assert.deepEqual(statsOf({}), { publications: 0, talks: 0, newsItems: 0, newsImages: 0, libraryPapers: 0, graphAllNodes: 0, graphAllEdges: 0 });
  assert.equal(statsOf({ news: { items: [{ images: [1, 2] }, {}, { images: [3] }] } }).newsImages, 3);
});

test('shrinkProblems flags empty or shrunken collections', () => {
  const ok = { publications: 61, libraryPapers: 189, newsItems: 23 };
  assert.deepEqual(shrinkProblems(ok), []);
  assert.deepEqual(shrinkProblems(ok, ok), []);
  assert.deepEqual(shrinkProblems({ ...ok, publications: 7 }, { ...ok, publications: 10 }), []);
  assert.equal(shrinkProblems({ ...ok, publications: 6 }, { ...ok, publications: 10 }).length, 1);
  assert.deepEqual(shrinkProblems({ ...ok, newsItems: 16 }, ok), ['newsItems dropped 23 -> 16 (below 70%)']);
  assert.deepEqual(shrinkProblems({ ...ok, newsItems: 17 }, ok), []);
  assert.deepEqual(shrinkProblems({ ...ok, libraryPapers: 0 }), ['libraryPapers is 0']);
  assert.deepEqual(shrinkProblems({ ...ok, libraryPapers: 0 }, ok), ['libraryPapers is 0 (was 189)']);
  assert.equal(shrinkProblems({ publications: 0, libraryPapers: 0, newsItems: 0 }).length, 3);
  assert.deepEqual(shrinkProblems({ ...ok, talks: 0, graphAllNodes: 0 }, { ...ok, talks: 26, graphAllNodes: 224 }), []);
});

test('mediaRefs finds the media files a json text points at', () => {
  const { json, media } = run();
  assert.deepEqual([...mediaRefs(Object.values(json))].sort(), Object.keys(media));
  assert.deepEqual([...mediaRefs(['"https://h/media/0123456789abcdef.webp" "/media/notahash.png" "/media/0123456789abcdef.webp.bak" "/media/0123456789ABCDEF.png"'])], ['media/0123456789abcdef.webp']);
  assert.equal(mediaRefs(['"/media/0123456789abcdef.webp.bak"']).size, 0);
});
