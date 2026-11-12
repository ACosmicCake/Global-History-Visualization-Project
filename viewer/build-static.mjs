// Static build of the viewer for GitHub Pages (or any static host): the viewer's files plus the API as plain JSON,
// api/pins.json and api/record/<id>.json, which are the paths the viewer fetches and server.mjs also answers.
// recordPayload keeps internal bookkeeping (changelog, author, reviewer notes) out of the published copies.
// Usage: node viewer/build-static.mjs [outDir]   (default dist/ at the project root)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { published, pinsPayload, recordPayload, searchPayload, linkIndex, readLinks } from './api.mjs';
import { recordPage, browsePage, sitemap, robots } from './pages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, '..', 'dist'));
const SKIP = new Set(['server.mjs', 'api.mjs', 'build-static.mjs', 'pages.mjs', 'test']); // tools, not part of the site
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
fs.writeFileSync(path.join(OUT, 'api', 'search.json'), JSON.stringify(searchPayload(recs)));
for (const r of recs) {
  const pub = recordPayload(r.id, links, index);
  fs.writeFileSync(path.join(OUT, 'api', 'record', `${r.id}.json`), JSON.stringify(pub));
  fs.writeFileSync(path.join(OUT, 'r', `${r.id}.html`), recordPage(pub, titles));
}
fs.writeFileSync(path.join(OUT, 'browse.html'), browsePage(recs));
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sitemap(recs));
fs.writeFileSync(path.join(OUT, 'robots.txt'), robots());
fs.writeFileSync(path.join(OUT, '.nojekyll'), ''); // serve files as they are (no Jekyll processing on GitHub Pages)

let bytes = 0;
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } };
walk(OUT);
console.log(`built ${recs.length} records -> ${path.relative(process.cwd(), OUT) || '.'} (${(bytes / 1048576).toFixed(1)} MB)`);
