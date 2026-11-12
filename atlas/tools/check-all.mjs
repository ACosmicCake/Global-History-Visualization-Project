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
for (const t of JSON.parse(fs.readFileSync(path.join(VIEWER, 'tours.json'), 'utf8'))) {
  for (const id of t.stops) if (!liveIds.has(id)) fails.push(`tour ${t.id}: unknown stop ${id}`);
  // a tour's editorial lines: one per stop at most, 25 words or fewer
  for (const [id, line] of Object.entries(t.lines || {})) {
    if (!t.stops.includes(id)) fails.push(`tour ${t.id}: a line for ${id}, which is not a stop`);
    if (String(line).trim().split(/\s+/).length > 25) fails.push(`tour ${t.id}: the line for ${id} is over 25 words`);
  }
}
const deep = JSON.parse(fs.readFileSync(path.join(VIEWER, 'deeptime.json'), 'utf8'));
for (const id of Object.keys(deep.scenes)) if (!liveIds.has(id)) fails.push(`deeptime scene: unknown record ${id}`);
for (const m of deep.marks) if (m.id && !liveIds.has(m.id)) fails.push(`deeptime mark: unknown record ${m.id}`);
for (const c of deep.film.chapters) if (!liveIds.has(c.record)) fails.push(`deeptime film: unknown record ${c.record}`);
// every script and module of the viewer, found by pattern so a new file is checked without editing a list (vendored
// libraries, installed packages and the 3D model sources are left out)
const SKIP_DIRS = new Set(['vendor', 'node_modules', 'models']);
const viewerFiles = (dir = VIEWER) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (SKIP_DIRS.has(e.name) ? [] : viewerFiles(path.join(dir, e.name))) : /\.(m?js)$/.test(e.name) ? [path.join(dir, e.name)] : []);
const scripts = viewerFiles().map(f => path.relative(VIEWER, f));
for (const f of scripts) {
  try { execFileSync(process.execPath, ['--check', path.join(VIEWER, f)], { stdio: 'pipe' }); } catch (e) { fails.push(`viewer/${f}: ${String(e.stderr).split('\n').slice(0, 5).join(' ')}`); }
}
// the browser's ES modules link: every import names a file that exists and a name it exports
try { execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', path.join(VIEWER, 'test', 'link.mjs')], { stdio: 'pipe' }); } catch (e) { fails.push(`viewer/app modules do not link: ${String(e.stderr).trim().split('\n').slice(0, 3).join(' ')}`); }
if (fails.length) { console.error(`${fails.length} problem(s):\n` + fails.slice(0, 200).join('\n')); process.exit(1); }
console.log(`ok: ${recs.length} record files, ${live.length} live, ${scripts.length} viewer scripts parse and the modules link`);
