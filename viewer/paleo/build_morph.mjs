// Build the data for a continuous continental-drift morph: today's coastlines (thinned), each tagged with its
// tectonic plate, plus every plate's finite rotation at 10 Ma steps back to 1000 Ma (MERDITH2021). The viewer
// interpolates the rotations (quaternion slerp) and turns the coastlines, so the continents move instead of
// cross-fading. Rotations are derived from two reference points per plate reconstructed by the GPlates Web Service.
// Citation: Merdith et al. 2021, Earth-Science Reviews 214, 103477; GPlates Web Service, EarthByte, University of Sydney.
// Usage: node viewer/paleo/build_morph.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODEL = 'MERDITH2021', STEP = 10, MAX = 1000, GWS = 'https://gws.gplates.org';
const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
const xyz = ([lon, lat]) => [Math.cos(rad(lat)) * Math.cos(rad(lon)), Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat))];
const ll = ([x, y, z]) => [deg(Math.atan2(y, x)), deg(Math.asin(Math.max(-1, Math.min(1, z))))];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const n = Math.hypot(...a) || 1; return a.map(v => v / n); };

async function get(url, body) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body } : {}).catch(() => null);
    if (r && r.ok) return r.json();
    await new Promise(ok => setTimeout(ok, 3000 * (i + 1)));
  }
  throw new Error('GWS failed: ' + url);
}
const reconstruct = (pts, t, extra = '') =>
  get(`${GWS}/reconstruct/reconstruct_points/`, `points=${pts.map(p => p.join(',')).join(',')}&time=${t}&model=${MODEL}${extra}`);

// 1. today's coastlines, thinned to vertices at least 0.15° apart
const raw = await get(`${GWS}/reconstruct/coastlines/?time=0&model=${MODEL}`);
const rings = [];
for (const f of raw.features) {
  const g = f.geometry, list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of list) {
    const out = [];
    for (const [x, y] of poly[0]) { const p = out[out.length - 1]; if (!p || Math.abs(x - p[0]) + Math.abs(y - p[1]) > 0.15) out.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]); }
    if (out.length >= 4) rings.push({ pts: out, c: ll(unit(out.reduce((s, p) => { const v = xyz(p); return [s[0] + v[0], s[1] + v[1], s[2] + v[2]]; }, [0, 0, 0]))) });
  }
}
console.log(rings.length, 'rings,', rings.reduce((s, r) => s + r.pts.length, 0), 'vertices');

// 2. each ring's plate: the majority plate of up to 6 of its vertices today
const samples = [];   // { ring, pt }
rings.forEach((r, ri) => { const n = Math.min(6, r.pts.length - 1); for (let k = 0; k < n; k++) samples.push({ ri, pt: r.pts[Math.floor((k * (r.pts.length - 1)) / n)] }); });
const tagged = await reconstruct(samples.map(x => x.pt), 0, '&fc');
tagged.features.forEach((f, i) => { samples[i].pid = f.properties?.pid ?? 0; });
rings.forEach((r, ri) => {
  const votes = {}; for (const x of samples) if (x.ri === ri) votes[x.pid] = (votes[x.pid] || 0) + 1;
  r.pid = Number(Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0]);
});

// 3. up to 12 spread-out sample points per plate (vertices on that plate), to fit its rotation at each step
const byPlate = new Map();
for (const x of samples) if (x.pid === rings[x.ri].pid) { if (!byPlate.has(x.pid)) byPlate.set(x.pid, []); byPlate.get(x.pid).push(x.pt); }
const refs = [];
for (const pid of new Set(rings.map(r => r.pid))) {
  const all = byPlate.get(pid) || rings.filter(r => r.pid === pid).flatMap(r => r.pts.slice(0, 2));
  const pick = [all[0]];   // farthest-point sampling
  while (pick.length < Math.min(12, all.length)) pick.push(all.reduce((best, p) => { const d = Math.min(...pick.map(q => 1 - dot(xyz(p), xyz(q)))); return d > best.d ? { p, d } : best; }, { p: all[0], d: -1 }).p);
  refs.push({ pid, cands: pick });
}
const frame = (a, b) => { const e1 = unit(a), e2 = unit(cross(e1, b)), e3 = cross(e1, e2); return [e1, e2, e3]; };

// 4. rotation of every plate at each step: R = Ft * F0^T, stored as a quaternion [w, x, y, z]
function quat(m) {   // m: row-major 3x3
  const tr = m[0][0] + m[1][1] + m[2][2]; let w, x, y, z;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = 0.25 * s; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / s; x = 0.25 * s; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s; }
  else if (m[1][1] > m[2][2]) { const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = 0.25 * s; z = (m[1][2] + m[2][1]) / s; }
  else { const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = 0.25 * s; }
  return [w, x, y, z];
}
const times = [], rot = refs.map(() => []), flat = refs.flatMap(r => r.cands);
for (let t = 0; t <= MAX; t += STEP) {
  times.push(t);
  const res = t === 0 ? null : await reconstruct(flat, t, '&return_null_points');
  let k = 0;
  refs.forEach((r, i) => {
    const now = r.cands.map((c, j) => (t === 0 ? c : res.coordinates[k + j])); k += r.cands.length;
    if (t === 0) { rot[i].push([1, 0, 0, 0]); return; }
    let best = null;   // the most separated pair of points that both reconstruct at t
    for (let a = 0; a < now.length; a++) for (let b = a + 1; b < now.length; b++) {
      if (!now[a] || !now[b]) continue; const d = 1 - dot(xyz(r.cands[a]), xyz(r.cands[b]));
      if (!best || d > best.d) best = { a, b, d };
    }
    if (!best && now.some(Boolean)) { const a = now.findIndex(Boolean); best = { a, b: a, d: 0 }; }   // one point: rotation about it is unknown; use the shortest one
    if (!best) { rot[i].push(null); return; }   // no reconstruction for this plate at t
    let q;
    if (best.d < 1e-9) {   // single point: the minimal rotation taking it from today to then
      const u0 = xyz(r.cands[best.a]), u1 = xyz(now[best.a]), ax = cross(u0, u1), w = 1 + dot(u0, u1);
      q = unit([w, ...ax]);
    } else {
      const F0 = frame(xyz(r.cands[best.a]), xyz(r.cands[best.b])), Ft = frame(xyz(now[best.a]), xyz(now[best.b]));
      q = quat([0, 1, 2].map(row => [0, 1, 2].map(col => Ft[0][row] * F0[0][col] + Ft[1][row] * F0[1][col] + Ft[2][row] * F0[2][col])));
    }
    const prev = rot[i].filter(Boolean).pop();
    if (prev && q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3] < 0) q = q.map(v => -v);   // keep slerp on the short arc
    rot[i].push(q.map(v => Math.round(v * 1e5) / 1e5));
  });
  if (t % 100 === 0) console.log('t =', t);
}

const index = new Map(refs.map((r, i) => [r.pid, i]));
fs.writeFileSync(path.join(HERE, 'morph.json'), JSON.stringify({
  model: MODEL, step: STEP, max: MAX, times,
  citation: 'Merdith et al. 2021, Extending full-plate tectonic models into deep time, Earth-Science Reviews 214, 103477; rotations derived from points reconstructed by the GPlates Web Service (gws.gplates.org), EarthByte Group, University of Sydney',
  plates: refs.map((r, i) => ({ pid: r.pid, q: rot[i] })),
  rings: rings.map(r => ({ p: index.get(r.pid), pts: r.pts })),
}));
console.log('plates', refs.length, 'written', (fs.statSync(path.join(HERE, 'morph.json')).size / 1e6).toFixed(1), 'MB');
