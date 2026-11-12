// Earth's vital signs: temperature, CO2, sea level, day length, Moon distance and known genera at the date shown
// (paleo/vitals.json), as a panel and as a curve on the time bar.
import { $, esc, show } from './dom.js';
import { state } from './state.js';
import { drawDensity } from './timebar.js';
import { render, renderFossilKey } from './main.js';

// Earth's vital signs (paleo/vitals.json, built by atlas/tools/build-vitals.mjs): each curve runs from today back as far as there are estimates.
// Reconstructed values carry a ≈ and are rounded to what they can bear; older than a curve's oldest estimate shows a dash, not a guess.
export let vitals = null;
export const VITAL_MIN_SPAN = { temp: 1, co2: 30, sea: 5, day: 0.2, moon: 2000, life: 100 }; // the curve on the time bar won't stretch less than this to fill its height, so a flat stretch stays flat
fetch('paleo/vitals.json')
  .then(r => r.json())
  .then(d => {
    vitals = d;
    $('#v-rows').innerHTML = Object.entries(d.series)
      .map(
        ([k, s]) =>
          `<button class="v-row" data-k="${k}" title="${esc(s.source)}"><span>${esc(s.label).replace(/ (.+)/, '<i> $1</i>')}</span><b></b></button>`,
      )
      .join('');
    $('#v-rows')
      .querySelectorAll('button')
      .forEach(b => {
        b.onclick = () => {
          if (compact()) return setVitalsOpen(true); // the one-line chip opens the full readout
          state.vitalCurve = b.dataset.k;
          showVitalSource();
          drawDensity();
        };
      });
    showVitalSource();
    render();
  })
  .catch(err => console.error('vitals', err));
// the time console's height depends on how its controls wrap, so the panel measures it rather than assuming
new ResizeObserver(() =>
  document.documentElement.style.setProperty(
    '--time-top',
    `${Math.round(document.documentElement.clientHeight - $('#time').getBoundingClientRect().top)}px`,
  ),
).observe($('#time'));
// Vital signs are on by default on a desktop and off on a phone, and the visitor's choice is remembered. On a desktop
// they start as a one-line chip showing the sign drawn on the time bar; a click opens the full readout.
const store = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {}
};
state.vitals = (store('atlas.vitals') ?? (innerWidth <= 760 ? '0' : '1')) === '1';
$('#vitals-toggle').setAttribute('aria-pressed', state.vitals);
$('#vitals-toggle').addEventListener('click', () => store('atlas.vitals', state.vitals ? '1' : '0'));
const wide = matchMedia('(min-width: 901px)');
let vitalsOpen = store('atlas.vitals.open') === '1';
const compact = () => wide.matches && !vitalsOpen;
export function setVitalsOpen(open) {
  vitalsOpen = open;
  store('atlas.vitals.open', open ? '1' : '0');
  $('#vitals').classList.toggle('compact', !open);
  $('#v-head').setAttribute('aria-expanded', open);
  render();
}
$('#vitals').classList.toggle('compact', !vitalsOpen);
$('#v-head').setAttribute('aria-expanded', vitalsOpen);
$('#v-head').onclick = () => setVitalsOpen(!vitalsOpen);
// rows that say nothing at the date step out: known genera after 10,000 BCE, and day length and the Moon's distance
// outside the Deep time and Life scales, where neither changes enough to show
const rowShown = k => (k === 'life' ? state.t < -10000 : k === 'day' || k === 'moon' ? state.level <= 1 : true);
export function showVitalSource() {
  $('#v-rows')
    .querySelectorAll('button')
    .forEach(b => b.setAttribute('aria-pressed', b.dataset.k === state.vitalCurve));
  $('#v-source').textContent = `${vitals.series[state.vitalCurve].source} ${vitals.note}`;
}
export function vitalAt(s, ma) {
  const p = s.points;
  if (ma > p[p.length - 1][0]) return null;
  if (ma <= p[0][0]) return p[0][1];
  let a = 0,
    b = p.length - 1;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (p[m][0] <= ma) a = m;
    else b = m;
  }
  return p[a][1] + ((p[b][1] - p[a][1]) * (ma - p[a][0])) / (p[b][0] - p[a][0]);
}
// the number alone, rounded for how well it is known at that age
export function vitalNumber(k, v, ma) {
  if (k === 'temp') return `${ma <= 1e-4 ? v.toFixed(1) : Math.round(v)}°C`;
  if (k === 'co2')
    return `${(ma <= 9e-6 ? Math.round(v) : ma <= 0.81 ? Math.round(v / 5) * 5 : Math.round(v / 50) * 50).toLocaleString()} ppm`;
  if (k === 'sea') {
    const m = ma <= 0.81 ? Math.round(v) : Math.round(v / 5) * 5;
    return `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} m`;
  }
  if (k === 'day') return `${v.toFixed(1)} h`;
  if (k === 'life') return (Math.round(v / 10) * 10).toLocaleString();
  return `${(Math.round(v / 1000) * 1000).toLocaleString()} km`;
}
export const vitalMeasured = (k, ma) => (k === 'temp' ? ma <= 1e-4 : k === 'co2' ? ma <= 9e-6 : ma <= 1e-4);
export const vitalText = (k, v, ma) => (v == null ? '—' : `${vitalMeasured(k, ma) ? '' : '≈ '}${vitalNumber(k, v, ma)}`);
export function renderVitals() {
  const key = renderFossilKey();
  show($('#vitals'), (!!vitals && state.vitals) || key);
  $('#vitals').classList.toggle('only-key', !state.vitals);
  if (!vitals || !state.vitals) return;
  const ma = (1950 - state.t) / 1e6;
  if (!rowShown(state.vitalCurve)) {
    state.vitalCurve = 'temp';
    showVitalSource();
    drawDensity();
  }
  for (const b of $('#v-rows').children) {
    const k = b.dataset.k;
    b.hidden = !rowShown(k);
    if (b.hidden) continue;
    const text = vitalText(k, vitalAt(vitals.series[k], ma), ma),
      el = b.lastElementChild;
    if (el.textContent !== text) el.textContent = text;
  }
}
// the chosen sign along the time bar, scaled to what it does on this scale; the panel says what that range is
export function drawVitalCurve(g, w, h, from, to) {
  const k = state.vitalCurve,
    s = state.vitals && vitals?.series[k];
  if (!s) return;
  const n = Math.max(2, Math.ceil(w / 2)),
    ys = Array.from({ length: n }, (_, i) => vitalAt(s, (1950 - (from + ((to - from) * i) / (n - 1))) / 1e6)),
    known = ys.filter(v => v != null);
  const say = text => {
    const r = $('#v-range');
    if (r.textContent !== text) r.textContent = text;
  };
  if (!known.length) {
    say(`${s.label}: no estimate this far back.`);
    return;
  }
  const lo = Math.min(...known),
    hi = Math.max(...known),
    pad = Math.max(0, VITAL_MIN_SPAN[k] - (hi - lo)) / 2,
    y0 = lo - pad,
    span = hi + pad - y0,
    Y = v => h - 3 - ((v - y0) / span) * (h - 6);
  const age = Math.max(0, (1950 - from) / 1e6);
  say(`On the time bar: ${s.label}, ${vitalNumber(k, lo, age)} to ${vitalNumber(k, hi, age)} at this scale`);
  g.beginPath();
  let pen = false;
  ys.forEach((v, i) => {
    if (v == null) {
      pen = false;
      return;
    }
    const x = (i / (n - 1)) * w;
    if (pen) g.lineTo(x, Y(v));
    else g.moveTo(x, Y(v));
    pen = true;
  });
  g.strokeStyle = 'rgba(150,215,240,.9)';
  g.lineWidth = 1.25;
  g.lineJoin = 'round';
  g.stroke();
}
// Sky: the Moon sits where it really was at the selected moment. The Sun lights the side being explored, or with Real sunlight on it stands where it does right now, at this time of day and year, which is
// the real sky at today's date and a fair one at any other: most scales show a year, with no day or hour to place it by. On the One year scale, which does show a day, the season follows that day and the
// time of day stays the clock's, so scrubbing changes the season rather than spinning the Earth under the Sun. City lights are modern (c. 2012), so they appear only from 1900 on.
