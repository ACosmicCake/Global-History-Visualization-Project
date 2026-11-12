// Orientation toward history out of view: when most of the records shown at the date are on the far side of the
// globe, a chip says where they are and turns the globe there. Follow, beside Play, keeps easing the globe toward the
// importance-weighted centre of what is shown; a drag stops it, and it is off under reduced motion.
import { REGION_LABELS } from '../shared/labels.mjs';
import { $, show } from './dom.js';
import { state } from './state.js';
import { pinsSeen } from './pins.js';
import { globe } from './main.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// the importance-weighted centre of the shown records, and the region most of those out of view belong to
function centre() {
  const { x, y, z } = pinsSeen,
    len = Math.hypot(x, y, z);
  if (!len) return null;
  const g = globe.toGeoCoords({ x: (x / len) * 100, y: (y / len) * 100, z: (z / len) * 100 });
  return { lat: g.lat, lng: g.lng };
}
function behindRegion() {
  let best = null,
    w = 0;
  for (const [r, n] of pinsSeen.behind) if (r && r !== 'global' && n > w) [best, w] = [r, n];
  return best;
}
const busy = () =>
  state.selected || !$('#seqbar').hidden || document.body.classList.contains('film') || $('#welcome').open || !$('#legend').matches('.collapsed') && innerWidth <= 760;
const cue = $('#cue');
let cueTo = null;
function checkCue() {
  const { shown, facing } = pinsSeen,
    region = behindRegion(),
    want = !busy() && !following && shown >= 5 && facing < shown / 4 && region;
  if (want) {
    const text = `Most of this is in ${REGION_LABELS[region] || region}`;
    if (cue.firstChild?.textContent !== text) cue.innerHTML = `<span>${text}</span><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 6h6M6.5 3L9.5 6l-3 3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
    cueTo = centre();
    show($('#hint'), false); // the first-visit hint gives way: they share the spot above the time bar
  }
  show(cue, !!want && !!cueTo);
}
cue.onclick = () => {
  if (!cueTo) return;
  globe.pointOfView({ ...cueTo, altitude: globe.pointOfView().altitude }, 1400);
  show(cue, false);
};

// Follow
let following = false,
  followTimer = 0;
const angle = (a, b) => {
  const r = Math.PI / 180,
    c = Math.sin(a.lat * r) * Math.sin(b.lat * r) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((a.lng - b.lng) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
};
function followStep() {
  if (!following || state.selected) return;
  const c = centre(),
    pov = globe.pointOfView();
  if (c && angle(c, pov) > 8) globe.pointOfView({ ...c, altitude: pov.altitude }, 2500);
}
export function setFollow(on) {
  following = on && !reduced.matches;
  for (const id of ['#follow', '#m-follow']) $(id).setAttribute('aria-pressed', following);
  clearInterval(followTimer);
  if (following) {
    followStep();
    followTimer = setInterval(followStep, 4000);
    show(cue, false);
  }
}
$('#follow').onclick = () => setFollow(!following);
$('#m-follow').onclick = () => setFollow(!following);
const motion = () => {
  for (const id of ['#follow', '#m-follow']) {
    $(id).disabled = reduced.matches;
    $(id).title = reduced.matches ? 'Off while your system asks for reduced motion' : 'Keep turning the globe toward what is shown';
  }
  if (reduced.matches) setFollow(false);
};
// called by main.js once the globe exists (this module is loaded before main.js runs)
export function initCue() {
  globe.controls().addEventListener('start', () => following && setFollow(false)); // the visitor took the globe
  reduced.addEventListener?.('change', motion);
  motion();
  setInterval(checkCue, 700);
}
