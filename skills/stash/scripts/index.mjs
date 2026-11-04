#!/usr/bin/env node
// The private memory behind Stash: every bookmark ever read, across runs.
// Everything stays in .stash/ on this computer.
//
//   node index.mjs ingest [--per 180]   merge .stash/incoming.json, write .stash/pages/ for what's unread
//   node index.mjs merge                merge .stash/scores/*.json, check them, write picked.json
//   node index.mjs topics               when each topic was saved, what repeats and what went quiet
//   node index.mjs search "words"       find a half-remembered post, by meaning-ish keywords
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const outDir = path.resolve(flag('out', '.stash'));
const p = (...f) => path.join(outDir, ...f);
const readJSON = (f, def) => (fs.existsSync(p(f)) ? JSON.parse(fs.readFileSync(p(f), 'utf8')) : def);
const loadIndex = () => readJSON('index.json', { version: 2, items: {} });
const saveIndex = (ix) => fs.writeFileSync(p('index.json'), JSON.stringify(ix));
const day = (t) => new Date(t).toISOString().slice(0, 10);
const lenses = (r) => (r ? Math.max(r.now || 0, r.direction || 0, r.taste || 0) : 0);
// Kept for the board: taste alone is a wide net, so on its own it has to be a 3.
const keeps = (r) => !!r && ((r.now || 0) >= 2 || (r.direction || 0) >= 2 || r.taste === 3);

function pageText(b) {
  const lines = [`### ${b.id} · @${b.by.handle} · saved ${day(b.saved)}`];
  if (b.text) lines.push(b.text.length > 1500 ? b.text.slice(0, 1500) + ' […]' : b.text);
  if (b.media?.length) lines.push(`media: ${b.media.map((m) => (m.type === 'video' ? `video ${m.duration || '?'}s` : m.type)).join(', ')}`);
  if (b.card) lines.push(`link: ${[b.card.title, b.card.description].filter(Boolean).join(' — ').slice(0, 250)}`);
  if (b.quoted) lines.push(`quoting @${b.quoted.handle}: ${b.quoted.text.slice(0, 600)}`);
  return lines.join('\n');
}

function ingest() {
  const incoming = readJSON('incoming.json', null);
  if (!incoming) throw new Error('No .stash/incoming.json. Run the save step first.');
  const ix = loadIndex();
  let added = 0;
  for (const b of incoming.items) {
    const old = ix.items[b.id];
    if (!old) added++;
    ix.items[b.id] = { ...b, read: old?.read || null };
  }
  ix.lastRange = incoming.range;
  ix.lastIds = incoming.items.map((b) => b.id);
  ix.account = incoming.account || ix.account;
  saveIndex(ix);
  const unread = incoming.items.filter((b) => !ix.items[b.id].read);
  for (const d of ['pages', 'scores']) { fs.rmSync(p(d), { recursive: true, force: true }); fs.mkdirSync(p(d), { recursive: true }); }
  const per = Number(flag('per', 180));
  const files = [];
  for (let i = 0; i * per < unread.length; i++) {
    const f = `reader-${i}.txt`;
    fs.writeFileSync(p('pages', f), unread.slice(i * per, (i + 1) * per).map(pageText).join('\n\n') + '\n');
    files.push(f);
  }
  console.log(JSON.stringify({ inRange: incoming.items.length, new: added, alreadyRead: incoming.items.length - unread.length, toRead: unread.length, readerFiles: files, total: Object.keys(ix.items).length }, null, 1));
}

function merge() {
  const ix = loadIndex();
  const problems = [], rates = [];
  const dir = p('scores');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort() : []) {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { problems.push(`${f}: invalid JSON (${e.message})`); continue; }
    let kept = 0;
    for (const r of rows) {
      const id = String(r.id);
      // Without the page data (fallback mode) a reader's row can create a stub.
      if (!ix.items[id] && r.handle) ix.items[id] = { id, saved: r.saved || Date.now(), url: `https://x.com/${r.handle}/status/${id}`, by: { handle: r.handle, name: r.handle }, text: r.gist || '', media: [], read: null };
      if (!ix.items[id]) { problems.push(`${f}: unknown id ${id}`); continue; }
      const bad = ['now', 'direction', 'taste'].filter((k) => ![0, 1, 2, 3].includes(r[k]));
      if (bad.length || !r.gist || !r.topic) { problems.push(`${f}: ${id} is missing ${[...bad, !r.gist && 'gist', !r.topic && 'topic'].filter(Boolean).join(', ')}`); continue; }
      const read = { now: r.now, direction: r.direction, taste: r.taste, topic: String(r.topic).toLowerCase().trim(), gist: r.gist, note: r.note || '' };
      if (keeps(read)) { kept++; if (!read.note) problems.push(`${f}: ${id} scored ${lenses(read)} with no note`); }
      ix.items[id].read = read;
    }
    rates.push({ file: f, rows: rows.length, kept, rate: rows.length ? kept / rows.length : 0 });
  }
  saveIndex(ix);
  const ids = ix.lastIds || [];
  const missing = ids.filter((id) => !ix.items[id]?.read);
  // A reader far from the others is often a calibration problem, not a real difference.
  const sorted = rates.map((r) => r.rate).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;
  const outliers = rates.filter((r) => median > 0 && (r.rate > median * 2.5 || r.rate < median / 2.5)).map((r) => r.file);
  const picked = ids.map((id) => ix.items[id]).filter((b) => b && keeps(b.read)).map((b) => ({
    id: b.id, saved: b.saved, url: b.url, by: b.by,
    text: b.text.length > 400 ? b.text.slice(0, 400) + '…' : b.text,
    media: (b.media || []).map(({ type, image, duration, video }) => ({ type, image, duration, video })),
    link: b.card?.title || null,
  }));
  fs.writeFileSync(p('picked.json'), JSON.stringify(picked));
  const c = (k) => picked.filter((b) => (ix.items[b.id].read[k] || 0) >= 2).length;
  console.log(JSON.stringify({ read: ids.length - missing.length, of: ids.length, missing: missing.slice(0, 40), missingCount: missing.length, picked: picked.length, topNow: picked.filter((b) => ix.items[b.id].read.now === 3).length, lens: { now: c('now'), direction: c('direction'), taste: c('taste') }, readers: rates.map((r) => `${r.file} ${r.kept}/${r.rows}`), outliers, problems: problems.slice(0, 40), problemCount: problems.length }, null, 1));
}

function topics() {
  const ix = loadIndex();
  const all = Object.values(ix.items).filter((b) => b.read);
  if (!all.length) throw new Error('Nothing read yet.');
  const newest = Math.max(...all.map((b) => b.saved));
  const months = [...new Set(all.map((b) => day(b.saved).slice(0, 7)))].sort();
  const cutoff = newest - 30 * 864e5;
  const allRecent = all.filter((b) => b.saved >= cutoff).length;
  const allEarlier = all.length - allRecent;
  const groups = new Map();
  for (const b of all) { const k = b.read.topic; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
  console.log(`months: ${months.join(' ')}   (counts below follow this order)\n`);
  const rows = [...groups].map(([topic, items]) => {
    const last = Math.max(...items.map((b) => b.saved));
    const quietDays = Math.round((newest - last) / 864e5);
    const strong = items.filter((b) => lenses(b.read) >= 2);
    const tags = [];
    if (items.length >= 5) tags.push('REPEATED');
    if (items.length >= 3 && quietDays >= 30) tags.push(`QUIET ${quietDays}d`);
    // Compare shares, not counts: people often save far more in some months than others.
    const recent = items.filter((b) => b.saved >= cutoff).length;
    const earlier = items.length - recent;
    if (allEarlier && allRecent && items.length >= 8) {
      const ratio = (recent / allRecent) / ((earlier || 0.5) / allEarlier);
      if (ratio < 0.4) tags.push('FADING');
      else if (ratio > 2.5) tags.push('RISING');
    }
    return { topic, n: items.length, strong: strong.length, tags, by: months.map((m) => items.filter((b) => day(b.saved).startsWith(m)).length).join(' '), first: day(Math.min(...items.map((b) => b.saved))), last: day(last),
      ids: [...items].sort((a, b) => lenses(b.read) - lenses(a.read)).slice(0, 6).map((b) => `${b.id} @${b.by.handle}`) };
  }).sort((a, b) => b.n - a.n);
  for (const r of rows) console.log(`${r.topic} — ${r.n} saved, ${r.strong} strong | ${r.by} | ${r.first} to ${r.last}${r.tags.length ? ' | ' + r.tags.join(', ') : ''}\n   ${r.ids.join(', ')}`);
}

function search() {
  const words = args.slice(1).filter((a, i, l) => !a.startsWith('--') && !(l[i - 1] || '').startsWith('--')).join(' ').toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  if (!words.length) throw new Error('Give some words to look for.');
  const hits = Object.values(loadIndex().items).map((b) => {
    const hay = [b.text, b.read?.gist, b.read?.topic, b.read?.note, b.by?.handle, b.quoted?.text, b.card?.title].join(' ').toLowerCase();
    return { b, s: words.filter((w) => hay.includes(w)).length };
  }).filter((x) => x.s).sort((a, b) => b.s - a.s || b.b.saved - a.b.saved).slice(0, Number(flag('limit', 15)));
  for (const { b } of hits) console.log(`${day(b.saved)} @${b.by.handle} ${b.url}\n   ${(b.read?.gist || b.text).replace(/\s+/g, ' ').slice(0, 180)}`);
  if (!hits.length) console.log('Nothing matched.');
}

({ ingest, merge, topics, search }[cmd] || (() => { throw new Error('Use: ingest, merge, topics or search'); }))();
