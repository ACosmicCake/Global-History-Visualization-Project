// Living Atlas viewer: static files plus a live API over atlas/records.
// Every request re-reads the records, so the globe shows each record as soon as it is published.
// The API paths match the files build-static.mjs writes (api/pins.json, api/record/<id>.json), so the same viewer
// code runs here and on the static site.
// Usage: node viewer/server.mjs [port]   (default 8787)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinsPayload, recordPayload } from './api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.argv[2] || process.env.PORT || 8787);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (url.pathname === '/api/pins.json' || url.pathname === '/api/pins') return send(200, TYPES['.json'], JSON.stringify(pinsPayload()));
  const rec = url.pathname.match(/^\/api\/record\/([^/]+?)(?:\.json)?$/);
  if (rec) {
    const r = recordPayload(decodeURIComponent(rec[1]));
    return r ? send(200, TYPES['.json'], JSON.stringify(r)) : send(404, 'text/plain', 'not found');
  }
  const file = path.join(HERE, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, ''));
  if (!file.startsWith(HERE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'text/plain', 'not found');
  send(200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
}).listen(PORT, () => console.log(`Living Atlas viewer on http://localhost:${PORT}`));
