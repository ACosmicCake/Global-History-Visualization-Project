// Time: the scales (levels), eons, year formatting, the time window around the date shown, and which records a scale
// and the filters let through. Reads the shared state; no DOM.
import { state } from './state.js';
import { SCALE_START, EARTH_FORMED, PHANEROZOIC_START } from '../shared/labels.mjs';

export const NOW = new Date().getUTCFullYear();
export const EARTH = EARTH_FORMED;
export const LEVELS = [
  { key: 'deep_time', name: 'Deep time', from: EARTH, to: NOW },
  { key: 'life', name: 'Life', from: SCALE_START.life, to: NOW },
  { key: 'human_origins', name: 'Human origins', from: SCALE_START.human_origins, to: NOW },
  { key: 'prehistory', name: 'Prehistory', from: SCALE_START.prehistory, to: NOW },
  { key: 'civilization', name: 'Civilization', from: SCALE_START.civilization, to: NOW },
  { key: 'modern', name: 'Modern', from: SCALE_START.modern, to: NOW },
  { key: 'event', name: 'One year', from: null, to: null },
];
export const SCALE_INDEX = Object.fromEntries(LEVELS.map((l, i) => [l.key, i]));
export const EONS = [ // ICS chronostratigraphic chart, eon boundaries
  { name: 'Hadean', from: EARTH, to: -4.031e9, color: '#3a1f2b' }, { name: 'Archean', from: -4.031e9, to: -2.5e9, color: '#4a2a3c' },
  { name: 'Proterozoic', from: -2.5e9, to: PHANEROZOIC_START, color: '#3c3557' }, { name: 'Phanerozoic', from: PHANEROZOIC_START, to: NOW, color: '#2c4a63' },
];
// ---------- time formatting & levels
export function fmtYear(y, short = false) {
  if (y == null) return '';
  const a = -y;
  if (a >= 1e9) return short ? `${(a / 1e9).toFixed(2)} Ga` : `${(a / 1e9).toFixed(2)} billion years ago`;
  if (a >= 1e6) return short ? `${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)} Ma` : `${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)} million years ago`;
  if (a >= 12000) return short ? `${Math.round(a / 1000)} ka` : `${Math.round(a / 1000).toLocaleString()},000 years ago`;
  if (y < 1) return `${(1 - Math.floor(y)).toLocaleString()} BCE`; // astronomical year -324.7 is within 325 BCE
  if (LEVELS[state.level].key === 'event' && !short) {
    const d = new Date(Date.UTC(Math.floor(y), 0, 1) + (y % 1) * 365.25 * 864e5);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return `${Math.floor(y)} CE`;
}
export const fmtSpan = y => (y >= 1e6 ? `${Math.round(y / 1e6).toLocaleString()} million years` : `${(y >= 1000 ? Math.round(y / 100) * 100 : Math.round(y)).toLocaleString()} years`);
export function range(level = state.level) {
  const L = LEVELS[level];
  if (L.key === 'event') { const y = Math.floor(state.t); return { from: y, to: y + 1 }; }
  return { from: L.from, to: L.to };
}
export function dateWindow() { const { from, to } = range(), w = windowHalf(from, to); return { from: state.t - w, to: state.t + w }; }
// The present has few records of its own, so at today's date a thin view opens out to the whole period (worked out once per render).
export const SPARSE_TODAY = 60;
export const wholeNow = () => state.whole || state.autoWhole;
export function checkToday() {
  state.autoWhole = false;
  if (state.whole || LEVELS[state.level].key === 'event' || state.t < NOW - 1) return;
  const w = dateWindow();
  state.autoWhole = state.pins.filter(p => p.lat != null && !p.global && inLevel(p) && domainOn(p) && p.until >= w.from && p.start <= w.to).length < SPARSE_TODAY;
}
export function windowNow() {
  const { from, to } = range();
  if (wholeNow() || LEVELS[state.level].key === 'event') return { from, to };
  return dateWindow();
}
// How far from the date shown a record may lie and still show. History gets denser toward the present, so the reach
// shrinks in proportion to how long ago the date is (about 300 years around 500 BCE, 10 around 1945), never past 3.5%
// of the scale, so a pin shown "at 1945" is not a battle from 1526.
export function windowHalf(from, to) { return Math.min((to - from) * 0.035, Math.max(8, (NOW - state.t) * 0.12)); }
// Near a date every record shows, and importance sets how loud its pin is (see pinPx). A whole period holds far more records, so it thins them from afar (spec 11.1), never past what the filters leave on.
export function minImportance() {
  if (!wholeNow()) return 1;
  const a = state.alt, floor = a > 2.1 ? 4 : a > 1.2 ? 3 : a > 0.6 ? 2 : 1;
  let top = 5; while (top > 1 && state.impOff.has(top)) top--;
  return Math.min(floor, top);
}
// The coarsest scale a record shows on. Its `scale` sets this, with two corrections so that browsing to a date finds
// what happened then: nothing is kept to the One-year view or to a scale whose span doesn't reach it, and modern
// records of note also show on Civilization, where the time window around a recent date is already narrow.
export function scaleIndex(p) {
  let i = Math.min(SCALE_INDEX[p.scale] ?? 5, 5);
  if (i === 5 && p.importance >= 4) i = 4;
  while (i > 0 && p.until < LEVELS[i].from) i--;
  return i;
}
export const inLevel = p => scaleIndex(p) <= state.level;
export const rankOf = p => p.importance;
// the Domains & layers filters: a record shows if any of its domains is on and its importance level is on
export const domainOn = p => (!(p.domains || []).length || (p.domains || []).some(d => !state.off.has(d))) && !state.impOff.has(p.importance || 0);
export const paleoOn = () => state.paleoMa != null && state.paleoMa >= 10;
