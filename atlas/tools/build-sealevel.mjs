// Builds the ice-age coastline data: viewer/assets/shelf-depth.png, how far below today's sea level each part of the
// shallow sea floor lies (from NOAA ETOPO1), and viewer/paleo/sealevel.json, sea level through time (Spratt & Lisiecki 2016).
// Only sea floor joined to the open ocean counts, so the Caspian and the Dead Sea don't drain when the sea falls.
// Pixel value: 0 land or deep basin cut off from the ocean; 1..255 depth 0..150 m, and 255 anything deeper.
// Download: ETOPO1 as CSV at a 10-cell stride from a NOAA ERDDAP server, griddap/etopo180.csv?altitude[(-90.0):10:(90.0)][(-180.0):10:(180.0)],
// and spratt2016.txt from ncei.noaa.gov/pub/data/paleo/contributions_by_author/spratt2016/. Keep both outside the repo.
// Usage: node atlas/tools/build-sealevel.mjs <etopo.csv> <spratt2016.txt>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { ROOT } from './lib.mjs';

const [csv, spratt] = process.argv.slice(2);
if (!csv || !spratt) { console.error('usage: build-sealevel.mjs <etopo.csv> <spratt2016.txt>'); process.exit(1); }
const VIEWER = path.resolve(ROOT, '..', 'viewer');

// ---------- the grid, as the file gives it: south to north, west to east
const rows = new Map();
let n = 0;
for await (const line of readline.createInterface({ input: fs.createReadStream(csv) })) {
  if (n++ < 2) continue;
  const [lat, , alt] = line.split(',');
  (rows.get(lat) || rows.set(lat, []).get(lat)).push(+alt);
}
const lats = [...rows.keys()].sort((a, b) => +b - +a), H = lats.length, W0 = rows.get(lats[0]).length, W = W0 - 1;   // the last column repeats the first (180° = -180°)
const elev = new Int16Array(W * H);
lats.forEach((lat, y) => { const r = rows.get(lat); for (let x = 0; x < W; x++) elev[y * W + x] = r[x]; });

// ---------- flood from the deep ocean through everything below sea level
const ocean = new Uint8Array(W * H), stack = [];
for (let i = 0; i < elev.length; i++) if (elev[i] < -3000) { ocean[i] = 1; stack.push(i); }
while (stack.length) {
  const i = stack.pop(), y = Math.floor(i / W), x = i - y * W;
  for (const j of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && !ocean[j] && elev[j] < 0) { ocean[j] = 1; stack.push(j); }
}

// ---------- 8-bit greyscale PNG, north at the top
const px = Buffer.alloc((W + 1) * H);
for (let y = 0; y < H; y++) {
  const o = y * (W + 1); px[o] = 2;   // PNG filter: difference from the row above
  for (let x = 0; x < W; x++) {
    const i = y * W + x, v = ocean[i] ? Math.min(255, 1 + Math.round(-elev[i] * 254 / 150)) : 0;
    const above = y ? (ocean[i - W] ? Math.min(255, 1 + Math.round(-elev[i - W] * 254 / 150)) : 0) : 0;
    px[o + 1 + x] = (v - above) & 255;
  }
}
const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(path.join(VIEWER, 'assets', 'shelf-depth.png'), png);

// ---------- sea level by age: the study's 0-430 ka stack where it exists, its 0-798 ka stack beyond
const curve = [];
const lines = fs.readFileSync(spratt, 'utf8').split(/\r?\n/);
const head = lines.findIndex(l => l.startsWith('age_calkaBP')), cols = lines[head].split('\t'), S = cols.indexOf('SeaLev_shortPC1'), L = cols.indexOf('SeaLev_longPC1');
for (const l of lines.slice(head + 1)) {
  const c = l.split('\t'); if (c.length < 2) continue;
  const short = parseFloat(c[S]), long = parseFloat(c[L]), m = Number.isNaN(short) ? long : short;
  if (!Number.isNaN(m)) curve.push([+c[0], Math.round(m)]);
}
fs.writeFileSync(path.join(VIEWER, 'paleo', 'sealevel.json'), JSON.stringify({ source: 'Spratt and Lisiecki 2016, Climate of the Past 12, doi:10.5194/cp-12-1-2016; age in thousand years before 1950, sea level in metres', curve }));
console.log(`shelf-depth.png ${W}x${H}, ${(png.length / 1024).toFixed(0)} KB; sealevel.json ${curve.length} points, lowest ${Math.min(...curve.map(x => x[1]))} m`);
