// Tours: a fixed order of existing records, each opened in turn. A tour can play itself: each stop opens, holds while
// its editorial line and title are read, plays its sequence if it has one (the sequence bar pauses and skips), and
// moves on. Any drag of the globe, closing the record, or stopping a sequence ends the playing.
import { state } from './state.js';
import { $, esc } from './dom.js';
import { closeWelcome, dataReady, globe, goTo, playSequence } from './main.js';

// ---------- tours: the records' own text, plus at most one editorial line per stop (25 words or fewer, marked as such)
export let tours = null;
export const loadTours = async () => {
  if (!tours) {
    await dataReady;
    const known = new Set(state.pins.map(p => p.id));
    tours = (await (await fetch('tours.json')).json())
      .map(t => ({ ...t, stops: t.stops.filter(id => known.has(id)), lines: t.lines || {} }))
      .filter(t => t.stops.length >= 2);
  }
  return tours;
};
const PLAY_ICON = '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>',
  PAUSE_ICON = '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>';
export function tourNav() {
  const t = state.tour;
  if (!t) return '';
  const line = t.lines?.[t.stops[t.i]];
  return `<div class="tour-nav"><span>${esc(t.title)} · ${t.i + 1} of ${t.stops.length}</span><button id="tour-play" aria-label="${playing ? 'Pause the tour' : 'Play the tour'}" title="${playing ? 'Pause the tour' : 'Play the tour: each stop in turn, with its sequence'}">${playing ? PAUSE_ICON : PLAY_ICON}</button><button id="tour-prev" aria-label="Previous stop" ${t.i ? '' : 'disabled'}>‹</button><button id="tour-next" aria-label="Next stop" ${t.i < t.stops.length - 1 ? '' : 'disabled'}>›</button><button id="tour-end" aria-label="Leave the tour">×</button></div>${
    line ? `<p class="tour-line"><span class="tl-tag" title="Written for this tour from the records' own text; it adds nothing they do not say">Tour note</span> ${esc(line)}</p>` : ''
  }`;
}
export function tourStep(d) {
  const t = state.tour;
  stopPlaying();
  if (t && t.stops[t.i + d]) goTo(t.stops[t.i + d]);
}
export async function startTour(id, i = 0, play = false) {
  const t = (await loadTours()).find(x => x.id === id);
  if (!t) return;
  closeWelcome();
  state.tour = { id, title: t.title, stops: t.stops, lines: t.lines, i: Math.min(i, t.stops.length - 1) };
  if (play) playTour();
  else goTo(state.tour.stops[state.tour.i]);
}

// ---------- playing a tour
let playing = null, // a token for the run in progress; a new run or a stop replaces it
  wake = null; // ends the current wait early when playing stops
export const tourPlaying = () => !!playing;
const READ_MS = 4500, // time on each stop's panel before its sequence starts (or, with none, before half the hold)
  HOLD_MS = 4500; // further time on a stop with no sequence
const wait = (ms, tok) =>
  new Promise(res => {
    const done = () => {
      clearTimeout(timer);
      wake = null;
      res();
    };
    const timer = setTimeout(done, ms * (state.tourPace ?? 1));
    wake = done;
    if (playing !== tok) done();
  });
// the record at this stop, once its full text has arrived (the panel's play button tells whether it has a sequence)
async function arrived(id, tok) {
  for (let n = 0; n < 150 && playing === tok; n++) {
    if (state.openRec?.id === id) return state.openRec;
    if (state.selected !== id && n > 20) return null; // the visitor went elsewhere
    await wait(100, tok);
  }
  return null;
}
export function playTour() {
  const t = state.tour;
  if (!t) return;
  const tok = {};
  playing = tok;
  listen();
  (async () => {
    for (;;) {
      const id = t.stops[t.i];
      if (state.selected !== id || !state.openRec) await goTo(id);
      else refreshNav();
      const r = await arrived(id, tok);
      if (playing !== tok || !r || state.tour !== t) break;
      await wait(READ_MS, tok);
      if (playing !== tok) break;
      if (document.querySelector('#panel #play-seq')) await new Promise(res => ((wake = res), playSequence(r, res)));
      else await wait(HOLD_MS, tok);
      wake = null;
      if (playing !== tok || state.tour !== t || state.selected !== id) break;
      if (t.i >= t.stops.length - 1) break; // the last stop: the tour stays open on it
      t.i++;
      await goTo(t.stops[t.i]);
    }
    if (playing === tok) stopPlaying();
  })();
  refreshNav();
}
export function stopPlaying() {
  if (!playing) return;
  playing = null;
  wake?.();
  wake = null;
  refreshNav();
}
function refreshNav() {
  const b = $('#panel #tour-play');
  if (!b) return;
  b.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  b.setAttribute('aria-label', playing ? 'Pause the tour' : 'Play the tour');
}
// any drag of the globe, or stopping a sequence from its bar, ends the playing
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  globe.controls().addEventListener('start', stopPlaying);
  $('#seq-stop').addEventListener('click', stopPlaying);
}
