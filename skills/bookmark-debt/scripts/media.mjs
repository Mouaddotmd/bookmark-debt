#!/usr/bin/env node
// Lets the agent actually see the bookmarks worth a closer look: images at a
// readable size and a few frames from each video, read straight from X's
// public media CDN (no full video download).
//
//   node media.mjs [--out .bookmark-debt] < picked.json
//
// stdin: the JSON array bd.get([...ids]) returned in the page.
// Writes .bookmark-debt/media/<id>/*.jpg (a cache the board reuses) and prints
// { id: [files] } so the agent knows what to look at.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--out');
const outDir = path.resolve(i >= 0 ? args[i + 1] : '.bookmark-debt');
const picked = JSON.parse(fs.readFileSync(0, 'utf8'));
const canFrame = process.platform === 'darwin';

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '.gitignore'), '*\n');

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

const result = {};
async function grab(b) {
  const dir = path.join(outDir, 'media', b.id);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    result[b.id] = fs.readdirSync(dir).map((f) => path.join(dir, f));
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [n, m] of b.media.entries()) {
    try {
      if (m.type === 'image') {
        const f = path.join(dir, `image-${n + 1}.jpg`);
        await download(`${m.image}?name=small`, f);
        files.push(f);
      } else if (m.video && canFrame) {
        const prefix = path.join(dir, `frame-${n + 1}`);
        const count = m.duration && m.duration > 40 ? 5 : 3;
        await run('swift', [path.join(here, 'frames.swift'), m.video, prefix, String(count)], { timeout: 120000 });
        for (let k = 1; k <= count; k++) if (fs.existsSync(`${prefix}-${k}.jpg`)) files.push(`${prefix}-${k}.jpg`);
      } else if (m.image) {
        const f = path.join(dir, `thumb-${n + 1}.jpg`);
        await download(`${m.image}?name=small`, f);
        files.push(f);
      }
    } catch (err) {
      console.error(`skip ${b.id} media ${n + 1}: ${err.message}`);
    }
  }
  result[b.id] = files;
}

// A few at a time: gentle on the CDN and on the Mac.
const queue = [...picked];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await grab(queue.shift()); }));
console.log(JSON.stringify(result, null, 1));
