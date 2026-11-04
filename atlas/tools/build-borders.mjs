// Shrinks the Cliopatria polity borders (Seshat Global History Databank, CC BY 4.0) into viewer/site/borders/ for the
// globe's Borders layer, one file per span of years so a visitor downloads only the eras they reach: outlines simplified
// (Douglas-Peucker), specks dropped, coordinates at 0.01°, and a shape that a polity keeps across several dated entries
// stored once. These are the changes the licence asks us to indicate.
// Download the file from github.com/Seshat-Global-History-Databank/cliopatria and unzip it outside the repo.
// Usage: node --max-old-space-size=4096 atlas/tools/build-borders.mjs <cliopatria .geojson> [tolerance in degrees, default 0.15]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const [input, tol = '0.15'] = process.argv.slice(2);
if (!input) { console.error('usage: build-borders.mjs <cliopatria .geojson> [tolerance]'); process.exit(1); }
const TOL = +tol, MIN_RING = 0.02;   // square degrees: a smaller ring is dropped unless it is the polity's largest
const OUT = path.resolve(ROOT, '..', 'viewer', 'site', 'borders');
const BINS = [-3400, -1000, 0, 500, 1000, 1250, 1500, 1750, 1900, 2025];   // must match BINS in viewer/borders.js

function simplify(pts) { // Douglas-Peucker, iterative, keeping both ends of the closed ring
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let best = -1, far = TOL;
    for (let i = a + 1; i < b; i++) {
      const d = len ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > far) { far = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const ringArea = r => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(s) / 2; };
const encode = r => { // integers at 0.01°, each point as a difference from the last: small numbers compress well
  const out = []; let x = 0, y = 0;
  for (const [lon, lat] of r) { const X = Math.round(lon * 100), Y = Math.round(lat * 100); if (out.length && X === x && Y === y) continue; out.push(X - x, Y - y); x = X; y = Y; }
  return out;
};

const src = JSON.parse(fs.readFileSync(input, 'utf8'));
const all = [];
let inPts = 0, outPts = 0;
for (const f of src.features) {
  if (!f.geometry) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = polys.flat().map(r => ({ r, a: ringArea(r) }));
  const biggest = Math.max(...rings.map(x => x.a));
  const kept = rings.filter(x => x.a === biggest || x.a >= MIN_RING).map(x => { inPts += x.r.length; const s = simplify(x.r); outPts += s.length; return encode(s); }).filter(e => e.length >= 6);
  if (!kept.length) continue;
  all.push({ p: f.properties, key: JSON.stringify(kept), kept });
}
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (let b = 0; b < BINS.length - 1; b++) {
  const geoms = [], seen = new Map(), features = [];
  for (const { p, key, kept } of all) {
    if (p.ToYear < BINS[b] || p.FromYear >= BINS[b + 1]) continue;
    let g = seen.get(key);
    if (g === undefined) { g = geoms.length; geoms.push(kept); seen.set(key, g); }
    features.push([p.Name, p.FromYear, p.ToYear, Math.round(p.Area), g]);
  }
  const file = path.join(OUT, `${BINS[b]}.json`);
  fs.writeFileSync(file, JSON.stringify({ source: 'Cliopatria, Seshat Global History Databank, CC BY 4.0; simplified for this site', geoms, features }));
  bytes += fs.statSync(file).size;
  console.log(`${BINS[b]}: ${features.length} entries, ${geoms.length} shapes, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}
console.log(`${all.length} dated entries, ${inPts.toLocaleString()} -> ${outPts.toLocaleString()} points, ${(bytes / 1048576).toFixed(1)} MB -> ${path.relative(process.cwd(), OUT)}`);
