// Builds the ocean side of deep time from MERDITH2021, the plate model that moves the globe's continents (Merdith et al. 2021, Earth-Science
// Reviews 214, 103477; Zenodo 4485738, CC BY 4.0), through the GPlates Web Service, every 10 million years back to 1 billion years ago:
//   viewer/paleo/boundaries.json   the plate boundaries at each age: r mid-ocean ridges, s subduction zones, t transforms and the rest
//   viewer/assets/paleo-ridges.png how far each point of the ocean lay from a ridge (red) and from a subduction zone (green)
// The image is NOT a seafloor age map. Published age grids use other reference frames, so they wouldn't line up with these continents. Distance
// from the nearest ridge is a stand-in: new crust forms at ridges and sinks as it cools and moves away. The viewer says so.
// 101 frames, each 180 x 90 (2-degree cells, north at the top, starting at 180 W), left to right and top to bottom in 11 columns; frame 0 is today.
// Red: degrees from a ridge, 0..60 as 0..255. Green: degrees from a subduction zone, 0..20 as 0..255. Blue is unused.
// Usage: node atlas/tools/build-plates.mjs <cache folder>     (the cache keeps the service's answers, so a rebuild doesn't ask again)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './lib.mjs';

const cacheDir = process.argv[2];
if (!cacheDir) { console.error('usage: build-plates.mjs <cache folder>'); process.exit(1); }
fs.mkdirSync(cacheDir, { recursive: true });
const VIEWER = path.resolve(ROOT, '..', 'viewer'), STEP = 10, MAX = 1000, W = 180, H = 90, COLS = 11;
const rad = d => (d * Math.PI) / 180;
const xyz = (lon, lat) => [Math.cos(rad(lat)) * Math.cos(rad(lon)), Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat))];
const KIND = { MidOceanRidge: 'r', SubductionZone: 's' };

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

const frames = [], ROWS = Math.ceil((MAX / STEP + 1) / COLS), AW = COLS * W, AH = ROWS * H, rgb = new Uint8Array(AW * AH * 3);
const cellDirs = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cellDirs.push(xyz(-180 + (x + 0.5) * 2, 90 - (y + 0.5) * 2));
const counts = [];
for (let t = 0; t <= MAX; t += STEP) {
  const d = await boundaries(t), out = { t, r: [], s: [], o: [] }, seeds = { r: [], s: [] };
  for (const f of d.features) {
    const g = f.geometry, kind = KIND[f.properties?.type] || 'o';
    for (const line of g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []) {
      const kept = []; let last = null;
      line.forEach(([x, y], i) => { if (!last || i === line.length - 1 || Math.abs(x - last[0]) * Math.cos(rad(y)) + Math.abs(y - last[1]) > 0.8) { kept.push(+x.toFixed(1), +y.toFixed(1)); last = [x, y]; } });
      if (kept.length >= 4) out[kind].push(kept);
      if (kind !== 'o') for (let i = 0; i + 1 < line.length; i++) {   // points along the line, about 2 degrees apart, for the distances
        const [x0, y0] = line[i], [x1, y1] = line[i + 1], n = Math.min(20, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
        for (let k = 0; k < n; k++) seeds[kind].push(xyz(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n));
      }
    }
  }
  frames.push(out);
  const k = t / STEP, ox = (k % COLS) * W, oy = Math.floor(k / COLS) * H;
  const nearest = (v, list) => { let best = -1; for (const p of list) { const c = v[0] * p[0] + v[1] * p[1] + v[2] * p[2]; if (c > best) best = c; } return (Math.acos(Math.min(1, best)) * 180) / Math.PI; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = cellDirs[y * W + x], o = ((oy + y) * AW + ox + x) * 3;
    rgb[o] = seeds.r.length ? Math.min(255, Math.round((nearest(v, seeds.r) / 60) * 255)) : 255;
    rgb[o + 1] = seeds.s.length ? Math.min(255, Math.round((nearest(v, seeds.s) / 20) * 255)) : 255;
  }
  counts.push([t, seeds.r.length, seeds.s.length]);
  if (t % 100 === 0) console.log(t, 'Ma: ridge points', seeds.r.length, 'subduction points', seeds.s.length);
}
fs.writeFileSync(path.join(VIEWER, 'paleo', 'boundaries.json'), JSON.stringify({ model: 'MERDITH2021', step: STEP, frames }));

const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
const px = Buffer.alloc((AW * 3 + 1) * AH);
for (let y = 0; y < AH; y++) { const o = y * (AW * 3 + 1); px[o] = 1; for (let x = 0; x < AW * 3; x++) px[o + 1 + x] = (rgb[y * AW * 3 + x] - (x >= 3 ? rgb[y * AW * 3 + x - 3] : 0)) & 255; }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(AW, 0); ihdr.writeUInt32BE(AH, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(VIEWER, 'assets', 'paleo-ridges.png'), png);
const size = f => fs.statSync(path.join(VIEWER, f)).size, gz = zlib.gzipSync(fs.readFileSync(path.join(VIEWER, 'paleo', 'boundaries.json'))).length;
console.log(`boundaries.json ${(size('paleo/boundaries.json') / 1e6).toFixed(2)} MB (${(gz / 1e6).toFixed(2)} MB gzipped); paleo-ridges.png ${AW}x${AH}, ${(png.length / 1e6).toFixed(2)} MB`);
console.log('frames with no ridges:', counts.filter(c => !c[1]).map(c => c[0]).join(' ') || 'none', '; with no subduction:', counts.filter(c => !c[2]).map(c => c[0]).join(' ') || 'none');
