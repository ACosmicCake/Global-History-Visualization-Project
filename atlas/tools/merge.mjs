// Merge a duplicate id into the record that covers the same thing (spec 11: ids are forever, so the old id
// becomes a redirect). Repoints every related link and closes the old queue item.
// Usage: node atlas/tools/merge.mjs <old-id> <into-id>
import fs from 'node:fs';
import { RECORDS, load, save, exists, readJSON, writeJSON, acquireLock, today } from './lib.mjs';

const [from, into] = process.argv.slice(2);
if (!from || !into || !exists(from) || !exists(into)) { console.error('usage: merge.mjs <old-id> <into-id> (both must exist)'); process.exit(1); }
acquireLock();
const old = load(from);
if (old.status === 'published' || old.status === 'outline') {
  // A published id stays readable: keep its content but point visitors and links at the surviving record.
  console.log(`note: ${from} is ${old.status}; it keeps its content and gains merged_into`);
}
old.merged_into = into; old.updated = today();
old.note = `${old.note || ''} Merged into ${into} (${today()}).`.trim();
save(old);
let relinked = 0;
for (const f of fs.readdirSync(RECORDS)) {
  if (!f.endsWith('.json') || f === `${from}.json`) continue;
  const id = f.slice(0, -5), text = fs.readFileSync(`${RECORDS}/${f}`, 'utf8');
  if (!text.includes(from)) continue;
  const r = JSON.parse(text); let n = 0;
  for (const x of r.related || []) if (x.id === from) { x.id = into; n++; }
  if (n) { save(r); relinked++; console.log(`relinked ${id}`); }
}
const q = readJSON('queue.json', { items: [] });
for (const it of q.items) if (it.id === from) { it.status = 'done'; it.note = `merged into ${into}`; it.claimed_by = null; }
writeJSON('queue.json', q);
console.log(`merged ${from} -> ${into}; ${relinked} records relinked`);
