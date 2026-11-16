#!/usr/bin/env node
// What to read before writing .bookmark-debt/project-map.md, and whether the map is stale.
//
//   node project.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const head = git('rev-parse', '--short', 'HEAD') || null;
const map = '.bookmark-debt/project-map.md';
const stamp = fs.existsSync(map) ? (fs.readFileSync(map, 'utf8').match(/map-commit:\s*(\w+)/) || [])[1] : null;
const files = (git('ls-files', '-co', '--exclude-standard') || '').split('\n').filter(Boolean);
const skip = /(^|\/)(node_modules|dist|build|vendor|\.git|\.bookmark-debt|Pods|coverage|\.next)(\/|$)/;
const exists = (f) => { try { return fs.statSync(f); } catch { return null; } };

// Your own words: where abandoned and half-formed ideas tend to live.
const docRe = /\.(md|mdx|txt|html|rtf|org)$/i;
const boiler = /(^|\/)(LICENSE|LICENCE|NOTICE|CODE_OF_CONDUCT|SECURITY|CONTRIBUTING|CHANGELOG|SOURCES|THIRD_PARTY)[^/]*$/i;
const perArea = {};
// Capped per top-level folder, so a vendored tree can't crowd out their own notes.
const docs = files.filter((f) => docRe.test(f) && !skip.test(f) && !boiler.test(f) && !/(^|\/)(skills|\.agents|\.claude)\//.test(f))
  .map((f) => ({ f, s: exists(f) })).filter((x) => x.s && x.s.size > 200)
  .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs)
  .filter(({ f }) => { const k = f.split('/')[0]; perArea[k] = (perArea[k] || 0) + 1; return perArea[k] <= 40; })
  .map(({ f, s }) => `${s.mtime.toISOString().slice(0, 10)} ${(s.size / 1024).toFixed(0).padStart(5)}KB ${f}`);

const areas = {};
for (const f of files) { if (skip.test(f) || docRe.test(f)) continue; const k = f.includes('/') ? f.split('/')[0] : '(root)'; areas[k] = (areas[k] || 0) + 1; }

console.log(JSON.stringify({ head, map: stamp ? { commit: stamp, stale: stamp !== head } : 'none yet', fileCount: files.length, areas }, null, 1));
console.log('\nRecent commits:\n' + (git('log', '--oneline', '-40') || '(no git history)'));
console.log('\nUncommitted work:\n' + (git('status', '--short').split('\n').slice(0, 40).join('\n') || '(none)'));
console.log('\nYour docs, newest first:\n' + docs.join('\n'));
