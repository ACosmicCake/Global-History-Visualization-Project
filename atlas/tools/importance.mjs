// Sets each record's importance score from its ratings in atlas/importance.json (definition: atlas/IMPORTANCE.md).
// Usage: node atlas/tools/importance.mjs          apply the ratings to the records
//        node atlas/tools/importance.mjs --check  list records whose score or ratings are out of step; change nothing
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, allRecords, readJSON, save, today, acquireLock } from './lib.mjs';

export function scoreOf({ r, d, t, l }) {
  const total = r + d + t + l;
  if (total >= 13) return r >= 3 && l >= 3 ? 5 : 4;
  if (total >= 10) return 4;
  if (total >= 7) return 3;
  if (total >= 4) return 2;
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const ratings = readJSON('importance.json', {});
  const recs = allRecords().filter(x => x.status !== 'stub' && x.importance);
  const unrated = recs.filter(x => !ratings[x.id]).map(x => x.id);
  const stale = recs.filter(x => ratings[x.id] && scoreOf(ratings[x.id]) !== x.importance.score);
  if (check) {
    console.log(`${unrated.length} unrated, ${stale.length} out of step`);
    [...unrated, ...stale.map(x => x.id)].forEach(id => console.log(`  ${id}`));
    process.exit(unrated.length || stale.length ? 1 : 0);
  }
  acquireLock();
  for (const rec of stale) {
    rec.importance.score = scoreOf(ratings[rec.id]);
    rec.updated = today();
    if (rec.published_at != null) {
      rec.record_version = (rec.record_version || 0) + 1;
      rec.changelog = [...(rec.changelog || []), { date: today(), version: rec.record_version, change: 'corrected' }];
    }
    save(rec);
  }
  if (stale.length) fs.appendFileSync(path.join(ROOT, 'changelog.md'), `${today()} · ${stale.length} records · corrected · rescored against atlas/IMPORTANCE.md; ratings in atlas/importance.json\n`, 'utf8');
  console.log(`rescored ${stale.length} of ${recs.length}; ${unrated.length} unrated`);
  unrated.forEach(id => console.log(`  unrated: ${id}`));
}
