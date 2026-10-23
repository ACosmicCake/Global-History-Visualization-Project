// Bundle every published record into viewer/site/atlas-data.json for the hosted globe.
// Run after each publish batch, then republish the artifact (viewer/site/index.html with its files).
// Usage: node viewer/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDS = path.resolve(HERE, '..', 'atlas', 'records');
const OUT = path.join(HERE, 'site', 'atlas-data.json');

const records = [];
for (const f of fs.readdirSync(RECORDS).sort()) {
  if (!f.endsWith('.json')) continue;
  const r = JSON.parse(fs.readFileSync(path.join(RECORDS, f), 'utf8'));
  if (r.status !== 'published') continue;
  // Internal bookkeeping stays in the data store; everything a visitor reads ships.
  const { changelog, author, parent_reconciliation, ...pub } = r;
  records.push(pub);
}
const data = { generated: new Date().toISOString(), count: records.length, records };
fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`${records.length} published records -> ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
