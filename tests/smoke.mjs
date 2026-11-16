#!/usr/bin/env node
// Runs the pipeline end to end on made-up bookmarks, in a throwaway folder.
// No browser, no network, no X account.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'bookmark-debt', 'scripts');
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-debt-test-'));
const bd = path.join(cwd, '.bookmark-debt');
fs.mkdirSync(bd);
fs.writeFileSync(path.join(cwd, 'app.js'), '// the project being audited\n');

const run = (file, ...args) => spawnSync(process.execPath, [path.join(scripts, file), ...args], { cwd, encoding: 'utf8' });
const ok = (file, ...args) => { const r = run(file, ...args); assert.equal(r.status, 0, `${file} ${args.join(' ')}\n${r.stderr}`); return r.stdout; };
const write = (name, value) => fs.writeFileSync(path.join(bd, name), JSON.stringify(value));
const pass = (name) => console.log(`ok - ${name}`);

for (const f of fs.readdirSync(scripts).filter((x) => /\.(mjs|js)$/.test(x))) {
  const r = spawnSync(process.execPath, ['--check', path.join(scripts, f)], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${f}: ${r.stderr}`);
}
pass('every script parses');

const DAY = 864e5, NOW = Date.parse('2026-06-30T12:00:00Z');
const items = Array.from({ length: 12 }, (_, i) => ({
  id: String(1000 + i), saved: NOW - i * 8 * DAY, posted: NOW - i * 9 * DAY, url: `https://x.com/example${i}/status/${1000 + i}`,
  by: { name: `Example ${i}`, handle: `example${i}`, avatar: '' },
  text: i === 3 ? 'A new way to do pricing pages for small teams' : `Example post number ${i}`,
  media: [], card: null, quoted: null, likes: 1, views: 10,
}));
write('incoming.json', { account: 'someone', range: { from: '2026-03-01T00:00:00.000Z', to: '2026-06-30T23:59:59.000Z' }, items });

let out = JSON.parse(ok('index.mjs', 'ingest', '--per', '5'));
assert.equal(out.toRead, 12);
assert.equal(out.readerFiles.length, 3);
pass('ingest writes reader files for unread bookmarks');

const row = (id, now, direction, taste) => ({ id: String(id), now, direction, taste, topic: id < 1006 ? 'pricing' : 'onboarding', gist: `gist for ${id} about pricing`, note: `Why ${id} matters to this project.` });
fs.writeFileSync(path.join(bd, 'scores', 'reader-0.json'), JSON.stringify(items.map((b, i) => row(b.id, i === 0 ? 3 : 0, i === 1 ? 2 : 0, i === 2 ? 3 : i === 4 ? 2 : 0))));
out = JSON.parse(ok('index.mjs', 'merge'));
assert.equal(out.missingCount, 0);
assert.equal(out.problemCount, 0);
assert.equal(out.picked, 3, 'keeps now 2+, direction 2+, or taste 3, and not taste 2 alone');
pass('merge checks rows and picks the keepers');

fs.writeFileSync(path.join(bd, 'scores', 'reader-1.json'), JSON.stringify([{ id: '9999', now: 0, direction: 0, taste: 0, topic: 'x', gist: 'y' }, { id: '1000', now: 9, direction: 0, taste: 0, topic: 'x', gist: 'y' }]));
out = JSON.parse(ok('index.mjs', 'merge'));
assert.equal(out.problemCount, 2, 'flags an unknown id and a bad score');
fs.rmSync(path.join(bd, 'scores', 'reader-1.json'));
pass('merge reports bad rows');

assert.match(ok('index.mjs', 'topics'), /pricing — 6 saved/);
assert.match(ok('index.mjs', 'search', 'pricing pages'), /example3/);
pass('topics and search');

const out2 = JSON.parse(ok('index.mjs', 'ingest'));
assert.equal(out2.toRead, 0, 'a re-run only reads what is new');
pass('re-runs skip what was already read');

const long = 'This sentence is here so the field has enough words to pass the check for a properly argued section of the report, with a little more for safety, plus a few extra words.';
const idea = (kind) => ({ title: `A ${kind} idea`, kind, confidence: 'high', status: 'partial', where: ['app.js'], what: long, whyNow: long, inProduct: long, cost: long, against: long, next: long, evidence: ['1000'] });
const analysis = {
  project: { name: 'Example' }, account: 'someone', range: { from: '2026-03-01', to: '2026-06-30' }, scanned: 12,
  headline: 'A headline.', direction: long,
  ideas: [idea('original'), idea('build'), idea('cut'), idea('respond')],
  lost: [{ title: 'A lost idea', kind: 'never-built', confidence: 'low', status: 'absent', where: [], story: long, worth: long, next: long, evidence: ['1005'] }],
  themes: [{ title: 'A theme', summary: 'Summary', fit: 'Fit', ids: ['1000', '1001'] }],
};
write('analysis.json', analysis);
assert.match(ok('check.mjs'), /Report holds up/);
pass('check accepts a complete report');

for (const [name, change] of [
  ['thin idea', (a) => { a.ideas[0].what = 'Too short.'; }],
  ['missing file', (a) => { a.ideas[0].where = ['does/not/exist.js']; }],
  ['unknown bookmark', (a) => { a.ideas[0].evidence = ['424242']; }],
  ['no original idea', (a) => { a.ideas[0].kind = 'build'; }],
  ['no lost ideas', (a) => { a.lost = []; }],
]) {
  const bad = structuredClone(analysis); change(bad); write('analysis.json', bad);
  assert.equal(run('check.mjs').status, 1, `check should refuse: ${name}`);
}
write('analysis.json', analysis);
pass('check refuses thin or unverifiable reports');

ok('board.mjs');
const html = fs.readFileSync(path.join(bd, 'board.html'), 'utf8');
for (const s of ['A lost idea', 'A original idea', 'A theme', 'gist for 1003 about pricing']) assert.ok(html.includes(s), `board is missing "${s}"`);
assert.ok(html.indexOf('data-s="lost"') > 0);
pass('board includes lost ideas, ideas, themes and search');

const projectOut = ok('project.mjs');
assert.match(projectOut, /fileCount/);
pass('project inventory runs');

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(scripts, 'bridge.mjs')], { cwd });
  child.on('error', reject);
  child.stdout.once('data', async (chunk) => {
    try {
      const { port, token } = JSON.parse(String(chunk));
      const url = (p) => `http://127.0.0.1:${port}${p}`;
      assert.equal((await fetch(url('/save?token=wrong&name=a.json'), { method: 'POST', body: '{}' })).status, 404);
      assert.equal((await fetch(url(`/save?token=${token}&name=..%2Fevil.sh`), { method: 'POST', body: 'x' })).status, 400);
      assert.equal((await fetch(url(`/save?token=${token}&name=saved.json`), { method: 'POST', body: '{"ok":true}' })).status, 200);
      assert.equal(fs.readFileSync(path.join(bd, 'saved.json'), 'utf8'), '{"ok":true}');
      assert.ok(!fs.existsSync(path.join(cwd, 'evil.sh')));
      await fetch(url(`/stop?token=${token}`), { method: 'POST' });
      child.once('exit', resolve);
    } catch (err) { child.kill(); reject(err); }
  });
});
pass('receiver needs the token, stays inside .bookmark-debt, and stops when told');

fs.rmSync(cwd, { recursive: true, force: true });
console.log('\nAll good.');
