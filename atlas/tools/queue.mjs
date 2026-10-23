// Discovery queue (spec 7 and 8). State in atlas/queue.json; visitor corrections in atlas/corrections.json.
// Usage:
//   node atlas/tools/queue.mjs next [n]                 highest-priority open items (corrections, then seed, then score)
//   node atlas/tools/queue.mjs claim <id> <agent>       claim an item before working on it
//   node atlas/tools/queue.mjs release <id> [note]      release without publishing (failure / parked)
//   node atlas/tools/queue.mjs park <id> <note>         park: strong sources not available now
//   node atlas/tools/queue.mjs add <file.json>          add items from a JSON array (see fields below)
//   node atlas/tools/queue.mjs stats
// Item fields: { id, title, kind, source: "correction|seed|discovery|enrichment", seed_group?, method?,
//   from?, region, year, domain, significance, demand, availability (0-100 each), note }
import fs from 'node:fs';
import { readJSON, writeJSON, today, exists, normName, timeBin, acquireLock } from './lib.mjs';

const Q = () => readJSON('queue.json', { items: [] });

function gapScore(item, cov) {
  if (!cov) return 50;
  const bin = timeBin(item.year);
  const n = cov.cells?.[`${item.region}|${bin}|${item.domain}`] || 0;
  return Math.round(100 * (1 - Math.min(n, 10) / 10));
}

export function score(item, cov) {
  const gap = gapScore(item, cov);
  const enrich = item.source === 'enrichment' ? 100 : 0;
  return +(0.40 * (item.significance ?? 50) + 0.25 * gap + 0.15 * (item.demand ?? 50) +
    0.10 * enrich + 0.10 * (item.availability ?? 50)).toFixed(1);
}

const tier = it => ({ correction: 0, seed: 1 }[it.source] ?? 2);

export function ranked() {
  const q = Q(); const cov = readJSON('coverage_map.json', null);
  const corrections = readJSON('corrections.json', { items: [] }).items.filter(c => c.status === 'open')
    .map(c => ({ ...c, source: 'correction', priority: 1000 }));
  const open = q.items.filter(i => i.status === 'open').map(i => ({ ...i, priority: score(i, cov) }));
  open.sort((a, b) => tier(a) - tier(b) || (a.seed_group ?? 99) - (b.seed_group ?? 99) || b.priority - a.priority);
  return [...corrections, ...open];
}

function update(id, fn) {
  const q = Q(); const it = q.items.find(i => i.id === id);
  if (!it) { console.error(`no queue item ${id}`); process.exit(1); }
  fn(it); it.updated = today(); writeJSON('queue.json', q); return it;
}

if (process.argv[1].endsWith('queue.mjs')) {
  const [cmd, a, b] = process.argv.slice(2);
  if (['claim', 'release', 'park', 'add'].includes(cmd)) acquireLock();
  if (cmd === 'next') {
    for (const it of ranked().slice(0, +(a || 10)))
      console.log(`${String(it.priority).padStart(6)}  ${it.source.padEnd(10)} ${it.id}  — ${it.title}`);
  } else if (cmd === 'claim') {
    const it = update(a, i => {
      if (i.status === 'claimed' && i.claimed_by !== b) { console.error(`held by ${i.claimed_by}`); process.exit(2); }
      i.status = 'claimed'; i.claimed_by = b; i.claimed_at = today();
    });
    console.log(`claimed ${it.id} for ${b}`);
  } else if (cmd === 'release') {
    update(a, i => { i.status = 'open'; i.claimed_by = null; if (b) i.note = b; }); console.log(`released ${a}`);
  } else if (cmd === 'park') {
    update(a, i => { i.status = 'parked'; i.claimed_by = null; i.note = b; }); console.log(`parked ${a}`);
  } else if (cmd === 'add') {
    const q = Q(); const add = JSON.parse(fs.readFileSync(a, 'utf8'));
    const known = new Set(q.items.map(i => i.id));
    const knownTitles = new Set(q.items.map(i => normName(i.title)));
    let n = 0;
    for (const it of add) {
      const prev = q.items.find(i => i.id === it.id);
      if (prev && prev.status === 'done' && it.source === 'enrichment') {
        // Re-open a finished item for an enrichment pass (spec 7, "deepen the thin").
        Object.assign(prev, { ...it, status: 'open', claimed_by: null, reopened: today() }); n++; continue;
      }
      if (known.has(it.id) || knownTitles.has(normName(it.title))) { console.log(`skip duplicate ${it.id}`); continue; }
      if (exists(it.id) && it.source !== 'enrichment') {
        // A published/drafted record already exists: queue enrichment instead of a new record.
        it.source = 'enrichment';
      }
      q.items.push({ status: 'open', added: today(), claimed_by: null, ...it }); known.add(it.id); n++;
    }
    writeJSON('queue.json', q); console.log(`added ${n}`);
  } else if (cmd === 'stats') {
    const q = Q(); const c = {};
    for (const i of q.items) c[`${i.source}/${i.status}`] = (c[`${i.source}/${i.status}`] || 0) + 1;
    console.log(JSON.stringify(c, null, 1));
  } else {
    console.log('commands: next | claim | release | park | add | stats');
  }
}
