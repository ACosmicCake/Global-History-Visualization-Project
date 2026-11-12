// Tours: a fixed order of existing records, each opened in turn.
import { state } from './state.js';
import { esc } from './dom.js';
import { closeWelcome, dataReady, goTo } from './main.js';

// ---------- tours: a fixed order of existing records, each opened in turn; no text beyond the records' own
export let tours = null;
export const loadTours = async () => { if (!tours) { await dataReady; const known = new Set(state.pins.map(p => p.id)); tours = (await (await fetch('tours.json')).json()).map(t => ({ ...t, stops: t.stops.filter(id => known.has(id)) })).filter(t => t.stops.length >= 2); } return tours; };
export function tourNav() {
  const t = state.tour;
  return t ? `<div class="tour-nav"><span>${esc(t.title)} · ${t.i + 1} of ${t.stops.length}</span><button id="tour-prev" aria-label="Previous stop" ${t.i ? '' : 'disabled'}>‹</button><button id="tour-next" aria-label="Next stop" ${t.i < t.stops.length - 1 ? '' : 'disabled'}>›</button><button id="tour-end" aria-label="Leave the tour">×</button></div>` : '';
}
export function tourStep(d) { const t = state.tour; if (t && t.stops[t.i + d]) goTo(t.stops[t.i + d]); }
export async function startTour(id, i = 0) {
  const t = (await loadTours()).find(x => x.id === id);
  if (!t) return;
  closeWelcome();
  state.tour = { id, title: t.title, stops: t.stops, i: Math.min(i, t.stops.length - 1) };
  goTo(state.tour.stops[state.tour.i]);
}
