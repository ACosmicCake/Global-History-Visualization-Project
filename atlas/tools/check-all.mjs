// The check CI runs before every deploy, and on pull requests: every record parses, every live record passes the quality
// gate, every link and tour stop points at a real record, and the viewer's scripts parse. Needs no network.
// Exits 1 with a list if anything fails.
// Usage: node atlas/tools/check-all.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, RECORDS } from './lib.mjs';
import { gate } from './gate.mjs';

const fails = [], recs = [];
for (const f of fs.readdirSync(RECORDS).filter(x => x.endsWith('.json'))) {
  try { recs.push(JSON.parse(fs.readFileSync(path.join(RECORDS, f), 'utf8'))); } catch (e) { fails.push(`${f}: not valid JSON (${e.message})`); }
}
const live = recs.filter(r => r.status === 'published' || r.status === 'outline'), ids = new Set(recs.map(r => r.id));
for (const r of live) {
  const problems = gate(r).fail;
  if (problems.length) fails.push(`${r.id}: ${problems.slice(0, 3).join('; ')}`);
  for (const x of r.related || []) if (!ids.has(x.id)) fails.push(`${r.id}: links to unknown record ${x.id}`);
}
const VIEWER = path.resolve(ROOT, '..', 'viewer'), liveIds = new Set(live.map(r => r.id));
for (const t of JSON.parse(fs.readFileSync(path.join(VIEWER, 'tours.json'), 'utf8'))) for (const id of t.stops) if (!liveIds.has(id)) fails.push(`tour ${t.id}: unknown stop ${id}`);
for (const f of ['app.js', 'space.js', 'spacecraft.js', 'borders.js', 'sequence.js', 'api.mjs', 'pages.mjs', 'server.mjs', 'build-static.mjs']) {
  try { execFileSync(process.execPath, ['--check', path.join(VIEWER, f)], { stdio: 'pipe' }); } catch (e) { fails.push(`viewer/${f}: ${String(e.stderr).split('\n').slice(0, 5).join(' ')}`); }
}
if (fails.length) { console.error(`${fails.length} problem(s):\n` + fails.slice(0, 200).join('\n')); process.exit(1); }
console.log(`ok: ${recs.length} record files, ${live.length} live, viewer scripts parse`);
