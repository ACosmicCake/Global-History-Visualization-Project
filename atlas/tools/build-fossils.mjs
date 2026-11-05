// Builds viewer/paleo/fossils.json: where fossils of eight groups have been found, and in rocks of what age, from the Paleobiology Database
// (paleobiodb.org; its data service states Creative Commons CC0 on its downloads, and it is credited all the same). It also adds a "life" curve to
// viewer/paleo/vitals.json: how many animal and plant genera are known from each stage.
// Download into one folder, outside the repo, from https://paleobiodb.org/data1.2/occs/list.csv?base_name=<names>&max_ma=560&min_ma=2&show=coords,class&vocab=pbdb
//   trilobites.csv Trilobita; brachiopods.csv Brachiopoda; ammonites.csv Ammonoidea; fish.csv Chondrichthyes,Actinopterygii,Placodermi,Agnatha;
//   dinosaurs.csv Dinosauria^Aves (no birds); mammals.csv Mammalia; insects.csv Insecta; plants.csv Plantae
// and diversity.json from https://paleobiodb.org/data1.2/occs/diversity.json?base_name=Metazoa,Plantae&count=genera&time_reso=stage
//
// Finds in the same half-degree cell, of the same group and dated to the same range, become one dot with a count. Each dot is put on the plate its place
// sits on today, by the rule the viewer uses for pins (the map of plates in morph.json, or else within 8 degrees of a coastline), so it moves with the land. Places with no plate
// are left out, as are finds dated no better than 30 million years. Columns are integers: lat and lon in tenths of a degree, old and young in tenths of a million years.
// Usage: node atlas/tools/build-fossils.mjs <folder>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './lib.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: build-fossils.mjs <folder>'); process.exit(1); }
const VIEWER = path.resolve(ROOT, '..', 'viewer');
const GROUPS = [['trilobites', 'Trilobites'], ['brachiopods', 'Brachiopods'], ['ammonites', 'Ammonites'], ['fish', 'Fish'], ['dinosaurs', 'Dinosaurs'], ['mammals', 'Mammals'], ['insects', 'Insects'], ['plants', 'Plants']];
const CELL = 0.5, MAX_SPAN = 30;
// Groups that died out: anything dated wholly after the end is left out, because it is a reworked fossil or, for dinosaurs, a bird the database files outside Aves
const LAST = { trilobites: 251.9, ammonites: 66, dinosaurs: 66 };

const morph = JSON.parse(fs.readFileSync(path.join(VIEWER, 'paleo', 'morph.json'), 'utf8'));
for (const r of morph.rings) { const xs = r.pts.map(p => p[0]), ys = r.pts.map(p => p[1]); r.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
const inRing = (lon, lat, pts) => { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside; } return inside; };
const plates = new Map(), plateCells = new Int32Array(360 * 180);
{ let at = 0; for (let i = 0; i < morph.grid.length; i += 2) { plateCells.fill(morph.grid[i], at, at + morph.grid[i + 1]); at += morph.grid[i + 1]; } }
function plateOf(lat, lon) {   // the same rule as plateOf in viewer/space.js
  const cell = plateCells[Math.min(179, Math.max(0, Math.floor(90 - lat))) * 360 + Math.min(359, Math.max(0, Math.floor(lon + 180)))]; if (cell >= 0) return cell;
  const key = `${lat},${lon}`; if (plates.has(key)) return plates.get(key);
  let best = null, bd = 8;
  for (const r of morph.rings) {
    const [x0, y0, x1, y1] = r.box;
    if (lat < y0 - 8 || lat > y1 + 8 || (lon < x0 - 12 && x1 - x0 < 300) || (lon > x1 + 12 && x1 - x0 < 300)) continue;
    if (inRing(lon, lat, r.pts)) { best = r.p; break; }
    for (const [x, y] of r.pts) { const d = Math.hypot((x - lon) * Math.cos((lat * Math.PI) / 180), y - lat); if (d < bd) { bd = d; best = r.p; } }
  }
  plates.set(key, best); return best;
}
function* rows(text) {   // quoted CSV
  let i = 0; const n = text.length;
  while (i < n) {
    const row = [];
    for (;;) {
      if (text[i] === '"') { let j = i + 1, s = ''; for (;;) { const k = text.indexOf('"', j); if (k < 0) { s += text.slice(j); j = n; break; } s += text.slice(j, k); if (text[k + 1] === '"') { s += '"'; j = k + 2; } else { j = k + 1; break; } } row.push(s); i = j; }
      else { let j = i; while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++; row.push(text.slice(i, j)); i = j; }
      if (text[i] === ',') { i++; continue; }
      while (text[i] === '\r' || text[i] === '\n') i++;
      break;
    }
    yield row;
  }
}
const dots = new Map(), report = [];
GROUPS.forEach(([file], g) => {
  let head = null, finds = 0, loose = 0, placeless = 0, late = 0;
  for (const r of rows(fs.readFileSync(path.join(dir, `${file}.csv`), 'utf8'))) {
    if (!head) { head = Object.fromEntries(r.map((c, i) => [c, i])); if (head.lng == null || head.max_ma == null) throw new Error(`${file}: unexpected columns`); continue; }
    const lon = +r[head.lng], lat = +r[head.lat], old = +r[head.max_ma], young = +r[head.min_ma];
    if (r[head.lng] === '' || r[head.lat] === '' || !Number.isFinite(lon + lat + old + young) || old > 600) continue;
    finds++;
    if (LAST[file] && old <= LAST[file]) { late++; continue; }
    if (old - young > MAX_SPAN) { loose++; continue; }
    const la = Math.round(lat / CELL) * CELL, lo = Math.round(lon / CELL) * CELL, p = plateOf(la, lo);
    if (p == null) { placeless++; continue; }
    const key = `${la},${lo},${p},${g},${old},${young}`, d = dots.get(key);
    if (d) d[6]++; else dots.set(key, [la, lo, p, g, old, young, 1]);
  }
  report.push(`${file}: ${finds.toLocaleString()} finds, ${loose.toLocaleString()} too loosely dated, ${placeless.toLocaleString()} with no plate, ${late.toLocaleString()} after the group's end`);
});
const list = [...dots.values()].sort((a, b) => b[4] - a[4]), col = f => list.map(f);
fs.writeFileSync(path.join(VIEWER, 'paleo', 'fossils.json'), JSON.stringify({
  groups: GROUPS.map(g => g[1]),
  source: `Paleobiology Database (paleobiodb.org), downloaded ${new Date().toISOString().slice(0, 10)}`,
  lat: col(d => Math.round(d[0] * 10)), lon: col(d => Math.round(d[1] * 10)), plate: col(d => d[2]), group: col(d => d[3]),
  old: col(d => Math.round(d[4] * 10)), young: col(d => Math.round(d[5] * 10)), n: col(d => d[6]),
}));
const raw = fs.readFileSync(path.join(VIEWER, 'paleo', 'fossils.json'));
console.log(report.join('\n')); console.log(`${list.length.toLocaleString()} dots; fossils.json ${(raw.length / 1e6).toFixed(2)} MB, ${(zlib.gzipSync(raw).length / 1e6).toFixed(2)} MB gzipped`);

// ---------- the diversity curve, one point per stage: every genus known to fall in it, ranging through gaps
const div = JSON.parse(fs.readFileSync(path.join(dir, 'diversity.json'), 'utf8')).records;
const pts = div.map(r => { const a = +r.eag, b = +r.lag, total = ['xft', 'xbl', 'xfl', 'xbt'].reduce((s, k) => s + (+r[k] || 0), 0); return [(a + b) / 2, total, r.nam]; }).filter(p => Number.isFinite(p[0]) && p[1] > 0 && p[0] <= 560).sort((a, b) => a[0] - b[0]);
const vitalsFile = path.join(VIEWER, 'paleo', 'vitals.json'), vitals = JSON.parse(fs.readFileSync(vitalsFile, 'utf8'));
vitals.series.life = { label: 'Known genera', unit: '', digits: 0, points: pts.map(p => [+p[0].toFixed(2), p[1]]), source: 'Animal and plant genera known as fossils from each stage, ranging through gaps, from the Paleobiology Database. These are raw counts: they rise toward the present partly because younger rocks survive better and have been searched more, so the sharp falls mean more than the long climb.' };
fs.writeFileSync(vitalsFile, JSON.stringify(vitals));
console.log(`life: ${pts.length} stages`); const at = ma => pts.reduce((b, p) => (Math.abs(p[0] - ma) < Math.abs(b[0] - ma) ? p : b));
for (const ma of [2, 30, 60, 70, 150, 200, 208, 240, 256, 300, 372, 380, 440, 448, 500, 540]) console.log(' ', ma, 'Ma:', at(ma)[1], at(ma)[2], `(${at(ma)[0].toFixed(1)})`);
