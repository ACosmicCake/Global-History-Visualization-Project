// Static build of the viewer for GitHub Pages (or any static host): the viewer's files plus the API as plain JSON,
// api/pins.json and api/record/<id>.json, which are the paths the viewer fetches and server.mjs also answers.
// recordPayload keeps internal bookkeeping (changelog, author, reviewer notes) out of the published copies.
// Usage: node viewer/build-static.mjs [outDir]   (default dist/ at the project root)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { published, pinsPayload, teasersPayload, recordPayload, searchPayload, linkIndex, readLinks } from './api.mjs';
import { recordPage, browsePage, coveragePage, sitemap, robots, recentPayload, feed } from './pages.mjs';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, '..', 'dist'));
const SKIP = new Set(['server.mjs', 'api.mjs', 'build-static.mjs', 'pages.mjs', 'test',   // tools, not part of the site
  'models']);   // 3D monument models: paused and not loaded by the viewer, so kept in the repo but not deployed
const NOT_SITE = /\.(glb|py)$|build_morph\.mjs$/;                                  // source files for the models and plate data

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(HERE)) {
  if (SKIP.has(f)) continue;
  fs.cpSync(path.join(HERE, f), path.join(OUT, f), { recursive: true, filter: src => !NOT_SITE.test(src) });
}

const recs = published(), links = readLinks(), index = linkIndex(recs), titles = new Map(recs.map(r => [r.id, r.title]));
fs.mkdirSync(path.join(OUT, 'api', 'record'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'r'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'api', 'pins.json'), JSON.stringify(pinsPayload(recs)));
fs.writeFileSync(path.join(OUT, 'api', 'teasers.json'), JSON.stringify(teasersPayload(recs)));
fs.writeFileSync(path.join(OUT, 'api', 'search.json'), JSON.stringify(searchPayload(recs)));
for (const r of recs) {
  const pub = recordPayload(r.id, links, index);
  fs.writeFileSync(path.join(OUT, 'api', 'record', `${r.id}.json`), JSON.stringify(pub));
  fs.writeFileSync(path.join(OUT, 'r', `${r.id}.html`), recordPage(pub, titles));
}
const recent = recentPayload(recs);
fs.writeFileSync(path.join(OUT, 'api', 'recent.json'), JSON.stringify(recent));
fs.writeFileSync(path.join(OUT, 'feed.xml'), feed(recent));
fs.writeFileSync(path.join(OUT, 'browse.html'), browsePage(recs, recent));
fs.writeFileSync(path.join(OUT, 'coverage.html'), coveragePage(recs));
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sitemap(recs));
fs.writeFileSync(path.join(OUT, 'robots.txt'), robots());
// Which deploy is live, for the service worker (sw.js): a new version empties its cache. Set "sw" to false here to switch
// the worker off for every visitor on their next page load.
let version = process.env.GITHUB_SHA;
try { version = version || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: HERE, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ version: (version || String(Date.now())).slice(0, 12), built: new Date().toISOString(), sw: true }));
fs.writeFileSync(path.join(OUT, '.nojekyll'), ''); // serve files as they are (no Jekyll processing on GitHub Pages)

let bytes = 0;
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } };
walk(OUT);
console.log(`built ${recs.length} records -> ${path.relative(process.cwd(), OUT) || '.'} (${(bytes / 1048576).toFixed(1)} MB)`);

// Size budget (viewer/test/budget.json): the pin list is on the critical path of every first visit, so it may not grow
// unnoticed. The first-load total is measured in a browser by viewer/test/smoke.mjs.
const budget = JSON.parse(fs.readFileSync(path.join(HERE, 'test', 'budget.json'), 'utf8'));
const pinsBytes = fs.statSync(path.join(OUT, 'api', 'pins.json')).size, MB = n => `${(n / 1e6).toFixed(2)} MB`;
console.log(`api/pins.json: ${MB(pinsBytes)} (budget ${MB(budget.pinsJson)})`);
if (pinsBytes > budget.pinsJson) { console.error(`api/pins.json is over its budget in viewer/test/budget.json`); process.exit(1); }
