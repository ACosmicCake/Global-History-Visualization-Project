// The time bar: the density strip and the marks for mass extinctions and ice ages, the slider and its dragging,
// and Play with its speed chip.
import { $, esc } from './dom.js';
import { EARTH, LEVELS, NOW, domainOn, inLevel, range } from './time.js';
import { state } from './state.js';
import { deepTime, goTo, render, setLevel } from './main.js';
import { drawVitalCurve } from './vitals.js';

// mass extinctions and ice ages on the time bar, for the scales that reach them. A click on an extinction opens its record. Ice ages are only a tint: they sit where people grab the bar, and one that
// fills most of the scale, as Antarctica's ice does on every short one, says nothing there, so it isn't drawn.
let marksKey = '';   // the marks drawn last, so an unchanged bar is not redrawn
export function drawMarks(from, to) {
  const key = `${from}|${to}|${!!deepTime}`;
  if (key === marksKey || !deepTime) return;
  marksKey = key;
  const X = ma => ((-ma * 1e6 - from) / (to - from)) * 100, box = $('#marks');
  box.innerHTML = deepTime.marks.map(m => {
    const title = esc(m.label), tag = m.id ? 'button' : 'span', attr = m.id ? `data-id="${esc(m.id)}" aria-label="${title}"` : '';
    if (m.kind === 'extinction') { const x = X(m.ma); return x < 0 || x > 100 ? '' : `<${tag} class="mark ext" style="left:${x.toFixed(2)}%" title="${title}" ${attr}></${tag}>`; }
    const a = Math.max(0, X(m.from)), b = Math.min(100, X(m.to));
    return b <= a || b - a > 40 ? '' : `<span class="mark ice" style="left:${a.toFixed(2)}%;width:${Math.max(0.4, b - a).toFixed(2)}%"></span>`;
  }).join('');
  box.querySelectorAll('button').forEach(b => { b.onclick = () => goTo(b.dataset.id); });
}
// density strip: how many records fall at each point of the current scale (so empty stretches are visible)
export function drawDensity() {
  const c = $('#density'), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const { from, to } = range(), bins = new Array(Math.max(20, Math.floor(w / 4))).fill(0);
  drawMarks(from, to);
  for (const p of state.pins) {
    if (!inLevel(p) || !domainOn(p) || p.until < from || p.start > to) continue;
    // count where each record begins (long periods would otherwise flood every bin)
    const i = Math.floor(((Math.max(p.start, from) - from) / (to - from)) * bins.length);
    bins[Math.min(bins.length - 1, Math.max(0, i))] += p.start >= from ? 1 : 0.35;
  }
  const max = Math.max(1, ...bins), bw = w / bins.length;
  g.fillStyle = 'rgba(190,205,230,0.08)'; g.fillRect(0, h - 1, w, 1);
  bins.forEach((n, i) => {
    if (!n) return;
    const bh = 3 + (n / max) * (h - 5);
    g.fillStyle = `rgba(217,179,106,${0.25 + 0.55 * (n / max)})`;
    g.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
  });
  drawVitalCurve(g, w, h, from, to);
  // the open record's dates, with its stated uncertainty as a soft edge rather than a crisp end (spec 11.5)
  const r = state.openRec, y0 = r?.when?.start?.year;
  if (y0 == null) return;
  const u = r.when.uncertainty || {}, y1 = r.when.end?.year ?? y0, X = y => ((y - from) / (to - from)) * w;
  const s0 = X(y0 - (u.start_minus_years || 0)), s1 = X(y0 + (u.start_plus_years || 0)), e0 = X(y1 - (u.end_minus_years || 0)), e1 = X(y1 + (u.end_plus_years || 0));
  if (e1 < 0 || s0 > w) return;
  const x0 = Math.max(0, s0), x1 = Math.min(w, Math.max(e1, s0 + 2));
  const grad = g.createLinearGradient(x0, 0, x1, 0), stop = x => Math.min(1, Math.max(0, (x - x0) / Math.max(1, x1 - x0)));
  grad.addColorStop(0, s0 < s1 ? 'rgba(240,243,248,0)' : 'rgba(240,243,248,.34)'); grad.addColorStop(stop(s1), 'rgba(240,243,248,.34)');
  grad.addColorStop(Math.max(stop(s1), stop(e0)), 'rgba(240,243,248,.34)'); grad.addColorStop(1, e0 < e1 ? 'rgba(240,243,248,0)' : 'rgba(240,243,248,.34)');
  g.fillStyle = grad; g.fillRect(x0, 0, x1 - x0, h);
}

// Dragging the time slider: the scale is fixed when the drag starts (in the one-year scale the range follows the
// year, so recomputing it mid-drag made the thumb run away), the slider's own value is left alone while it is held,
// and the globe redraws at most once a frame however fast the input events come
export let slideRange = null, slideFrame = 0, sliding = null;
export const slider = $('#slider');
export function slideTo(v) {
  const { from, to } = slideRange || range();
  state.t = from + (to - from) * (v / 1000);
  if (!slideFrame) slideFrame = requestAnimationFrame(() => { slideFrame = 0; render(); });
}
// The slider follows the pointer itself, with the pointer captured, so nothing else on the page can make it let go. The keyboard still works through the input's own events.
export const valueAtPointer = x => { const r = slider.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (x - r.left - 10) / Math.max(1, r.width - 20))) * 1000); };
slider.addEventListener('pointerdown', e => {
  if (e.button) return;
  e.preventDefault(); slider.focus({ preventScroll: true, focusVisible: false });
  if (timer) stopPlay();   // playback would otherwise fight the drag for the date
  slideRange = range(); sliding = e.pointerId;
  try { slider.setPointerCapture(e.pointerId); } catch {}
  slider.value = valueAtPointer(e.clientX); slideTo(+slider.value);
});
slider.addEventListener('pointermove', e => { if (e.pointerId !== sliding) return; slider.value = valueAtPointer(e.clientX); slideTo(+slider.value); });
export const slideEnd = e => { if (e.pointerId !== sliding) return; sliding = null; slideRange = null; render(); };
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) slider.addEventListener(ev, slideEnd);
slider.oninput = e => { slideTo(+e.target.value); };
$('#context').onclick = e => {
  const r = e.currentTarget.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
  if (f > 0.985) { state.t = -500; return setLevel(4); }  // the Humans sliver opens Civilization (spec 2)
  state.t = EARTH + f * (NOW - EARTH); setLevel(0);
};
export const ctx = $('#context');
ctx.tabIndex = 0; ctx.setAttribute('role', 'button'); ctx.setAttribute('aria-label', 'Jump to human history');
ctx.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.t = -500; setLevel(4); } };
$('#empty-btn').onclick = () => { state.whole = true; $('#whole').setAttribute('aria-pressed', true); render(); };
export let timer = null;
export const PLAY = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>';
export const PAUSE = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>';
// Play: the base speed scales with the level (spec 2), a whole scale in about 40 seconds at 1x, or about 12 days a
// second in the one-year scale; the speed chip multiplies it. Playback stops at the present day rather than looping.
export const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
export let speed = 1;
try { const s = +localStorage.getItem('atlas-speed'); if (SPEEDS.includes(s)) speed = s; } catch {}
export const presentT = () => { const d = new Date(), y0 = Date.UTC(d.getUTCFullYear(), 0, 1); return NOW + (d - y0) / (Date.UTC(NOW + 1, 0, 1) - y0); };
export const speedLabel = () => (speed < 1 ? `${speed}×`.replace('0.', '.') : `${speed}×`);
export function stopPlay() { cancelAnimationFrame(timer); timer = null; $('#play').innerHTML = PLAY; $('#play').setAttribute('aria-label', 'Play through time'); }
$('#play').onclick = () => {
  if (timer) return stopPlay();
  const end = () => Math.min(range().to, presentT());
  if (state.t >= end() - 1e-6) { state.t = range().from; render(); }   // at the end already: start the scale over
  $('#play').innerHTML = PAUSE; $('#play').setAttribute('aria-label', 'Pause');
  let last = performance.now();
  const step = now => {
    if (!timer) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const { from, to } = range(), event = LEVELS[state.level].key === 'event';
    const rate = (event ? 12.5 / 365 : (to - from) / 40) * speed;   // years per second
    // the one-year scale's window follows the year, so it plays on into the next year until the present day
    const stop = event ? presentT() : Math.min(to, presentT());
    state.t = Math.min(stop, state.t + rate * dt);
    render();
    if (state.t >= stop - 1e-9) stopPlay(); else timer = requestAnimationFrame(step);
  };
  timer = requestAnimationFrame(step);
};
$('#speed').textContent = speedLabel();
$('#speed').onclick = e => {   // click for faster, shift-click or right-click for slower
  const i = SPEEDS.indexOf(speed), back = e.shiftKey;
  speed = SPEEDS[(i + (back ? SPEEDS.length - 1 : 1)) % SPEEDS.length];
  $('#speed').textContent = speedLabel();
  try { localStorage.setItem('atlas-speed', speed); } catch {}
};
$('#speed').oncontextmenu = e => { e.preventDefault(); $('#speed').onclick({ shiftKey: true }); };
