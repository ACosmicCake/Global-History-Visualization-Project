// Fetches MERDITH2021's plate boundaries (Merdith et al. 2021, Earth-Science Reviews 214, 103477; Zenodo 4485738, CC BY 4.0) from the GPlates Web Service, every 10 million years back to
// 1 billion years ago, and keeps them as merdith-boundaries.json in the cache folder: r mid-ocean ridges, s subduction zones, x transforms. Each s line runs with the overriding plate on its
// left, so the viewer can draw the teeth on that side. The model's polarity label names that side: checked against today's trenches, where 29 of 35 have land on the labelled side,
// including Japan and Java. atlas/tools/build-world.mjs then carries them onto the globe's positions.
// Usage: node atlas/tools/build-plates.mjs <cache folder>
import fs from 'node:fs';
import path from 'node:path';

const cacheDir = process.argv[2];
if (!cacheDir) { console.error('usage: build-plates.mjs <cache folder>'); process.exit(1); }
fs.mkdirSync(cacheDir, { recursive: true });
const STEP = 10, MAX = 1000, rad = d => (d * Math.PI) / 180, KIND = { MidOceanRidge: 'r', SubductionZone: 's', Transform: 'x' };
async function boundaries(t) {
  const file = path.join(cacheDir, `merdith-${t}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`https://gws.gplates.org/topology/plate_boundaries?time=${t}&model=MERDITH2021`).catch(() => null);
    if (r?.ok) { const d = await r.json(); fs.writeFileSync(file, JSON.stringify(d)); return d; }
    await new Promise(ok => setTimeout(ok, 3000 * (i + 1)));
  }
  throw new Error(`GPlates service failed at ${t} Ma`);
}
const frames = [];
for (let t = 0; t <= MAX; t += STEP) {
  const d = await boundaries(t), out = { t, r: [], s: [], x: [] };
  for (const f of d.features) {
    const g = f.geometry, kind = KIND[f.properties?.type];
    if (!kind) continue;   // faults, inferred boundaries and the rest add clutter and say little at this scale
    for (const raw of g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []) {
      const line = kind === 's' && f.properties.polarity === 'Right' ? [...raw].reverse() : raw, kept = []; let last = null;
      line.forEach(([x, y], i) => { if (!last || i === line.length - 1 || Math.abs(x - last[0]) * Math.cos(rad(y)) + Math.abs(y - last[1]) > 0.8) { kept.push(+x.toFixed(1), +y.toFixed(1)); last = [x, y]; } });
      if (kept.length >= 4) out[kind].push(kept);
    }
  }
  frames.push(out);
}
fs.writeFileSync(path.join(cacheDir, 'merdith-boundaries.json'), JSON.stringify({ model: 'MERDITH2021', step: STEP, frames }));
console.log('frames', frames.length);
