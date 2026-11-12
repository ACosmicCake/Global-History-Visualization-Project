// The address bar: the date, scale, open record and tour live in the hash, so a link restores the view and Back closes a record.
import { LEVELS, NOW } from './time.js';
import { state } from './state.js';
import { loadTours } from './tours.js';
import { closePanel, openRecord } from './panel.js';
import { $, show } from './dom.js';
import { dataReady, goTo, render, setLevel } from './main.js';

// ---------- the address bar: #t=1945&l=modern&r=<record id>&tour=<id>. Opening or closing a record adds a history entry,
// so Back returns to the record before; moving through time only updates the current entry.
let urlTimer = 0, restoring = true;   // nothing is written until the records have loaded, or the opening view would overwrite a shared link
export const setRestoring = on => { restoring = on; };
export function stateHash() {
  const h = new URLSearchParams(), level = LEVELS[state.level].key;
  if (state.selected || state.t !== -500 || level !== 'civilization') { h.set('t', String(+state.t.toPrecision(7))); h.set('l', level); }
  if (state.selected) h.set('r', state.selected);
  if (state.tour) h.set('tour', state.tour.id);
  const out = h.toString();
  return out ? `#${out}` : '';
}
export function writeURL(push) {
  clearTimeout(urlTimer);
  if (restoring) return;
  const h = stateHash();
  if (h !== location.hash) history[push ? 'pushState' : 'replaceState'](null, '', h || location.pathname + location.search);
}
export function queueURL() { clearTimeout(urlTimer); urlTimer = setTimeout(() => writeURL(false), 400); }
export async function applyHash() {
  await dataReady;
  const h = new URLSearchParams(location.hash.slice(1)), r = h.get('r'), t = parseFloat(h.get('t')), l = LEVELS.findIndex(x => x.key === h.get('l')), tour = h.get('tour');
  restoring = true;
  try {
    if (!Number.isNaN(t)) state.t = Math.min(t, NOW + 1);
    if (l >= 0) setLevel(l, true); else render();
    if (tour && state.tour?.id !== tour) { const x = (await loadTours()).find(k => k.id === tour); if (x) state.tour = { id: tour, title: x.title, stops: x.stops, i: Math.max(0, x.stops.indexOf(r)) }; }
    if (!tour) state.tour = null;
    if (r && r !== state.selected) await (Number.isNaN(t) ? goTo(r) : openRecord(r));
    else if (!r && state.selected) closePanel();
  } finally { restoring = false; }
}
addEventListener('popstate', applyHash);
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#panel').hidden) closePanel(); });
export function flash(msg) { const n = $('#notice'); n.textContent = msg; show(n, true); setTimeout(() => render(), 2500); }

