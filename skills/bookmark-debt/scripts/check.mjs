#!/usr/bin/env node
// Refuses a thin report: every idea must be fully argued, tied to the real
// project and backed by real bookmarks. Run from the project root.
//
//   node check.mjs [--out .bookmark-debt]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const i = args.indexOf('--out');
const outDir = path.resolve(i >= 0 ? args[i + 1] : '.bookmark-debt');
const read = (f, d) => (fs.existsSync(path.join(outDir, f)) ? JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')) : d);
const a = read('analysis.json', null);
if (!a) { console.error('No .bookmark-debt/analysis.json'); process.exit(1); }
const known = new Set([...Object.keys(read('index.json', { items: {} }).items), ...read('picked.json', []).map((b) => b.id)]);
const errors = [], warnings = [];
const STATUS = ['shipped', 'partial', 'planned', 'abandoned', 'absent'];
const KINDS = ['build', 'original', 'respond', 'cut'];
const LOST = ['never-built', 'went-quiet', 'doc-revived', 'scooped'];
const CONF = ['high', 'medium', 'low'];

function where(label, list) {
  if (!Array.isArray(list)) return errors.push(`${label}: "where" must list files (it can be empty only for status "absent")`);
  for (const w of list) if (!fs.existsSync(String(w).split(':')[0])) errors.push(`${label}: "${w}" doesn't exist in this project`);
}
function evidence(label, ids, min = 1) {
  if (!Array.isArray(ids) || ids.length < min) return errors.push(`${label}: needs at least ${min} bookmark as evidence`);
  for (const id of ids) if (!known.has(String(id))) errors.push(`${label}: unknown bookmark ${id}`);
}
function words(label, field, v, min) {
  const n = String(v || '').trim().split(/\s+/).filter(Boolean).length;
  if (n < min) errors.push(`${label}: "${field}" is too thin (${n} words, needs ${min}+)`);
}
function common(label, x) {
  if (!STATUS.includes(x.status)) errors.push(`${label}: "status" must be one of ${STATUS.join(', ')}`);
  if (x.status && x.status !== 'absent' && !(x.where || []).length) errors.push(`${label}: status "${x.status}" must cite files in "where"`);
  where(label, x.where || []);
  if (!CONF.includes(x.confidence)) errors.push(`${label}: "confidence" must be one of ${CONF.join(', ')}`);
  words(label, 'next', x.next, 8);
}

if (!a.headline) errors.push('Missing headline');
words('report', 'direction', a.direction, 30);
for (const [n, x] of (a.ideas || []).entries()) {
  const label = `idea ${n + 1} "${x.title || '?'}"`;
  if (!KINDS.includes(x.kind)) errors.push(`${label}: "kind" must be one of ${KINDS.join(', ')}`);
  words(label, 'what', x.what, 25); words(label, 'whyNow', x.whyNow, 20); words(label, 'inProduct', x.inProduct, 25);
  words(label, 'cost', x.cost, 10); words(label, 'against', x.against, 15);
  common(label, x); evidence(label, x.evidence);
}
for (const [n, x] of (a.lost || []).entries()) {
  const label = `lost idea ${n + 1} "${x.title || '?'}"`;
  if (!LOST.includes(x.kind)) errors.push(`${label}: "kind" must be one of ${LOST.join(', ')}`);
  words(label, 'story', x.story, 25); words(label, 'worth', x.worth, 15);
  common(label, x); evidence(label, x.evidence);
}
for (const t of a.themes || []) evidence(`theme "${t.title}"`, t.ids);
if ((a.ideas || []).length < 4) errors.push('Fewer than 4 ideas');
if (!(a.ideas || []).some((x) => x.kind === 'original')) errors.push('No "original" idea: combine saves into something no single post says');
if (!(a.lost || []).length && !a.lostNote) errors.push('No lost ideas: add them, or say honestly in "lostNote" why none held up');
const respond = (a.ideas || []).filter((x) => x.kind === 'respond').length;
if (respond > (a.ideas || []).length / 2) warnings.push(`${respond} ideas just respond to competitors: push further`);
for (const w of warnings) console.log('warning: ' + w);
if (errors.length) { console.error(errors.map((e) => '✗ ' + e).join('\n')); process.exit(1); }
console.log(`Report holds up: ${a.ideas.length} ideas, ${(a.lost || []).length} lost ideas, ${(a.themes || []).length} themes.`);
