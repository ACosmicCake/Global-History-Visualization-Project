// Builds viewer/paleo/vitals.json: Earth's vital signs through time, each curve joined from published records, oldest to newest.
// Download into one folder, outside the repo:
//   scotese-grid.zip   Scotese et al. 2021, zenodo.org/records/8238875 (gmst_scotese02a_v21321_csv-grid.zip)
//   hansen2013.txt     Hansen et al. 2013, columbia.edu/~mhs119/Sensitivity+SL+CO2/Table.txt
//   hadcrut5.csv       Met Office HadCRUT.5.0.2.0, analysis summary series, global annual
//   foster2875.xlsx    Foster et al. 2017, Nature Communications 8:14845, Supplementary Data 2
//   cenco2pip.zip      CenCO2PIP 2023, zenodo.org/records/14537923
//   epa-co2.csv        US EPA Climate Change Indicators, atmospheric concentrations, CO2 (June 2024); its ice core column
//   maunaloa.csv       NOAA GML annual mean CO2, Mauna Loa
// Sea level to 798,000 years ago comes from viewer/paleo/sealevel.json. Day length and Moon distance are the measurements tabled
// by Farhat et al. 2022 (A&A 665, L1), written out below. Ages are millions of years before 1950.
// Usage: node atlas/tools/build-vitals.mjs <folder>
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ROOT } from './lib.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: build-vitals.mjs <folder>'); process.exit(1); }
const VIEWER = path.resolve(ROOT, '..', 'viewer'), file = n => path.join(dir, n), yearToMa = y => (1950 - y) / 1e6;

// ---------- reading zip and xlsx files, with nothing to install
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
function sheets(b) {
  const z = zip(b), shared = [...(z.find(x => /sharedStrings/.test(x.name))?.read().toString() || '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join(''));
  return z.filter(x => /xl\/worksheets\/sheet\d+\.xml$/.test(x.name)).map(x => [...x.read().toString().matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map(r => {
    const row = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = c[3]?.match(/<v>([^<]*)<\/v>/)?.[1];
      if (v != null) row[c[1]] = /t="s"/.test(c[2]) ? shared[+v] : /t="str"/.test(c[2]) ? v : +v;
      else { const t = c[3]?.match(/<t[^>]*>([^<]*)<\/t>/)?.[1]; if (t != null) row[c[1]] = t; }
    }
    return row;
  }));
}

// ---------- smoothing and thinning: about the same number of points per factor of ten in age, averaged
function thin(pts, perDecade = 60) {
  const bins = new Map();
  for (const [ma, v] of pts) { const k = ma <= 0 ? `r${ma}` : Math.round(Math.log10(ma) * perDecade); (bins.get(k) || bins.set(k, []).get(k)).push([ma, v]); }
  return [...bins.values()].map(b => [b.reduce((s, p) => s + p[0], 0) / b.length, b.reduce((s, p) => s + p[1], 0) / b.length]).sort((a, b) => a[0] - b[0]);
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const round = (pts, d) => pts.map(([m, v]) => [+m.toPrecision(5), +v.toFixed(d)]);
const atAge = (pts, ma) => { const near = pts.reduce((b, p) => (Math.abs(p[0] - ma) < Math.abs(b[0] - ma) ? p : b)); return near[1]; };

// ---------- temperature
const scotese = zip(fs.readFileSync(file('scotese-grid.zip'))).filter(x => /\.csv$/.test(x.name)).map(x => {
  const ma = parseInt(path.basename(x.name)); let sum = 0, w = 0;
  x.read().toString().trim().split('\n').forEach((line, i) => { const c = Math.cos((90 - i) * Math.PI / 180); for (const s of line.split(',')) { const v = +s; if (Number.isFinite(v)) { sum += v * c; w += c; } } });
  return [ma, sum / w];
}).sort((a, b) => a[0] - b[0]);
const hansen = fs.readFileSync(file('hansen2013.txt'), 'utf8').split('\n').map(l => l.trim().split(/\s+/).map(Number)).filter(a => a.length >= 7 && a.every(Number.isFinite)).map(a => ({ ma: a[2], ts: a[5], sl: a[6] }));
const hansenOldest = Math.max(...hansen.map(h => h.ma));
// HadCRUT5 gives anomalies from 1961-90; 14 degrees C is the usual value for that period's global mean
const hadcrut = fs.readFileSync(file('hadcrut5.csv'), 'utf8').trim().split('\n').slice(1).map(l => l.split(',')).filter(c => +c[0] < new Date().getUTCFullYear()).map(c => [yearToMa(+c[0]), 14 + +c[1]]);
const firstInstrument = Math.max(...hadcrut.map(p => p[0]));
const temp = [...hadcrut, ...thin(hansen.filter(h => h.ma > firstInstrument).map(h => [h.ma, h.ts]), 40), ...scotese.filter(p => p[0] > hansenOldest)];

// ---------- CO2
const row = l => l.split(',').map(s => s.trim());
const mauna = fs.readFileSync(file('maunaloa.csv'), 'utf8').split('\n').filter(l => /^\d{4},/.test(l)).map(l => { const c = row(l); return [yearToMa(+c[0]), +c[1]]; });
const newestIce = Math.max(...mauna.map(p => p[0]));
const ice = fs.readFileSync(file('epa-co2.csv'), 'utf8').split('\n').filter(l => /^-?\d/.test(l)).map(row).filter(c => c[1] !== '').map(c => [yearToMa(+c[0]), +c[1]]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] > newestIce);
const iceOldest = Math.max(...ice.map(p => p[0]));
// CenCO2PIP is a set of vetted estimates, not a curve: the median in sliding 1-million-year windows, leaving out what the authors quarantined
const estimates = [];
for (const x of zip(fs.readFileSync(file('cenco2pip.zip')))) {
  if (!/\.xlsx$/.test(x.name) || /__MACOSX/.test(x.name)) continue;
  const proxy = path.basename(x.name);
  for (const rows of sheets(x.read())) {
    const h = rows.find(r => { const v = Object.values(r); return (v.includes('age_ka') || v.includes('age_ka_bp')) && (v.includes('CO2_ppm') || v.includes('METHOD_wtmean_pCO2_ppm_use')); });
    if (!h) continue;
    const col = name => Object.keys(h).find(k => h[k] === name), A = col('age_ka') || col('age_ka_bp'), C = col('CO2_ppm') || col('METHOD_wtmean_pCO2_ppm_use');
    const Q = Object.keys(h).filter(k => /quarantined/i.test(String(h[k])));
    for (const r of rows.slice(rows.indexOf(h) + 1)) {
      if (Q.some(k => r[k] === 1 || /^true$/i.test(String(r[k])))) continue;
      const ka = r[A], ppm = r[C];
      if (typeof ka === 'number' && typeof ppm === 'number' && ka > 0 && ka < 67000 && ppm > 100 && ppm < 8000) estimates.push({ ma: ka / 1000, ppm, proxy });
    }
  }
}
const rawWindows = [];
for (let ma = iceOldest + 0.25; ma <= 66; ma += 0.5) { const near = estimates.filter(e => Math.abs(e.ma - ma) <= 1).map(e => e.ppm); if (near.length >= 3) rawWindows.push([ma, median(near)]); }
const windows = rawWindows.map(([ma], i) => [ma, median(rawWindows.slice(Math.max(0, i - 2), i + 3).map(w => w[1]))]);   // a running median, so one thin stretch of samples doesn't draw a spike
const foster = sheets(fs.readFileSync(file('foster2875.xlsx')))[0].filter(r => typeof r.A === 'number' && typeof r.B === 'number').map(r => [r.A, r.B]);
// Foster's fit is poorly constrained just past the end of the Cretaceous (244 ppm, 95% range 154-424), far below the CenCO2PIP medians that
// meet it. Leaving those ages out draws a straight line across the gap, so scrubbing past the asteroid does not show a CO2 crash that nobody measured.
const co2 = [...mauna, ...thin(ice, 60), ...round(thin(windows, 200), 0), ...foster.filter(p => p[0] > 72)];

// ---------- sea level
const spratt = JSON.parse(fs.readFileSync(path.join(VIEWER, 'paleo', 'sealevel.json'), 'utf8')).curve.map(([ka, m]) => [ka / 1000, m]);
const sprattOldest = Math.max(...spratt.map(p => p[0]));
// The stack reads +8 m at the present day, its margin being wider than the change: today is 0 by definition, a straight line from 8,000 years ago
const sea = [[0, 0], ...spratt.filter(p => p[0] >= 8 / 1000), ...thin(hansen.filter(h => h.ma > sprattOldest).map(h => [h.ma, h.sl]), 40)];

// ---------- the Earth-Moon system: Farhat et al. 2022, tables 2 and 3. Age in Ga, length of day in hours, Moon distance in km
const RE = 383598 / 60.142611;
const TIDES = [[0, 24.00, 383598], [0.055, 23.80, 382284], [0.27, 22.90, 375967], [0.445, 22.53, 373277], [0.493, 21.99, 369153], [0.5, 21.82, 367854], [1.4, 18.70, 339777], [2.46, 16.98, 320452], [3.2, 15.17, Math.round(46.45 * RE)]];

const byAge = pts => [...pts].sort((a, b) => a[0] - b[0]);
const out = {
  note: 'Each curve joins published records. Where two meet they can differ, and every value has real uncertainty, which grows with age.',
  series: {
    temp: { label: 'Temperature', unit: '°C', digits: 0, points: round(byAge(temp), 2), source: 'Global mean surface temperature. Scotese et al. 2021 (540–66 million years ago), Hansen et al. 2013 (from 65.5 million years ago), HadCRUT5 (from 1850).' },
    co2: { label: 'CO₂', unit: ' ppm', digits: 0, points: round(byAge(co2), 0), source: 'Atmospheric carbon dioxide. Foster et al. 2017 (420–72 million years ago), then a straight line across to the Atlas’s own medians of the CenCO2PIP 2023 estimates (66 million to 800,000 years ago), which run below the authors’ fitted curve at the Eocene peak (about 1,200 ppm here, about 1,600 in the paper). Then Antarctic ice cores as compiled by the US EPA (last 800,000 years), Mauna Loa (from 1959).' },
    sea: { label: 'Sea level', unit: ' m', digits: 0, signed: true, points: round(byAge(sea), 1), source: 'Against today’s level. Hansen et al. 2013 (65 million to 800,000 years ago), Spratt and Lisiecki 2016 (800,000 to 8,000 years ago), then a straight line to today, because that study’s margin is wider than the change since. Hansen’s curve tops out at +65 m, the rise with no ice left.' },
    day: { label: 'Day length', unit: ' h', digits: 1, points: TIDES.map(t => [t[0] * 1000, t[1]]), source: 'Measurements from tidal rhythmites and sedimentary cycles, tabled by Farhat et al. 2022; straight lines between them. Back to 3.2 billion years ago.' },
    moon: { label: 'Moon distance', unit: ' km', digits: -3, points: TIDES.map(t => [t[0] * 1000, t[2]]), source: 'Average distance, from the same measurements in Farhat et al. 2022; straight lines between them. Back to 3.2 billion years ago.' },
  },
};
fs.writeFileSync(path.join(VIEWER, 'paleo', 'vitals.json'), JSON.stringify(out));

// ---------- what to look at before trusting the file
for (const [k, s] of Object.entries(out.series)) console.log(k.padEnd(5), `${s.points.length} points, ${s.points[0][0]} to ${s.points.at(-1)[0]} Ma; ${Math.min(...s.points.map(p => p[1]))} to ${Math.max(...s.points.map(p => p[1]))}${s.unit}`);
console.log('file', (fs.statSync(path.join(VIEWER, 'paleo', 'vitals.json')).size / 1024).toFixed(0), 'KB; CenCO2PIP estimates used', estimates.length, 'from', new Set(estimates.map(e => e.proxy)).size, 'files');
console.log('CO2 checks: 51 Ma', atAge(co2, 51), '(paper: about 1600); 33.9 Ma', atAge(co2, 33.9), '(paper: about 720); Foster at 51 Ma', atAge(foster, 51), '; at the 66 Ma join', atAge(co2, 66.5), '/', atAge(foster, 65.5));
console.log('CO2 ice core: 20 ka', atAge(ice, 0.02), '(expect about 190), 125 ka', atAge(ice, 0.125), '(expect about 275), 400 ka', atAge(ice, 0.4), ', oldest', iceOldest, ', 1 ka', atAge(ice, 0.001));
console.log('temp checks: 1850', atAge(temp, yearToMa(1850)), ', 2023', atAge(temp, yearToMa(2023)), ', 20 ka', atAge(temp, 0.02), ', 50 Ma', atAge(temp, 50), ', join at', hansenOldest, atAge(hansen.map(h => [h.ma, h.ts]), hansenOldest), '/', atAge(scotese, 70));
console.log('sea checks: 20 ka', atAge(sea, 0.02), ', 1 Ma', atAge(sea, 1), ', 50 Ma', atAge(sea, 50));
