// The film: the last billion years, played like a record's sequence, each caption drawn from the record it names.
import { NOW } from './time.js';
import { state } from './state.js';
import { $, esc, show } from './dom.js';
import { closePanel } from './panel.js';
import { PAUSE, PLAY, stopPlay, timer } from './timebar.js';
import { placed } from './pins.js';
import { closeWelcome, deepTime, globe, levelFor, render, setLevel, updateSky } from './main.js';
import { vitalAt, vitalText, vitals } from './vitals.js';

// ---------- the film: the last billion years, played like a record's sequence, each caption drawn from the record it names
export const filmDate = ma => {
  if (ma >= 999.5) return '1 billion years ago';
  if (ma >= 1) return `${Math.round(ma)} million years ago`;
  const y = ma * 1e6 + NOW; // the clock counts from year 0, the words from today
  if (y < 200) return 'Today';
  return `${(Math.round(y / (y >= 100000 ? 10000 : y >= 10000 ? 1000 : 100)) * (y >= 100000 ? 10000 : y >= 10000 ? 1000 : 100)).toLocaleString('en-US')} years ago`;
};
export function endFilm() {
  state.film = false;
  document.body.classList.remove('film');
  show($('#film'), false);
  globe.camera().clearViewOffset();
  globe.controls().enabled = true;
  state.seqPaused = false;
  updateSky();
  render();
}
// The plate model loads on demand; a pointer or focus on a way into deep time starts the download early.
export const loadPaleo = () => window.Space?.loadPaleo?.() || Promise.resolve();
export function prefetchIceAge(el) {
  for (const ev of ['pointerenter', 'focus', 'touchstart'])
    el.addEventListener(ev, () => window.Space?.loadIceAge?.(), { once: true, passive: true });
}
export function prefetchPaleo(el) {
  for (const ev of ['pointerenter', 'focus', 'touchstart']) el.addEventListener(ev, () => loadPaleo(), { once: true, passive: true });
}
export async function startFilm() {
  if (!deepTime) return;
  closeWelcome();
  if (state.selected) closePanel();
  if (timer) stopPlay();
  const f = deepTime.film,
    box = $('#film');
  state.film = true;
  document.body.classList.add('film');
  globe.controls().enabled = false;
  show(box, true);
  render();
  $('#film-credit').textContent = f.credit;
  $('#film-big').textContent = f.title;
  $('#film-big').classList.add('on');
  $('#film-pause').innerHTML = PAUSE.replace('12" height="12"', '13" height="13"');
  $('#film-pause').setAttribute('aria-label', 'Pause film');
  $('#film-text').classList.remove('on');
  $('#film-bar').style.width = '0';
  state.seqPaused = false;
  box.focus({ preventScroll: true });
  globe.camera().setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.08, innerWidth, innerHeight);
  const chapter = c => {
    $('#film-text').classList.remove('on');
    setTimeout(() => {
      if (!state.film) return;
      if (c) $('#film-big').classList.remove('on'); // the title stays until the first chapter
      $('#film-chapter').textContent = c ? c.title : '';
      $('#film-caption').textContent = c ? c.caption : '';
      if (c) $('#film-text').classList.add('on');
    }, 350);
  };
  await loadPaleo(); // the moving continents must be ready before the first frame
  if (!state.film) return; // closed while it loaded
  let lastDate = '',
    ended = false;
  window.Sequence.film(f, {
    globe,
    getTime: () => state.t,
    setTime: y => {
      state.t = Math.min(y, NOW);
      const lv = levelFor(state.t);
      if (lv !== state.level && state.level !== 6) setLevel(lv, true);
      else render();
    },
    ride: ({ lat, lng }) => {
      const q = placed({ lat, lon: lng });
      return { lat: q.lat, lng: q.lon };
    },
    ui: {
      fade: on => $('#film-fade').classList.toggle('on', on),
      title: () => {},
      chapter,
      progress: (k, ma) => {
        $('#film-bar').style.width = `${Math.min(100, k * 100).toFixed(2)}%`;
        const d = filmDate(ma);
        if (d !== lastDate) {
          lastDate = d;
          $('#film-date').textContent = d;
        }
        if (vitals) {
          const line = [
              ['temp', 'Temperature'],
              ['co2', 'CO₂'],
              ['day', 'Day'],
            ]
              .map(([k, l]) => {
                const v = vitalAt(vitals.series[k], ma);
                return v == null ? '' : `${l} ${vitalText(k, v, ma)}`;
              })
              .filter(Boolean)
              .join('  ·  '),
            el = $('#film-vitals');
          if (el.textContent !== line) el.textContent = line;
        }
        if (k * f.length >= f.endAt && !ended) {
          ended = true;
          chapter(null);
          setTimeout(() => {
            if (state.film) {
              $('#film-big').innerHTML = `Today<small>${esc(f.end)}</small>`;
              $('#film-big').classList.add('on');
            }
          }, 400);
        }
      },
    },
    onEnd: endFilm,
  });
}
export const closeFilm = () => {
  window.Sequence.stop();
  $('#film-fade').classList.remove('on');
  endFilm();
};
$('#film-close').onclick = closeFilm;
$('#film-pause').onclick = () => {
  state.seqPaused = !state.seqPaused;
  window.Sequence.setPaused(state.seqPaused);
  $('#film-pause').setAttribute('aria-label', state.seqPaused ? 'Resume film' : 'Pause film');
  $('#film-pause').innerHTML = (state.seqPaused ? PLAY : PAUSE).replace('12" height="12"', '13" height="13"');
};
$('#film-prev').onclick = () => window.Sequence.filmControl?.step(-1);
$('#film-next').onclick = () => window.Sequence.filmControl?.step(1);
addEventListener('keydown', e => {
  if (!state.film) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeFilm();
  } else if (e.key === ' ' && document.activeElement?.tagName !== 'BUTTON') {
    e.preventDefault();
    $('#film-pause').click();
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    $('#film-prev').click();
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    $('#film-next').click();
  }
});
