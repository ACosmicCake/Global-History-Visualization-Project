// Builds deep time's one moving world, so that land, sea, pins, fossils and plate boundaries all share a single reconstruction.
//
//   viewer/assets/paleo-world.png  The PALEOMAP PaleoDEMs (Scotese and Wright 2018, zenodo.org/records/5460860, CC BY 4.0) as they are, land and sea floor: 109 frames, 5 million
//                                  years apart back to 540 Ma, then 46 more, 10 million years apart back to 1,000 Ma, 360 x 180 (1-degree cells, north at the top, starting at 180 W), left
//                                  to right and top to bottom in 11 columns. No maps reach past 540 Ma, so those 46 are the 540 Ma map's surface carried back by the rotations, keeping only rock that MERDITH2021
//                                  reconstructs at that age; going back, the rest retreats toward the surviving continents over 90 million years. Which rock is there comes from that model; its heights and coasts are a stand-in, and the viewer says so. 128 and up: land, the square root of height up to 6,000 m. Below 128: under water, likewise.
//   viewer/assets/paleo-flow.png   How the surface moves from each frame to the next older one, so the viewer can glide land between frames rather than crossfade: 154 frames, 180 x 90.
//                                  Red: degrees east (scaled by the cosine of latitude). Green: degrees north. 128 is no movement and 127 steps are 16 degrees. It comes from the plate
//                                  rotations: each cell of rock is moved with its plate, the movement spreads to its neighbours, and it is blurred.
//   viewer/assets/paleo-rock.png   Which entry in morph.json's table each spot rides on at each frame, 180 x 90, in the same layout: red high byte and green low byte of the entry plus 1. The viewer
//                                  uses it to pin fine surface detail to the rock, so detail moves with the land. Where plates overlap, rock that exists at that age comes before rock that doesn't, and land before sea floor. Among equals
//                                  each spot takes what most of its neighbours have, so a plate shows as one piece rather than a patchwork.
//   viewer/paleo/morph.json        The rotations everything rides on, every 10 million years to 1,000 Ma. To 580 Ma: PALEOMAP, the model the PaleoDEMs are drawn on. By 680 Ma: MERDITH2021,
//                                  the only one of the two that reaches 1,000 Ma. Between them each plate slowly turns from one to the other, so nothing jumps. "grid" says which entry
//                                  each 1-degree cell of today's map uses, as value, count pairs. Jumps too fast for a real plate are spread over the steps around them. rings, today's coastlines, are only for browsers without WebGL2.
//   viewer/paleo/boundaries.json   MERDITH2021's plate boundaries, carried across to these positions by the rotations of the nearest rock. PALEOMAP has no boundaries of its own, so
//                                  younger than 680 Ma these are approximate, and any part that lands inland is left out. Each frame's boundaries are 10 million years apart.
//
// Each PaleoDEM was drawn on its own, so coasts jump between neighbours and small islands come and go. Each frame here is a weighted average of the frames 25 million years either side of it, each moved
// into line first by the flow, so land changes slowly and only what lasts stays. Specks of land or sea a few cells across, which would blink as the coast moves past them, are lowered or filled in.
//
// Usage: node atlas/tools/build-world.mjs <PaleoDEMS_long_lat_elev_csv_v2.zip> <cache folder>
// The cache folder keeps the service's answers. It needs merdith-morph.json from viewer/paleo/build_morph.mjs, and merdith-boundaries.json from atlas/tools/build-plates.mjs.
// Afterwards run atlas/tools/build-fossils.mjs, which uses morph.json.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './lib.mjs';

const [zipFile, cacheDir] = process.argv.slice(2);
if (!zipFile || !cacheDir) { console.error('usage: build-world.mjs <zip> <cache folder>'); process.exit(1); }
const VIEWER = path.resolve(ROOT, '..', 'viewer'), GWS = 'https://gws.gplates.org', W = 360, H = 180, COLS = 11, STEP = 5, MAX = 540, FRAMES = MAX / STEP + 1, BLEND_FROM = 580, BLEND_TO = 680, FLOW_MAX = 16, OLD_STEP = 10, OLDEST = 1000;
const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
const xyz = ([lon, lat]) => [Math.cos(rad(lat)) * Math.cos(rad(lon)), Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat))];
const ll = u => [deg(Math.atan2(u[1], u[0])), deg(Math.asin(Math.max(-1, Math.min(1, u[2]))))];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const n = Math.hypot(...a) || 1; return a.map(v => v / n); };
const apply = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
const mul = (a, b) => a.map(r => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const trans = m => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
const IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const quatMatrix = ([w, x, y, z]) => [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)], [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)], [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
function matrixQuat(m) {
  const tr = m[0][0] + m[1][1] + m[2][2]; let w, x, y, z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; x = 0.25 * s; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = 0.25 * s; z = (m[1][2] + m[2][1]) / s; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = 0.25 * s; }
  return [w, x, y, z];
}
function slerp(a, b, f) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; const s = d < 0 ? -1 : 1; d = Math.abs(d);
  if (d > 0.9995) { const q = a.map((v, i) => v + (s * b[i] - v) * f), n = Math.hypot(...q); return q.map(v => v / n); }
  const th = Math.acos(d), so = Math.sin(th), wa = Math.sin((1 - f) * th) / so, wb = (s * Math.sin(f * th)) / so;
  return a.map((v, i) => wa * v + wb * b[i]);
}
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
const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
function writePng(name, data, w, h, channels) {
  const row = w * channels, px = Buffer.alloc((row + 1) * h);
  for (let y = 0; y < h; y++) { const o = y * (row + 1); px[o] = 1; for (let x = 0; x < row; x++) px[o + 1 + x] = (data[y * row + x] - (x >= channels ? data[y * row + x - channels] : 0)) & 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = channels === 3 ? 2 : 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
  fs.writeFileSync(path.join(VIEWER, 'assets', name), png);
  console.log(`${name} ${w}x${h}, ${(png.length / 1e6).toFixed(2)} MB`);
}

// ---------- today's land, from the coastlines, and each cell's plate in each model
const merdith = JSON.parse(fs.readFileSync(path.join(cacheDir, 'merdith-morph.json'), 'utf8'));
const cellOf = (x, y) => [-180 + x + 0.5, 90 - y - 0.5];
const near = new Uint8Array(W * H), rock = new Int16Array(W * H).fill(-1);
for (const r of merdith.rings) {
  const xs = r.pts.map(p => p[0]), ys = r.pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let y = 0; y < H; y++) { const lat = 90 - y - 0.5; if (lat < y0 || lat > y1) continue;
    for (let x = 0; x < W; x++) { const lon = -180 + x + 0.5; if (lon < x0 || lon > x1) continue;
      let inside = false; for (let i = 0, j = r.pts.length - 1; i < r.pts.length; j = i++) { const [xi, yi] = r.pts[i], [xj, yj] = r.pts[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside; }
      if (inside) { near[y * W + x] = 1; rock[y * W + x] = r.p; } } }
  for (const [lon, lat] of r.pts) { const i = Math.min(H - 1, Math.floor(90 - lat)) * W + Math.min(W - 1, Math.floor(lon + 180)); near[i] = 1; rock[i] = r.p; }
}
const onLandToday = near.slice();
for (let pass = 0; pass < 3; pass++) { const was = near.slice(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (was[y * W + x]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const yy = y + dy; if (yy >= 0 && yy < H) near[yy * W + ((x + dx + W) % W)] = 1; } }
const cells = []; for (let i = 0; i < W * H; i++) if (near[i]) cells.push(i);
{ // the cells around land take the Merdith plate of the nearest land
  const queue = []; for (let i = 0; i < W * H; i++) if (rock[i] >= 0) queue.push(i);
  for (let h = 0; h < queue.length; h++) { const i = queue[h], y = Math.floor(i / W), x = i - y * W; for (const j of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && rock[j] < 0) { rock[j] = rock[i]; queue.push(j); } }
}
const cacheFile = path.join(cacheDir, 'paleomap-rotations.json');
let cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
if (!cache.pids || cache.pids.length !== cells.length) {
  cache = { pids: [], rot: {} };
  for (let i = 0; i < cells.length; i += 3000) {
    const pts = cells.slice(i, i + 3000).map(c => cellOf(c % W, Math.floor(c / W)));
    const d = await post(`points=${pts.map(p => p.join(',')).join(',')}&time=0&model=PALEOMAP&fc`);
    if (d.features.length !== pts.length) throw new Error('points dropped by the service');
    cache.pids.push(...d.features.map(f => f.properties?.pid ?? 0));
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
}
const byPid = new Map(); cache.pids.forEach((pid, k) => { if (pid) (byPid.get(pid) || byPid.set(pid, []).get(pid)).push(k); });
const pidList = [...byPid.keys()], plateIndex = new Map(pidList.map((p, i) => [p, i]));
const refs = pidList.map(pid => {
  const all = byPid.get(pid).filter((_, i, a) => i % Math.ceil(a.length / 300) === 0).map(k => cellOf(cells[k] % W, Math.floor(cells[k] / W))), pick = [all[0]];
  while (pick.length < Math.min(8, all.length)) pick.push(all.reduce((b, p) => { const d = Math.min(...pick.map(q => 1 - dot(xyz(p), xyz(q)))); return d > b.d ? { p, d } : b; }, { p: all[0], d: -1 }).p);
  return pick;
});
const frame = (a, b) => { const e1 = unit(a), e2 = unit(cross(e1, b)), e3 = cross(e1, e2); return [e1, e2, e3]; };
const flat = refs.flat(), wanted = []; for (let t = STEP; t <= MAX; t += STEP) wanted.push(t); for (let t = MAX + 10; t <= BLEND_TO; t += 10) wanted.push(t);
for (const t of wanted) {
  if (cache.rot[t]) continue;
  const res = await post(`points=${flat.map(p => p.join(',')).join(',')}&time=${t}&model=PALEOMAP&return_null_points`);
  let k = 0;
  cache.rot[t] = refs.map(r => {
    const now = r.map((_, j) => res.coordinates[k + j]); k += r.length;
    let best = null;
    for (let a = 0; a < now.length; a++) for (let b = a + 1; b < now.length; b++) { if (!now[a] || !now[b]) continue; const d = 1 - dot(xyz(r[a]), xyz(r[b])); if (!best || d > best.d) best = { a, b, d }; }
    if (!best) return null;
    const F0 = frame(xyz(r[best.a]), xyz(r[best.b])), Ft = frame(xyz(now[best.a]), xyz(now[best.b]));
    return [0, 1, 2].map(i => [0, 1, 2].map(j => Ft[0][i] * F0[0][j] + Ft[1][i] * F0[1][j] + Ft[2][i] * F0[2][j]));
  });
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
}
const pmAt = (i, t) => (t === 0 ? IDENT : cache.rot[t]?.[i] || null);
const mdAt = (k, t) => { const q = merdith.plates[k].q[t / merdith.step]; return q ? quatMatrix(q) : null; };

// ---------- the rotation table: one entry per pairing of a PALEOMAP plate and a Merdith plate
const pairs = new Map(), gridPlate = new Int32Array(W * H).fill(-1), table = [];
cells.forEach((c, k) => {
  const pid = cache.pids[k]; if (!pid && rock[c] < 0) return;
  const key = `${pid}:${rock[c]}`; let id = pairs.get(key);
  if (id === undefined) { id = table.length; pairs.set(key, id); table.push({ pid, plate: rock[c] }); }
  gridPlate[c] = id;
});
// Neither model reconstructs everything at every age: only about 60 of PALEOMAP's 210 plates here go past 600 Ma, and few of Merdith's terranes reach 1,000 Ma. A plate without its own
// rotation at some age rides with the nearest plate that has one, keeping its place, so land doesn't freeze, tear or vanish.
const times = []; for (let t = 0; t <= 1000; t += 10) times.push(t);
const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
const qinv = q => [q[0], -q[1], -q[2], -q[3]];
const centres = table.map(() => [0, 0, 0]); cells.forEach(c => { const id = gridPlate[c]; if (id < 0) return; const d = xyz(cellOf(c % W, Math.floor(c / W))), e = centres[id]; e[0] += d[0]; e[1] += d[1]; e[2] += d[2]; }); centres.forEach((c, i) => { centres[i] = unit(c); });
const ownRotation = (e, t) => {
  const pi = e.pid ? plateIndex.get(e.pid) : null, P = pi != null && t <= BLEND_TO ? pmAt(pi, t) : null, M = e.plate >= 0 ? mdAt(e.plate, t) : null, w = Math.min(1, Math.max(0, (t - BLEND_FROM) / (BLEND_TO - BLEND_FROM))), g = w * w * (3 - 2 * w);
  if (t <= BLEND_FROM) return P ? matrixQuat(P) : null;
  if (t >= BLEND_TO) return M ? matrixQuat(M) : null;
  return P && M ? slerp(matrixQuat(P), matrixQuat(M), g) : null;
};
for (const e of table) e.q = [];
let riding = 0;
times.forEach((t, ti) => {
  const own = table.map(e => (t === 0 ? [1, 0, 0, 0] : ownRotation(e, t))), have = []; own.forEach((q, i) => { if (q) have.push(i); });
  table.forEach((e, i) => {
    if (own[i]) { e.q[ti] = own[i]; return; }
    riding++;
    let best = -1, bd = -2; for (const j of have) { const c = dot(centres[i], centres[j]); if (c > bd) { bd = c; best = j; } }
    const prev = e.q[ti - 1];
    if (best < 0) { e.q[ti] = prev; return; }
    const p = table[best], step = qmul(own[best], qinv(p.q[ti - 1])), n = qmul(step, prev), l = Math.hypot(...n);
    e.q[ti] = n.map(v => v / l);
  });
  table.forEach(e => { const q = e.q[ti], prev = e.q[ti - 1]; if (q && prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) e.q[ti] = q.map(v => -v); });
});
console.log('rotations borrowed from a neighbour:', riding, 'of', table.length * times.length);
// a real plate crosses about 15 degrees in 10 million years; ease anything faster
{
  const LIMIT = 14, PASSES = 24, qd = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], turn = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(qd(a, b)))) * 180) / Math.PI, norm = q => { const n = Math.hypot(...q); return q.map(v => v / n); };
  let before = 0, after = 0;
  for (const e of table) {
    const q = e.q;
    for (let i = 0; i + 1 < q.length; i++) if (q[i] && q[i + 1] && turn(q[i], q[i + 1]) > LIMIT) before++;
    for (let pass = 0; pass < PASSES; pass++) {
      const fix = new Set(); for (let i = 0; i + 1 < q.length; i++) if (q[i] && q[i + 1] && turn(q[i], q[i + 1]) > LIMIT) for (let k = i - 2; k <= i + 3; k++) if (k > 0 && k + 1 < q.length && q[k]) fix.add(k);
      if (!fix.size) break;
      const next = q.map(v => v && [...v]); for (const k of fix) { const a = q[k - 1], b = q[k + 1]; if (a && b) next[k] = norm(q[k].map((v, j) => 0.25 * a[j] + 0.5 * v + 0.25 * b[j])); }
      next.forEach((v, k) => { q[k] = v; });
    }
    for (let i = 0; i + 1 < q.length; i++) if (q[i] && q[i + 1] && turn(q[i], q[i + 1]) > LIMIT) after++;
  }
  console.log('steps over', LIMIT, 'degrees:', before, 'before easing,', after, 'after');
}
const tableAt = (id, t) => { const q = table[id].q[t / 10]; return q ? quatMatrix(q) : null; };
const rings = merdith.rings.map(r => {
  const votes = new Map(); for (const [lon, lat] of r.pts) { const id = gridPlate[Math.min(H - 1, Math.floor(90 - lat)) * W + Math.min(W - 1, Math.floor(lon + 180))]; if (id >= 0) votes.set(id, (votes.get(id) || 0) + 1); }
  return { p: votes.size ? [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0] : -1, pts: r.pts };
}).filter(r => r.p >= 0);
const rle = []; for (let i = 0; i < gridPlate.length;) { let j = i; while (j < gridPlate.length && gridPlate[j] === gridPlate[i]) j++; rle.push(gridPlate[i], j - i); i = j; }
fs.writeFileSync(path.join(VIEWER, 'paleo', 'morph.json'), JSON.stringify({
  model: `PALEOMAP to ${BLEND_FROM} Ma, turning into MERDITH2021 by ${BLEND_TO} Ma`, step: 10, max: 1000, times,
  citation: 'Scotese 2016 PALEOMAP PaleoAtlas for GPlates; Merdith et al. 2021, Earth-Science Reviews 214, 103477; rotations derived from points reconstructed by the GPlates Web Service (gws.gplates.org), EarthByte Group, University of Sydney',
  plates: table.map(e => ({ pid: e.pid, q: e.q.map(q => q && q.map(v => Math.round(v * 1e4) / 1e4)) })), rings, grid: rle,
}));
console.log('rotations:', table.length, 'plate pairings;', rings.length, 'rings; morph.json', (fs.statSync(path.join(VIEWER, 'paleo', 'morph.json')).size / 1e6).toFixed(2), 'MB');

// ---------- read the maps
const files = new Map(zip(fs.readFileSync(zipFile)).filter(x => /\.csv$/i.test(x.name) && !/__MACOSX/.test(x.name)).map(x => [+path.basename(x.name).match(/(\d+)Ma/)[1], x]));
const worlds = [];
for (let t = 0; t <= MAX; t += STEP) {
  const f = files.get(t); if (!f) throw new Error(`no PaleoDEM for ${t} Ma`);
  // the files differ: 58 are 361 x 181 with newlines; 50, from 150 Ma on, are 360 x 180 with bare carriage returns and no row at 90 S; one has a plain header
  const grid = new Float32Array(361 * 181); let count = 0;
  for (const line of f.read().toString().split(/\r\n|\r|\n/)) { const [lon, lat, e] = line.split(',').map(Number); if (!Number.isFinite(lon) || !Number.isFinite(e)) continue; grid[(90 - lat) * 361 + lon + 180] = e; count++; }
  if (count < 360 * 180) throw new Error(`${t} Ma: ${count} values`);
  if (count === 360 * 180) for (let x = 0; x < 361; x++) grid[180 * 361 + x] = grid[179 * 361 + x];
  // the corner of some maps holds a stray 10,500 m
  for (let i = 0; i < grid.length; i++) if (grid[i] > 9000) grid[i] = grid[i + 1] <= 9000 ? grid[i + 1] : 0;
  const img = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = y * 361 + x; img[y * W + x] = (grid[a] + grid[a + 1] + grid[a + 361] + grid[a + 362]) / 4; }
  worlds.push(img);
}

// ---------- how the surface moves from each frame to the next
const FW = 180, FH = 90, flows = [];
const rockDirs = cells.map(c => xyz(cellOf(c % W, Math.floor(c / W))));
const rotYoung = (i, t) => { const pid = cache.pids[i]; return (pid ? pmAt(plateIndex.get(pid), t) : null); };   // to 540 Ma: the rotations the maps were drawn with
const rotOld = (i, t) => { const id = gridPlate[cells[i]]; return id >= 0 ? tableAt(id, t) : null; };             // past it: the table, as eased and turning into Merdith
const flowAges = []; for (let t = 0; t < MAX; t += STEP) flowAges.push([t, t + STEP, rotYoung]); for (let t = MAX; t < OLDEST; t += OLD_STEP) flowAges.push([t, t + OLD_STEP, rotOld]);
for (const [ta, tb, rotation] of flowAges) {
  const sx = new Float32Array(FW * FH), sy = new Float32Array(FW * FH), n = new Float32Array(FW * FH);
  cells.forEach((_, i) => {
    const a = rotation(i, ta), b = rotation(i, tb); if (!a || !b) return;
    const [lon0, lat0] = ll(apply(a, rockDirs[i])), [lon1, lat1] = ll(apply(b, rockDirs[i]));
    let dl = lon1 - lon0; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    const g = Math.min(FH - 1, Math.floor((90 - lat0) / 2)) * FW + Math.min(FW - 1, Math.floor((lon0 + 180) / 2));
    sx[g] += dl * Math.cos(rad((lat0 + lat1) / 2)); sy[g] += lat1 - lat0; n[g]++;
  });
  const queue = []; for (let g = 0; g < FW * FH; g++) if (n[g]) { sx[g] /= n[g]; sy[g] /= n[g]; n[g] = 1; queue.push(g); }
  for (let h = 0; h < queue.length; h++) { const i = queue[h], y = Math.floor(i / FW), x = i - y * FW; for (const j of [y * FW + (x + 1) % FW, y * FW + (x + FW - 1) % FW, y > 0 ? i - FW : -1, y < FH - 1 ? i + FW : -1]) if (j >= 0 && !n[j]) { sx[j] = sx[i]; sy[j] = sy[i]; n[j] = 1; queue.push(j); } }
  for (let pass = 0; pass < 4; pass++) for (const s of [sx, sy]) {
    const was = s.slice(); for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { let v = 0, c = 0; for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const yy = y + dy; if (yy < 0 || yy >= FH) continue; v += was[yy * FW + ((x + dx + FW) % FW)]; c++; } s[y * FW + x] = v / c; }
  }
  flows.push({ sx, sy });
}
const flowAt = (fl, lon, lat) => { const fx = (lon + 180) / 2 - 0.5, fy = (90 - lat) / 2 - 0.5, x0 = Math.floor(fx), y0 = Math.max(0, Math.min(FH - 2, Math.floor(fy))), tx = fx - x0, ty = Math.max(0, Math.min(1, fy - y0)), v = (s, x, y) => s[y * FW + ((x + FW) % FW)], read = s => (v(s, x0, y0) * (1 - tx) + v(s, x0 + 1, y0) * tx) * (1 - ty) + (v(s, x0, y0 + 1) * (1 - tx) + v(s, x0 + 1, y0 + 1) * tx) * ty; return [read(fl.sx), read(fl.sy)]; };
const sampleWorld = (img, lon, lat) => { const fx = lon + 180 - 0.5, fy = 90 - lat - 0.5, x0 = Math.floor(fx), y0 = Math.max(0, Math.min(H - 2, Math.floor(fy))), tx = fx - x0, ty = Math.max(0, Math.min(1, fy - y0)), v = (x, y) => img[y * W + ((x % W) + W) % W]; return (v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx) * (1 - ty) + (v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx) * ty; };

// ---------- smooth each frame with its neighbours, moved into line; write the images
const encode = e => { if (e >= 0) return 128 + Math.round(127 * Math.sqrt(Math.min(e, 6000) / 6000)); const v = 127 - Math.round(127 * Math.sqrt(Math.min(-e, 6000) / 6000)); return e < -1500 ? v & ~1 : v; };   // the deep sea needs less precision
const OLD_FRAMES = (OLDEST - MAX) / OLD_STEP, ROWS = Math.ceil((FRAMES + OLD_FRAMES) / COLS), AW = COLS * W, AH = ROWS * H, atlas = new Uint8Array(AW * AH), soft = [];
// one frame of a series, averaged with its neighbours along the plates' path: follow each cell forward and back through the flow, and read each neighbour where the rock has got to
const alongFlow = (series, k, flowOf, reach, sigma) => {
  const out = new Float32Array(W * H), weight = []; for (let j = 0; j <= reach; j++) weight.push(Math.exp(-j * j / (2 * sigma * sigma)));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [lon, lat] = cellOf(x, y); let sum = weight[0] * series[k][y * W + x], w = weight[0];
    for (const dir of [1, -1]) {
      let lo = lon, la = lat;
      for (let j = 1; j <= reach; j++) {
        const n = k + dir * j; if (n < 0 || n >= series.length) break;
        const [fx, fy] = flowAt(flowOf(dir > 0 ? n - 1 : n), lo, la), cosL = Math.max(0.15, Math.cos(rad(la)));
        lo += dir * fx / cosL; la = Math.max(-89.5, Math.min(89.5, la + dir * fy));
        if (lo > 180) lo -= 360; else if (lo < -180) lo += 360;
        sum += weight[j] * sampleWorld(series[n], lo, la); w += weight[j];
      }
    }
    out[y * W + x] = sum / w;
  }
  return out;
};
// Land or water only a few degrees across can't hold steady on a 1-degree map. Each is pressed under the waterline, or filled, in proportion to how small it is, so it fades as it shrinks rather than blinking out.
const settleSpecks = img => {
  for (const [isIt, limit, sign] of [[v => v >= 0, 9, -1], [v => v < 0, 6, 1]]) {
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (seen[i] || !isIt(img[i])) continue;
      const q = [i]; seen[i] = 1; let area = 0, far = 0;
      for (let h = 0; h < q.length; h++) { const c = q[h], y = Math.floor(c / W), x = c - y * W; area += Math.cos(rad(90 - y - 0.5)); far = Math.max(far, Math.abs(img[c])); for (const n of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y ? c - W : -1, y < H - 1 ? c + W : -1]) if (n >= 0 && !seen[n] && isIt(img[n])) { seen[n] = 1; q.push(n); } }
      if (area >= limit) continue;
      const f = area / limit, press = (1 - f * f * (3 - 2 * f)) * (far + 40);
      for (const c of q) img[c] += sign * press;
    }
  }
  return img;
};
const putFrame = (k, img) => { const ox = (k % COLS) * W, oy = Math.floor(k / COLS) * H; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) atlas[(oy + y) * AW + ox + x] = encode(img[y * W + x]); };
worlds.forEach((_, k) => { const out = settleSpecks(alongFlow(worlds, k, n => flows[n], 5, 2.5)); soft.push(out); putFrame(k, out); });
// MERDITH2021 only reconstructs rock it has evidence for at each age. Going back, rock it doesn't have yet retreats toward the rock that lasts: the farthest goes first, from 540 Ma at the earliest since
// the maps show it until then, and what touches a surviving continent goes last, 90 million years later. Read forward, continents grow outward as terranes join them. Nothing vanishes all at once.
const rockOldest = cells.map(c => { const q = rock[c] >= 0 ? merdith.plates[rock[c]].q : null; if (q) for (let i = q.length - 1; i >= 0; i--) if (q[i]) return i * merdith.step; return 0; });
const rockReach = new Float32Array(cells.length);
{
  const steps = new Int16Array(W * H).fill(-1), queue = [];
  cells.forEach((c, i) => { if (rockOldest[i] < OLDEST - 50) return; const m = rotOld(i, MAX); if (!m) return; const [x, y] = ll(apply(m, rockDirs[i])), g = Math.min(H - 1, Math.floor(90 - y)) * W + Math.min(W - 1, Math.floor(x + 180)); if (steps[g] < 0) { steps[g] = 0; queue.push(g); } });
  for (let h = 0; h < queue.length; h++) { const i = queue[h], y = Math.floor(i / W), x = i - y * W; for (const n of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (n >= 0 && steps[n] < 0) { steps[n] = steps[i] + 1; queue.push(n); } }
  cells.forEach((c, i) => { const m = rotOld(i, MAX); if (!m) return; const [x, y] = ll(apply(m, rockDirs[i])), g = Math.min(H - 1, Math.floor(90 - y)) * W + Math.min(W - 1, Math.floor(x + 180)); rockReach[i] = Math.max(0, steps[g]); });
}
const presence = (i, t) => { const gone = Math.max(rockOldest[i], MAX) + 90 * (1 - Math.min(1, rockReach[i] / 45)), f = Math.max(0, Math.min(1, (t - gone + 12) / 24)); return 1 - f * f * (3 - 2 * f); };
// older than the maps: the 540 Ma surface, carried back rock by rock. Each rock is read at 16 points, because rock carried to high latitudes spreads over more cells of the grid, and each point is shared across the four cells around where it lands, so turning the grid leaves no holes; cells beside
// rock then fill in, so small cracks between plates close, and a light blur takes off the grid.
const oldWorlds = [];
{
  const last = soft[FRAMES - 1]; let seaSum = 0, seaN = 0; for (const v of last) if (v < -1500) { seaSum += v; seaN++; } const openSea = seaSum / Math.max(1, seaN);
  const SUB = 4, points = cells.map((c, i) => { const m = rotYoung(i, MAX) || rotOld(i, MAX); if (!m) return null; const out = []; for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) { const d = xyz([-180 + (c % W) + (a + 0.5) / SUB, 90 - Math.floor(c / W) - (b + 0.5) / SUB]), [x, y] = ll(apply(m, d)); out.push({ d, h: sampleWorld(last, x, y) }); } return out; });
  for (let j = 1; j <= OLD_FRAMES; j++) {
    const t = MAX + j * OLD_STEP, sum = new Float32Array(W * H), wt = new Float32Array(W * H), cover = new Float32Array(W * H), held = new Float32Array(W * H), val = new Float32Array(W * H).fill(openSea), steps = new Int8Array(W * H).fill(-1), queue = [];
    cells.forEach((_, i) => {
      const m = rotOld(i, t), there = presence(i, t); if (!points[i] || !m || there <= 0) return;
      for (const { d, h } of points[i]) {
        const lift = Math.exp(Math.max(-1500, Math.min(1500, h)) / 400);   // two rocks on one spot merge toward the higher, so a seam never drops land into the sea
        const [x, y] = ll(apply(m, d)), fx = x + 180 - 0.5, fy = 90 - y - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        for (const [cx, cy, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x0 + 1, y0, tx * (1 - ty)], [x0, y0 + 1, (1 - tx) * ty], [x0 + 1, y0 + 1, tx * ty]]) { if (cy < 0 || cy >= H || w <= 0) continue; const g = cy * W + ((cx % W) + W) % W; const top = w * there * lift; sum[g] += h * top; wt[g] += top; held[g] += w * there; cover[g] += w; }
      }
    });
    for (let g = 0; g < W * H; g++) if (held[g] > 0.05) { const f = Math.min(1, held[g] / cover[g]); val[g] = openSea + (sum[g] / wt[g] - openSea) * f * f * (3 - 2 * f); steps[g] = 0; queue.push(g); }
    for (let q = 0; q < queue.length; q++) { const i = queue[q]; if (steps[i] >= 2) continue; const y = Math.floor(i / W), x = i - y * W; for (const n of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (n >= 0 && steps[n] < 0) { steps[n] = steps[i] + 1; val[n] = val[i]; queue.push(n); } }
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let v = 0, c = 0; for (const [dx, dy, w] of [[0, 0, 4], [1, 0, 2], [-1, 0, 2], [0, 1, 2], [0, -1, 2], [1, 1, 1], [-1, 1, 1], [1, -1, 1], [-1, -1, 1]]) { const yy = y + dy; if (yy < 0 || yy >= H) continue; v += w * val[yy * W + ((x + dx + W) % W)]; c += w; } out[y * W + x] = v / c; }
    oldWorlds.push(out);
  }
  // the same smoothing through the stand-in frames, starting among the last real maps so there is no join
  const lead = 4, series = [...soft.slice(FRAMES - 1 - lead), ...oldWorlds], flowOf = n => flows[FRAMES - 1 - lead + n], done = series.map((_, n) => (n < lead - 1 ? series[n] : settleSpecks(alongFlow(series, n, flowOf, 3, 1.5))));
  done.forEach((img, n) => { const k = FRAMES - 1 - lead + n; if (n < lead - 1) return; if (k < FRAMES) soft[k] = img; else oldWorlds[k - FRAMES] = img; putFrame(k, img); });
}
writePng('paleo-world.png', atlas, AW, AH, 1);
const FA_ROWS = Math.ceil(flows.length / COLS), FAW = COLS * FW, FAH = FA_ROWS * FH, flowImg = new Uint8Array(FAW * FAH * 3); let fastest = 0;
flows.forEach((fl, k) => {
  const ox = (k % COLS) * FW, oy = Math.floor(k / COLS) * FH;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const g = y * FW + x, o = ((oy + y) * FAW + ox + x) * 3, code = v => 128 + Math.round((Math.max(-FLOW_MAX, Math.min(FLOW_MAX, v)) / FLOW_MAX) * 127); fastest = Math.max(fastest, Math.abs(fl.sx[g]), Math.abs(fl.sy[g])); flowImg[o] = code(fl.sx[g]); flowImg[o + 1] = code(fl.sy[g]); flowImg[o + 2] = 128; }
});
writePng('paleo-flow.png', flowImg, FAW, FAH, 3);
console.log('fastest flow', fastest.toFixed(1), 'degrees per step');
{
  const ages = []; for (let t = 0; t <= MAX; t += STEP) ages.push(t); for (let t = MAX + OLD_STEP; t <= OLDEST; t += OLD_STEP) ages.push(t);
  const RAW = COLS * FW, RAH = Math.ceil(ages.length / COLS) * FH, img = new Uint8Array(RAW * RAH * 3);
  ages.forEach((t, k) => {
    const ids = new Int32Array(FW * FH).fill(-1), queue = [], rank = new Int8Array(FW * FH).fill(-1), found = new Array(FW * FH);
    // where plates overlap: rock that exists at this age before rock that doesn't, then land before sea floor
    cells.forEach((c, i) => {
      const id = gridPlate[c], m = (t <= MAX && rotYoung(i, t)) || (t % 10 === 0 ? rotOld(i, t) : null); if (id < 0 || !m) return;
      const [x, y] = ll(apply(m, rockDirs[i])), g = Math.min(FH - 1, Math.floor((90 - y) / 2)) * FW + Math.min(FW - 1, Math.floor((x + 180) / 2)), r = (presence(i, t) >= 0.5 ? 2 : 0) + onLandToday[c];
      if (r < rank[g]) return;
      if (r > rank[g]) { rank[g] = r; found[g] = new Map(); }
      found[g].set(id, (found[g].get(id) || 0) + 1);
    });
    // plates turned within a degree of each other draw as one, as in the viewer, so choosing among them makes no seam
    const reps = [], groupOfId = new Map(), groupOf = id => {
      if (groupOfId.has(id)) return groupOfId.get(id);
      const a = Math.floor(t / 10), f = t / 10 - a, qa = table[id].q[a], qb = table[id].q[a + 1], q = qa && f && qb ? slerp(qa, qb, f) : qa; let n = -1;
      if (q) n = reps.findIndex(p => Math.abs(p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3]) > 0.99996);
      if (n < 0) { n = reps.length; reps.push(q || [0, 0, 0, 0]); }
      groupOfId.set(id, n); return n;
    };
    const tally = new Array(FW * FH), pick = new Int32Array(FW * FH).fill(-1);
    for (let g = 0; g < FW * FH; g++) if (found[g]) { const m = new Map(); for (const [id, n] of found[g]) m.set(groupOf(id), (m.get(groupOf(id)) || 0) + n); tally[g] = m; let most = -1; for (const [c, n] of m) if (n > most) { most = n; pick[g] = c; } }
    // each spot with a choice takes what most of its neighbours have
    for (let pass = 0; pass < 4; pass++) {
      const was = pick.slice();
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
        const g = y * FW + x; if (!tally[g] || tally[g].size < 2) continue;
        let best = -1, top = -1;
        for (const [c, n] of tally[g]) { let s = n * 0.1; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy; if ((dx || dy) && yy >= 0 && yy < FH && was[yy * FW + ((x + dx + FW) % FW)] === c) s++; } if (s > top) { top = s; best = c; } }
        pick[g] = best;
      }
    }
    for (let g = 0; g < FW * FH; g++) if (found[g]) { let most = -1; for (const [id, n] of found[g]) if (groupOf(id) === pick[g] && n > most) { most = n; ids[g] = id; } queue.push(g); }
    for (let h = 0; h < queue.length; h++) { const i = queue[h], y = Math.floor(i / FW), x = i - y * FW; for (const j of [y * FW + (x + 1) % FW, y * FW + (x + FW - 1) % FW, y > 0 ? i - FW : -1, y < FH - 1 ? i + FW : -1]) if (j >= 0 && ids[j] < 0) { ids[j] = ids[i]; queue.push(j); } }
    const ox = (k % COLS) * FW, oy = Math.floor(k / COLS) * FH;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const o = ((oy + y) * RAW + ox + x) * 3, v = ids[y * FW + x] + 1; img[o] = v >> 8; img[o + 1] = v & 255; img[o + 2] = 0; }
  });
  writePng('paleo-rock.png', img, RAW, RAH, 3);
}

// ---------- the boundaries, carried across by the rotations of the nearest rock
const src = JSON.parse(fs.readFileSync(path.join(cacheDir, 'merdith-boundaries.json'), 'utf8')), rockSamples = [];
const seen = new Set();
cells.forEach((c, k) => { const x = c % W, y = Math.floor(c / W), id = gridPlate[c]; if (id < 0 || rock[c] < 0) return; if ((x % 4 === 0 && y % 4 === 0) || !seen.has(id)) { seen.add(id); rockSamples.push({ dir: rockDirs[k], id, plate: rock[c] }); } });
const out = { model: 'MERDITH2021, carried onto the positions in morph.json', step: src.step, frames: [] };
// The two models don't agree everywhere, so some boundaries land in the middle of a continent on these maps. A boundary is cut where it runs over land higher than the coast's edge, leaving
// the parts in the sea and along the coasts.
const worldAt = t => (t <= MAX ? soft[t / STEP] : oldWorlds[(t - MAX) / OLD_STEP - 1]);
const offLand = (l, t) => { const w = worldAt(t), runs = []; let run = []; for (let i = 0; i < l.length; i += 2) { if (sampleWorld(w, l[i], Math.max(-89.4, Math.min(89.4, l[i + 1]))) > 120) { if (run.length >= 4) runs.push(run); run = []; } else run.push(l[i], l[i + 1]); } if (run.length >= 4) runs.push(run); return runs; };
for (const f of src.frames) {
  const t = f.t;
  if (t >= BLEND_TO) { out.frames.push({ t, r: f.r.flatMap(l => offLand(l, t)), s: f.s.flatMap(l => offLand(l, t)), x: f.x.flatMap(l => offLand(l, t)) }); continue; }
  const live = []; for (const r of rockSamples) { const m = mdAt(r.plate, t), q = tableAt(r.id, t); if (m && q) live.push({ at: apply(m, r.dir), turn: mul(q, trans(m)) }); }
  const carry = l => { const o = []; for (let i = 0; i < l.length; i += 2) { const v = xyz([l[i], l[i + 1]]); const near4 = [{ c: -2 }, { c: -2 }, { c: -2 }, { c: -2 }]; for (const r of live) { const c = dot(r.at, v); if (c > near4[3].c) { near4[3] = { c, r }; near4.sort((a, b) => b.c - a.c); } } let sum = [0, 0, 0]; for (const n of near4) { if (!n.r) continue; const a = Math.max(0.5, deg(Math.acos(Math.min(1, n.c)))), w = 1 / (a * a), u = apply(n.r.turn, v); sum = [sum[0] + w * u[0], sum[1] + w * u[1], sum[2] + w * u[2]]; } const [lon, lat] = ll(unit(sum)); o.push(+lon.toFixed(1), +lat.toFixed(1)); } return o; };
  out.frames.push({ t, r: f.r.map(carry).flatMap(l => offLand(l, t)), s: f.s.map(carry).flatMap(l => offLand(l, t)), x: f.x.map(carry).flatMap(l => offLand(l, t)) });
}
fs.writeFileSync(path.join(VIEWER, 'paleo', 'boundaries.json'), JSON.stringify(out));
console.log('boundaries.json', (fs.statSync(path.join(VIEWER, 'paleo', 'boundaries.json')).size / 1e6).toFixed(2), 'MB');

// ---------- checks: rock followed through time, and how much the coast still jumps
const checks = [['Himalaya', 85, 30], ['Rockies, Colorado', -106, 39], ['Kansas', -99, 38], ['Appalachians', -80, 38], ['Sahara, Libya', 18, 27], ['Andes', -69, -20], ['Congo', 22, -2], ['Siberia', 100, 62]], show = [0, 10, 14, 18, 30, 50, 60, 80, 108];
console.log('height in metres at'.padEnd(20), show.map(k => `${k * STEP}Ma`.padStart(7)).join(''));
for (const [name, lon, lat] of checks) {
  const c = Math.floor(90 - lat) * W + Math.floor(lon + 180), k = cells.indexOf(c), pi = plateIndex.get(cache.pids[k]);
  console.log(name.padEnd(20), show.map(s => { const m = pmAt(pi, s * STEP); if (!m) return '-'.padStart(7); const [x, y] = ll(apply(m, rockDirs[k])); return String(Math.round(sampleWorld(soft[s], x, y))).padStart(7); }).join(''));
}
const flips = []; for (let k = 0; k + 1 < soft.length; k++) { let n = 0; for (let i = 0; i < W * H; i++) if ((soft[k][i] >= 0) !== (soft[k + 1][i] >= 0)) n++; flips.push(n); }
console.log('land share at 0, 100, 250, 500 Ma:', [0, 20, 50, 100].map(k => ((soft[k].reduce((s, v, i) => s + (v >= 0 ? Math.cos(rad(90 - Math.floor(i / W) - 0.5)) : 0), 0) / (W * H * 2 / Math.PI)) * 100).toFixed(0) + '%').join(' '), '; cells flipping land/sea per frame, median', [...flips].sort((a, b) => a - b)[flips.length >> 1]);
