// Search: titles, aliases and other names (spec 11.6), then places and summaries, and dates ("1945", "500 BCE").
// The index of other names and summaries (api/search.json) loads the first time someone searches.
import { NOW, fmtYear } from './time.js';
import { $, esc, show } from './dom.js';
import { state } from './state.js';
import { goTo, levelFor, setLevel } from './main.js';
import { badgeURL } from './badges.js';

// ---------- search: titles, aliases and other names (spec 11.6), then places and summaries, and dates ("1945", "500 BCE")
export const fold = t =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export const STOP = new Set(['the', 'of', 'and', 'in', 'a', 'an', 'on', 'to']);
export let searchIndex = null,
  searchLoading = null;
export function loadSearch() {
  // other names and summaries are a separate file, fetched the first time someone searches
  searchLoading =
    searchLoading ||
    fetch('api/search.json')
      .then(r => r.json())
      .then(rows => {
        searchIndex = new Map(
          rows.map(([id, names, text]) => [id, { names: fold(names).split('\n').filter(Boolean), text: ` ${fold(text)}` }]),
        );
        renderSearch();
      })
      .catch(() => {
        searchLoading = null;
      });
  return searchLoading;
}
export const foldedPins = new Map();
export function foldedPin(p) {
  if (!foldedPins.has(p.id)) foldedPins.set(p.id, { title: fold(p.title), aliases: (p.aliases || []).map(fold) });
  return foldedPins.get(p.id);
}
export function searchScore(p, q, words) {
  const f = foldedPin(p),
    x = searchIndex?.get(p.id),
    names = [...f.aliases, ...(x?.names || [])];
  if (f.title.startsWith(q)) return 7;
  if (` ${f.title}`.includes(` ${q}`)) return 6;
  if (f.title.includes(q)) return 5;
  if (names.some(n => n.startsWith(q))) return 4;
  if (names.some(n => n.includes(q))) return 3;
  if (!words.length) return 0;
  if (words.every(w => f.title.includes(w) || names.some(n => n.includes(w)))) return 2;
  return q.length >= 3 && x && words.every(w => x.text.includes(` ${w}`)) ? 1 : 0;
}
export function parseDate(q) {
  let m;
  if ((m = q.match(/^(\d+(?:\.\d+)?)\s*(ga|billion(?: years(?: ago)?)?)$/))) return -m[1] * 1e9;
  if ((m = q.match(/^(\d+(?:\.\d+)?)\s*(ma|mya|million(?: years(?: ago)?)?)$/))) return -m[1] * 1e6;
  if ((m = q.match(/^(\d+(?:\.\d+)?)\s*(ka|thousand(?: years(?: ago)?)?)$/))) return -m[1] * 1e3;
  if ((m = q.match(/^(\d{1,5})\s*(bce|bc)$/))) return 1 - +m[1];
  if ((m = q.match(/^(?:(?:ad|ce)\s*)?(\d{1,4})(?:\s*(?:ad|ce))?$/))) return +m[1] <= NOW ? +m[1] : null;
  return null;
}
export function renderSearch() {
  const q = fold($('#q').value).trim().replace(/\s+/g, ' ');
  if (q.length < 2) return show($('#results'), false);
  const asRoman = q.replace(/\b2\b/g, 'ii').replace(/\b1\b/g, 'i'); // "world war 2"
  const words = q.split(' ').filter(w => !STOP.has(w)),
    wordsR = asRoman.split(' ').filter(w => !STOP.has(w)),
    year = parseDate(q);
  const hits = state.pins
    .map(p => {
      let score = Math.max(searchScore(p, q, words), asRoman !== q ? searchScore(p, asRoman, wordsR) : 0);
      if (!score && year != null && p.start <= year && p.end >= year && p.end - p.start <= 50) score = 1.5; // what was under way that year
      return { p, score };
    })
    .filter(h => h.score)
    .sort((x, y) => y.score - x.score || y.p.importance - x.p.importance || x.p.start - y.p.start);
  const dateRow =
    year != null ? `<li><button class="goto" data-year="${year}"><span class="t">Go to ${esc(fmtYear(year))} →</span></button></li>` : '';
  $('#results').innerHTML =
    dateRow +
    (hits.length
      ? hits
          .slice(0, 30)
          .map(
            ({ p }) =>
              `<li><button data-id="${esc(p.id)}"><img class="dot" alt="" src="${badgeURL(p.domains?.[0], !p.outline)}"><span class="t">${esc(p.title)}</span><span class="d">${esc(p.display)}<span class="imp" title="Importance ${p.importance} of 5">${'●'.repeat(p.importance)}</span></span></button></li>`,
          )
          .join('')
      : dateRow
        ? ''
        : '<li style="padding:8px;color:var(--muted);font-size:12px">No record matches. <a href="browse.html" style="color:var(--brass)">Browse all records</a></li>');
  show($('#results'), true);
  $('#results')
    .querySelectorAll('button[data-id]')
    .forEach(b => {
      b.onclick = () => {
        show($('#results'), false);
        $('#q').value = '';
        goTo(b.dataset.id);
      };
    });
  $('#results')
    .querySelector('button[data-year]')
    ?.addEventListener('click', e => {
      show($('#results'), false);
      $('#q').value = '';
      state.t = +e.currentTarget.dataset.year;
      setLevel(levelFor(state.t), true);
    });
}
$('#q').oninput = () => {
  loadSearch();
  renderSearch();
};
$('#q').onfocus = loadSearch;
addEventListener('pointerdown', e => {
  if (!e.target.closest('.search')) show($('#results'), false);
}); // a click elsewhere closes the list
$('#q').onkeydown = e => {
  if (e.key === 'Escape') {
    e.target.value = '';
    show($('#results'), false);
  }
  if (e.key === 'Enter') $('#results button')?.click();
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    $('#results button')?.focus();
  }
};
$('#results').onkeydown = e => {
  // up and down through the results; Escape goes back to the box
  const all = [...$('#results').querySelectorAll('button')],
    i = all.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    all[Math.min(all.length - 1, i + 1)]?.focus();
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    (i > 0 ? all[i - 1] : $('#q')).focus();
  }
  if (e.key === 'Escape') {
    show($('#results'), false);
    $('#q').focus();
  }
};
