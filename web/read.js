'use strict';

import { prepareSvg, rejectedNotice, wire, draft, mountLightbox } from './lib/diagram.mjs';
import { parseStem, stemOf, ghRaw, loadIndex, removeEntry, reanalyze, specRows, categoryLabel, STATE_TEXT } from './lib/library.mjs';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const lightbox = mountLightbox($('lightbox'));

// Coupled with app.js: same localStorage key and shape.
function loadCfg() {
  try { return JSON.parse(localStorage.getItem('repobox.cfg')) || null; } catch { return null; }
}

function showMessage(text) {
  for (const id of ['tblock', 'read']) $(id).hidden = true;
  $('msg').replaceChildren(el('p', null, text));
  $('msg').hidden = false;
  document.title = 'RepoBox';
}

const pad = (n) => String(n).padStart(2, '0');
function day(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function lastSeen(rec) {
  const times = (Array.isArray(rec.sightings) ? rec.sightings : []).map((s) => s && s.at).filter(Boolean);
  if (times.length) return times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
  return rec.last_seen || rec.analyzed_at || '';
}
const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
const text = (v) => (typeof v === 'string' ? v : '');

function cell(label, value) { const d = el('div', 'cell'); d.append(el('span', 'lbl', label), el('span', 'val', value)); return d; }
function section(title, ...kids) { const s = el('section', 'sec'); s.append(el('h2', null, title), ...kids); return s; }

function specTable(lines) {
  const t = el('table', 'spec'); const body = el('tbody'); t.append(body);
  for (const [label, value] of specRows(lines)) {
    const tr = el('tr');
    if (label) tr.append(el('th', null, label), el('td', null, value));
    else { const td = el('td', null, value); td.colSpan = 2; tr.append(td); }
    body.append(tr);
  }
  return t;
}

function tabs(rec) {
  const views = {};
  const highlights = list(rec.highlights), stack = list(rec.stack), summary = text(rec.summary);
  if (highlights.length) views['值得借鏡'] = () => { const ul = el('ul'); highlights.forEach((h) => ul.append(el('li', null, h))); return ul; };
  if (summary) views['技術摘要'] = () => el('p', null, summary);
  if (stack.length) views['技術棧'] = () => { const d = el('div', 'stack'); stack.forEach((s) => d.append(el('span', null, s))); return d; };
  const names = Object.keys(views);
  if (!names.length) return null;
  const box = el('div', 'more'); const seg = el('div', 'seg'); seg.setAttribute('role', 'tablist');
  const panel = el('div', 'panel'); panel.setAttribute('role', 'tabpanel');
  const fade = () => panel.classList.toggle('has-more', panel.scrollTop + panel.clientHeight < panel.scrollHeight - 4);
  panel.addEventListener('scroll', fade);
  const show = (name) => {
    panel.replaceChildren(views[name]());
    panel.scrollTop = 0;
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === name)));
    requestAnimationFrame(fade);
  };
  for (const name of names) {
    const b = el('button', null, name); b.type = 'button'; b.setAttribute('role', 'tab'); b.onclick = () => show(name);
    seg.append(b);
  }
  box.append(seg, panel);
  show(names[0]);
  return box;
}

function renderText(rec, legacy) {
  const parts = [];
  const intro = text(rec.intro), examples = list(rec.examples), reqs = list(rec.requirements);
  if (intro) {
    // Long intros clamp to four lines and only the first example shows (user call 2026-10-19), so the tabs keep room.
    const lead = el('p', 'lead clamp', intro);
    const kids = [lead];
    const more = el('button', 'linkish', '展開'); more.type = 'button'; more.hidden = true;
    more.onclick = () => { lead.classList.remove('clamp'); more.hidden = true; };
    kids.push(more);
    const measure = () => { if (lead.classList.contains('clamp')) more.hidden = lead.scrollHeight <= lead.clientHeight + 1; };
    new ResizeObserver(measure).observe(lead);
    if (examples.length) {
      const p = el('p', 'eg'); p.append(el('b', null, '例如'), el('span', null, examples[0]));
      const egs = el('div', 'egs'); egs.append(p);
      kids.push(egs);
    }
    parts.push(section('這是什麼', ...kids));
  }
  if (reqs.length) parts.push(section('使用門檻', specTable(reqs)));
  const t = legacy ? null : tabs(rec);
  if (t) parts.push(t);
  if (legacy || (!intro && !t)) parts.push(el('p', 'note', '這筆是舊格式，重新分析後會有完整內容。'));
  $('col').replaceChildren(...parts);
}

function renderDiagram(cfg, stem, svgRes) {
  const fig = $('fig');
  fig.classList.remove('zoomable'); fig.onclick = null; fig.onkeydown = null; fig.removeAttribute('tabindex'); fig.removeAttribute('role');
  if (svgRes.status === 404) { fig.replaceChildren(el('p', 'nodia', '這筆沒有架構圖。')); return; }
  if (svgRes.status !== 200) { fig.replaceChildren(el('p', 'nodia', '架構圖載入失敗，稍後再試。')); return; }
  const svg = prepareSvg(svgRes.text, 'h');
  if (!svg) { fig.replaceChildren(rejectedNotice(document, `https://github.com/${cfg.repo}/blob/main/library/${stem}.svg`)); return; }
  fig.replaceChildren(svg, el('span', 'hint', '點圖放大'));
  fig.classList.add('zoomable');
  fig.setAttribute('role', 'button');
  fig.tabIndex = 0;
  const zoom = () => {
    const big = prepareSvg(svgRes.text, 'v');
    if (!big) return;
    wire(big, lightbox.isDrag);
    lightbox.open(big);
  };
  fig.onclick = zoom;
  fig.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); zoom(); } };
  draft(svg);
}

function removeButton(cfg, stem, repo) {
  const b = el('button', 'rm', '移除'); b.type = 'button';
  b.onclick = async () => {
    if (!confirm(`從書庫移除 ${repo}？\n介紹和架構圖會一起刪掉；之後再收這個 repo 會重新分析。`)) return;
    b.disabled = true; b.textContent = '移除中…';
    try {
      await removeEntry(cfg, stem, repo);
      location.replace('./');
    } catch (e) {
      b.disabled = false; b.textContent = '移除';
      alert(e.status === 401 ? `移除失敗：${STATE_TEXT.auth}` : e.status === 403 ? '移除失敗：token 沒有這個收藏庫的寫入權限。' :
        e.status ? `移除失敗（GitHub 回應 ${e.status}），稍後再試。` : `移除失敗：${STATE_TEXT.unavailable}`);
    }
  };
  return b;
}

function reanalyzeButton(cfg, url, repo) {
  const b = el('button', 're', '重新分析'); b.type = 'button';
  b.onclick = async () => {
    if (!confirm(`重新分析 ${repo}？\n會在收藏庫的 Actions 重跑一次（約 3–9 分鐘），完成後重新整理這頁就會看到新版。`)) return;
    b.disabled = true; b.textContent = '送出中…';
    try {
      await reanalyze(cfg, url);
      b.textContent = '已送出';
    } catch (e) {
      b.disabled = false; b.textContent = '重新分析';
      alert(e.status === 401 ? `送出失敗：${STATE_TEXT.auth}` :
        e.status === 403 ? '送出失敗：token 沒有 Actions 權限。到 GitHub 的 token 設定加上 Actions: Read and write（token 不用換）。' :
        e.status === 404 || e.status === 422 ? '送出失敗：收藏庫找不到可手動觸發的 repobox.yml。' :
        e.status ? `送出失敗（GitHub 回應 ${e.status}），稍後再試。` : `送出失敗：${STATE_TEXT.unavailable}`);
    }
  };
  return b;
}

function renderRecord(cfg, stem, rec, svgRes, legacy) {
  const repo = text(rec.repo) || stem;
  const h1 = el('h1', null, repo); h1.title = repo;
  const head = el('div', 'head'); head.append(h1);
  if (text(rec.tagline)) head.append(el('p', 'sub', rec.tagline));
  const parts = [head, cell('分類', categoryLabel(text(rec.category)) || '—'), cell('授權', text(rec.license) || '—'),
    cell('收藏日', day(lastSeen(rec)))];
  if (/^https:\/\/github\.com\//.test(text(rec.url))) {
    const gh = el('a', 'gh', 'GitHub ↗'); gh.href = rec.url; gh.target = '_blank'; gh.rel = 'noopener';
    parts.push(gh, reanalyzeButton(cfg, rec.url, repo));
  }
  parts.push(removeButton(cfg, stem, repo));
  $('tblock').replaceChildren(...parts);
  $('msg').hidden = true;
  $('tblock').hidden = false;
  $('read').hidden = false;
  document.title = `${repo} · RepoBox`;
  renderText(rec, legacy);
  renderDiagram(cfg, stem, svgRes);
}

let generation = 0;

async function load() {
  const gen = ++generation;
  const stem = parseStem(location.hash);
  if (!stem) { showMessage('找不到這筆收藏。'); return; }
  const cfg = loadCfg();
  if (!cfg || !cfg.repo || !cfg.token) { showMessage('先到收藏頁連結收藏庫。'); return; }
  const [side, svgRes, idx] = await Promise.all([
    ghRaw(cfg, `library/${stem}.json`), ghRaw(cfg, `library/${stem}.svg`), loadIndex(cfg),
  ]);
  // A newer navigation (hashchange) or a settings change makes this result stale.
  const now = loadCfg();
  if (gen !== generation || parseStem(location.hash) !== stem || !now || now.repo !== cfg.repo) return;
  if (side.status === 200) {
    let rec = null;
    try { rec = JSON.parse(side.text); } catch { /* handled below */ }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { showMessage(STATE_TEXT['bad-data']); return; }
    renderRecord(cfg, stem, rec, svgRes, false);
    return;
  }
  if (side.status === 401 || side.status === 403) { showMessage(STATE_TEXT.auth); return; }
  if (side.status === 404) {
    // Entries written before sidecars existed are still listed in index.json.
    const entry = idx.state === 'ok' ? idx.index.entries.find((e) => e && stemOf(e.md) === stem) : null;
    if (entry) { renderRecord(cfg, stem, entry, svgRes, true); return; }
    showMessage(idx.state === 'auth' || idx.state === 'no-repo' ? STATE_TEXT[idx.state] : '找不到這筆收藏。');
    return;
  }
  showMessage(STATE_TEXT.unavailable);
}

addEventListener('hashchange', load);
load();
