// Step 7: publish and log. Usage: node atlas/tools/publish.mjs <id> [--change new|enriched|corrected] [--not-duplicate-of <id>]
// Runs the gate and the duplicate check, flips status to published, bumps record_version, appends the changelog,
// creates invisible stubs for missing related ids, closes the queue item, rebuilds the coverage map and
// says when a progress report (every 50) or an independent audit (every 100) is due.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SCHEMA_VERSION, allRecords, exists, load, save, today, normName, readJSON, writeJSON, acquireLock } from './lib.mjs';
import { gate } from './gate.mjs';
import { buildCoverage } from './coverage.mjs';

const args = process.argv.slice(2);
const id = args[0];
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
if (!id || !exists(id)) { console.error(`no record ${id}`); process.exit(1); }

acquireLock();
const rec = load(id);
const { fail, warn } = gate(rec);
if (fail.length) { console.error(`GATE FAILED for ${id}:\n  ✗ ${fail.join('\n  ✗ ')}`); process.exit(1); }

// Duplicate check by title and every alias against all other non-stub records (spec 7 step 2, 11.6).
const allowed = new Set((opt('--not-duplicate-of') || '').split(',').filter(Boolean));
const names = new Set([rec.title, ...(rec.aliases || []).map(a => a.name)].map(normName).filter(n => n.length > 3));
const clashes = [];
for (const o of allRecords()) {
  if (o.id === id || o.status === 'stub' || allowed.has(o.id)) continue;
  for (const n of [o.title, ...(o.aliases || []).map(a => a.name)].map(normName)) if (names.has(n)) clashes.push(`${o.id} (“${n}”)`);
}
if (clashes.length) {
  console.error(`POSSIBLE DUPLICATE of ${[...new Set(clashes)].join(', ')}. Merge/enrich, or re-run with --not-duplicate-of <id>.`);
  process.exit(1);
}

const prevPublished = rec.published_at != null;
const outline = rec.tier === 'outline'; // outline tier: a sourced pin, upgraded to a full record later
const change = opt('--change') || (outline ? 'outline' : prevPublished ? 'enriched' : 'new');
rec.status = outline ? 'outline' : 'published';
rec.record_version = (rec.record_version || 0) + (prevPublished ? 1 : 0) || 1;
rec.updated = today();
rec.published_at = rec.published_at || new Date().toISOString();
rec.changelog = [...(rec.changelog || []).filter(c => c.version !== rec.record_version), { date: today(), version: rec.record_version, change }];
save(rec);

// Stubs for missing related records (invisible until written).
const stubs = [];
for (const r of rec.related || []) {
  if (exists(r.id)) continue;
  const prefix = r.id.split('-')[0];
  const kind = { person: 'person', place: 'place', polity: 'polity', org: 'organization', species: 'species' }[prefix] || r.kind || 'event';
  const title = r.title || r.id.replace(/^(person|place|polity|org|species)-/, '').replace(/^-?\d+(my|ka)?(-\d\d){0,2}-/, '')
    .split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  save({ id: r.id, title, kind, status: 'stub', schema_version: SCHEMA_VERSION, created_from: id, created: today(),
    note: `Stub created from ${id} (${r.type}${r.because ? `: ${r.because}` : ''}).` });
  stubs.push(r.id);
}

// Changelog line: date · id · new|enriched|corrected · confidence · least-certain field
const line = `${today()} · ${id} · ${change} · ${rec.confidence}${rec.provisional ? '+provisional' : ''} · ${rec.reviewer_note.replace(/\s+/g, ' ')}\n`;
fs.appendFileSync(path.join(ROOT, 'changelog.md'), line, 'utf8');

// Queue: close the item; queue each new stub so it gets written.
const q = readJSON('queue.json', { items: [] });
if (outline) { // an outline stays in the queue as an upgrade target
  let it = q.items.find(i => i.id === id);
  if (!it) { it = { id, title: rec.title, kind: rec.kind, region: rec.regions[0], year: rec.when.start.year, domain: rec.domains[0], significance: 20 * rec.importance.score, demand: 50, availability: 70, added: today() }; q.items.push(it); }
  Object.assign(it, { source: 'enrichment', method: 'upgrade-outline', status: 'open', claimed_by: null, outlined: today() });
} else for (const it of q.items) if (it.id === id && it.status !== 'done') { it.status = 'done'; it.done = today(); it.claimed_by = null; }
for (const s of stubs) if (!q.items.some(i => i.id === s))
  q.items.push({ id: s, title: load(s).title, kind: load(s).kind, source: 'discovery', method: 'stub-from-links', from: id,
    region: rec.regions[0], year: rec.when.start.year, domain: rec.domains[0], significance: 40, demand: 40, availability: 60,
    status: 'open', added: today(), claimed_by: null });
writeJSON('queue.json', q);

const cov = buildCoverage();
const state = readJSON('state.json', {});
if (change === 'new') state.published_new = (state.published_new || 0) + 1;
else if (change === 'outline') state.outlines = (state.outlines || 0) + 1;
else state.enriched = (state.enriched || 0) + 1;
const total = (state.published_new || 0) + (state.enriched || 0); // outlines do not count toward reports/audits
state.last_publish = { id, at: rec.published_at, change };
writeJSON('state.json', state);

console.log(`${outline ? 'OUTLINED' : 'PUBLISHED'} ${id} v${rec.record_version} (${change}); stubs: ${stubs.length ? stubs.join(', ') : 'none'}`);
warn.forEach(m => console.log(`  ! ${m}`));
console.log(`passes: ${total}; balance batch ${cov.balance.batch}: ${cov.balance.size} records, Europe+N.America ${cov.balance.europe_northern_america}`);
if (total % 50 === 0) console.log('>> PROGRESS REPORT DUE (spec 10): write atlas/reports/progress-NNNN.md');
if (total % 100 === 0) console.log('>> INDEPENDENT AUDIT DUE: 5 random published records re-verified by a different agent');
