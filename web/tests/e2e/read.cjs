// Reading page: one-screen desktop layout, phone layout, error and legacy states, rejected SVGs.
// Run: PW_CORE=/path/to/playwright-core node web/tests/e2e/read.cjs   (exit 1 on any mismatch)
const { chromium } = require(process.env.PW_CORE || 'playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const serve = require('./serve.cjs');
const FX = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const ENTRY = FX('entry.json'), SVG = FX('entry.svg'), INDEX = FX('index.json');
const STEM = 'xiaopuouo__openchatx-mcp';
const SHOTS = process.env.SHOTS || '';

(async () => {
  const { base: B, close } = await serve();
  const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {});
  const failures = [];
  const expect = (label, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond ? '' : ` — ${detail}`}`); if (!cond) failures.push(label); };
  const open = async ({ vp = { width: 1440, height: 900 }, scheme = 'light', hash = `#${STEM}`, routes = {} } = {}) => {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, isMobile: vp.width < 600, hasTouch: vp.width < 600 });
    const calls = []; const errors = [];
    const table = { [`/contents/library/${STEM}.json`]: { status: 200, body: ENTRY }, [`/contents/library/${STEM}.svg`]: { status: 200, body: SVG },
      '/contents/index.json': { status: 200, body: INDEX }, '': { status: 200, body: '{}' }, ...routes };
    await ctx.route('https://api.github.com/**', (r) => {
      const u = r.request().url().replace('https://api.github.com/repos/me/lib', ''); calls.push(u);
      const hit = table[u] || { status: 404, body: '{"message":"Not Found"}' };
      return r.fulfill({ status: hit.status, contentType: 'application/json', body: hit.body });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/40[134]|503/.test(m.text())) errors.push(m.text()); });
    await page.goto(B);
    await page.evaluate(() => localStorage.setItem('repobox.cfg', JSON.stringify({ repo: 'me/lib', token: 't', nonce: 'n' })));
    calls.length = 0;
    await page.goto(`${B}read.html${hash}`);
    await page.waitForTimeout(2600);
    return { ctx, page, calls, errors };
  };
  const done = async (label, o, shot) => {
    if (SHOTS && shot) await o.page.screenshot({ path: path.join(SHOTS, `${shot}.png`) });
    expect(`${label}: no page errors`, o.errors.length === 0, o.errors.join(' | '));
    await o.ctx.close();
  };
  const metrics = (page) => page.evaluate(() => {
    const col = document.querySelector('.col');
    return { sh: document.documentElement.scrollHeight, h: innerHeight, sw: document.documentElement.scrollWidth, w: innerWidth,
      colOver: col ? col.scrollHeight - col.clientHeight : null, nodes: document.querySelectorAll('.fig svg.dia .node').length,
      gutter: getComputedStyle(document.querySelector('.view')).paddingLeft };
  });

  let o = await open();
  let m = await metrics(o.page);
  expect('(a) 1440x900 fits one screen', m.sh === m.h && m.colOver <= 0, JSON.stringify(m));
  expect('(a) diagram inlined with nodes', m.nodes > 0, JSON.stringify(m));
  expect('(a) title is the repo', (await o.page.title()).startsWith('XiaoPuOuO/openchatx-mcp'), await o.page.title());
  expect('(a) tagline under the repo name', (await o.page.textContent('.tblock .sub').catch(() => '')) === '用 ChatGPT 直接操作你的電腦', 'missing');
  const lay = await o.page.evaluate(() => ({ bar: document.querySelector('.tblock').getBoundingClientRect().height,
    panel: document.querySelector('.more').getBoundingClientRect().height, clipped: (() => { const p = document.querySelector('.panel'); return p.scrollHeight - p.clientHeight; })(), egs: [...document.querySelectorAll('.eg')].filter((e) => e.offsetParent).length,
    back: !!document.querySelector('a.back') && !document.querySelector('.tblock a.back'),
    cells: [...document.querySelectorAll('.tblock .cell .lbl')].map((l) => l.textContent) }));
  expect('(a) top bar is one row, back link outside it, no 語言', lay.bar <= 56 && lay.back && !lay.cells.includes('語言'), JSON.stringify(lay));
  expect('(a) tab box has room (>= 200px) and its content is not cut off', lay.panel >= 200 && lay.clipped <= 0, JSON.stringify(lay));
  expect('(a) only the first example, no more-examples button', lay.egs === 1 && (await o.page.locator('button.more-eg').count()) === 0, JSON.stringify(lay));
  await o.page.click('.fig'); await o.page.waitForTimeout(400);
  expect('(h) clicking the figure opens the lightbox', await o.page.isVisible('#lightbox'), 'hidden');
  await o.page.locator('#lightbox g.node').nth(4).click(); await o.page.waitForTimeout(200);
  expect('(h) tapping a node lights its links', (await o.page.locator('#lightbox .lit').count()) > 1, 'no .lit');
  await o.page.keyboard.press('Escape'); await o.page.waitForTimeout(200);
  expect('(h) Esc closes the lightbox', !(await o.page.isVisible('#lightbox')), 'still open');
  await done('(a)', o, 'read-1440');

  o = await open({ vp: { width: 1280, height: 720 } }); m = await metrics(o.page);
  expect('(b) 1280x720 page does not scroll', m.sh === m.h, JSON.stringify(m));
  await done('(b)', o, 'read-1280x720');

  o = await open({ vp: { width: 390, height: 844 } }); m = await metrics(o.page);
  expect('(c) phone has no sideways scroll and 24px gutters', m.sw === m.w && m.gutter === '24px', JSON.stringify(m));
  await done('(c)', o, 'read-phone');

  o = await open({ routes: { [`/contents/library/${STEM}.json`]: { status: 401, body: '{}' } } });
  expect('(d) 401 shows the token message', (await o.page.textContent('body')).includes('token 失效'), 'missing');
  expect('(d) error page has exactly one back link', (await o.page.locator('a[href="./"]:visible').count()) === 1, String(await o.page.locator('a[href="./"]:visible').count()));
  await done('(d)', o);

  o = await open({ routes: { [`/contents/library/${STEM}.svg`]: { status: 200, body: SVG.replace('</svg>', '<script>window.__pwned=1</script></svg>') } } });
  const safe = await o.page.evaluate(() => ({
    notice: (document.querySelector('.fig') || {}).textContent || '',
    embeds: document.querySelectorAll('img, object, embed, iframe').length,
    urls: [...document.querySelectorAll('*')].flatMap((el) => ['src', 'href', 'data', 'srcdoc'].map((a) => el.getAttribute(a) || '')).filter((v) => /^(blob|data):/i.test(v)).length,
    pwned: window.__pwned === 1,
  }));
  expect('(e) rejected SVG shows a notice and exposes no URL', safe.notice.includes('沒通過安全檢查') && safe.embeds === 0 && safe.urls === 0 && !safe.pwned, JSON.stringify(safe));
  await done('(e)', o);

  const partial = JSON.parse(ENTRY); delete partial.intro; delete partial.highlights;
  o = await open({ routes: { [`/contents/library/${STEM}.json`]: { status: 200, body: JSON.stringify(partial) } } });
  const p = await o.page.evaluate(() => ({ what: [...document.querySelectorAll('.sec h2')].map((h) => h.textContent), tabs: [...document.querySelectorAll('.seg button')].map((b) => b.textContent) }));
  expect('(f) missing fields drop their sections', !p.what.includes('這是什麼') && !p.tabs.includes('值得借鏡') && p.tabs.includes('技術摘要'), JSON.stringify(p));
  await done('(f)', o);

  o = await open({ routes: { [`/contents/library/${STEM}.json`]: { status: 404, body: '{}' } } });
  const legacy = await o.page.evaluate(() => ({ text: document.body.textContent, nodes: document.querySelectorAll('.fig svg.dia .node').length }));
  expect('(f2) no sidecar but indexed shows the legacy state', legacy.text.includes('舊格式') && legacy.text.includes('XiaoPuOuO/openchatx-mcp') && legacy.nodes > 0, legacy.text.slice(0, 120));
  await done('(f2)', o);

  o = await open({ hash: '#../x' });
  expect('(g) unsafe hash shows not-found and makes no API call', (await o.page.textContent('body')).includes('找不到這筆收藏') && o.calls.length === 0, `calls=${o.calls}`);
  await done('(g)', o);

  {
    // A slow response for the previous entry must not replace the current one.
    const other = JSON.stringify({ ...JSON.parse(ENTRY), repo: 'Bee/Two', url: 'https://github.com/Bee/Two' });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    await ctx.route('https://api.github.com/**', async (r) => {
      const u = r.request().url().replace('https://api.github.com/repos/me/lib', '');
      if (u === `/contents/library/${STEM}.json`) { await new Promise((res) => setTimeout(res, 1500)); return r.fulfill({ status: 200, contentType: 'application/json', body: ENTRY }); }
      if (u === '/contents/library/bee__two.json') return r.fulfill({ status: 200, contentType: 'application/json', body: other });
      if (u.endsWith('.svg')) return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG });
      if (u === '/contents/index.json') return r.fulfill({ status: 200, contentType: 'application/json', body: INDEX });
      return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(B);
    await page.evaluate(() => localStorage.setItem('repobox.cfg', JSON.stringify({ repo: 'me/lib', token: 't', nonce: 'n' })));
    await page.goto(`${B}read.html#${STEM}`);
    await page.waitForTimeout(200);
    await page.evaluate(() => { location.hash = '#bee__two'; });
    await page.waitForTimeout(2500);
    const h1 = await page.textContent('h1').catch(() => '');
    expect('(j) late response for the previous entry is ignored', h1 === 'Bee/Two', h1);
    expect('(j): no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  for (const [repo, want] of [[404, '找不到收藏庫'], [200, '找不到這筆收藏'], [401, 'token 失效'], [403, 'token 失效']]) {
    o = await open({ routes: { [`/contents/library/${STEM}.json`]: { status: 404, body: '{}' }, [`/contents/library/${STEM}.svg`]: { status: 404, body: '{}' },
      '/contents/index.json': { status: 404, body: '{}' }, '': { status: repo, body: '{}' } } });
    const body = await o.page.textContent('body');
    expect(`(k) all 404 + repo ${repo} says "${want}"`, body.includes(want), body.replace(/\s+/g, ' ').slice(0, 120));
    await done(`(k) repo ${repo}`, o);
  }

  {
    // 展開 must appear when a resize makes a previously fitting intro clamp.
    const mid = JSON.stringify({ ...JSON.parse(ENTRY), intro: '這是一段中等長度的介紹文字，用來測試在寬螢幕上剛好放得下四行，但換到窄螢幕之後會超過四行而被截斷，這時候展開按鈕必須出現讓人能讀到完整內容，不然後半段文字就永遠看不到了，這樣不行。' });
    o = await open({ routes: { [`/contents/library/${STEM}.json`]: { status: 200, body: mid } } });
    const before = await o.page.isVisible('.sec .linkish:not(.more-eg)');
    await o.page.setViewportSize({ width: 390, height: 844 }); await o.page.waitForTimeout(400);
    const after = await o.page.isVisible('.sec .linkish:not(.more-eg)');
    expect('(l) 展開 follows the intro after a resize', !before && after, `before=${before} after=${after}`);
    await done('(l)', o);
  }
  {
    const long = JSON.stringify({ ...JSON.parse(ENTRY), repo: 'some-really-long-organisation-name/an-even-longer-repository-name-here' });
    o = await open({ vp: { width: 1000, height: 800 }, routes: { [`/contents/library/${STEM}.json`]: { status: 200, body: long } } });
    const h = await o.page.evaluate(() => { const h1 = document.querySelector('.tblock h1'); const box = h1.parentElement.getBoundingClientRect(); return { fits: h1.scrollWidth <= h1.clientWidth + 1 && h1.getBoundingClientRect().right <= box.right + 1, title: h1.getAttribute('title') }; });
    expect('(m) a long repo name is never silently clipped', h.fits || h.title === 'some-really-long-organisation-name/an-even-longer-repository-name-here', JSON.stringify(h));
    await done('(m)', o);
  }

  {
    const j = (body) => ({ status: 200, body: JSON.stringify(body) });
    const git = { '': j({ default_branch: 'main' }), '/git/ref/heads/main': j({ object: { sha: 'c1' } }), '/git/commits/c1': j({ tree: { sha: 't1' } }),
      '/git/trees/t1': j({ tree: [{ path: 'library', type: 'tree', sha: 'l1' }] }), '/git/trees/l1': j({ tree: [{ path: `${STEM}.md` }, { path: `${STEM}.json` }, { path: `${STEM}.svg` }] }),
      '/contents/index.json?ref=c1': { status: 200, body: INDEX }, '/git/trees': j({ sha: 't2' }), '/git/commits': j({ sha: 'c2' }), '/git/refs/heads/main': j({}) };
    o = await open({ routes: git });
    o.page.once('dialog', (d) => d.dismiss());
    await o.page.click('.tblock .rm'); await o.page.waitForTimeout(300);
    expect('(n) cancelling the confirm writes nothing', !o.calls.some((c) => c.startsWith('/git/')), o.calls.join(','));
    o.page.once('dialog', (d) => d.accept());
    await o.page.click('.tblock .rm'); await o.page.waitForURL((u) => !u.pathname.endsWith('read.html'), { timeout: 3000 }).catch(() => {});
    expect('(n) confirming commits and returns to the library', o.calls.includes('/git/refs/heads/main') && !o.page.url().includes('read.html'), `${o.page.url()} ${o.calls.join(',')}`);
    await done('(n)', o);
    o = await open({ vp: { width: 390, height: 844 } });
    const rm = await o.page.evaluate(() => { const r = document.querySelector('.tblock .rm').getBoundingClientRect(), g = document.querySelector('.tblock .gh').getBoundingClientRect(); return { sameRow: Math.abs(r.top - g.top) < 2, h: r.height }; });
    expect('(n) phone: 移除 sits beside the GitHub link', rm.sameRow && rm.h >= 28, JSON.stringify(rm));
    const row = await o.page.evaluate(() => ['.gh', '.re', '.rm'].map((s) => document.querySelector(`.tblock ${s}`).getBoundingClientRect())
      .map((r) => ({ top: Math.round(r.top), right: Math.round(r.right), w: Math.round(r.width) })));
    expect('(o) phone: GitHub / 重新分析 / 移除 share one row inside the screen', row.every((r) => r.top === row[0].top && r.right <= 390 && r.w > 0), JSON.stringify(row));
    await done('(n) phone', o, 'read-phone-rm');
  }

  {
    const DISPATCH = '/actions/workflows/repobox.yml/dispatches';
    const branch = { '': { status: 200, body: JSON.stringify({ default_branch: 'main' }) } };
    o = await open({ routes: { ...branch, [DISPATCH]: { status: 204, body: '' } } });
    const posts = [];
    o.page.on('request', (r) => { if (r.method() === 'POST') posts.push({ url: r.url(), body: r.postData() }); });
    o.page.once('dialog', (d) => d.dismiss());
    await o.page.click('.tblock .re'); await o.page.waitForTimeout(300);
    expect('(o) cancelling the confirm dispatches nothing', posts.length === 0, JSON.stringify(posts));
    o.page.once('dialog', (d) => d.accept());
    await o.page.click('.tblock .re'); await o.page.waitForTimeout(500);
    const sent = posts.find((p) => p.url.endsWith(DISPATCH));
    expect('(o) confirming dispatches repobox.yml with the repo url',
      sent && JSON.stringify(JSON.parse(sent.body)) === JSON.stringify({ ref: 'main', inputs: { url: JSON.parse(ENTRY).url } }), JSON.stringify(posts));
    const btn = await o.page.evaluate(() => { const b = document.querySelector('.tblock .re'); return { text: b.textContent, disabled: b.disabled }; });
    expect('(o) the button then reads 已送出 and stays disabled', btn.text === '已送出' && btn.disabled, JSON.stringify(btn));
    await done('(o)', o, 'read-reanalyze');
    o = await open({ routes: { ...branch, [DISPATCH]: { status: 403, body: '{"message":"Resource not accessible by personal access token"}' } } });
    const msgs = [];
    o.page.on('dialog', (d) => { msgs.push(d.message()); d.type() === 'confirm' ? d.accept() : d.dismiss(); });
    await o.page.click('.tblock .re'); await o.page.waitForTimeout(500);
    const after = await o.page.evaluate(() => { const b = document.querySelector('.tblock .re'); return { text: b.textContent, disabled: b.disabled }; });
    expect('(o) a token without Actions access says so and re-enables the button',
      msgs.length === 2 && msgs[1].includes('Actions: Read and write') && after.text === '重新分析' && !after.disabled, JSON.stringify({ msgs, after }));
    await done('(o) 403', o);
  }

  o = await open({ scheme: 'dark' });
  await done('(i) dark', o, 'read-dark');

  await browser.close(); close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall reading-page checks passed');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
