// Static build of the viewer for GitHub Pages (or any static host): the viewer's files plus the API as plain JSON,
// api/pins.json and api/record/<id>.json, which are the paths the viewer fetches and server.mjs also answers.
// Internal bookkeeping (changelog, author, parent_reconciliation) stays out of the published copies.
// Usage: node viewer/build-static.mjs [outDir]   (default dist/ at the project root)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { published, pinsPayload, recordPayload, readLinks } from './api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(process.argv[2] || path.join(HERE, '..', 'dist'));
const SKIP = new Set(['server.mjs', 'api.mjs', 'build.mjs', 'build-static.mjs']); // tools, not part of the site

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(HERE)) {
  if (SKIP.has(f)) continue;
  fs.cpSync(path.join(HERE, f), path.join(OUT, f), { recursive: true });
}

const recs = published(), links = readLinks();
fs.mkdirSync(path.join(OUT, 'api', 'record'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'api', 'pins.json'), JSON.stringify(pinsPayload(recs)));
for (const r of recs) {
  const { changelog, author, parent_reconciliation, ...pub } = recordPayload(r.id, links);
  fs.writeFileSync(path.join(OUT, 'api', 'record', `${r.id}.json`), JSON.stringify(pub));
}
fs.writeFileSync(path.join(OUT, '.nojekyll'), ''); // serve files as they are (no Jekyll processing on GitHub Pages)

let bytes = 0;
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } };
walk(OUT);
console.log(`built ${recs.length} records -> ${path.relative(process.cwd(), OUT) || '.'} (${(bytes / 1048576).toFixed(1)} MB)`);
