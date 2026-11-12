// The record panel: opens at once from the pin, fills in from the full record, with its Wikipedia box, Meanwhile list,
// connections, sources, sharing and the report link. All record text is escaped: records are data written by agents.
import { REGION_LABELS, REPO, RELATION_LABELS } from '../shared/labels.mjs';
import { state } from './state.js';
import { $, esc, show } from './dom.js';
import { DOMAINS } from './badges.js';
import { NOW, fmtSpan, fmtYear } from './time.js';
import { placed } from './pins.js';
import { LIVE, deepTime, globe, goTo, playSequence, render } from './main.js';
import { flash, writeURL } from './url.js';
import { playTour, stopPlaying, tourNav, tourPlaying, tourStep } from './tours.js';

// ---------- record panel (all record text is escaped: records are data written by agents)
export const CONF_LABEL = { established: 'Established', probable: 'Probable', contested: 'Contested', legendary: 'Legendary' };
// A record opens at once from what its pin already knows, then fills in when the full record arrives. Hovering a pin fetches its record ahead of the click.
export const recordCache = new Map();
let openToken = 0,
  hoverFetch = null;
export function fetchRecord(id) {
  let got = recordCache.get(id);
  if (!got) {
    got = fetch(`api/record/${encodeURIComponent(id)}.json`).then(res => (res.ok ? res.json() : null));
    recordCache.set(id, got);
    got.then(
      r => {
        if (!r) recordCache.delete(id);
      },
      () => recordCache.delete(id),
    );
  }
  return got;
}
export function fetchSoon(id) {
  clearTimeout(hoverFetch);
  if (id) hoverFetch = setTimeout(() => fetchRecord(id).catch(() => {}), 100);
}
// keep the pin in the open part of the screen: left of the side panel, or above the phone's bottom sheet, whose
// height the visitor can change (a sheet at its tallest leaves no globe to frame)
let framed = null;
export function frameRecord(lat, lon, unc) {
  framed = lat == null ? null : [lat, lon, unc];
  if (lat == null || (unc ?? 0) >= 5000) return;
  const phone = innerWidth <= 760,
    k = Math.min(1, state.alt);
  if (phone && sheetStep === 2) return;
  globe.pointOfView(
    { lat: phone ? Math.max(-80, lat - 26 * k * (SHEET[sheetStep] / 0.62)) : lat, lng: lon + (phone ? 0 : 14 * k), altitude: Math.min(state.alt, 1.5) },
    1100,
  );
}
// On a phone the record is a sheet with three heights. Its handle can be dragged between them (down past the lowest
// closes the record), and the buttons beside it step up and down; the title always comes first.
const SHEET = [0.32, 0.62, 0.92];
let sheetStep = 1;
function setSheet(i) {
  sheetStep = Math.max(0, Math.min(SHEET.length - 1, i));
  const panel = $('#panel');
  panel.style.setProperty('--sheet', SHEET[sheetStep]);
  panel.style.removeProperty('--sheet-px');
  panel.querySelector('.p-taller')?.toggleAttribute('disabled', sheetStep === SHEET.length - 1);
  panel.querySelector('.p-shorter')?.toggleAttribute('disabled', sheetStep === 0);
  panel.querySelector('.p-grip')?.setAttribute('aria-valuenow', sheetStep + 1);
  if (framed) frameRecord(...framed);
}
function wirePanel(panel) {
  panel.querySelector('.p-close').onclick = closePanel;
  panel.querySelector('.p-close').focus({ preventScroll: true });
  panel.querySelector('.p-taller').onclick = () => setSheet(sheetStep + 1);
  panel.querySelector('.p-shorter').onclick = () => setSheet(sheetStep - 1);
  const grip = panel.querySelector('.p-grip');
  grip.onkeydown = e => {
    const d = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (d) {
      e.preventDefault();
      setSheet(sheetStep + d);
    }
  };
  grip.onclick = () => setSheet(sheetStep === SHEET.length - 1 ? 0 : sheetStep + 1);
  let drag = null;
  grip.onpointerdown = e => {
    drag = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: false, id: e.pointerId };
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {}
  };
  grip.onpointermove = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) panel.style.setProperty('--sheet-px', `${Math.max(80, Math.min(innerHeight * 0.95, drag.h - dy))}px`);
  };
  grip.onpointerup = grip.onpointercancel = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const { moved } = drag,
      h = panel.getBoundingClientRect().height / innerHeight;
    drag = null;
    if (!moved) return; // a tap: the click handler steps the height
    grip.addEventListener('click', ev => ev.stopImmediatePropagation(), { capture: true, once: true });
    if (h < SHEET[0] - 0.1) return closePanel();
    let best = 0;
    SHEET.forEach((f, i) => {
      if (Math.abs(f - h) < Math.abs(SHEET[best] - h)) best = i;
    });
    setSheet(best);
  };
  setSheet(sheetStep);
}
const PANEL_BAR = `<div class="p-bar">
    <button class="p-grip phone-only" role="slider" aria-label="Record sheet height" aria-valuemin="1" aria-valuemax="3" aria-valuenow="2"><i></i></button>
    <button class="p-size p-shorter phone-only" aria-label="Make the record sheet shorter"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
    <button class="p-size p-taller phone-only" aria-label="Make the record sheet taller"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 8l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>
    <button class="p-close" aria-label="Close record"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6"/></svg></button>
  </div>`;
export const CLOSE_ICON =
  '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6"/></svg>';
export function panelFromPin(p) {
  const panel = $('#panel');
  panel.innerHTML = `${PANEL_BAR}<div class="p-scroll"><div class="p-intro"><div class="p-kicker">${esc((DOMAINS[p.domains?.[0]] || [p.kind])[0])} · ${esc(p.kind)}</div><h2>${esc(p.title)}</h2><div class="p-when">${esc(p.display)}</div></div>
    <div class="p-body"><div class="prose">${p.summary ? `<p>${esc(p.summary)}</p>` : ''}</div></div></div>`;
  show(panel, true);
  show($('#notice'), false);
  wirePanel(panel);
}
export async function openRecord(id) {
  const token = ++openToken,
    pin = state.pins.find(p => p.id === id);
  if (document.activeElement && !$('#panel').contains(document.activeElement)) lastFocus = document.activeElement;
  if (pin) {
    panelFromPin(pin);
    state.selected = id;
    state.openRec = null;
    state.arcs = [];
    render();
    writeURL(true);
    document.title = `${pin.title} · Living Atlas`;
    frameRecord(pin.lat, pin.lon, pin.unc);
  }
  const r = await fetchRecord(id).catch(() => null);
  if (token !== openToken) return; // closed, or another record opened, while this one was on its way
  if (!r) {
    if (pin) closePanel();
    flash(`“${id}” is not published yet.`);
    return;
  }
  state.selected = id;
  state.openRec = r;
  state.arcs = causalArcs(r);
  render();
  writeURL(true);
  document.title = `${r.title} · Living Atlas`;
  if (state.tour) {
    const i = state.tour.stops.indexOf(id);
    if (i >= 0) state.tour.i = i;
  }
  const img = (r.media || []).find(m => m.type === 'image' || m.type === 'map');
  const paras = s =>
    esc(s)
      .split(/\n+/)
      .filter(Boolean)
      .map(x => `<p>${x}</p>`)
      .join('');
  const known = new Set(state.pins.map(p => p.id));
  const relLabel = RELATION_LABELS;
  const num = n =>
    n.low === n.high ? Number(n.low).toLocaleString() : `${Number(n.low).toLocaleString()}–${Number(n.high).toLocaleString()}`;
  const panel = $('#panel');
  panel.innerHTML = `
    ${PANEL_BAR}
    <div class="p-scroll">
    <div class="p-intro">
      ${tourNav()}
      <div class="p-kicker">${esc((DOMAINS[r.domains?.[0]] || [r.kind])[0])} · ${esc(r.kind)}</div>
      <h2>${esc(r.title)}</h2>
      <div class="p-when">${esc(r.when?.display)}</div>
      <div class="p-where">${esc(r.where?.historical_name)}${uncertaintyLine(r)}</div>
    </div>
    ${
      img || r.wiki
        ? `<div class="p-fig">${img ? `<img class="p-hero" src="${esc(img.file_url)}" alt="${esc(img.title)}">` : '<img class="p-hero wiki-hero" alt="" hidden>'}
      ${img ? `<div class="p-credit">${esc(img.title)} · ${esc(img.credit)} · ${esc(img.license)}</div>` : '<div class="p-credit wiki-credit" hidden></div>'}</div>`
        : ''
    }
    <div class="p-body">
      ${r.status === 'outline' ? '<div class="outline-note">A short record: a summary drawn from the sources below.</div>' : ''}
      <div class="badges"><span class="badge conf-${esc(r.confidence)}">${esc(CONF_LABEL[r.confidence] || r.confidence)}${r.provisional ? ' · provisional' : ''}</span><span class="badge">Importance ${esc(r.importance?.score)}/5</span>${r.wiki ? `<a class="badge wiki-badge" href="https://en.wikipedia.org/wiki/${esc(encodeURIComponent(r.wiki.title.replace(/ /g, '_')))}" target="_blank" rel="noopener noreferrer" title="Open the Wikipedia article (further reading, not a source)">Wikipedia ↗</a>` : ''}<button class="badge p-share" id="p-share" title="Copy a link to this record">Copy link</button></div>
      ${(r.animation?.beats || []).length || (r.where?.geometry?.waypoints || []).length >= 2 || deepTime?.scenes[r.id] ? `<button class="play-seq" id="play-seq"><svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>${(r.animation?.beats || []).length ? `Play the sequence · ${r.animation.beats.length} beats` : deepTime?.scenes[r.id] ? 'Play the animation' : 'Play the route'}</button>` : ''}
      ${r.audience_note ? `<div class="warn">${esc(r.audience_note)}</div>` : ''}
      ${r.card ? `<p class="lede">${esc(r.card)}</p>` : ''}
      ${r.status === 'outline' ? `<section><h3>Summary</h3><div class="prose">${paras(r.summary)}</div></section>` : ''}
      ${r.what ? `<section><h3>What happened</h3><div class="prose">${paras(r.what)}</div></section>` : ''}
      ${r.why_it_matters ? `<section><h3>Why it matters</h3><div class="prose">${paras(r.why_it_matters)}</div></section>` : ''}
      ${r.how ? `<section><details><summary><h3>How it happened</h3></summary><div class="prose">${paras(r.how)}</div></details></section>` : ''}
      ${(r.perspectives || []).length ? `<section><h3>Perspectives</h3>${r.perspectives.map(p => `<div class="persp"><b>${esc(p.holder)}</b><span>${esc(p.account)}</span></div>`).join('')}</section>` : ''}
      ${(r.numbers || []).length ? `<section><h3>Numbers</h3><table class="nums">${r.numbers.map(n => `<tr><td>${esc(n.label || n.field)}</td><td>${esc(num(n))} ${esc(n.unit)}</td></tr>`).join('')}</table></section>` : ''}
      ${(r.related || []).length ? `<section><h3>Connections</h3><div class="rel">${r.related.map(x => `<button data-id="${esc(x.id)}" ${known.has(x.id) ? '' : 'disabled title="Not written yet"'}><i>${esc(relLabel[x.type] || x.type)}</i>${esc(x.title || state.pins.find(p => p.id === x.id)?.title || x.id)}${x.because ? `<span class="because">${esc(x.because)}</span>` : ''}</button>`).join('')}</div></section>` : ''}
      ${meanwhile(r)}
      ${r.where?.paleo?.lat != null ? `<section><h3>Position then</h3><div class="prose"><p>${esc(r.where.paleo.lat)}°, ${esc(r.where.paleo.lon)}° at ${esc(r.where.paleo.age_ma)} million years ago (${esc(r.where.paleo.plate_model)}).</p></div></section>` : ''}
      <section><details><summary><h3>Sources (${(r.sources || []).length})</h3></summary><ol class="srcs">${(r.sources || []).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> <span class="cls">${esc(s.class)}</span>${s.original_url ? ' <span class="cls">archived copy</span>' : ''}<br><span style="color:var(--muted)">${esc(s.publisher)}</span></li>`).join('')}</ol></details></section>
      ${r.wiki ? `<section class="wiki"><h3>On Wikipedia${r.wiki.quality ? ` <span class="wq">${r.wiki.quality === 'FA' ? 'Featured article' : 'Good article'}</span>` : ''}</h3><div class="wiki-body">Loading the article summary…</div></section>` : ''}
      ${r.visitor_note ? `<section><h3>Least certain</h3><div class="prose"><p style="font-size:13px;color:var(--soft)">${esc(r.visitor_note)}</p></div></section>` : ''}
      <div class="meta-line">Drafted and reviewed by AI models, then checked against its sources by automated tools. <a href="about.html" target="_blank" rel="noopener">How this is made</a> · <a href="${esc(reportLink(r))}" target="_blank" rel="noopener noreferrer">Report a problem</a><br>${esc(r.id)} · version ${esc(r.record_version)} · updated ${esc(r.updated)}</div>
    </div>
    </div>`;
  show(panel, true);
  show($('#notice'), false);
  panel.querySelector('.p-scroll').scrollTop = 0;
  wirePanel(panel);
  // a picture that fails to load leaves no empty box: it and its credit step out
  const hero = panel.querySelector('.p-hero:not(.wiki-hero)');
  if (hero) {
    const gone = () => show(panel.querySelector('.p-fig'), false);
    hero.onerror = gone;
    if (hero.complete && !hero.naturalWidth) gone();
  }
  panel.querySelector('#p-share').onclick = shareRecord;
  panel.querySelector('#tour-prev')?.addEventListener('click', () => tourStep(-1));
  panel.querySelector('#tour-next')?.addEventListener('click', () => tourStep(1));
  panel.querySelector('#tour-play')?.addEventListener('click', () => (tourPlaying() ? stopPlaying() : playTour()));
  panel.querySelector('#tour-end')?.addEventListener('click', () => {
    stopPlaying();
    state.tour = null;
    panel.querySelector('.tour-nav').remove();
    panel.querySelector('.tour-line')?.remove();
    writeURL(false);
  });
  const playBtn = panel.querySelector('#play-seq');
  if (playBtn) playBtn.onclick = () => playSequence(r);
  panel.querySelectorAll('.rel button:not([disabled])').forEach(b => {
    b.onclick = () => goTo(b.dataset.id);
  });
  if (r.wiki) wikiSummary(id, r.wiki);
  if (!pin) frameRecord(r.where?.lat, r.where?.lon, r.where?.uncertainty_km);
}
// The linked Wikipedia article's lead, fetched live (always current, nothing stored); shown as further reading
export const wikiCache = new Map();
export async function wikiSummary(id, w) {
  const box = $('#panel .wiki-body');
  try {
    if (!wikiCache.has(w.title)) {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.title.replace(/ /g, '_'))}`);
      if (!res.ok) throw new Error(res.status);
      wikiCache.set(w.title, await res.json());
    }
    if (state.selected !== id || !box?.isConnected) return; // the reader has moved on
    const s = wikiCache.get(w.title),
      url = s.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(w.title)}`;
    box.innerHTML = `<p class="wiki-text">${esc(s.extract || '')}</p>
      <a class="wiki-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Read “${esc(s.title || w.title)}” on Wikipedia →</a>
      <div class="wiki-note">Text from Wikipedia, CC BY-SA 4.0. Further reading, not one of this record’s sources.</div>`;
    wikiImage(id, s);
  } catch {
    if (box?.isConnected)
      box.innerHTML = `<a class="wiki-link" href="https://en.wikipedia.org/wiki/${encodeURIComponent(w.title.replace(/ /g, '_'))}" target="_blank" rel="noopener noreferrer">Read “${esc(w.title)}” on Wikipedia →</a>`;
  }
}
// The article's lead image as the panel picture, for records without media of their own. Only freely licensed
// Wikimedia Commons files are used (an English-Wikipedia-only upload may be a non-free "fair use" image), each
// credited with its author and licence from the file's Commons metadata; with no licence on record, no image.
export const imageCredit = new Map();
export async function wikiImage(id, s) {
  const hero = $('#panel .wiki-hero'),
    credit = $('#panel .wiki-credit');
  const src = s.thumbnail?.source || s.originalimage?.source;
  if (!hero || !src || !/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(src)) return;
  const file = decodeURIComponent((src.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/) || [])[1] || '');
  if (!file) return;
  try {
    if (!imageCredit.has(file)) {
      const j = await (
        await fetch(
          `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=extmetadata|url&titles=${encodeURIComponent('File:' + file)}`,
        )
      ).json();
      const info = Object.values(j.query?.pages || {})[0]?.imageinfo?.[0],
        m = info?.extmetadata || {};
      // plain text from Commons' HTML; a name its markup repeats ("Unknown authorUnknown author") is said once
      const text = h =>
        new DOMParser()
          .parseFromString(String(h || ''), 'text/html')
          .body.textContent.replace(/\s+/g, ' ')
          .trim()
          .replace(/^(.+?)\s*\1$/, '$1')
          .replace(/\.$/, '');
      imageCredit.set(
        file,
        info && m.LicenseShortName
          ? { author: text(m.Artist?.value).slice(0, 80), license: text(m.LicenseShortName.value), page: info.descriptionurl }
          : null,
      );
    }
    const c = imageCredit.get(file);
    if (!c || state.selected !== id || !hero.isConnected) return;
    hero.src = src.replace(/\/(\d+)px-/, (x, n) => (+n < 960 ? '/960px-' : x)); // a sharper thumbnail; Commons serves standard widths (500, 960…), not 640
    // a file smaller than 960px has no 960px thumbnail: fall back to the article's own one, then give up quietly
    hero.alt = s.title || '';
    hero.onerror = () => {
      if (hero.src !== src) hero.src = src;
      else {
        show(hero, false);
        show(credit, false);
      }
    };
    credit.innerHTML = `${c.author ? esc(c.author) + ' · ' : ''}${esc(c.license)} · <a href="${esc(c.page)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>`;
    show(hero, true);
    show(credit, true);
  } catch {}
}
let lastFocus = null; // where focus was before a record opened, to return it on close
export function closePanel() {
  openToken++;
  show($('#panel'), false);
  state.selected = null;
  state.openRec = null;
  state.arcs = [];
  stopPlaying();
  state.tour = null;
  document.title = 'Living Atlas';
  render();
  writeURL(true);
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}
// ---------- helpers for the record panel
export function reportLink(r) {
  const body = `Record: ${r.id}\nPage: ${location.origin}${location.pathname.replace(/[^/]*$/, '')}r/${r.id}.html\n\nWhat looks wrong:\n\nA source that shows this (a link, if you have one):\n`;
  return `https://github.com/${REPO}/issues/new?labels=correction&title=${encodeURIComponent(`Correction: ${r.title}`)}&body=${encodeURIComponent(body)}`;
}
export function uncertaintyLine(r) {
  // how exact the pin and the date are, in the record's own stated margins
  const km = r.where?.uncertainty_km,
    u = r.when?.uncertainty || {},
    yrs = Math.max(u.start_minus_years || 0, u.start_plus_years || 0, u.end_minus_years || 0, u.end_plus_years || 0),
    bits = [];
  if (km >= 5 && km < 5000) bits.push(`Place within about ${Math.round(km).toLocaleString()} km`);
  if (yrs >= 1) bits.push(`dates within about ${fmtSpan(yrs)}`);
  return bits.length ? `<small>${esc(bits.join(' · '))}</small>` : '';
}
export async function shareRecord(e) {
  // the plain page carries a preview for chat apps and search engines, and links on to the globe
  const r = state.openRec,
    url = LIVE ? location.href : new URL(`r/${r.id}.html`, location.href.split('#')[0]).href,
    b = e.currentTarget;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: r.title, url });
    } catch {}
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    b.textContent = 'Link copied';
  } catch {
    prompt('Copy this link', url);
  }
  setTimeout(() => {
    if (b.isConnected) b.textContent = 'Copy link';
  }, 1600);
}
// Cause and effect drawn on the globe (spec 11.8): an arc from each cause to its effect, for the open record's causal links
export function causalArcs(r) {
  if (r.where?.lat == null || (r.where.uncertainty_km ?? 0) >= 5000) return [];
  const here = placed({ lat: r.where.lat, lon: r.where.lon });
  return (r.related || [])
    .filter(x => x.type === 'caused' || x.type === 'caused_by')
    .flatMap(x => {
      const p = state.pins.find(q => q.id === x.id);
      if (!p || p.lat == null || p.global) return [];
      const there = placed(p),
        out = x.type === 'caused';
      return [
        {
          id: p.id,
          title: p.title,
          because: x.because,
          label: out ? 'Led to' : 'Caused by',
          color: out ? ['#d9b36a', '#f0d9a4'] : ['#8fb0e8', '#d9b36a'],
          a: out ? here.lat : there.lat,
          b: out ? here.lon : there.lon,
          c: out ? there.lat : here.lat,
          d: out ? there.lon : here.lon,
        },
      ];
    });
}
export function kmBetween(a, b, c, d) {
  const R = Math.PI / 180,
    h = Math.sin(((c - a) * R) / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin(((d - b) * R) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
// What else was happening: other records of about the same date, near this one and across the other regions of the world
// what was under way around year y, pinned somewhere (not planet-wide), most important first and people last, since
// a long life overlaps nearly everything. The window widens with distance from today: ±5 years near now, ±2% of the
// time before it further back. Used by Meanwhile and by Around the world.
export function underWay(y, skip = () => false) {
  const w = Math.max(5, (NOW - y) * 0.02),
    longest = Math.max(150, w * 10);
  return state.pins
    .filter(p => p.lat != null && !p.global && !skip(p) && p.start <= y + w && p.until >= y - w && p.until - p.start <= longest)
    .sort(
      (a, b) =>
        (a.kind === 'person') - (b.kind === 'person') || b.importance - a.importance || Math.abs(a.start - y) - Math.abs(b.start - y),
    );
}
// Around the world: for year y, the top two records in each region, regions in a fixed order
export function aroundTheWorld(y, per = 2) {
  const by = new Map();
  for (const p of underWay(y)) {
    if (!p.region) continue;
    const list = by.get(p.region) || by.set(p.region, []).get(p.region);
    if (list.length < per) list.push(p);
  }
  return Object.keys(REGION_LABELS)
    .filter(k => by.has(k))
    .map(k => ({ region: k, label: REGION_LABELS[k], pins: by.get(k) }));
}
export function meanwhile(r) {
  const y = r.when?.start?.year;
  if (y == null) return '';
  const listed = new Set((r.related || []).map(x => x.id));
  const others = underWay(y, p => p.id === r.id || listed.has(p.id));
  const pinned = r.where?.lat != null && (r.where.uncertainty_km ?? 0) < 5000;
  const near = pinned ? others.filter(p => kmBetween(r.where.lat, r.where.lon, p.lat, p.lon) < 1000).slice(0, 4) : [];
  const regions = new Set([r.regions?.[0]]),
    far = [];
  for (const p of others) {
    if (far.length >= 5) break;
    if (!near.includes(p) && p.region && !regions.has(p.region)) {
      regions.add(p.region);
      far.push(p);
    }
  }
  if (!near.length && !far.length) return '';
  const row = p => `<button data-id="${esc(p.id)}"><i>${esc(fmtYear(p.start, true))}</i>${esc(p.title)}</button>`;
  return `<section><h3>Meanwhile</h3>${near.length ? `<div class="mw-h">Nearby</div><div class="rel">${near.map(row).join('')}</div>` : ''}${far.length ? `<div class="mw-h">Elsewhere in the world</div><div class="rel">${far.map(row).join('')}</div>` : ''}</section>`;
}
