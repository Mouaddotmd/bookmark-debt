#!/usr/bin/env node
// Builds .stash/board.html from what the agent picked and what it concluded.
//
//   node board.mjs [--out .stash]
//
// Reads .stash/picked.json (stash.get output for the relevant bookmarks) and
// .stash/analysis.json (headline, ideas, themes, and a score + note per id).
// The page is one self-contained file; images come from the .stash/media
// cache when present, otherwise from X's media CDN.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const outDir = path.resolve(flag('out', '.stash'));
const read = (f, def) => (fs.existsSync(path.join(outDir, f)) ? JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')) : def);

const picked = read('picked.json', []);
const analysis = read('analysis.json', {});
const index = read('index.json', { items: {} });
const LENS = { now: 'useful now', direction: 'could change the direction', taste: 'your taste' };
// A score and note per bookmark, from the readers, unless the analysis revised it.
const scoreOf = (id) => {
  const r = index.items[id]?.read;
  const base = r ? (() => {
    const lens = ['now', 'direction', 'taste'].sort((a, b) => (r[b] || 0) - (r[a] || 0))[0];
    return { score: r[lens], note: r.note, lens: LENS[lens] };
  })() : {};
  return { ...base, ...(analysis.notes || {})[id] };
};

const localMedia = (id) => {
  const dir = path.join(outDir, 'media', id);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => `media/${id}/${f}`) : [];
};

const byId = new Map(picked.map((b) => [String(b.id), b]));
const card = (id) => {
  // A lost idea can rest on a post that scored low at first, so fall back to the index.
  const b = byId.get(String(id)) || index.items[id];
  if (!b) return null;
  const s = scoreOf(b.id);
  const local = localMedia(b.id);
  const video = (b.media || []).find((m) => m.type !== 'image');
  b.media = b.media || [];
  return {
    id: b.id, url: b.url, date: new Date(b.saved).toISOString().slice(0, 10), author: b.by, lens: s.lens || '',
    text: b.text.length > 400 ? b.text.slice(0, 400) + '…' : b.text,
    // Prefer a mid-video frame over X's thumbnail, which is often a title card.
    image: local.find((f) => /frame-\d+-2\.jpg$/.test(f)) || local[0] || b.media[0]?.image || null,
    video: video ? { duration: video.duration, gif: video.type === 'gif' } : null,
    photos: b.media.filter((m) => m.type === 'image').length,
    linkTitle: b.link || b.card?.title || null,
    score: s.score ?? null, note: s.note || '',
  };
};

const themed = new Set();
const themes = (analysis.themes || []).map((t) => {
  const items = (t.ids || []).map(card).filter(Boolean).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  items.forEach((c) => themed.add(c.id));
  return { title: t.title, summary: t.summary, fit: t.fit, items };
});
const loose = picked.map((b) => card(b.id)).filter((c) => c && !themed.has(c.id)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
if (loose.length) themes.push({ title: 'Also worth a look', summary: 'Relevant, but not part of a bigger pattern yet.', items: loose });

const ideas = (analysis.ideas || []).map((i) => ({ ...i, evidence: (i.evidence || []).map(card).filter(Boolean) }));
const lost = (analysis.lost || []).map((i) => ({ ...i, evidence: (i.evidence || []).map(card).filter(Boolean) }));
// Everything ever read, so a half-remembered post can be found from this page.
const memory = Object.values(index.items).filter((b) => b.read).sort((a, b) => b.saved - a.saved).map((b) => ({
  u: b.url, d: new Date(b.saved).toISOString().slice(0, 10), h: b.by?.handle || '', g: b.read.gist || '', t: b.read.topic || '', x: (b.text || '').slice(0, 280),
}));
const fmt = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
const range = analysis.range ? `saved ${fmt(analysis.range.from)} – ${fmt(analysis.range.to) || 'now'}` : '';

const data = {
  project: analysis.project || { name: path.basename(path.dirname(outDir)) },
  headline: analysis.headline || '', direction: analysis.direction || '', lostNote: analysis.lostNote || '',
  meta: { scanned: analysis.scanned ?? picked.length, matched: picked.length, range, account: analysis.account || index.account },
  ideas, lost, themes, memory,
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stash · ${esc(data.project.name)}</title>
<style>
:root {
  --bg: #f6f5f2; --panel: #ffffff; --ink: #16161a; --ink-2: #55555e; --ink-3: #8b8b94;
  --line: #e4e2dc; --accent: #2f5fd0; --chip: #eceae4; --hi: #1f7a4d;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111113; --panel: #1a1a1d; --ink: #f1f1f3; --ink-2: #a9a9b2; --ink-3: #6f6f78;
    --line: #2a2a2f; --accent: #7aa2ff; --chip: #232327; --hi: #5fcf95; color-scheme: dark; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; }
.wrap { max-width: 1240px; margin: 0 auto; padding: 56px 24px 96px; }
header .eyebrow { font-size: 13px; color: var(--ink-3); letter-spacing: .02em; }
header h1 { font-size: 40px; line-height: 1.1; letter-spacing: -0.025em; margin: 8px 0 12px; font-weight: 650; }
header .headline { font-size: 19px; color: var(--ink-2); max-width: 760px; margin: 0; text-wrap: pretty; }
.stats { display: flex; gap: 28px; margin: 28px 0 0; flex-wrap: wrap; }
.stat b { display: block; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.stat span { font-size: 13px; color: var(--ink-3); }
nav.chips { position: sticky; top: 0; z-index: 2; background: var(--bg); display: flex; gap: 8px;
  overflow-x: auto; padding: 14px 0; margin: 40px 0 8px; border-bottom: 1px solid var(--line); scrollbar-width: none; }
.chip { flex: none; border: 0; background: var(--chip); color: var(--ink-2); font: inherit; font-size: 13px;
  padding: 6px 12px; border-radius: 999px; cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--ink); color: var(--bg); }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--ink-3); font-weight: 600; margin: 48px 0 16px; }
.direction { margin: 22px 0 0; max-width: 760px; font-size: 16px; color: var(--ink); text-wrap: pretty; }
.ideas { display: grid; gap: 14px; }
.idea { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 26px 28px; display: flex; flex-direction: column; gap: 16px; }
.idea header { display: grid; gap: 8px; }
.tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.tag { background: var(--chip); color: var(--ink-2); padding: 2px 8px; border-radius: 999px; }
.tag.lost { background: var(--accent); color: var(--bg); }
.idea h3 { margin: 0; font-size: 23px; line-height: 1.25; letter-spacing: -0.015em; font-weight: 620; text-wrap: balance; }
.idea .lede { margin: 0; color: var(--ink); font-size: 16px; max-width: 780px; text-wrap: pretty; }
.argue { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr)); gap: 16px 28px; margin: 0; }
.argue div { min-width: 0; }
.argue dt { font-size: 12px; font-weight: 600; color: var(--ink-3); margin-bottom: 3px; }
.argue dd { margin: 0; color: var(--ink-2); font-size: 14px; text-wrap: pretty; }
.where { font-size: 13px; color: var(--ink-3); }
.where code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--chip); color: var(--ink-2); padding: 1px 5px; border-radius: 5px; margin-right: 4px; overflow-wrap: anywhere; }
.idea .next { color: var(--ink); font-size: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
.idea .next b { color: var(--hi); font-weight: 600; }
.evidence { display: flex; gap: 6px; flex-wrap: wrap; }
.evidence a { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; padding: 3px 11px 3px 3px; border-radius: 9px; background: var(--chip);
  font-size: 12.5px; color: var(--ink-2); text-decoration: none; }
.evidence a:hover { color: var(--ink); }
.evidence img, .evidence .blank { width: 30px; height: 30px; border-radius: 7px; object-fit: cover; flex: none; background: var(--line); }
.find input { width: 100%; max-width: 620px; font: inherit; font-size: 16px; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 11px 14px; }
.find input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.find ol { list-style: none; margin: 14px 0 0; padding: 0; max-width: 780px; }
.find li { padding: 11px 0; border-bottom: 1px solid var(--line); }
.find li a { color: var(--ink); text-decoration: none; font-size: 14px; }
.find li a:hover { text-decoration: underline; }
.find li small { display: block; color: var(--ink-3); font-size: 12.5px; margin-top: 2px; }
.empty { color: var(--ink-3); font-size: 14px; margin-top: 14px; }
.theme { margin-top: 56px; }
.theme-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 24px; align-items: baseline; margin-bottom: 18px; }
.theme-head h3 { margin: 0; font-size: 26px; letter-spacing: -0.02em; font-weight: 620; }
.theme-head .count { color: var(--ink-3); font-size: 13px; font-variant-numeric: tabular-nums; }
.theme-head p { grid-column: 1 / -1; margin: 0; color: var(--ink-2); max-width: 780px; text-wrap: pretty; }
.theme-head .fit { color: var(--ink); }
.grid { columns: 4 260px; column-gap: 12px; }
.card { break-inside: avoid; margin: 0 0 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  overflow: hidden; display: block; color: inherit; text-decoration: none; }
.card:hover { border-color: var(--ink-3); }
.media { position: relative; background: var(--chip); }
.media img { display: block; width: 100%; height: auto; max-height: 420px; object-fit: cover; }
.badge { position: absolute; left: 8px; bottom: 8px; background: rgba(0,0,0,.72); color: #fff; font-size: 11px;
  padding: 2px 7px; border-radius: 6px; font-variant-numeric: tabular-nums; }
.body { padding: 14px 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.who { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-3); min-width: 0; }
.who img { width: 20px; height: 20px; border-radius: 50%; flex: none; }
.who b { color: var(--ink); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who .date { margin-left: auto; flex: none; }
.text { margin: 0; font-size: 14px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
.link { font-size: 13px; color: var(--ink-3); }
.note { font-size: 13.5px; color: var(--ink); padding: 10px 12px; background: var(--chip); border-radius: 10px; }
.note .dots { color: var(--hi); letter-spacing: 1px; margin-right: 6px; }
[hidden] { display: none !important; }
footer { margin-top: 80px; color: var(--ink-3); font-size: 13px; }
@media (max-width: 600px) { header h1 { font-size: 30px; } .wrap { padding: 32px 16px 64px; } .idea { padding: 20px; } }
</style>
</head>
<body>
<div class="wrap" id="app"></div>
<script>
const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};
const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dots = (n) => n == null ? '' : '●'.repeat(n) + '○'.repeat(Math.max(0, 3 - n));
const mins = (s) => s >= 60 ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '0:' + String(s).padStart(2, '0');

function cardHTML(c) {
  const badge = c.video ? (c.video.gif ? 'GIF' : '▶ ' + mins(c.video.duration || 0)) : c.photos > 1 ? c.photos + ' images' : '';
  return '<a class="card" href="' + h(c.url) + '" target="_blank" rel="noopener">' +
    (c.image ? '<div class="media"><img loading="lazy" src="' + h(c.image) + '" alt="">' + (badge ? '<span class="badge">' + h(badge) + '</span>' : '') + '</div>' : '') +
    '<div class="body"><div class="who">' + (c.author?.avatar ? '<img src="' + h(c.author.avatar) + '" alt="">' : '') +
    '<b>' + h(c.author?.name || '') + '</b><span class="date">' + h(c.date) + '</span></div>' +
    (c.text ? '<p class="text">' + h(c.text) + '</p>' : '') +
    (c.linkTitle ? '<div class="link">↗ ' + h(c.linkTitle) + '</div>' : '') +
    (c.note ? '<div class="note"><span class="dots" title="' + h(c.lens) + '">' + dots(c.score) + '</span>' + h(c.note) + '</div>' : '') +
    '</div></a>';
}

const KIND = { build: 'Build', original: 'Original idea', respond: 'Respond', cut: 'Cut', 'never-built': 'Saved often, never built', 'went-quiet': 'You stopped saving this', 'doc-revived': 'From your own notes', scooped: 'Someone shipped your idea' };
const STATUS = { shipped: 'Already shipped', partial: 'Partly built', planned: 'Planned', abandoned: 'Abandoned', absent: 'Not in the project' };
const field = (label, v) => v ? '<div><dt>' + h(label) + '</dt><dd>' + h(v) + '</dd></div>' : '';

function reportHTML(i, n, isLost) {
  return '<article class="idea"><header><div class="tags"><span>' + String(n + 1).padStart(2, '0') + '</span>' +
    (i.kind ? '<span class="tag' + (isLost ? ' lost' : '') + '">' + h(KIND[i.kind] || i.kind) + '</span>' : '') +
    (i.status ? '<span class="tag">' + h(STATUS[i.status] || i.status) + '</span>' : '') +
    (i.confidence ? '<span class="tag">' + h(i.confidence) + ' confidence</span>' : '') + '</div>' +
    '<h3>' + h(i.title) + '</h3></header>' +
    '<p class="lede">' + h(i.what || i.story || i.why) + '</p><dl class="argue">' +
    field('Why it matters now', i.whyNow) + field('Why it\\'s worth bringing back', i.worth) + field('How it would work in the product', i.inProduct) +
    field('What it costs', i.cost) + field('The best argument against', i.against) + '</dl>' +
    ((i.where || []).length ? '<div class="where">In your project: ' + i.where.map((w) => '<code>' + h(w) + '</code>').join('') + '</div>' : '') +
    '<div class="evidence">' + i.evidence.map((c) => '<a href="' + h(c.url) + '" target="_blank" rel="noopener">' +
      (c.image ? '<img loading="lazy" src="' + h(c.image) + '" alt="">' : '<span class="blank"></span>') + '@' + h(c.author?.handle || '') + '</a>').join('') + '</div>' +
    (i.next ? '<div class="next"><b>Start here →</b> ' + h(i.next) + '</div>' : '') + '</article>';
}

const d = DATA, m = d.meta;
let out = '<header><div class="eyebrow">Stash · @' + h(m.account || '') + (m.range ? ' · ' + h(m.range) : '') + '</div>' +
  '<h1>' + h(d.project.name) + '</h1>' + (d.headline ? '<p class="headline">' + h(d.headline) + '</p>' : '') +
  (d.direction ? '<p class="direction">' + h(d.direction) + '</p>' : '') +
  '<div class="stats"><div class="stat"><b>' + m.scanned + '</b><span>bookmarks read</span></div>' +
  '<div class="stat"><b>' + m.matched + '</b><span>kept</span></div>' +
  '<div class="stat"><b>' + d.ideas.length + '</b><span>ideas</span></div>' +
  '<div class="stat"><b>' + d.lost.length + '</b><span>lost ideas</span></div>' +
  '<div class="stat"><b>' + d.themes.length + '</b><span>themes</span></div></div></header>';

out += '<nav class="chips"><button class="chip" aria-pressed="true" data-f="all">Everything</button>' +
  (d.lost.length || d.lostNote ? '<button class="chip" aria-pressed="false" data-f="lost">Lost ideas</button>' : '') +
  (d.ideas.length ? '<button class="chip" aria-pressed="false" data-f="ideas">Ideas</button>' : '') +
  (d.memory.length ? '<button class="chip" aria-pressed="false" data-f="find">Find a post</button>' : '') +
  d.themes.map((t, i) => '<button class="chip" aria-pressed="false" data-f="t' + i + '">' + h(t.title) + ' · ' + t.items.length + '</button>').join('') + '</nav>';

if (d.lost.length || d.lostNote) {
  out += '<section data-s="lost"><h2>Ideas you lost track of</h2>' + (d.lostNote ? '<p class="direction">' + h(d.lostNote) + '</p>' : '') +
    '<div class="ideas">' + d.lost.map((i, n) => reportHTML(i, n, true)).join('') + '</div></section>';
}

if (d.ideas.length) {
  out += '<section data-s="ideas"><h2>Ideas for ' + h(d.project.name) + '</h2><div class="ideas">' + d.ideas.map((i, n) => reportHTML(i, n, false)).join('') + '</div></section>';
}

out += d.themes.map((t, i) => '<section class="theme" data-s="t' + i + '"><div class="theme-head"><h3>' + h(t.title) + '</h3>' +
  '<span class="count">' + t.items.length + ' bookmarks</span>' + (t.summary ? '<p>' + h(t.summary) + '</p>' : '') +
  (t.fit ? '<p class="fit">' + h(t.fit) + '</p>' : '') + '</div><div class="grid">' + t.items.map(cardHTML).join('') + '</div></section>').join('');

if (d.memory.length) {
  out += '<section class="find" data-s="find"><h2>Find a post you half remember</h2>' +
    '<input id="find" type="search" aria-label="Search everything Stash has read" placeholder="Search ' + d.memory.length + ' bookmarks, by what you remember">' +
    '<ol id="found"></ol><p class="empty" id="none" hidden>Nothing matched. Try different words.</p></section>';
}

out += '<footer>Made with Stash from your own X bookmarks. Everything on this page lives on your computer.</footer>';
document.getElementById('app').innerHTML = out;

const findBox = document.getElementById('find');
if (findBox) findBox.addEventListener('input', () => {
  const words = findBox.value.toLowerCase().split(/\\s+/).filter((w) => w.length > 1);
  const hits = !words.length ? [] : d.memory.map((r) => {
    const hay = (r.g + ' ' + r.t + ' ' + r.h + ' ' + r.x).toLowerCase();
    return { r, s: words.filter((w) => hay.includes(w)).length };
  }).filter((x) => x.s).sort((a, b) => b.s - a.s).slice(0, 40);
  document.getElementById('found').innerHTML = hits.map(({ r }) => '<li><a href="' + h(r.u) + '" target="_blank" rel="noopener">' + h(r.g || r.x) + '</a><small>@' + h(r.h) + ' · ' + h(r.d) + ' · ' + h(r.t) + '</small></li>').join('');
  document.getElementById('none').hidden = !words.length || hits.length > 0;
});

document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  document.querySelectorAll('[data-s]').forEach((s) => { s.hidden = b.dataset.f !== 'all' && s.dataset.s !== b.dataset.f; });
  window.scrollTo({ top: document.querySelector('nav.chips').offsetTop, behavior: 'instant' });
}));
</script>
</body>
</html>
`;

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

fs.writeFileSync(path.join(outDir, 'board.html'), html);
console.log(`board → ${path.join(outDir, 'board.html')} (${picked.length} relevant, ${themes.length} themes, ${ideas.length} ideas)`);
