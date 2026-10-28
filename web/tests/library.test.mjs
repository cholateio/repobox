import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStem, stemOf, mergeLibrary, specRows, ghRaw, loadIndex, STATE_TEXT } from '../lib/library.mjs';

const CFG = { repo: 'me/lib', token: 'tok' };
const fakeFetch = (routes) => async (url, opts) => {
  fakeFetch.calls.push({ url, opts });
  const r = routes[url.replace('https://api.github.com/repos/me/lib', '')];
  if (r === 'net') throw new TypeError('network');
  if (!r) return new Response('{"message":"Not Found"}', { status: 404 });
  return new Response(r.body ?? '', { status: r.status });
};
fakeFetch.calls = [];

test('parseStem accepts safe stems and rejects everything else', () => {
  assert.equal(parseStem('#owner__repo'), 'owner__repo');
  assert.equal(parseStem('#a-b__c.d'), 'a-b__c.d');
  for (const bad of ['#../x', '#a/b', '#A__B', '', '#', '#%E0%A4%A', '#' + 'a'.repeat(100) + '__' + 'b'.repeat(100), '#no-separator']) {
    assert.equal(parseStem(bad), null, bad);
  }
});

test('stemOf takes the stem from a library md path', () => {
  assert.equal(stemOf('library/owner__repo.md'), 'owner__repo');
  assert.equal(stemOf('library/../x.md'), null);
  assert.equal(stemOf('README.md'), null);
});

const INDEX = { entries: [
  { repo: 'Old/One', md: 'library/old__one.md', intro: 'i1', category: 'other', last_seen: '2026-10-01T00:00:00+00:00' },
  { repo: 'New/Two', md: 'library/new__two.md', intro: 'i2', category: 'dev-tool', last_seen: '2026-10-09T00:00:00+08:00' },
  { repo: 'Bad/Path', md: 'library/../evil.md', intro: 'x', category: 'other', last_seen: '2026-10-10T00:00:00+00:00' },
] };

test('mergeLibrary orders entries and puts unindexed pending/failed first', () => {
  const history = [
    { id: 'p1', repo: 'Fresh/Repo', lib: 'me/lib', at: '2026-10-19T01:00:00Z', state: 'pending' },
    { id: 'f1', repo: 'Broken/Repo', lib: 'me/lib', at: '2026-10-19T02:00:00Z', state: 'failed' },
    { id: 'p2', repo: 'new/two', lib: 'me/lib', at: '2026-10-19T03:00:00Z', state: 'pending' },
    { id: 'd1', repo: 'Done/Repo', lib: 'me/lib', at: '2026-10-19T04:00:00Z', state: 'done' },
    { id: 'o1', repo: 'Other/Lib', lib: 'someone/else', at: '2026-10-19T05:00:00Z', state: 'pending' },
  ];
  const items = mergeLibrary(INDEX, history, 'me/lib');
  assert.deepEqual(items.map((i) => i.kind + ':' + (i.stem || i.id)), ['failed:f1', 'pending:p1', 'entry:new__two', 'entry:old__one']);
});

test('mergeLibrary with no index still lists local pending items', () => {
  const items = mergeLibrary(null, [{ id: 'p1', repo: 'A/B', lib: 'me/lib', at: '2026-10-19T00:00:00Z', state: 'pending' }], 'me/lib');
  assert.deepEqual(items.map((i) => i.kind), ['pending']);
});

test('specRows splits labelled requirement lines', () => {
  assert.deepEqual(specRows(['平台：Windows', '費用: 免費', '不需安裝']), [['平台', 'Windows'], ['費用', '免費'], [null, '不需安裝']]);
});

test('ghRaw sends the raw accept header and reports status', async () => {
  fakeFetch.calls = [];
  const f = fakeFetch({ '/contents/library/a__b.json': { status: 401, body: '{}' } });
  const r = await ghRaw(CFG, 'library/a__b.json', f);
  assert.equal(r.status, 401);
  const { url, opts } = fakeFetch.calls[0];
  assert.equal(url, 'https://api.github.com/repos/me/lib/contents/library/a__b.json');
  assert.equal(opts.headers.Authorization, 'Bearer tok');
  assert.equal(opts.headers.Accept, 'application/vnd.github.raw+json');
  assert.equal(opts.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.deepEqual(await ghRaw(CFG, 'x', fakeFetch({ '/contents/x': 'net' })), { status: 0, text: null });
});

test('loadIndex maps every outcome to a state', async () => {
  const idx = (status, body) => ({ '/contents/index.json': { status, body } });
  const cases = [
    [idx(200, JSON.stringify(INDEX)), 'ok'],
    [idx(200, '{broken'), 'bad-data'],
    [idx(200, '{"entries": {}}'), 'bad-data'],
    [idx(401), 'auth'], [idx(403), 'auth'], [idx(503), 'unavailable'], [{ '/contents/index.json': 'net' }, 'unavailable'],
    [{ '': { status: 200, body: '{}' } }, 'empty'],
    [{}, 'no-repo'],
    [{ '': { status: 401 } }, 'auth'], [{ '': { status: 403 } }, 'auth'],
    [{ '': { status: 429 } }, 'unavailable'], [{ '': { status: 503 } }, 'unavailable'], [{ '': 'net' }, 'unavailable'],
  ];
  for (const [routes, want] of cases) {
    const got = await loadIndex(CFG, fakeFetch(routes));
    assert.equal(got.state, want, JSON.stringify(routes));
    assert.ok(STATE_TEXT[got.state] || got.state === 'ok');
  }
});

test('mergeLibrary drops malformed index entries instead of throwing', () => {
  const index = { entries: [null, 5, 'x', { repo: 3, md: 'library/a__b.md' }, { repo: 'A/B', md: 7 }, ...INDEX.entries] };
  const items = mergeLibrary(index, [], 'me/lib');
  assert.deepEqual(items.map((i) => i.stem), ['new__two', 'old__one']);
});

test('badges pull platform and cost hints from requirement lines', async () => {
  const { badges } = await import('../lib/library.mjs');
  assert.deepEqual(badges(['平台：Windows 10 或 11（64 位元），需要網路連線', '需要準備：自己的 AI 服務金鑰', '費用：程式免費，AI 服務依用量計費']), ['Windows', '需付模型費']);
  assert.deepEqual(badges(['平台：macOS（Apple Silicon 或 Intel）或 Windows（x64 或 ARM）', '費用：軟體免費開源（MIT），使用一般 ChatGPT 對話額度']), ['macOS', 'Windows', '免費']);
  assert.deepEqual(badges(['平台：Windows、macOS、Linux 都可以', '費用：免費']), ['跨平台', '免費']);
  assert.deepEqual(badges(['平台：任何現代瀏覽器', '費用：需要訂閱 Pro 方案']), ['網頁', '訂閱']);
  assert.deepEqual(badges(['不需安裝']), ['不需安裝']);
  assert.deepEqual(badges(['平台：Windows', '限制：只在 Linux 測過，免費版有次數上限']), ['Windows']);
  assert.deepEqual(badges(['費用：本身免費開源（MIT），模型使用費依你的 AI 服務方案計算']), ['需付模型費']);
  assert.deepEqual(badges([]), []);
  assert.deepEqual(badges(null), []);
});

test('mergeLibrary passes tagline and requirements through, typed', () => {
  const idx = { entries: [{ repo: 'A/B', md: 'library/a__b.md', tagline: '一句副標', requirements: ['平台：Windows', 5], intro: 'i', category: 'x', last_seen: '2026-10-19T00:00:00Z' },
    { repo: 'C/D', md: 'library/c__d.md', tagline: 7, requirements: 'nope', last_seen: '2026-10-18T00:00:00Z' }] };
  const [ab, cd] = mergeLibrary(idx, [], 'me/lib');
  assert.equal(ab.tagline, '一句副標');
  assert.deepEqual(ab.requirements, ['平台：Windows']);
  assert.equal(cd.tagline, '');
  assert.deepEqual(cd.requirements, []);
});

test('badges respect negation', async () => {
  const { badges } = await import('../lib/library.mjs');
  assert.deepEqual(badges(['費用：完全免費，不需訂閱']), ['免費']);
  assert.deepEqual(badges(['費用：免費，不按用量計費']), ['免費']);
  assert.deepEqual(badges(['平台：不支援 Windows，僅支援 Linux']), ['Linux']);
  assert.deepEqual(badges(['平台：無法在 macOS 執行，需要 Windows']), ['Windows']);
});

test('categoryLabel never returns inherited object members', async () => {
  const { categoryLabel } = await import('../lib/library.mjs');
  assert.equal(categoryLabel('mcp-server'), 'MCP 伺服器');
  assert.equal(categoryLabel('constructor'), 'constructor');
  assert.equal(categoryLabel('toString'), 'toString');
  assert.equal(categoryLabel('__proto__'), '__proto__');
  assert.equal(categoryLabel(''), '');
});

test('affirmative 無論/不論/不只 are not negations', async () => {
  const { badges } = await import('../lib/library.mjs');
  assert.deepEqual(badges(['平台：無論 Windows、macOS 或 Linux 都可使用']), ['跨平台']);
  assert.deepEqual(badges(['平台：不論 Windows 或 macOS 都能跑']), ['Windows', 'macOS']);
  assert.deepEqual(badges(['平台：不只 Windows，也支援 Linux']), ['Windows', 'Linux']);
  assert.deepEqual(badges(['平台：不管 macOS 還是 Windows 都行']), ['macOS', 'Windows']);
});

const README = '# RepoBox 收藏庫\n\n2 個 repo · 更新 2026-10-19\n\n## 最近收藏\n\n- [New/Two](library/new__two.md) ⭐ 3\n- [Old/One](library/old__one.md) ⭐ 1\n\n## 分類\n\n### other\n\n- [Old/One](library/old__one.md) ⭐ 1\n';

test('withoutEntry and readmeWithout drop exactly one entry', async () => {
  const { withoutEntry, readmeWithout } = await import('../lib/library.mjs');
  const out = JSON.parse(withoutEntry(JSON.stringify({ generated_at: 'x', count: 3, entries: INDEX.entries }), 'old__one'));
  assert.deepEqual(out.entries.map((e) => e.repo), ['New/Two', 'Bad/Path']);
  assert.equal(out.count, 2);
  const rd = readmeWithout(README, 'old__one', 1);
  assert.ok(!rd.includes('old__one') && rd.includes('[New/Two](library/new__two.md)') && rd.includes('\n1 個 repo'));
});

const gitFake = (refMoves = 0) => {
  const calls = [];
  let moves = refMoves;
  const fetchImpl = async (url, opts = {}) => {
    const path = url.replace('https://api.github.com/repos/me/lib', '');
    const method = opts.method || 'GET';
    calls.push({ method, path, body: opts.body ? JSON.parse(opts.body) : null });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (method === 'GET' && path === '') return json({ default_branch: 'main' });
    if (path === '/git/ref/heads/main') return json({ object: { sha: 'c1' } });
    if (path === '/git/commits/c1') return json({ tree: { sha: 't1' } });
    if (path === '/git/trees/t1') return json({ tree: [{ path: 'library', type: 'tree', sha: 'l1' }] });
    if (path === '/git/trees/l1') return json({ tree: [{ path: 'old__one.md' }, { path: 'old__one.json' }, { path: 'new__two.md' }] });
    if (path === '/contents/index.json?ref=c1') return new Response(JSON.stringify(INDEX), { status: 200 });
    if (path === '/contents/README.md?ref=c1') return new Response(README, { status: 200 });
    if (path === '/git/trees') return json({ sha: 't2' }, 201);
    if (path === '/git/commits') return json({ sha: 'c2' }, 201);
    if (path === '/git/refs/heads/main') return moves-- > 0 ? json({ message: 'not fast forward' }, 422) : json({});
    return json({ message: 'Not Found' }, 404);
  };
  return { calls, fetchImpl };
};

test('removeEntry deletes the existing files and rewrites index and README in one commit', async () => {
  const { removeEntry } = await import('../lib/library.mjs');
  const g = gitFake();
  assert.equal(await removeEntry(CFG, 'old__one', 'Old/One', g.fetchImpl), 'ok');
  const tree = g.calls.find((c) => c.path === '/git/trees').body;
  assert.equal(tree.base_tree, 't1');
  assert.deepEqual(tree.tree.filter((t) => t.sha === null).map((t) => t.path), ['library/old__one.md', 'library/old__one.json']);
  const idx = JSON.parse(tree.tree.find((t) => t.path === 'index.json').content);
  assert.ok(!idx.entries.some((e) => e.md === 'library/old__one.md'));
  assert.ok(!tree.tree.find((t) => t.path === 'README.md').content.includes('old__one'));
  assert.deepEqual(g.calls.find((c) => c.path === '/git/commits').body.parents, ['c1']);
  assert.deepEqual(g.calls.find((c) => c.method === 'PATCH').body, { sha: 'c2', force: false });
});

test('removeEntry retries when the branch moved and gives up after three tries', async () => {
  const { removeEntry } = await import('../lib/library.mjs');
  const once = gitFake(1);
  assert.equal(await removeEntry(CFG, 'old__one', 'Old/One', once.fetchImpl), 'ok');
  assert.equal(once.calls.filter((c) => c.method === 'PATCH').length, 2);
  await assert.rejects(removeEntry(CFG, 'old__one', 'Old/One', gitFake(5).fetchImpl), (e) => e.status === 409);
});

test('removeEntry reports gone when nothing is left and refuses bad stems', async () => {
  const { removeEntry } = await import('../lib/library.mjs');
  const g = gitFake();
  assert.equal(await removeEntry(CFG, 'nobody__here', 'x', g.fetchImpl), 'gone');
  assert.ok(!g.calls.some((c) => c.method !== 'GET'));
  await assert.rejects(removeEntry(CFG, '../x', 'x', g.fetchImpl), (e) => e.status === 400);
});

test('removeEntry commits nothing when index.json or README.md cannot be read', async () => {
  const { removeEntry } = await import('../lib/library.mjs');
  for (const path of ['/contents/index.json?ref=c1', '/contents/README.md?ref=c1']) {
    const g = gitFake();
    const inner = g.fetchImpl;
    g.fetchImpl = async (url, opts) => (url.endsWith(path) ? new Response('{}', { status: 502 }) : inner(url, opts));
    await assert.rejects(removeEntry(CFG, 'old__one', 'Old/One', g.fetchImpl), (e) => e.status === 502, path);
    assert.ok(!g.calls.some((c) => c.method !== 'GET'), path);
  }
});

test('removeEntry finishes a half-done removal and encodes the branch', async () => {
  const { removeEntry } = await import('../lib/library.mjs');
  const g = gitFake();
  const inner = g.fetchImpl;
  g.fetchImpl = async (url, opts) => {
    const u = url.replace('/heads/release%231', '/heads/main');
    if (url.endsWith('/repos/me/lib')) return new Response(JSON.stringify({ default_branch: 'release#1' }), { status: 200 });
    return inner(u, opts);
  };
  assert.equal(await removeEntry(CFG, 'bad__path', 'Bad/Path', g.fetchImpl), 'gone');
  const g2 = gitFake();
  assert.equal(await removeEntry(CFG, 'new__two', 'New/Two', g2.fetchImpl), 'ok');
  const tree = g2.calls.find((c) => c.path === '/git/trees').body.tree;
  assert.deepEqual(tree.map((t) => t.path), ['library/new__two.md', 'index.json', 'README.md']);
  const ghost = gitFake();
  const base = ghost.fetchImpl;
  ghost.fetchImpl = async (url, opts) => (url.endsWith('/git/trees/l1') ? new Response(JSON.stringify({ tree: [] }), { status: 200 }) : base(url, opts));
  assert.equal(await removeEntry(CFG, 'old__one', 'Old/One', ghost.fetchImpl), 'ok');
  assert.deepEqual(ghost.calls.find((c) => c.path === '/git/trees').body.tree.map((t) => t.path), ['index.json', 'README.md']);
});

test('removeEntry repairs README links and count when index.json already dropped the entry', async () => {
  const { removeEntry } = await import('../lib/library.mjs');
  const g = gitFake();
  const inner = g.fetchImpl;
  const idx = { entries: INDEX.entries.filter((e) => e.md !== 'library/old__one.md') };
  g.fetchImpl = async (url, opts) => {
    if (url.endsWith('/git/trees/l1')) return new Response(JSON.stringify({ tree: [] }), { status: 200 });
    if (url.endsWith('/contents/index.json?ref=c1')) return new Response(JSON.stringify(idx), { status: 200 });
    return inner(url, opts);
  };
  assert.equal(await removeEntry(CFG, 'old__one', 'Old/One', g.fetchImpl), 'ok');
  const tree = g.calls.find((c) => c.path === '/git/trees').body.tree;
  assert.deepEqual(tree.map((t) => t.path), ['README.md']);
  assert.ok(!tree[0].content.includes('old__one') && tree[0].content.includes('\n2 個 repo'));
});

test('removeEntry leaves the README count alone when index.json has no entries array', async () => {
  const { removeEntry } = await import('../lib/library.mjs');
  for (const body of ['{"count":2}', '{"entries":null}', 'not json']) {
    const g = gitFake();
    const inner = g.fetchImpl;
    g.fetchImpl = async (url, opts) => (url.endsWith('/contents/index.json?ref=c1') ? new Response(body, { status: 200 }) : inner(url, opts));
    assert.equal(await removeEntry(CFG, 'old__one', 'Old/One', g.fetchImpl), 'ok', body);
    const tree = g.calls.find((c) => c.path === '/git/trees').body.tree;
    assert.ok(!tree.some((t) => t.path === 'index.json'), body);
    const rd = tree.find((t) => t.path === 'README.md').content;
    assert.ok(!rd.includes('old__one') && rd.includes('\n2 個 repo'), body);
  }
});

test('reanalyze dispatches the library workflow on the default branch with the repo url', async () => {
  const { reanalyze } = await import('../lib/library.mjs');
  const calls = [];
  const fetchFor = (status) => async (url, opts = {}) => {
    const path = url.replace('https://api.github.com/repos/me/lib', '');
    calls.push({ method: opts.method || 'GET', path, body: opts.body ? JSON.parse(opts.body) : null });
    if (path === '') return new Response(JSON.stringify({ default_branch: 'trunk' }), { status: 200 });
    return new Response(status === 204 ? null : '{"message":"Resource not accessible by personal access token"}', { status });
  };
  await reanalyze(CFG, 'https://github.com/Owner/Repo', fetchFor(204));
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.path, '/actions/workflows/repobox.yml/dispatches');
  assert.deepEqual(post.body, { ref: 'trunk', inputs: { url: 'https://github.com/Owner/Repo' } });
  await assert.rejects(reanalyze(CFG, 'https://github.com/Owner/Repo', fetchFor(403)), (e) => e.status === 403);
  calls.length = 0;
  await assert.rejects(reanalyze(CFG, 'https://evil.example/Owner/Repo', fetchFor(204)), (e) => e.status === 400);
  assert.equal(calls.length, 0);
});
