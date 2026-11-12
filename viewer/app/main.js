// Living Atlas viewer: a rotatable globe with a nested-scale time axis (spec section 2), pins filtered by
// time level and importance (spec 11.1), and routes for moving events.
// Data comes from api/pins.json: live from server.mjs locally, refreshed every 15 seconds; a static file, fetched once, on the published site.
// Libraries load as pinned UMD scripts in index.html: three@0.149.0, globe.gl@2.27.2.
import './webgl-check.js'; // first: stops here, with a message, where the globe can't run
import { KIND_LABELS, REGION_LABELS, SCALE_START } from '../shared/labels.mjs';
import { $, esc, show } from './dom.js';
import { state } from './state.js';
import './search.js';
import {
  EARTH,
  EONS,
  LEVELS,
  NOW,
  checkToday,
  domainOn,
  fmtSpan,
  fmtYear,
  inLevel,
  minImportance,
  paleoOn,
  range,
  rankOf,
  scaleIndex,
  wholeNow,
  windowNow,
} from './time.js';
import { CLOSE_AT, DOMAINS, badgeURL, baseColor, colorOf, haloTexture, isMajor, pinTexture, standsOut } from './badges.js';
import { clusterPins, labelTexture, pinData, pinSprites, placePinSprites, placed, visiblePins } from './pins.js';
import { PAUSE, PLAY, drawDensity, fadeTabs, slideRange, stopPlay, timer } from './timebar.js';
import { aroundTheWorld, closePanel, fetchSoon, openRecord, recordCache } from './panel.js';
import { loadTours, startTour, tourPlaying } from './tours.js';
import { prefetchIceAge, prefetchPaleo, startFilm } from './film.js';
import { applyHash, flash, queueURL, resumeLast, setRestoring } from './url.js';
import { renderVitals } from './vitals.js';
import { initCue } from './cue.js';
const { THREE, Globe } = window;

export const GLOBE_R = 100;
export let hoverId = null;

// ---------- globe
const zoomK = () => Math.min(1, Math.max(0.0015, state.alt / 1.8)); // pins and labels shrink as the camera comes in, down to street scale
const tip = p =>
  p.cluster
    ? `<div class="tip"><span class="d">${p.cluster.length} records here</span>${p.cluster
        .slice(0, 6)
        .map(x => `<p>${esc(x.title)}</p>`)
        .join('')}${p.cluster.length > 6 ? '<p>…</p>' : ''}</div>`
    : `<div class="tip"><span class="d">${esc(p.display)}${p.outline ? '' : ' · full story'}${p.unc >= 100 ? ` · place within about ${Math.round(p.unc).toLocaleString()} km` : ''}</span><b>${esc(p.title)}</b>${p.summary ? `<p>${esc(p.summary)}</p>` : ''}</div>`;
// High-density screens (2x, 3x) would render 4–9 times the pixels for little visible gain on a moving globe: cap the
// drawing resolution at 1.5x (and antialias only at 1x, where it is needed and cheap)
const PR = Math.min(window.devicePixelRatio || 1, 1.5);
export const globe = Globe({ animateIn: true, rendererConfig: { antialias: PR < 1.25, alpha: true, powerPreference: 'high-performance' } })(
  $('#globe'),
)
  .backgroundColor('rgba(0,0,0,0)')
  .showGraticules(false)
  .showAtmosphere(false)
  .pointsTransitionDuration(0)
  .pathTransitionDuration(0)
  .labelsTransitionDuration(0)
  .customThreeObject(p => {
    // pins are screen-sized badge sprites (see placePinSprites)
    const mat = new THREE.SpriteMaterial({
      map: pinTexture(p, standsOut(p, state.alt)),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
    });
    const group = new THREE.Group(),
      sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 10 + p.importance;
    sprite.visible = false;
    group.add(sprite); // shown by placePinSprites once sized
    sprite.raycast = function (r, hits) {
      if (this.visible) THREE.Sprite.prototype.raycast.call(this, r, hits);
    }; // no clicks on hidden pins
    const lt = labelTexture(p.title || '');
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: lt.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }),
    );
    label.userData = { w: lt.w, h: lt.h };
    label.renderOrder = 20;
    label.visible = false;
    label.raycast = () => {};
    group.add(label);
    pinSprites.set(p.id, { group, sprite, halo: null, label, p });
    return group;
  })
  .customThreeObjectUpdate((obj, p) => {
    // runs for every pin on each render: move it, and add or drop the selection halo
    Object.assign(obj.position, globe.getCoords(p.lat, p.lon, 0.004 + p.importance * 0.0012)); // the most important pin wins the pointer where pins overlap
    const e = pinSprites.get(p.id);
    if (!e) return;
    e.p = p;
    const lt = labelTexture(p.title || '');
    if (e.label.material.map !== lt.tex) {
      e.label.material.map = lt.tex;
      e.label.userData = { w: lt.w, h: lt.h };
      e.label.material.needsUpdate = true;
    }
    if (p.id === state.selected && !e.halo) {
      e.halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: haloTexture,
          color: baseColor(p),
          transparent: true,
          depthTest: false,
          depthWrite: false,
          sizeAttenuation: false,
        }),
      );
      e.halo.renderOrder = 9;
      e.halo.visible = false;
      e.halo.raycast = () => {};
      obj.add(e.halo);
    } else if (p.id !== state.selected && e.halo) {
      obj.remove(e.halo);
      e.halo.material.dispose();
      e.halo = null;
    }
  })
  .customLayerLabel(tip)
  .onCustomLayerClick(p => (p.cluster ? openCluster(p) : openRecord(p.id)))
  .onCustomLayerHover(p => {
    $('#globe').style.cursor = p ? 'pointer' : '';
    hoverId = p?.id ?? null;
    fetchSoon(p && !p.cluster ? p.id : null);
  })
  .labelLat('lat')
  .labelLng('lon')
  .labelText('title')
  .labelSize(() => 0.5 * zoomK())
  .labelDotRadius(0)
  .labelColor(() => 'rgba(233,237,244,0.82)')
  .labelAltitude(0.03)
  .labelResolution(2)
  .labelLabel(tip)
  .onLabelClick(p => openRecord(p.id))
  .pathPoints('pts')
  .pathPointLat(p => p.lat)
  .pathPointLng(p => p.lon)
  .pathColor(p => (p.ring ? p.color : [p.color, 'rgba(255,255,255,0.15)']))
  .pathStroke(p => (p.ring ? 0.7 : p.wall ? 2.2 : p.dated ? 1.8 : 1.1))
  .pathDashLength(p => (p.wall || p.ring ? 1 : 0.04))
  .pathDashGap(p => (p.wall || p.ring ? 0 : 0.02))
  .pathDashAnimateTime(p => (p.wall || p.ring ? 0 : 9000))
  .arcStartLat('a')
  .arcStartLng('b')
  .arcEndLat('c')
  .arcEndLng('d')
  .arcColor('color')
  .arcStroke(0.45)
  .arcAltitudeAutoScale(0.3)
  .arcDashLength(0.35)
  .arcDashGap(0.12)
  .arcDashAnimateTime(2600)
  .arcsTransitionDuration(0)
  .arcLabel(
    a =>
      `<div class="tip"><span class="d">${esc(a.label)}</span><b>${esc(a.title)}</b>${a.because ? `<p>${esc(a.because)}</p>` : ''}</div>`,
  )
  .onArcClick(a => goTo(a.id));
window.Space.init(globe); // satellite Earth, clouds, stars, Sun and Moon (space.js)
window.Fossils.init(globe, () => {
  fossilCountMa = null;
  render();
});
window.Coastlines.init(globe);
window.Borders?.init(globe); // dated polity borders (borders.js)
// deep-time visuals: scenes for records, names on the moving continents, marks on the time bar, the film (deeptime.json)
export let deepTime = null;
fetch('deeptime.json')
  .then(r => r.json())
  .then(d => {
    deepTime = d;
    window.DeepTime?.init(globe, d.labels);
    render();
  })
  .catch(err => console.error('deeptime', err));
// spacecraft in the sky (spacecraft.js): clicking one opens its record once that record is published
window.Spacecraft?.init(globe, { onPick: id => openRecord(id), known: id => state.pins.some(p => p.id === id) });
globe.pointOfView({ lat: 28, lng: 25, altitude: state.alt });
globe.controls().autoRotate = false;

// Smooth zoom and drag: the stock wheel zoom jumps one step per notch, so we take over the wheel and ease the
// camera altitude toward a target in log space every frame; rotation gets inertia from the controls' damping.
globe.renderer().setPixelRatio(PR);
const controls = globe.controls();
controls.enableZoom = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.55;
const ALT_MIN = 0.04,
  ALT_MAX = 6;
const camAlt = () => globe.camera().position.length() / GLOBE_R - 1;
let zoomTarget = null;
$('#globe').addEventListener(
  'wheel',
  e => {
    e.preventDefault();
    const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY; // lines/pages -> pixels
    const from = zoomTarget ?? camAlt();
    zoomTarget = Math.min(ALT_MAX, Math.max(ALT_MIN, from * Math.exp(Math.max(-200, Math.min(200, step)) * 0.0022)));
  },
  { passive: false },
);
let pinch = null; // two-finger pinch feeds the same eased zoom
$('#globe').addEventListener(
  'touchstart',
  e => {
    if (e.touches.length === 2)
      pinch = {
        d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY),
        alt: globe.pointOfView().altitude,
      };
  },
  { passive: true },
);
$('#globe').addEventListener(
  'touchmove',
  e => {
    if (!pinch || e.touches.length !== 2) return;
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    zoomTarget = Math.min(ALT_MAX, Math.max(ALT_MIN, pinch.alt * (pinch.d / d)));
  },
  { passive: true },
);
$('#globe').addEventListener(
  'touchend',
  () => {
    pinch = null;
  },
  { passive: true },
);

// Per frame: ease the camera distance in log space (frame-rate independent).
// Rebuilding pins and labels is expensive, so that waits until the camera settles and the detail tier changes.
let lastFrame = performance.now(),
  settleTimer = null,
  tierKey = '';
const tier = () => `${minImportance()}|${Math.round(Math.log2(zoomK()) * 3)}`;
// ---------- planet-wide records: no single place, so no pin. A faint ring at the globe's edge says "something
// planet-wide is happening now", and one small pill in the left column names how many; clicking it opens a short list.
let planetList = [],
  planetOpen = false,
  planetKey = '';
function renderPlanet(planet) {
  planetList = [...planet].sort((a, b) => b.importance - a.importance || a.start - b.start);
  const on = planetList.length > 0 && $('#panel').hidden && !window.Sequence?.playing;
  if (!on) planetOpen = false;
  const key = planetList.map(p => p.id).join('|') + planetOpen;
  if (key !== planetKey) {
    planetKey = key;
    const top = planetList[0];
    $('#planet').innerHTML = `<button class="pw-pill" aria-expanded="${planetOpen}" title="Records about the whole planet at this time">
        <span class="pw-dot"></span><span class="pw-lab">Planet-wide</span><span class="pw-n">${planetList.length}</span>${planetList.length === 1 ? `<span class="pw-one">${esc(top.title)}</span>` : ''}</button>
      ${planetOpen ? `<ul class="pw-list" role="list">${planetList.map(p => `<li><button data-id="${esc(p.id)}"><img alt="" src="${badgeURL(p.domains?.[0], !p.outline)}"><span class="t">${esc(p.title)}</span><span class="d">${esc(p.display || '')}</span></button></li>`).join('')}</ul>` : ''}`;
    $('#planet .pw-pill').onclick = () => {
      if (planetList.length === 1) return openRecord(planetList[0].id);
      planetOpen = !planetOpen;
      renderPlanet(planetList);
    };
    $('#planet')
      .querySelectorAll('button[data-id]')
      .forEach(b => {
        b.onclick = () => {
          planetOpen = false;
          openRecord(b.dataset.id);
        };
      });
  }
  show($('#planet'), on);
  show($('#planet-ring'), on);
  placePlanetOrbit();
}
addEventListener('pointerdown', e => {
  if (planetOpen && !e.target.closest('#planet')) {
    planetOpen = false;
    renderPlanet(planetList);
  }
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && planetOpen) {
    planetOpen = false;
    renderPlanet(planetList);
  }
});
const _o = new THREE.Vector3();
function placePlanetOrbit() {
  // per frame: the ring on the globe's edge (cheap: one style write)
  const box = $('#planet');
  if (box.hidden) return;
  const cam = globe.camera(),
    el = globe.renderer().domElement,
    W = el.clientWidth || innerWidth,
    H = el.clientHeight || innerHeight;
  _o.set(0, 0, 0).project(cam);
  const cx = ((_o.x + 1) * W) / 2,
    cy = ((1 - _o.y) * H) / 2,
    d = cam.position.length();
  const r = ((Math.tan(Math.asin(Math.min(0.999, GLOBE_R / d))) / Math.tan((cam.fov * Math.PI) / 180 / 2)) * H) / 2; // the globe's radius in px
  const ring = $('#planet-ring'),
    fits = r * 2 < Math.min(W, H) * 1.05;
  ring.hidden = !fits;
  if (fits) ring.style.cssText = `left:${cx - r - 3}px;top:${cy - r - 3}px;width:${r * 2 + 6}px;height:${r * 2 + 6}px`;
}

(function zoomFrame(now) {
  const dt = Math.min(64, (now ?? performance.now()) - lastFrame);
  lastFrame = now ?? performance.now();
  if (zoomTarget != null) {
    const cam = globe.camera(),
      cur = camAlt();
    const ease = 1 - Math.pow(1 - 0.24, dt / 16.7);
    let next = Math.exp(Math.log(cur) + (Math.log(zoomTarget) - Math.log(cur)) * ease);
    if (Math.abs(Math.log(next / zoomTarget)) < 0.001) {
      next = zoomTarget;
      zoomTarget = null;
    }
    cam.position.setLength(GLOBE_R * (1 + next));
    controls.rotateSpeed = 0.55 * Math.min(1, Math.max(0.06, next / 2)); // calmer dragging close in
    cameraMoved(next);
  }
  placePinSprites();
  placePlanetOrbit();
  requestAnimationFrame(zoomFrame);
})();
let skyAlt = 0;
function cameraMoved(alt) {
  state.alt = alt;
  // the sky depends only on height, so a pan (or a sequence following a route) skips that work
  if (Math.abs(Math.log(alt / (skyAlt || alt * 2))) > 0.01) {
    skyAlt = alt;
    updateSky();
  }
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    const t = tier();
    if (t !== tierKey) {
      tierKey = t;
      render();
    }
  }, 160);
}
controls.addEventListener('change', () => cameraMoved(camAlt())); // drags
setInterval(() => {
  const a = camAlt();
  if (Math.abs(a - state.alt) / state.alt > 0.05) cameraMoved(a);
}, 250); // tweened fly-tos
addEventListener('resize', () => {
  globe.width(innerWidth).height(innerHeight);
  drawDensity();
});
// Sea level through the ice ages (Spratt and Lisiecki 2016, thousand-year steps back to 798,000 years ago), how far below
// today's it stood at the date shown. Fetched the first time the date is old enough to need it. Small values near the
// present are within the study's margin, so nothing is drawn for them.
let seaCurve = null,
  seaLoading = false;
// The African Humid Period, when the Sahara held lakes, animals and people: about 11,000 to 5,000 years ago, ending within a few centuries
const humidAt = bp => Math.min(1, Math.max(0, (11500 - bp) / 500)) * Math.min(1, Math.max(0, (bp - 4700) / 300));
function seaDropAt(t) {
  const ka = (1950 - t) / 1000;
  if (ka < 8 || ka > 798) return 0;
  if (!seaCurve) {
    if (!seaLoading) {
      seaLoading = true;
      fetch('paleo/sealevel.json')
        .then(r => r.json())
        .then(d => {
          seaCurve = d.curve;
          render();
        })
        .catch(() => {
          seaLoading = false;
        });
    }
    return 0;
  }
  const i = Math.min(seaCurve.length - 2, Math.floor(ka)),
    [a, ma] = seaCurve[i],
    [b, mb] = seaCurve[i + 1];
  const drop = -(ma + ((mb - ma) * (ka - a)) / (b - a));
  return drop >= 5 ? drop : 0;
}
// the fossil groups, with how many finds of each are known from rocks of this age; a click hides or shows a group
let fossilCountMa = null;
export function renderFossilKey() {
  const groups = window.Fossils.groups,
    ma = -state.t / 1e6,
    on = !!(state.fossils && groups && state.paleoMa != null && ma <= 600),
    box = $('#v-fossils');
  show(box, on);
  if (!on) return false;
  const chips = $('#v-chips');
  if (!chips.children.length) {
    chips.innerHTML = groups
      .map(
        (g, i) =>
          `<button class="f-chip" data-i="${i}" aria-pressed="true" style="color:${window.Fossils.COLORS[i]}" title="Show or hide ${esc(g)}"><i></i><span>${esc(g)}</span><b></b></button>`,
      )
      .join('');
    chips.querySelectorAll('button').forEach(b => {
      b.onclick = () => {
        const i = +b.dataset.i,
          now = !window.Fossils.isOn(i);
        window.Fossils.setGroup(i, now);
        b.setAttribute('aria-pressed', now);
      };
    });
  }
  if (fossilCountMa == null || Math.abs(fossilCountMa - ma) >= 0.25) {
    fossilCountMa = ma;
    window.Fossils.counts(ma).forEach((n, i) => {
      const b = chips.children[i],
        text = n ? n.toLocaleString() : '—';
      if (b.lastElementChild.textContent !== text) {
        b.lastElementChild.textContent = text;
        b.classList.toggle('none', !n);
      }
    });
  }
  return true;
}
function yearToDate(y) {
  if (!(y > -270000 && y < 270000)) return new Date();
  const d = new Date(Date.UTC(2000, 0, 1));
  d.setUTCFullYear(Math.floor(y));
  return new Date(d.getTime() + (y - Math.floor(y)) * 365.2425 * 864e5);
}
function sunMoment() {
  const now = new Date();
  if (LEVELS[state.level].key !== 'event' || state.t <= -4000) return now;
  const d = yearToDate(state.t);
  d.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), 0, 0);
  return d;
}
export function updateSky() {
  const present = state.t >= NOW - 1,
    cloudBtn = $('#clouds'); // the cloud image is today's weather, so it shows only in the present day
  if (cloudBtn.disabled === present) {
    cloudBtn.disabled = !present;
    cloudBtn.title = present ? 'Clouds from a recent satellite image' : 'Clouds show only in the present day';
  }
  window.Space.update({
    date: state.t > -4000 ? yearToDate(state.t) : new Date(),
    sunDate: sunMoment(),
    sunMode: state.realSun ? 'real' : 'camera',
    nightLights: state.t >= 1900,
    clouds: state.clouds && present,
    zoomAlt: state.alt,
  });
  window.Space.showPlateEdges(state.plateEdges);
  state.paleoMa = window.Space.setPaleo(state.t < -2e6 ? -state.t / 1e6 : null);
  const lifeMa = state.t < -2e6 && -state.t / 1e6 <= 560 ? -state.t / 1e6 : null,
    coastBtn = $('#coastlines'); // the Life period, easing out just past it
  if (coastBtn.disabled === (lifeMa != null)) {
    coastBtn.disabled = lifeMa == null;
    coastBtn.title =
      lifeMa != null
        ? 'Today’s coastlines, carried back with the plates, to show where today’s continents were'
        : 'Today’s coastlines show on the moving plates in the Life period, the last 540 million years';
  }
  window.Coastlines.update(state.coastlines && !state.film ? lifeMa : null);
  state.seaDrop = seaDropAt(state.t);
  const bp = 1950 - state.t;
  window.Space.setSeaDrop(state.seaDrop * Math.min(1, Math.max(0, (bp - 8000) / 1000))); // the shelves flood gradually, not at a stroke, as the curve ends
  window.Space.setIce(bp);
  state.humid = humidAt(bp);
  window.Space.setClimate(Math.min(1, state.seaDrop / 125), state.humid);
  window.Borders?.update(state.t, state.borders && !state.film);
  window.DeepTime?.update(state.paleoMa >= 10 && -state.t / 1e6 <= window.Space.PALEO_MAX ? -state.t / 1e6 : null);
  window.Fossils.update(state.fossils && state.paleoMa != null ? -state.t / 1e6 : null);
  window.Spacecraft?.update(state.film ? -1e9 : state.t, state.t > -4000 ? yearToDate(state.t) : new Date());
}

// ---------- rendering
// A dated route (every waypoint has a year) grows as time passes: the legs reached by state.t, plus the leg under way
function routeSoFar(p) {
  const w = p.waypoints;
  if (!w.every(x => typeof x.year === 'number')) return w;
  const pts = w.filter(x => x.year <= state.t);
  const next = w.find(x => x.year > state.t),
    last = pts[pts.length - 1];
  if (last && next) {
    const f = (state.t - last.year) / (next.year - last.year);
    pts.push({ lat: last.lat + (next.lat - last.lat) * f, lon: last.lon + (next.lon - last.lon) * f });
  }
  return pts;
}
// Deep time between records: rather than "nothing recorded", the geological period in view with a one-line general
// picture of it, plainly marked as background (not a sourced atlas record), and the nearest records either side.
// Period boundaries in millions of years, from the International Chronostratigraphic Chart (ICS, v2024/12).
const PERIODS = [
  [
    4567,
    4031,
    'Hadean',
    'The young Earth forms and is hit by a Mars-sized body, making the Moon. A molten surface cools to a first crust; the oldest surviving mineral grains date from late in this eon.',
  ],
  [
    4031,
    3600,
    'Eoarchean',
    'The oldest rocks that survive form. Oceans already cover most of the planet, and the first life may already be in them.',
  ],
  [
    3600,
    3200,
    'Paleoarchean',
    'Microbial mats build stromatolites in shallow seas, among the oldest widely accepted signs of life. The air holds almost no oxygen.',
  ],
  [
    3200,
    2800,
    'Mesoarchean',
    'Small continents grow from volcanic island arcs. Some microbes may already be making oxygen by photosynthesis.',
  ],
  [
    2800,
    2500,
    'Neoarchean',
    'Continental crust grows quickly and the first large stable cores of continents form. Oxygen is made, but used up as fast as it appears.',
  ],
  [2500, 2300, 'Siderian', 'Banded iron formations are laid down as oxygen from microbes rusts the iron dissolved in the oceans.'],
  [
    2300,
    2050,
    'Rhyacian',
    'The Great Oxidation Event: oxygen builds up in the air for the first time, and long glaciations follow as greenhouse methane falls.',
  ],
  [
    2050,
    1800,
    'Orosirian',
    'Mountain building assembles an early supercontinent, often called Columbia or Nuna. Two of Earth’s largest known impact craters, Vredefort and Sudbury, form.',
  ],
  [1800, 1600, 'Statherian', 'Continents stabilise. Cells with a nucleus (eukaryotes) are known from fossils of about this age.'],
  [1600, 1400, 'Calymmian', 'Platform sediments spread over stable continents; the long, quiet "boring billion" is under way.'],
  [
    1400,
    1200,
    'Ectasian',
    'Sea life is still mostly single-celled; the first red algae, early multicellular life, appear around this time.',
  ],
  [1200, 1000, 'Stenian', 'Grenville mountain building welds continents into the supercontinent Rodinia.'],
  [
    1000,
    720,
    'Tonian',
    'Rodinia is complete and begins to break apart. Oxygen begins to rise again, and simple animals may have appeared.',
  ],
  [
    720,
    635,
    'Cryogenian',
    '"Snowball Earth": ice spreads from the poles to the tropics, at least twice, and the oceans are largely frozen over.',
  ],
  [635, 538.8, 'Ediacaran', 'After the ice, the first large complex organisms, the soft-bodied Ediacaran biota, live on the sea floor.'],
  [
    538.8,
    486.85,
    'Cambrian',
    'The Cambrian explosion: most major animal groups appear in the seas, many with shells and eyes. The land is still bare.',
  ],
  [
    486.85,
    443.1,
    'Ordovician',
    'Sea life diversifies greatly, the first plants reach land, and the period ends in an ice age and a mass extinction.',
  ],
  [
    443.1,
    419.62,
    'Silurian',
    'Reefs recover and jawed fish spread. Small vascular plants and the first land animals, arthropods, colonise the shores.',
  ],
  [419.62, 358.86, 'Devonian', 'The Age of Fishes. The first forests grow, and the first four-limbed vertebrates crawl from the water.'],
  [
    358.86,
    298.9,
    'Carboniferous',
    'Vast swamp forests lay down today’s coal. Oxygen is high, insects grow huge, and the first reptiles appear.',
  ],
  [
    298.9,
    251.9,
    'Permian',
    'The supercontinent Pangaea is assembled, with a dry interior. The period ends in the largest mass extinction in Earth’s history.',
  ],
  [
    251.9,
    201.4,
    'Triassic',
    'Life recovers on Pangaea; the first dinosaurs and mammals appear, and another mass extinction ends the period.',
  ],
  [201.4, 143.1, 'Jurassic', 'Pangaea splits and the Atlantic begins to open. Dinosaurs dominate the land; the first birds appear.'],
  [
    143.1,
    66,
    'Cretaceous',
    'Flowering plants spread, and the continents near their modern shapes. An asteroid impact ends the reign of the non-avian dinosaurs.',
  ],
  [
    66,
    23.04,
    'Paleogene',
    'Mammals and birds diversify into the empty niches. A hot climate gives way to cooling, and Antarctica freezes over.',
  ],
  [23.04, 2.58, 'Neogene', 'Grasslands spread, the climate keeps cooling, and the first hominins appear in Africa.'],
  [
    2.58,
    0.0117,
    'Pleistocene',
    'Ice ages come and go. Several kinds of humans live side by side, and modern humans spread from Africa across the world.',
  ],
];
const periodAt = ma => PERIODS.find(([a, b]) => ma <= a && ma > b) || null;
function renderPeriod([a, b, name, text]) {
  const span =
    a >= 1000
      ? `${(a / 1000).toFixed(2)}–${(b / 1000).toFixed(2)} billion years ago`
      : b < 1
        ? `${a} million – ${Math.round(b * 1000)} thousand years ago`
        : `${a}–${b} million years ago`;
  $('#empty-text').innerHTML =
    `<b>${esc(name)}</b><small>${esc(span)}</small>${esc(text)}<em>Background sketch, not a sourced record: the general scientific picture, simplified.</em>`;
  renderNearest();
}
// the nearest records either side of the window, so a gap is one click away from something real
function renderNearest() {
  const win = windowNow(),
    mi = minImportance(),
    cand = state.pins.filter(p => p.lat != null && inLevel(p) && domainOn(p) && rankOf(p) >= mi);
  const before = cand.filter(p => p.until < win.from).sort((x, y) => y.until - x.until)[0],
    after = cand.filter(p => p.start > win.to).sort((x, y) => x.start - y.start)[0];
  $('#empty-near').replaceChildren(
    ...[
      [before, '←'],
      [after, '→'],
    ]
      .filter(([p]) => p)
      .map(([p, arrow]) => {
        const b2 = document.createElement('button');
        b2.textContent = arrow === '←' ? `← ${p.title}` : `${p.title} →`;
        b2.title = `Go to ${fmtYear(p.start)}`;
        b2.onclick = () => {
          state.t = Math.min(p.start, NOW);
          render();
        };
        return b2;
      }),
  );
}
// past the plate model's reach: what the Earth was like, as an artist's impression (no continents are reconstructed)
function eonNote(ma) {
  const ga = ma / 1000;
  const scene =
    ga > 4.0
      ? 'Hadean Earth: a young crust cracked over magma and scarred by impacts, under a thick hot sky.'
      : ga > 2.5
        ? 'Archean Earth: a water world with few small islands, under an orange, oxygen-poor haze; microbial life in the seas.'
        : ga > 2.1 && ga < 2.45
          ? 'Huronian glaciation: ice reaching far toward the equator as oxygen rose and greenhouse methane fell.'
          : 'Proterozoic Earth: growing continents and shallow seas, oxygen slowly building up; life still mostly single-celled.';
  return `${scene} Artist’s impression: no plate model reaches back past ${window.Space.PALEO_MAX} million years, so where the land lay is unknown. Pins mark where the evidence is found today.`;
}
function uncertaintyRing(p) {
  // the open record's margin of error for its place, as a circle on the globe
  const q = placed(p),
    r = p.unc / 6371,
    lat = (q.lat * Math.PI) / 180,
    lon = (q.lon * Math.PI) / 180,
    pts = [];
  for (let i = 0; i <= 72; i++) {
    const b = (i / 72) * 2 * Math.PI,
      la = Math.asin(Math.sin(lat) * Math.cos(r) + Math.cos(lat) * Math.sin(r) * Math.cos(b));
    pts.push({
      lat: (la * 180) / Math.PI,
      lon: ((lon + Math.atan2(Math.sin(b) * Math.sin(r) * Math.cos(lat), Math.cos(r) - Math.sin(lat) * Math.sin(la))) * 180) / Math.PI,
    });
  }
  return { pts, color: 'rgba(255,255,255,0.7)', ring: true };
}
let shownArcs = null;
export function render() {
  tierKey = tier();
  updateSky();
  checkToday();
  const shown = visiblePins();
  const pins = shown.filter(p => !p.global),
    planet = shown.filter(p => p.global); // planet-wide records get a chip, not a misleading pin
  renderPlanet(planet);
  // One persistent datum per pin, so globe.gl keeps each badge and only adds or removes the pins entering or
  // leaving the time window (fresh objects every render would rebuild every sprite and make the pins flash)
  const drawn = clusterPins(pins),
    ids = new Set(drawn.map(p => p.id));
  for (const id of [...pinData.keys()])
    if (!ids.has(id)) {
      pinData.delete(id);
      pinSprites.delete(id);
    }
  if (hoverId && !ids.has(hoverId)) hoverId = null;
  globe.customLayerData(
    drawn.map(p => {
      const d = pinData.get(p.id);
      if (d) return Object.assign(d, p);
      const n = { ...p };
      pinData.set(p.id, n);
      return n;
    }),
  );
  placePinSprites();
  // place names are drawn by the pin sprites themselves (placePinSprites), with collision avoidance
  // routes stay hidden unless the Routes layer is on; an opened record still shows its own route
  // a playing sequence draws its own smooth route, so the static one for that record steps aside
  globe.pathsData(
    pins
      .filter(p => p.waypoints?.length >= 2 && (state.paths || p.id === state.selected) && p.id !== window.Sequence?.recordId)
      .map(p => ({
        pts: routeSoFar(p),
        color: colorOf(p),
        wall: /wall/i.test(p.title),
        dated: p.waypoints.every(x => typeof x.year === 'number'),
      }))
      .filter(x => x.pts.length >= 2)
      .concat(
        pins
          .filter(p => p.id === state.selected && p.unc >= 5 && p.unc < 5000 && (!p.geometry || p.geometry === 'point'))
          .map(uncertaintyRing),
      ),
  );
  const arcs = window.Sequence?.playing ? [] : state.arcs;
  if (arcs !== shownArcs) {
    shownArcs = arcs;
    globe.arcsData(arcs);
  }

  const { from, to } = range();
  const within = state.autoWhole
    ? ` across ${LEVELS[state.level].name}`
    : state.whole || LEVELS[state.level].key === 'event'
      ? ''
      : ` within ${fmtSpan((windowNow().to - windowNow().from) / 2)}`;
  $('#now').innerHTML = `${esc(fmtYear(state.t))}<small>${pins.length} shown${esc(within)}</small>`;
  $('#slider').setAttribute('aria-valuetext', fmtYear(state.t));
  $('#t0').textContent = fmtYear(from, true);
  $('#tm').textContent = LEVELS[state.level].key === 'event' ? '' : fmtYear((from + to) / 2, true);
  $('#t1').textContent = LEVELS[state.level].key === 'event' ? fmtYear(to, true) : 'today';
  if (!slideRange) $('#slider').value = Math.round(((state.t - from) / (to - from)) * 1000);
  const full = NOW - EARTH,
    left = (from - EARTH) / full,
    width = Math.max((to - from) / full, 0.004);
  Object.assign($('#context .win').style, { left: `${Math.min(left, 1 - width) * 100}%`, width: `${width * 100}%` });

  const notice =
    state.paleoMa != null && -state.t / 1e6 > window.Space.PALEO_MAX
      ? eonNote(-state.t / 1e6)
      : state.paleoMa >= 10
        ? innerWidth <= 760
          ? `Earth ${Math.round(state.paleoMa)} million years ago. ${state.paleoMa <= 540 ? '' : 'Land is a stand-in. '}Sources in About.`
          : `Earth ${Math.round(state.paleoMa)} million years ago. ${state.paleoMa <= 540 ? 'Land and sea floor: PALEOMAP PaleoDEMs (Scotese and Wright 2018). ' : 'No maps reach this far. Which rock is here comes from plate models; its coasts and heights are a stand-in, from the 540 million-year-old map. '}`
        : state.paleoMa != null
          ? 'Today’s imagery, carried back with the plates, fading into the PALEOMAP maps of land and sea floor.'
          : state.t < -1e6
            ? 'The map shows today’s continents, which have barely moved in the last few million years.'
            : state.seaDrop > 0
              ? `Sea level about ${Math.round(state.seaDrop / 5) * 5} m below today’s, so the coastlines are drawn further out (sea level: Spratt and Lisiecki 2016; depths: NOAA ETOPO1). ${state.t > -80000 ? 'Ice sheets: PaleoMIST 1.0 (Gowan et al. 2021).' : 'Ice sheets are drawn only for the last 80,000 years.'} Plant cover is schematic.`
              : state.t < -12000
                ? state.humid > 0
                  ? 'The Sahara is tinted green for the African Humid Period, about 11,000 to 5,000 years ago. Plant cover is schematic.'
                  : `The map shows today’s coastlines. ${state.t > -80000 ? 'Ice sheets: PaleoMIST 1.0 (Gowan et al. 2021).' : 'Sea level is drawn only for the last 800,000 years, and ice sheets for the last 80,000.'}`
                : '';
  $('#notice').textContent = notice;
  show($('#notice'), !!notice && $('#panel').hidden && !(innerWidth <= 760 && !$('#seqbar').hidden)); // on a phone it would cover what a sequence is showing
  const anyInLevel = state.pins.some(p => inLevel(p) && domainOn(p) && p.until >= from && p.start <= to),
    anyPublished = anyInLevel || state.pins.some(p => inLevel(p) && p.until >= from && p.start <= to);
  show($('#empty'), state.pins.length > 0 && pins.length === 0 && $('#seqbar').hidden);
  const period = state.t < -11700 && periodAt(-state.t / 1e6);
  $('#empty').classList.toggle('period', !!period);
  if (period && pins.length === 0) renderPeriod(period);
  else {
    $('#empty-text').textContent =
      !anyInLevel && anyPublished
        ? 'Your filters are hiding every record here. Turn on an importance level or a domain, or choose another region or kind, to see them.'
        : wholeNow() || !anyInLevel
          ? anyInLevel
            ? 'Zoom in to see smaller events here.'
            : `No published records in the ${LEVELS[state.level].name.toLowerCase()} scale yet.`
          : `Nothing recorded near ${fmtYear(state.t)} yet.`;
    if (pins.length === 0) renderNearest();
  }
  show($('#empty-btn'), !period && !wholeNow() && anyInLevel);
  renderVitals();
  drawDensity();
  queueURL();
}

function buildChrome() {
  $('#levels').innerHTML = LEVELS.map((l, i) => `<button role="tab" data-i="${i}" tabindex="-1">${l.name}</button>`).join('');
  // the scale tabs are one stop for Tab; the arrow keys, Home and End move between them
  $('#levels').onkeydown = e => {
    const n = LEVELS.length,
      i = { ArrowRight: state.level + 1, ArrowLeft: state.level - 1, Home: 0, End: n - 1 }[e.key];
    if (i == null) return;
    e.preventDefault();
    setLevel((i + n) % n);
    $('#levels .on')?.focus();
  };
  $('#levels')
    .querySelectorAll('button')
    .forEach(b => {
      b.onclick = () => setLevel(+b.dataset.i);
    });
  $('#levels')
    .querySelectorAll('button')
    .forEach(b => {
      const from = LEVELS[+b.dataset.i].from;
      if (from < -2e6) prefetchPaleo(b);
      if (from < -10000) prefetchIceAge(b);
    });
  $('#context').innerHTML =
    EONS.map(
      e => `<div class="eon" style="flex:${e.to - e.from};background:${e.color}" title="${e.name} eon"><span>${e.name}</span></div>`,
    ).join('') + '<div class="win"></div><div class="humans" title="Human history"></div>';
}
function buildLegend() {
  const counts = {};
  for (const p of state.pins) for (const d of p.domains || []) counts[d] = (counts[d] || 0) + 1;
  $('#domains').innerHTML = Object.entries(DOMAINS)
    .filter(([k]) => counts[k])
    .map(
      ([k, [name, col]]) =>
        `<li><button data-d="${k}" aria-pressed="${!state.off.has(k)}"><img class="sw" alt="" src="${badgeURL(k, true)}">${name}<span class="n">${counts[k]}</span></button></li>`,
    )
    .join('');
  $('#domains')
    .querySelectorAll('button')
    .forEach(b => {
      b.onclick = () => {
        const d = b.dataset.d;
        state.off.has(d) ? state.off.delete(d) : state.off.add(d);
        b.setAttribute('aria-pressed', !state.off.has(d));
        render();
      };
    });
  // region and kind: choosing one or more shows only those; choosing none shows all
  for (const [box, field, labels, chosen] of [
    ['#f-regions', 'region', REGION_LABELS, state.regions],
    ['#f-kinds', 'kind', KIND_LABELS, state.kinds],
  ]) {
    const n = {};
    for (const p of state.pins) n[p[field]] = (n[p[field]] || 0) + 1;
    $(box).innerHTML = Object.keys(labels)
      .filter(k => n[k])
      .sort((a, b) => n[b] - n[a])
      .map(k => `<button class="chip" data-k="${k}" aria-pressed="${chosen.has(k)}">${esc(labels[k][0].toUpperCase() + labels[k].slice(1))}<span class="n">${n[k].toLocaleString()}</span></button>`)
      .join('');
    $(box)
      .querySelectorAll('button')
      .forEach(b => {
        b.onclick = () => {
          const k = b.dataset.k;
          chosen.has(k) ? chosen.delete(k) : chosen.add(k);
          b.setAttribute('aria-pressed', chosen.has(k));
          render();
        };
      });
  }
  // importance levels: each switches its pins on or off (5 = most important); "Only" keeps just that level
  const lv = {};
  for (const p of state.pins) lv[p.importance || 0] = (lv[p.importance || 0] || 0) + 1;
  $('#imp-levels').innerHTML = [5, 4, 3, 2, 1]
    .filter(l => lv[l])
    .map(
      l =>
        `<button data-l="${l}" aria-pressed="${!state.impOff.has(l)}" title="Importance ${l} of 5: click to show or hide; double-click to show only this level"><span class="dots">${'●'.repeat(l)}${'○'.repeat(5 - l)}</span><span class="n">${lv[l].toLocaleString()}</span></button>`,
    )
    .join('');
  $('#imp-levels')
    .querySelectorAll('button')
    .forEach(b => {
      const l = +b.dataset.l;
      b.onclick = () => {
        state.impOff.has(l) ? state.impOff.delete(l) : state.impOff.add(l);
        buildLegend();
        render();
      };
      b.ondblclick = () => {
        // only this level, or everything again if it already was the only one
        const only = [1, 2, 3, 4, 5].every(x => x === l || state.impOff.has(x)) && !state.impOff.has(l);
        state.impOff = new Set(only ? [] : [1, 2, 3, 4, 5].filter(x => x !== l));
        buildLegend();
        render();
      };
    });
}
export function setLevel(i, keepT = false) {
  state.level = i;
  const { from, to } = range();
  if (!keepT && LEVELS[i].key !== 'event') state.t = Math.min(Math.max(state.t, from), to);
  $('#levels')
    .querySelectorAll('button')
    .forEach(b => {
      const on = +b.dataset.i === i;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
    });
  const tabs = $('#levels'),
    on = tabs.querySelector('.on'); // keep the active scale visible when the tabs scroll (phones)
  if (on && tabs.scrollWidth > tabs.clientWidth)
    tabs.scrollTo({ left: on.offsetLeft - tabs.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
  fadeTabs();
  $('#time').classList.toggle('deep', i === 0);
  render();
}
setInterval(() => {
  if (state.realSun) updateSky();
}, 60000); // the real Sun keeps moving while the page sits still
for (const [id, key] of [
  ['#borders', 'borders'],
  ['#whole', 'whole'],
  ['#paths', 'paths'],
  ['#coastlines', 'coastlines'],
  ['#clouds', 'clouds'],
  ['#realsun', 'realSun'],
  ['#vitals-toggle', 'vitals'],
  ['#fossils-toggle', 'fossils'],
]) {
  $(id).onclick = () => {
    state[key] = !state[key];
    $(id).setAttribute('aria-pressed', state[key]);
    render();
    updateSky();
  };
}

// jump the time axis to a record's own level and date, then open it
export async function goTo(id) {
  await dataReady; // a jump requested before the records arrive waits for them
  closePinList();
  const p = state.pins.find(x => x.id === id);
  if (p) {
    const lvl = Math.max(scaleIndex(p), p.start < -1e6 ? 0 : p.start < SCALE_START.civilization ? 3 : p.start < SCALE_START.modern ? 4 : 5);
    state.t = Math.min(Math.max(p.start, range(lvl).from ?? p.start), NOW);
    setLevel(Math.min(lvl, 5), true);
  }
  openRecord(id);
}

// ---------- authored sequences (spec 6.2): the time axis locks to each beat; the panel steps aside while playing
// the scale a date belongs to: the narrowest of Deep time to Modern that reaches back to it
export function levelFor(y) {
  const S = SCALE_START;
  return y < S.life ? 0 : y < S.human_origins ? 1 : y < S.prehistory ? 2 : y < S.civilization ? 3 : y < S.modern ? 4 : 5;
}
// onDone runs when the sequence reaches its end (not when it is stopped): a playing tour moves on from there
export function playSequence(r, onDone) {
  const pin = state.pins.find(p => p.id === r.id);
  window.Sequence.play(r, {
    globe,
    color: pin ? baseColor(pin) : '#d9b36a',
    scene: deepTime?.scenes[r.id],
    getTime: () => state.t,
    ride: ({ lat, lng }) => {
      const q = placed({ lat, lon: lng });
      return { lat: q.lat, lng: q.lon };
    },
    schematic: () => {
      $('#seq-title').textContent = `${r.title} · schematic animation`;
    },
    setTime: y => {
      state.t = Math.min(y, NOW);
      const lv = levelFor(state.t);
      if (lv !== state.level && state.level !== 6) setLevel(lv, true);
      else render();
    },
    onStart: n => {
      show($('#panel'), false);
      show($('#seqbar'), true);
      show($('#hint'), false);
      $('#seq-title').textContent = r.title;
      $('#seq-caption').textContent = '';
      $('#seq-num').textContent = '';
      $('#seq-dots').innerHTML = Array.from({ length: n }, () => '<i></i>').join('');
    },
    caption: (i, text, consequence, num) => {
      $('#seq-caption').textContent = text;
      $('#seq-num').textContent = num || '';
      $('#seq-dots')
        .querySelectorAll('i')
        .forEach((d, j) => {
          d.classList.toggle('on', j <= i);
          d.classList.toggle('now', j === i);
          if (j === i) d.classList.toggle('cons', !!consequence);
        });
    },
    onEnd: () => {
      show($('#seqbar'), false);
      show($('#panel'), !!state.selected);
      render();
      onDone?.();
    },
  });
}
$('#seq-pause').onclick = () => {
  state.seqPaused = !state.seqPaused;
  window.Sequence.setPaused(state.seqPaused);
  $('#seq-pause').setAttribute('aria-label', state.seqPaused ? 'Resume sequence' : 'Pause sequence');
  $('#seq-pause').innerHTML = state.seqPaused
    ? PLAY.replace('12" height="12"', '11" height="11"')
    : PAUSE.replace('12" height="12"', '11" height="11"');
};
$('#seq-stop').onclick = () => {
  window.Sequence.stop();
  state.seqPaused = false;
  show($('#seqbar'), false);
  show($('#panel'), !!state.selected);
  render();
};
// skip back and forth: the buttons, the arrow keys, or a click on one of the beat dots
$('#seq-prev').onclick = () => window.Sequence.step(-1);
$('#seq-next').onclick = () => window.Sequence.step(1);
$('#seq-dots').onclick = e => {
  const dots = [...$('#seq-dots').children],
    i = dots.indexOf(e.target);
  if (i >= 0) window.Sequence.goTo(i);
};
addEventListener('keydown', e => {
  if ($('#seqbar').hidden || !window.Sequence.playing || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    window.Sequence.step(-1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    window.Sequence.step(1);
  }
});

state.arcs = [];
// ---------- lists of pins: a dense spot opened, or everything shown now (for the keyboard and for crowded screens)
// rows of pins, optionally under headings: [{ label, pins }]; `by` names the button that opened it (aria-expanded)
const pinRows = pins =>
  `<ul>${pins.map(p => `<li><button data-id="${esc(p.id)}"><img alt="" src="${badgeURL(p.domains?.[0], !p.outline)}"><span>${esc(p.title)}</span><span class="d">${esc(p.display || '')}</span></button></li>`).join('')}</ul>`;
let listBy = '#list-btn';
function openPinList(title, pins, groups = null, by = '#list-btn') {
  const box = $('#pinlist');
  closePinList();
  listBy = by;
  box.innerHTML = `<h2>${esc(title)}<button aria-label="Close list">×</button></h2>${groups ? groups.map(g => `<h3>${esc(g.label)}</h3>${pinRows(g.pins)}`).join('') : pinRows(pins)}`;
  box.querySelector('h2 button').onclick = closePinList;
  box.querySelectorAll('button[data-id]').forEach(b => {
    b.onclick = () => (groups ? goTo(b.dataset.id) : openRecord(b.dataset.id));
  });
  box.dataset.kind = groups ? 'world' : 'list';
  show(box, true);
  $(listBy).setAttribute('aria-expanded', 'true');
  box.querySelector('button[data-id]')?.focus({ preventScroll: true });
}
function closePinList() {
  show($('#pinlist'), false);
  $(listBy).setAttribute('aria-expanded', 'false');
}
function openCluster(c) {
  openPinList(`${c.cluster.length} records here`, c.cluster);
  globe.pointOfView({ lat: c.lat, lng: c.lon, altitude: Math.max(0.15, state.alt * 0.55) }, 800);
}
$('#list-btn').onclick = () => {
  if (!$('#pinlist').hidden && listBy === '#list-btn') return closePinList();
  const pins = visiblePins()
    .filter(p => !p.global)
    .sort((a, b) => b.importance - a.importance || a.start - b.start);
  openPinList(`${pins.length} records shown now`, pins.slice(0, 200));
};
// Around the world: for the date shown, the top two records under way in each region
export function openWorld() {
  if (!$('#pinlist').hidden && listBy === '#world-btn') return closePinList();
  const groups = aroundTheWorld(state.t);
  openPinList(`Around the world in ${fmtYear(Math.round(state.t))}`, null, groups.length ? groups : [{ label: 'Nothing pinned near this date', pins: [] }], '#world-btn');
}
$('#world-btn').onclick = openWorld;
addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closePinList();
    closeWelcome();
  }
});
// ---------- welcome card: what this is, where to start, what happened on this date
function onThisDay() {
  const d = new Date(),
    md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return state.pins
    .filter(p => p.md === md)
    .sort((a, b) => b.importance - a.importance || b.start - a.start)
    .slice(0, 3);
}
// The welcome is a modal dialog: a backdrop, focus kept inside, Escape closes. Three main choices (the film, a tour,
// exploring), with "On this day" below; the tours are listed when Take a tour is chosen.
const welcome = $('#welcome');
async function openWelcome() {
  const list = await loadTours(),
    today = onThisDay();
  welcome.innerHTML = `<h2 id="welcome-title">Living Atlas</h2>
    <p>Earth and human history, placed where and when it happened. Drag the globe, move the time bar, and open any pin to read its record and sources.</p>
    <div class="w-main">
      <button id="film-btn" class="w-choice"><b>Watch the film</b><span>${esc(deepTime?.film.title || 'A billion years of Earth')}</span></button>
      <button id="tours-btn" class="w-choice" aria-expanded="false" aria-controls="w-tours"><b>Take a tour</b><span>${list.length} guided routes through the records</span></button>
      <button id="welcome-close" class="w-choice" autofocus><b>Explore</b><span>The globe, on your own</span></button>
    </div>
    <ul id="w-tours" class="tour-list" hidden>${list.map(t => `<li><button data-tour="${esc(t.id)}"><b>${esc(t.title)}</b><span>${esc(t.blurb)} ${t.stops.length} stops.</span></button></li>`).join('')}</ul>
    ${today.length ? `<h3>On this day</h3><ul class="tour-list w-today">${today.map(p => `<li><button data-id="${esc(p.id)}"><b>${esc(p.title)}</b><span>${esc(p.display)}</span></button></li>`).join('')}</ul>` : ''}
    <div class="welcome-foot"><span>Written by AI models from cited sources. <a href="about.html">How this is made</a></span></div>`;
  welcome.querySelectorAll('button[data-tour]').forEach(b => {
    b.onclick = () => startTour(b.dataset.tour, 0, true); // chosen from the welcome, a tour plays itself
  });
  welcome.querySelectorAll('button[data-id]').forEach(b => {
    b.onclick = () => {
      closeWelcome();
      goTo(b.dataset.id);
    };
  });
  welcome.querySelector('#tours-btn').onclick = e => {
    const open = welcome.querySelector('#w-tours').hidden;
    show(welcome.querySelector('#w-tours'), open);
    e.currentTarget.setAttribute('aria-expanded', open);
    if (open) welcome.querySelector('#w-tours button')?.focus();
  };
  welcome.querySelector('#welcome-close').onclick = closeWelcome;
  welcome.querySelector('#film-btn').onclick = startFilm;
  prefetchPaleo(welcome.querySelector('#film-btn'));
  if (!welcome.open) welcome.showModal();
  // showModal focuses Explore (autofocus), not the film: focus there would start its 4 MB download
}
export function closeWelcome() {
  if (welcome.open) welcome.close();
}
// Tab wraps around inside the dialog, rather than leaving the page for the browser's own controls
welcome.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const all = [...welcome.querySelectorAll('button, a[href]')].filter(el => el.offsetParent),
    first = all[0],
    last = all[all.length - 1];
  if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
});
// however it closes (a choice, Escape), the welcome counts as seen
welcome.addEventListener('close', () => {
  try {
    localStorage.setItem('atlas.welcomed', '1');
  } catch {}
});
$('#start').onclick = openWelcome;
// ---------- live data
let lastSig = '';
async function refresh() {
  try {
    const d = await (await fetch('api/pins.json', { cache: LIVE ? 'no-store' : 'default' })).json();
    const sig = d.pins.map(p => p.id + p.updated).join('|');
    if (sig === lastSig) return;
    if (lastSig) recordCache.clear(); // something changed on the live server
    lastSig = sig;
    state.pins = d.pins.map(window.AtlasPins.expand);
    $('#count').textContent = `${(d.count + d.outlines).toLocaleString()} records`;
    $('#count').title = `${d.count} full records, ${d.outlines.toLocaleString()} outlines`;
    buildLegend();
    render();
    if (teasers || teasersWanted) applyTeasers();
  } catch (e) {
    // a failed check for new records changes nothing while the records already loaded are on screen: stay quiet and try again next time
    if (state.pins.length) console.warn('atlas data refresh failed', e);
    else
      flash(
        `The atlas data could not be loaded (${e.message}). ${LIVE ? 'Is the viewer server running?' : 'Check your connection and reload the page.'}`,
      );
  }
  $('#loading').classList.add('gone');
  setTimeout(() => show($('#loading'), false), 700); // don't rely on the fade finishing
}
// Tooltip teasers (api/teasers.json, 0.5 MB) load at the visitor's first move, tap or key press, so a first visit that
// only looks does not download them; until they arrive a tooltip or the instant panel shows no summary. Locally they
// are fetched again whenever the pins change.
let teasers = null,
  teasersSig = '',
  teasersWanted = false,
  teasersLoad = null;
function wantTeasers(e) {
  if (teasersWanted || (e.type === 'pointermove' && !e.movementX && !e.movementY)) return; // the browser's own synthetic moves don't count
  teasersWanted = true;
  dataReady.then(applyTeasers);
}
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(ev, wantTeasers, { passive: true });
async function applyTeasers() {
  if (!teasers || (LIVE && teasersSig !== lastSig)) {
    const sig = lastSig; // one request at a time, shared by every caller
    teasersLoad =
      teasersLoad ||
      fetch('api/teasers.json', { cache: LIVE ? 'no-store' : 'default' })
        .then(r => r.json())
        .finally(() => {
          teasersLoad = null;
        });
    try {
      teasers = await teasersLoad;
      teasersSig = sig;
    } catch (e) {
      console.warn('atlas teasers failed', e);
      return;
    }
  }
  for (const p of state.pins) if (teasers[p.id] != null) p.summary = teasers[p.id];
}
// On a desktop the legend is a collapsible box, closed on a first visit, whose state is remembered; on a phone it is a sheet
// from the bottom of the screen, opened by the Layers button and closed by its header, Escape or a touch on the globe.
const phoneLayout = () => innerWidth <= 760;
let collapsed = phoneLayout();
try {
  if (!phoneLayout()) collapsed = localStorage.getItem('atlas.legend.collapsed.desktop') !== '0'; // closed until opened once
} catch {}
function setLegend(c) {
  collapsed = c;
  $('#legend').classList.toggle('collapsed', c);
  $('#legend-toggle').setAttribute('aria-expanded', String(!c));
  $('#layers-btn').setAttribute('aria-expanded', String(!c));
  $('#masthead').classList.toggle('sheet-open', !c && phoneLayout());
  if (phoneLayout()) return;
  try {
    localStorage.setItem('atlas.legend.collapsed.desktop', c ? '1' : '0');
  } catch {}
}
$('#legend-toggle').onclick = () => {
  setLegend(!collapsed);
  if (collapsed && phoneLayout()) $('#layers-btn').focus({ preventScroll: true });
};
$('#layers-btn').onclick = () => {
  setLegend(!collapsed);
  if (!collapsed) $('#legend-toggle').focus({ preventScroll: true });
};
$('#globe').addEventListener('pointerdown', () => {
  if (!collapsed && phoneLayout()) setLegend(true);
});
addEventListener('keydown', e => {
  if (e.key === 'Escape' && !collapsed && phoneLayout()) {
    setLegend(true);
    $('#layers-btn').focus({ preventScroll: true });
  }
});
setLegend(collapsed);
// first-visit hint: fades on the first real interaction with the globe
const dismissHint = () => {
  $('#hint').classList.add('fade');
  setTimeout(() => show($('#hint'), false), 900);
};
for (const ev of ['pointerdown', 'wheel', 'touchstart']) $('#globe').addEventListener(ev, dismissHint, { once: true, passive: true });
setTimeout(dismissHint, 12000);
window.atlas = { openRecord, goTo, state, globe, startTour, startFilm, tourPlaying }; // handy for debugging from the console
buildChrome();
initCue();
setLevel(4);
// Live refresh only against the local server, where records are being published; the static site's data changes
// only with a new deploy, so it is fetched once (and can be cached).
export const LIVE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
export const dataReady = refresh();
if (LIVE) setInterval(refresh, 15000);
dataReady.then(() => {
  // a link to a place in the atlas opens there; a first visit with no link gets the welcome card
  if (location.hash.length > 1) return applyHash();
  resumeLast();
  setRestoring(false);
  let seen = false;
  try {
    seen = !!localStorage.getItem('atlas.welcomed');
  } catch {}
  if (!seen) openWelcome();
});
