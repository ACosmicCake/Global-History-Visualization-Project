// Builds viewer/assets/ice-sheets.png: grounded ice thickness for the last 80,000 years, from PaleoMIST 1.0 (Gowan et al. 2021,
// Nature Communications 12:1199, CC BY 4.0). 33 frames, 2,500 years apart, each 360 x 181 (1 degree, north at the top, starting at
// 180 W), laid out left to right and top to bottom in 6 columns; frame 0 is today. Pixel value: 0 no ice; 1..255 the square root of
// thickness up to 5,000 m, so thin margins still show.
// Download: global_grid/reconstruction_1_degree.nc from the archive at doi.org/10.1594/PANGAEA.905800. It is 3.7 GB whole, but the
// server takes range requests, so this one file can be read out of it. Keep it outside the repo, with h5wasm installed beside it
// (npm install h5wasm --prefix <folder>): the file is NetCDF-4, which needs an HDF5 reader, and the site itself depends on nothing.
// Usage: node atlas/tools/build-icesheets.mjs <reconstruction_1_degree.nc> <folder with h5wasm>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib.mjs';

const [file, reader] = process.argv.slice(2);
if (!file || !reader) { console.error('usage: build-icesheets.mjs <reconstruction_1_degree.nc> <folder with h5wasm>'); process.exit(1); }
const { default: h5wasm } = await import(pathToFileURL(path.join(path.resolve(reader), 'node_modules', 'h5wasm', 'dist', 'node', 'hdf5_hl.js')));
await h5wasm.ready;
const f = new h5wasm.File(file, 'r');
const time = [...f.get('time').value], lon = [...f.get('lon').value], lat = [...f.get('lat').value], ice = f.get('ice_thickness'), raw = ice.value;
const [T, H, W0] = ice.shape, W = W0 - 1;      // the last column repeats the first
if (T !== 33 || lon[0] !== -180 || lon[W] !== 180 || Math.abs(lat[0]) !== 90) throw new Error(`unexpected grid: ${T} ${lon[0]}..${lon[W]} ${lat[0]}..`);
const north = lat[0] === 90, order = time.map((t, i) => [Math.abs(t), i]).sort((a, b) => a[0] - b[0]);
if (order[0][0] !== 0 || order[32][0] !== 80000) throw new Error('unexpected times: ' + time.slice(0, 3));

const COLS = 6, ROWS = 6, AW = COLS * W, AH = ROWS * H, grey = new Uint8Array(AW * AH), areas = [];
order.forEach(([bp, t], k) => {
  const ox = (k % COLS) * W, oy = Math.floor(k / COLS) * H, base = t * H * W0;
  let km2 = 0, peak = 0;
  for (let y = 0; y < H; y++) {
    const row = north ? y : H - 1 - y, cosLat = Math.cos(lat[row] * Math.PI / 180);
    for (let x = 0; x < W; x++) {
      const m = raw[base + row * W0 + x];
      if (!(m > 1) || m > 1e6) continue;       // no ice, or the file's missing value
      grey[(oy + y) * AW + ox + x] = Math.min(255, 1 + Math.round(Math.sqrt(m / 5000) * 254));
      km2 += 111.2 * 111.2 * cosLat; peak = Math.max(peak, m);
    }
  }
  areas.push(`${bp / 1000} ka: ${(km2 / 1e6).toFixed(1)} million km2, thickest ${Math.round(peak)} m`);
});
f.close();

// ---------- 8-bit greyscale PNG
const px = Buffer.alloc((AW + 1) * AH);
for (let y = 0; y < AH; y++) {
  const o = y * (AW + 1); px[o] = 2;           // PNG filter: difference from the row above
  for (let x = 0; x < AW; x++) px[o + 1 + x] = (grey[y * AW + x] - (y ? grey[(y - 1) * AW + x] : 0)) & 255;
}
const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(AW, 0); ihdr.writeUInt32BE(AH, 4); ihdr[8] = 8; ihdr[9] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
const out = path.resolve(ROOT, '..', 'viewer', 'assets', 'ice-sheets.png');
fs.writeFileSync(out, png);
console.log(areas.join('\n'));
console.log(`ice-sheets.png ${AW}x${AH}, ${(png.length / 1024).toFixed(0)} KB`);
