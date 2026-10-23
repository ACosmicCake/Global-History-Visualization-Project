// Measure a structure's plan from its OpenStreetMap outline (a mapped building/way or relation), for model plan
// dimensions when a source gives the height but no footprint. Prints the long and short sides of the minimum-area
// bounding rectangle (and the diameter of a near-circular outline) in metres, plus the citation to add as a
// class "dataset" source. OSM outlines are surveyed or traced from imagery: cite them as the plan source only for
// the structure the outline is tagged as.
// Usage: node atlas/tools/osm-footprint.mjs way/<id> | relation/<id> | "<search text>"
const arg = process.argv[2];
if (!arg) { console.error('usage: osm-footprint.mjs way/<id> | relation/<id> | "<name>"'); process.exit(1); }
const UA = { 'User-Agent': 'LivingAtlas/1.0 (research tool)' };

async function resolve(q) {
  if (/^(way|relation)\/\d+$/.test(q)) return q;
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`, { headers: UA }).then(r => r.json());
  const hit = res.find(x => x.osm_type === 'way' || x.osm_type === 'relation');
  if (!hit) throw new Error('no mapped outline (way or relation) found for that name');
  console.log(`match: ${hit.display_name}`);
  return `${hit.osm_type}/${hit.osm_id}`;
}

const id = await resolve(arg);
const [type, num] = id.split('/');
const query = `[out:json];${type}(${num});out geom;`;
const data = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: UA, body: 'data=' + encodeURIComponent(query) }).then(r => r.json());
const el = data.elements?.[0];
if (!el) throw new Error('outline not found');
let pts = el.geometry || (el.members || []).filter(m => m.role === 'outer').flatMap(m => m.geometry || []);
pts = pts.filter(Boolean);
if (pts.length < 3) throw new Error('outline has too few points');

// project to local metres around the centroid
const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon0 = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
const k = 111320, kx = k * Math.cos((lat0 * Math.PI) / 180);
const xy = pts.map(p => [(p.lon - lon0) * kx, (p.lat - lat0) * k]);
// minimum-area bounding rectangle over edge directions
let best = null;
for (let i = 0; i < xy.length - 1; i++) {
  const a = Math.atan2(xy[i + 1][1] - xy[i][1], xy[i + 1][0] - xy[i][0]), c = Math.cos(a), s = Math.sin(a);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of xy) { const u = x * c + y * s, v = -x * s + y * c; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
  const area = (x1 - x0) * (y1 - y0);
  if (!best || area < best.area) best = { area, l: Math.max(x1 - x0, y1 - y0), w: Math.min(x1 - x0, y1 - y0) };
}
const r = xy.map(([x, y]) => Math.hypot(x, y)), rm = r.reduce((s, v) => s + v, 0) / r.length;
const round = rm > 0 && Math.max(...r.map(v => Math.abs(v - rm))) / rm < 0.08;
const tags = el.tags || {};
console.log(`osm: https://www.openstreetmap.org/${id}  name: ${tags.name || tags['name:en'] || '(unnamed)'}  building: ${tags.building || tags.historic || tags.amenity || '?'}`);
console.log(`plan: ${best.l.toFixed(1)} m x ${best.w.toFixed(1)} m (minimum bounding rectangle)${round ? `; near-circular, diameter about ${(2 * rm).toFixed(1)} m` : ''}`);
console.log(`cite as: {"id":"src-osm-outline","url":"https://www.openstreetmap.org/${id}","title":"OpenStreetMap outline of ${(tags.name || 'the structure').replace(/"/g, '')}","publisher":"OpenStreetMap contributors","class":"dataset","opened":true,"supports":["model.geometry"]}`);
