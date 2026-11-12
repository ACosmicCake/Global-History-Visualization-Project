// Living Atlas viewer: static files plus a live API over atlas/records.
// Files that changed are read again on the next request, so the globe shows each record as soon as it is published.
// The API paths match the files build-static.mjs writes (api/pins.json, api/record/<id>.json), so the same viewer
// code runs here and on the static site.
// Usage: node viewer/server.mjs [port]   (default 8787)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { published, pinsPayload, teasersPayload, recordPayload, searchPayload, recordsSeen, warmLinks } from './api.mjs';
import { recordPage, browsePage, recentPayload, feed } from './pages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.argv[2] || process.env.PORT || 8787);
let pinsAnswer = { version: -1, json: '' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (url.pathname === '/api/pins.json' || url.pathname === '/api/pins') {
    const recs = published();   // only worked out again when a record has changed
    if (pinsAnswer.version !== recordsSeen()) pinsAnswer = { version: recordsSeen(), json: JSON.stringify(pinsPayload(recs)) };
    return send(200, TYPES['.json'], pinsAnswer.json);
  }
  if (url.pathname === '/api/teasers.json') return send(200, TYPES['.json'], JSON.stringify(teasersPayload()));
  if (url.pathname === '/api/search.json') return send(200, TYPES['.json'], JSON.stringify(searchPayload()));
  if (url.pathname === '/api/recent.json') return send(200, TYPES['.json'], JSON.stringify(recentPayload(published())));
  if (url.pathname === '/feed.xml') return send(200, 'application/atom+xml; charset=utf-8', feed(recentPayload(published())));
  if (url.pathname === '/browse.html') return send(200, TYPES['.html'], browsePage(published()));
  const page = url.pathname.match(/^\/r\/([^/]+?)\.html$/);
  if (page) {
    const r = recordPayload(decodeURIComponent(page[1]));
    return r ? send(200, TYPES['.html'], recordPage(r, new Map(published().map(x => [x.id, x.title])))) : send(404, 'text/plain', 'not found');
  }
  const rec = url.pathname.match(/^\/api\/record\/([^/]+?)(?:\.json)?$/);
  if (rec) {
    const r = recordPayload(decodeURIComponent(rec[1]));
    return r ? send(200, TYPES['.json'], JSON.stringify(r)) : send(404, 'text/plain', 'not found');
  }
  const file = path.join(HERE, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, ''));
  if (!file.startsWith(HERE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(404, 'text/plain', 'not found');
  send(200, TYPES[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
}).listen(PORT, () => { console.log(`Living Atlas viewer on http://localhost:${PORT}`); setTimeout(warmLinks, 0); });
