// Builds viewer/assets/paleo-terrain.png: how high each piece of today's land stood, every 5 million years back to 540 million years ago.
// Source: Scotese and Wright 2018, PALEOMAP PaleoDEMs (zenodo.org/records/5460860, CC BY 4.0). Download PaleoDEMS_long_lat_elev_csv_v2.zip.
//
// The PaleoDEMs are drawn on the PALEOMAP plate model; the globe's continents move on MERDITH2021. So the heights are carried on the rock:
// each 1-degree cell of today's map is turned to where PALEOMAP put it at that age (rotations fitted to points reconstructed by the GPlates
// Web Service), the PaleoDEM is read there, and the height is stored back at today's position. The globe then moves it with its own plate model.
//
// 109 frames, 5 million years apart, each 360 x 180 (1-degree cells, north at the top, starting at 180 W), left to right and top to bottom in 11
// columns; frame 0 is today. Pixel value: 128 and up, land, the square root of height up to 6,000 m; below 128, under water, the square root of
// depth down to 4,000 m. Cells far from today's land hold their nearest neighbour's value, which compresses to nothing.
//
// Usage: node atlas/tools/build-terrain.mjs <PaleoDEMS_long_lat_elev_csv_v2.zip> <cache folder>
// The cache folder keeps the rotations, so a rebuild doesn't ask the GPlates service again.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './lib.mjs';

const [zipFile, cacheDir] = process.argv.slice(2);
if (!zipFile || !cacheDir) { console.error('usage: build-terrain.mjs <zip> <cache folder>'); process.exit(1); }
fs.mkdirSync(cacheDir, { recursive: true });
const VIEWER = path.resolve(ROOT, '..', 'viewer'), GWS = 'https://gws.gplates.org', W = 360, H = 180, COLS = 11, STEP = 5, MAX = 540;
const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
const xyz = ([lon, lat]) => [Math.cos(rad(lat)) * Math.cos(rad(lon)), Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat))];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const n = Math.hypot(...a) || 1; return a.map(v => v / n); };

function zip(b) {
  let e = b.length - 22; while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  const n = b.readUInt16LE(e + 10), out = []; let p = b.readUInt32LE(e + 16);
  for (let i = 0; i < n; i++) {
    const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42), name = b.toString('utf8', p + 46, p + 46 + nl);
    out.push({ name, read: () => { const s = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28), raw = b.subarray(s, s + size); return method === 8 ? zlib.inflateRawSync(raw) : raw; } });
    p += 46 + nl + el + cl;
  }
  return out;
}
async function post(body) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${GWS}/reconstruct/reconstruct_points/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }).catch(() => null);
    if (r?.ok) return r.json();
    await new Promise(ok => setTimeout(ok, 3000 * (i + 1)));
  }
  throw new Error('GPlates service failed');
}

// ---------- today's land, from the same coastlines the globe draws, widened by 3 cells
const cellOf = (x, y) => [-180 + x + 0.5, 90 - y - 0.5];
const morph = JSON.parse(fs.readFileSync(path.join(VIEWER, 'paleo', 'morph.json'), 'utf8'));
const near = new Uint8Array(W * H);
for (const r of morph.rings) {
  const xs = r.pts.map(p => p[0]), ys = r.pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let y = 0; y < H; y++) { const lat = 90 - y - 0.5; if (lat < y0 || lat > y1) continue;
    for (let x = 0; x < W; x++) { const lon = -180 + x + 0.5; if (lon < x0 || lon > x1) continue;
      let inside = false; for (let i = 0, j = r.pts.length - 1; i < r.pts.length; j = i++) { const [xi, yi] = r.pts[i], [xj, yj] = r.pts[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside; }
      if (inside) near[y * W + x] = 1; } }
  for (const [lon, lat] of r.pts) near[Math.min(H - 1, Math.floor(90 - lat)) * W + Math.min(W - 1, Math.floor(lon + 180))] = 1;
}
for (let pass = 0; pass < 3; pass++) { const was = near.slice(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (was[y * W + x]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const yy = y + dy; if (yy >= 0 && yy < H) near[yy * W + ((x + dx + W) % W)] = 1; } }
const cells = []; for (let i = 0; i < W * H; i++) if (near[i]) cells.push(i);
console.log(cells.length, 'cells on or near land');

// ---------- each cell's PALEOMAP plate, then every plate's rotation at each age (cached)
const cacheFile = path.join(cacheDir, 'paleomap-rotations.json');
let cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
if (!cache.pids || cache.pids.length !== cells.length) {
  cache = { pids: [], rot: {} };
  for (let i = 0; i < cells.length; i += 3000) {
    const pts = cells.slice(i, i + 3000).map(c => cellOf(c % W, Math.floor(c / W)));
    const d = await post(`points=${pts.map(p => p.join(',')).join(',')}&time=0&model=PALEOMAP&fc`);
    if (d.features.length !== pts.length) throw new Error('points dropped by the service');
    cache.pids.push(...d.features.map(f => f.properties?.pid ?? 0));
    console.log('plates', i + pts.length, '/', cells.length);
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
}
const byPid = new Map();
cache.pids.forEach((pid, k) => { if (pid) (byPid.get(pid) || byPid.set(pid, []).get(pid)).push(k); });
const pidList = [...byPid.keys()];
const refs = pidList.map(pid => {   // up to 8 far-apart points on each plate, chosen by farthest-point sampling
  const all = byPid.get(pid).filter((_, i, a) => i % Math.ceil(a.length / 300) === 0).map(k => cellOf(cells[k] % W, Math.floor(cells[k] / W))), pick = [all[0]];
  while (pick.length < Math.min(8, all.length)) pick.push(all.reduce((b, p) => { const d = Math.min(...pick.map(q => 1 - dot(xyz(p), xyz(q)))); return d > b.d ? { p, d } : b; }, { p: all[0], d: -1 }).p);
  return pick;
});
const frame = (a, b) => { const e1 = unit(a), e2 = unit(cross(e1, b)), e3 = cross(e1, e2); return [e1, e2, e3]; };
const flat = refs.flat();
for (let t = STEP; t <= MAX; t += STEP) {
  if (cache.rot[t]) continue;
  const res = await post(`points=${flat.map(p => p.join(',')).join(',')}&time=${t}&model=PALEOMAP&return_null_points`);
  let k = 0;
  cache.rot[t] = refs.map(r => {
    const now = r.map((_, j) => res.coordinates[k + j]); k += r.length;
    let best = null;
    for (let a = 0; a < now.length; a++) for (let b = a + 1; b < now.length; b++) { if (!now[a] || !now[b]) continue; const d = 1 - dot(xyz(r[a]), xyz(r[b])); if (!best || d > best.d) best = { a, b, d }; }
    if (!best) { const a = now.findIndex(Boolean); if (a < 0) return null; const u0 = xyz(r[a]), u1 = xyz(now[a]), ax = cross(u0, u1), c = dot(u0, u1), s = 1 / (1 + c + 1e-9); return [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) + (i === 0 ? [0, -ax[2], ax[1]][j] : i === 1 ? [ax[2], 0, -ax[0]][j] : [-ax[1], ax[0], 0][j]) + s * ([[-(ax[1] ** 2 + ax[2] ** 2), ax[0] * ax[1], ax[0] * ax[2]], [ax[0] * ax[1], -(ax[0] ** 2 + ax[2] ** 2), ax[1] * ax[2]], [ax[0] * ax[2], ax[1] * ax[2], -(ax[0] ** 2 + ax[1] ** 2)]][i][j]))); }
    const F0 = frame(xyz(r[best.a]), xyz(r[best.b])), Ft = frame(xyz(now[best.a]), xyz(now[best.b]));
    return [0, 1, 2].map(i => [0, 1, 2].map(j => Ft[0][i] * F0[0][j] + Ft[1][i] * F0[1][j] + Ft[2][i] * F0[2][j]));
  });
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  if (t % 50 === 0) console.log('rotations', t, 'Ma');
}
const plateIndex = new Map(pidList.map((p, i) => [p, i]));

// ---------- read each PaleoDEM at the place PALEOMAP put each cell
const encode = e => (e >= 0 ? 128 + Math.round(127 * Math.sqrt(Math.min(e, 6000) / 6000)) : 127 - Math.round(127 * Math.sqrt(Math.min(-e, 4000) / 4000)));
const files = new Map(zip(fs.readFileSync(zipFile)).filter(x => /\.csv$/i.test(x.name) && !/__MACOSX/.test(x.name)).map(x => [+path.basename(x.name).match(/(\d+)Ma/)[1], x]));
const frames = [], ROWS = Math.ceil((MAX / STEP + 1) / COLS), AW = COLS * W, AH = ROWS * H, atlas = new Uint8Array(AW * AH);
const checks = [['Himalaya', 85, 30], ['Rockies, Colorado', -106, 39], ['Kansas', -99, 38], ['Appalachians', -80, 38], ['Sahara, Libya', 18, 27], ['Andes', -69, -20], ['Congo', 22, -2], ['Siberia', 100, 62]];
const report = checks.map(() => []);
for (let t = 0; t <= MAX; t += STEP) {
  const f = files.get(t); if (!f) throw new Error(`no PaleoDEM for ${t} Ma`);
  // the files differ: 58 are 361 x 181 with newlines; 50, from 150 Ma on, are 360 x 180 with bare carriage returns and no row at 90 S; one has a plain header
  const grid = new Float32Array(361 * 181); let count = 0;
  for (const line of f.read().toString().split(/\r\n|\r|\n/)) { const [lon, lat, e] = line.split(',').map(Number); if (!Number.isFinite(lon) || !Number.isFinite(e)) continue; grid[(90 - lat) * 361 + lon + 180] = e; count++; }
  if (count < 360 * 180) throw new Error(`${t} Ma: ${count} values`);
  if (count === 360 * 180) for (let x = 0; x < 361; x++) grid[180 * 361 + x] = grid[179 * 361 + x];
  const read = (lon, lat) => {   // bilinear on the 1-degree grid
    const x = ((lon + 180) % 360 + 360) % 360, y = Math.min(179.999, Math.max(0, 90 - lat)), x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, X = i => (i + 360) % 360;
    const v = (i, j) => grid[j * 361 + X(i)];
    return (v(x0, y0) * (1 - fx) + v(x0 + 1, y0) * fx) * (1 - fy) + (v(x0, y0 + 1) * (1 - fx) + v(x0 + 1, y0 + 1) * fx) * fy;
  };
  const img = new Int16Array(W * H).fill(-1), rots = t ? cache.rot[t] : null;
  cells.forEach((c, k) => {
    const pid = cache.pids[k]; if (!pid) return;
    const x = c % W, y = Math.floor(c / W), [lon, lat] = cellOf(x, y);
    let p = [lon, lat];
    if (rots) { const m = rots[plateIndex.get(pid)]; if (!m) return; const v = xyz(p), u = [dot(m[0], v), dot(m[1], v), dot(m[2], v)]; p = [deg(Math.atan2(u[1], u[0])), deg(Math.asin(Math.max(-1, Math.min(1, u[2]))))]; }
    img[c] = encode(read(p[0], p[1]));
  });
  // everything without a value takes its nearest neighbour's
  const queue = []; for (let i = 0; i < img.length; i++) if (img[i] >= 0) queue.push(i);
  for (let h = 0; h < queue.length; h++) { const i = queue[h], y = Math.floor(i / W), x = i - y * W; for (const j of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && img[j] < 0) { img[j] = img[i]; queue.push(j); } }
  const k = t / STEP, ox = (k % COLS) * W, oy = Math.floor(k / COLS) * H;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) atlas[(oy + y) * AW + ox + x] = img[y * W + x];
  checks.forEach(([, lon, lat], i) => { const v = img[(Math.floor(90 - lat)) * W + Math.floor(lon + 180)]; report[i].push(v >= 128 ? Math.round(((v - 128) / 127) ** 2 * 6000) : -Math.round(((127 - v) / 127) ** 2 * 4000)); });
  frames.push(t);
}

// ---------- write it: the row filter that suits smooth images
const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
const px = Buffer.alloc((AW + 1) * AH);
for (let y = 0; y < AH; y++) { const o = y * (AW + 1); px[o] = 1; for (let x = 0; x < AW; x++) px[o + 1 + x] = (atlas[y * AW + x] - (x ? atlas[y * AW + x - 1] : 0)) & 255; }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(AW, 0); ihdr.writeUInt32BE(AH, 4); ihdr[8] = 8; ihdr[9] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(VIEWER, 'assets', 'paleo-terrain.png'), png);
console.log(`paleo-terrain.png ${AW}x${AH}, ${(png.length / 1e6).toFixed(2)} MB, ${frames.length} frames`);
const show = [0, 10, 14, 18, 30, 50, 60, 80, 108];
console.log('height in metres at'.padEnd(20), show.map(k => `${k * STEP}Ma`.padStart(7)).join(''));
checks.forEach(([name], i) => console.log(name.padEnd(20), show.map(k => String(report[i][k]).padStart(7)).join('')));
