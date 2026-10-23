// Fill `where.paleo` on records that were written while the GPlates Web Service was down ({ pending: ... }).
// Age: the one named in the pending note ("paleo.mjs <lon> <lat> <age>"), else the midpoint of the record's dates.
// Usage: node atlas/tools/paleo-fill.mjs [--dry]
import { allRecords, save, today, acquireLock } from './lib.mjs';

const dry = process.argv.includes('--dry'), MODEL = 'MERDITH2021';
if (!dry) acquireLock();
let n = 0;
for (const r of allRecords()) {
  const p = r.where?.paleo;
  if (!p || !p.pending || r.where.lat == null) continue;
  const m = String(p.pending).match(/paleo\.mjs\s+(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)/);
  const lon = m ? Number(m[1]) : r.where.lon, lat = m ? Number(m[2]) : r.where.lat;
  const age = m ? Number(m[3]) : Math.round(-((r.when.start.year + r.when.end.year) / 2) / 1e4) / 100;
  if (!(age > 0 && age <= 1000)) { console.log(`${r.id}: age ${age} Ma outside the model`); continue; }
  const url = `https://gws.gplates.org/reconstruct/reconstruct_points/?points=${lon},${lat}&time=${age}&model=${MODEL}`;
  const res = await fetch(url).then(x => (x.ok ? x.json() : null)).catch(() => null);
  const c = res?.coordinates?.[0];
  if (!c) { console.log(`${r.id}: GPlates gave no position (service down or no plate at that point)`); continue; }
  let src = (r.sources || []).find(s => /gplates/.test(s.url || ''));
  if (!src) {
    src = { id: 'src-gplates-gws', url, title: `GPlates Web Service reconstruct_points, ${MODEL}, ${age} Ma`, publisher: 'EarthByte Group, University of Sydney (GPlates Web Service)', accessed: today(), class: 'dataset', opened: true, supports: ['where.paleo'] };
    r.sources.push(src);
  }
  r.where.paleo = { lat: Math.round(c[1] * 100) / 100, lon: Math.round(c[0] * 100) / 100, age_ma: age, plate_model: `${MODEL} (Merdith et al. 2021, Earth-Science Reviews 214:103477) via GPlates Web Service`, source: src.id, note: `Point ${lon}, ${lat} reconstructed to ${age} Ma.` };
  r.updated = today();
  if (!dry) save(r);
  console.log(`${r.id}: ${age} Ma -> ${r.where.paleo.lat}, ${r.where.paleo.lon}`); n++;
}
console.log(`${dry ? 'would fill' : 'filled'} ${n} pending paleo-positions`);
