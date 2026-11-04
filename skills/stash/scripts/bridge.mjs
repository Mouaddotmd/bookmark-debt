#!/usr/bin/env node
// A tiny receiver on 127.0.0.1 so the page can hand bookmarks straight to
// .stash/ without an agent copying them. Local only, one random token, and it
// exits by itself when told to or after 15 idle minutes.
//
//   node bridge.mjs [--out .stash]     prints {"port":…,"token":…}
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const i = args.indexOf('--out');
const outDir = path.resolve(i >= 0 ? args[i + 1] : '.stash');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, '.gitignore'), '*\n');
const token = crypto.randomBytes(16).toString('hex');

let idle;
const touch = () => { clearTimeout(idle); idle = setTimeout(() => process.exit(0), 15 * 60 * 1000); };
touch();

// The page that holds the data posts to this helper window, which is on our
// own origin, so X's content security policy doesn't apply to the upload.
const receiver = `<!doctype html><meta charset="utf-8"><title>Stash receiver</title><body style="font:14px system-ui;padding:24px">Stash is saving to your computer. This window closes by itself.<script>
const T=${JSON.stringify(token)};
addEventListener('message',async(e)=>{
  if(!/^https:\\/\\/(x|twitter)\\.com$/.test(e.origin)||!e.data||e.data.token!==T)return;
  const r=await fetch('/save?token='+T+'&name='+encodeURIComponent(e.data.name),{method:'POST',body:e.data.body});
  e.source.postMessage({stash:'saved',name:e.data.name,ok:r.ok,bytes:e.data.body.length},e.origin);
  if(e.data.last)setTimeout(()=>close(),200);
});
if(opener)opener.postMessage({stash:'ready'},'*');
</script>`;

const server = http.createServer((req, res) => {
  touch();
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/receiver' && url.searchParams.get('token') === token) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(receiver);
  }
  if (req.method === 'POST' && url.pathname === '/save' && url.searchParams.get('token') === token) {
    const name = path.basename(url.searchParams.get('name') || '');
    if (!/^[\w.-]+\.json$/.test(name)) { res.writeHead(400); return res.end(); }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      fs.writeFileSync(path.join(outDir, name), Buffer.concat(chunks));
      console.log(JSON.stringify({ saved: name, bytes: Buffer.concat(chunks).length }));
      res.writeHead(200); res.end('ok');
    });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/stop' && url.searchParams.get('token') === token) {
    res.writeHead(200); res.end('bye'); return setTimeout(() => process.exit(0), 50);
  }
  res.writeHead(404); res.end();
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port, token })));
