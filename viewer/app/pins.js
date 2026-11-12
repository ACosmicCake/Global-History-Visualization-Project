// Pins: which records show (visiblePins, riding their plates in deep time), sprite sizes, labels and their placement
// each frame, and clustering of dense spots into one badge.
import { LEVELS, domainOn, inLevel, minImportance, paleoOn, rankOf, wholeNow, windowNow } from './time.js';
import { state } from './state.js';
import { CLOSE_AT, isMajor, pinTexture, standsOut } from './badges.js';
import { GLOBE_R, globe, hoverId, render } from './main.js';
const { THREE } = window; // the vendored libraries (classic scripts)

// in deep time a pin rides on its plate: today's find spot turned with the same rotation as the continents shown,
// else the record's own sourced paleo-position, else today's coordinates (past the plate model's reach)
export const placed = p => {
  if (!paleoOn() || p.lat == null) return p;
  const q = window.Space.platePos?.(p.lat, p.lon) || (p.paleo?.lat != null && { lat: p.paleo.lat, lon: p.paleo.lon });
  return q ? { ...p, lat: q.lat, lon: q.lon } : p;
};
window.addEventListener('paleo-ready', () => render());
export function visiblePins() {
  if (state.film) return []; // the film is about the Earth; the pins come back when it ends
  const win = windowNow(),
    mi = minImportance();
  // the open record always shows (with its route), whatever the time scale, filters or zoom thinning: a sequence can
  // move the time axis to a scale the record isn't classed at, and its pin must not vanish while it is being read
  return state.pins
    .filter(
      p =>
        p.lat != null &&
        (p.id === state.selected || (inLevel(p) && domainOn(p) && rankOf(p) >= mi && p.until >= win.from && p.start <= win.to)),
    )
    .map(placed);
}

// Sprite size in screen pixels. Importance sets how loud a pin is: large markers for 5s, medium for 4s, small dots for the rest, which become markers as the camera closes in. The camera height eases
// it (a little larger close in), and the hovered and selected pins grow. Sprites keep a constant pixel size, so pins stay crisp at every zoom.
export const PIN_SIZE = { 5: 38, 4: 26 },
  DOT_SIZE = { 3: 20, 2: 17, 1: 15 };
export function pinPx(p, alt, big) {
  const near = 1 - Math.min(1, Math.max(0, (Math.log(alt) - Math.log(0.08)) / (Math.log(3) - Math.log(0.08)))); // 0 far .. 1 close
  const stack = p.cluster && !isMajor(p),
    base = (stack ? 20 : big ? (PIN_SIZE[p.importance] ?? 24) : (DOT_SIZE[p.importance] ?? 15)) * (0.82 + 0.38 * near);
  return base * (p.id === state.selected ? 1.4 : p.id === hoverId ? 1.2 : 1);
}
// Labels: crisp screen-facing text beside the badge, with a dark halo for legibility on land and sea
export const LABEL_PX = 13,
  LABEL_RES = 3;
export const labelCache = new Map();
export function labelTexture(text) {
  // cached: pins are rebuilt on every data refresh and zoom tier
  if (!labelCache.has(text)) labelCache.set(text, drawLabel(text));
  return labelCache.get(text);
}
export function drawLabel(text) {
  const c = document.createElement('canvas'),
    g = c.getContext('2d'),
    font = `500 ${LABEL_PX * LABEL_RES}px Inter, "Segoe UI", system-ui, sans-serif`;
  g.font = font;
  const t = text.length > 34 ? text.slice(0, 32) + '…' : text,
    pad = 4 * LABEL_RES;
  c.width = Math.ceil(g.measureText(t).width) + pad * 2;
  c.height = Math.ceil(LABEL_PX * LABEL_RES * 1.5);
  g.font = font;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 4 * LABEL_RES;
  g.strokeStyle = 'rgba(6,9,16,0.78)';
  g.strokeText(t, pad, c.height / 2);
  g.fillStyle = 'rgba(240,243,248,0.96)';
  g.fillText(t, pad, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return { tex, w: c.width / LABEL_RES, h: c.height / LABEL_RES };
}
export const labelMin = () => {
  const a = state.alt;
  return a > 1.9 ? 5 : a >= CLOSE_AT[3] ? 4 : a >= CLOSE_AT[2] ? 3 : a >= CLOSE_AT[1] ? 2 : 1;
}; // 5s are always named, 4s when there's room, the rest as they come to stand out, or on hover

export const pinSprites = new Map(); // id -> { group, sprite, halo, label, p }
export const pinData = new Map(); // id -> the datum object handed to globe.gl (kept stable between renders)
export const _v = new THREE.Vector3();
export function placePinSprites() {
  // per frame: size, horizon fade, selection pulse, label collisions
  const cam = globe.camera(),
    el = globe.renderer().domElement,
    H = el.clientHeight || innerHeight,
    W = el.clientWidth || innerWidth;
  const p11 = cam.projectionMatrix.elements[5],
    camPos = cam.position,
    cd = camPos.length(),
    now = performance.now();
  const k = 2 / (H * p11),
    lm = labelMin(),
    wanted = [];
  const win = windowNow(),
    reach = LEVELS[state.level].key === 'event' || wholeNow() ? Infinity : (win.to - win.from) / 2;
  const seen = { shown: 0, facing: 0, x: 0, y: 0, z: 0, behind: new Map() };
  for (const entry of pinSprites.values()) {
    const { group, sprite, halo, label, p } = entry,
      pos = group.position,
      r = pos.length();
    if (!r) continue;
    const facing = pos.dot(camPos) / (r * cd); // cosine between the pin and the camera direction
    const horizon = GLOBE_R / cd; // below this the pin is behind the Earth's limb
    const vis = Math.min(1, Math.max(0, (facing - horizon) / 0.06));
    // where the shown records are, weighted by importance: for the cue toward history out of view, and for Follow
    const n = p.cluster ? p.cluster.length : 1,
      wt = n * (p.importance || 1) ** 2;
    seen.shown += n;
    seen.x += (pos.x / r) * wt;
    seen.y += (pos.y / r) * wt;
    seen.z += (pos.z / r) * wt;
    if (facing > horizon + 0.05) seen.facing += n;
    else for (const q of p.cluster || [p]) seen.behind.set(q.region, (seen.behind.get(q.region) || 0) + (q.importance || 1) ** 2);
    sprite.visible = vis > 0.01;
    // a record fades and shrinks with its distance from the date shown, so what happened then reads first
    const special = p.id === state.selected || p.id === hoverId;
    const far = special ? 0 : Math.min(1, Math.max(0, p.start - state.t, state.t - p.until) / reach);
    const big = special || standsOut(p, state.alt),
      tex = pinTexture(p, big);
    if (sprite.material.map !== tex) {
      sprite.material.map = tex;
      sprite.material.needsUpdate = true;
    }
    sprite.material.opacity = vis * (1 - 0.65 * far) * (big ? 1 : 0.88);
    const px = pinPx(p, state.alt, big) * (1 - 0.25 * far);
    sprite.scale.setScalar(px * k);
    if (halo) {
      const pulse = 1.9 + 0.35 * Math.sin(now / 380);
      halo.visible = sprite.visible;
      halo.material.opacity = 0.55 * vis;
      halo.scale.setScalar(px * pulse * k);
    }
    if (label) {
      label.visible = false;
      if (vis > 0.3 && (special || (p.importance >= lm && far < 0.6))) {
        _v.copy(pos).project(cam);
        const x = ((_v.x + 1) * W) / 2 + px / 2 + 2,
          y = ((1 - _v.y) * H) / 2;
        wanted.push({
          entry,
          vis,
          rank: (special ? 100 : 0) + p.importance + (p.outline ? 0 : 0.5) - 2 * far,
          box: [x, y - label.userData.h / 2, x + label.userData.w, y + label.userData.h / 2],
          px,
        });
      }
    }
  }
  // greedy placement: the most important names first, skipping any that would overlap one already placed
  wanted.sort((a, b) => b.rank - a.rank);
  const placed = [];
  window.DeepTime?.placeLabels(placed, state.alt, k, W, H, cam); // supercontinents and old oceans come first
  for (const w of wanted) {
    const [x0, y0, x1, y1] = w.box;
    if (placed.some(([a0, b0, a1, b1]) => x0 < a1 && x1 > a0 && y0 < b1 && y1 > b0)) continue;
    placed.push(w.box);
    const { label } = w.entry,
      { w: lw, h: lh } = label.userData;
    label.visible = true;
    label.material.opacity = w.vis;
    label.scale.set(lw * k, lh * k, 1);
    label.center.set(-(w.px / 2 + 2) / lw, 0.5); // anchor the text just right of the badge
  }
  window.Borders?.placeLabels(placed, state.alt, k, W, H, cam); // polity names take what space is left
  pinsSeen = seen;
}
// how many of the shown pins face the camera, the importance-weighted centre of them all, and the regions of those
// out of view; measured each frame by placePinSprites
export let pinsSeen = { shown: 0, facing: 0, x: 0, y: 0, z: 0, behind: new Map() };
// Dense spots become one count badge. The cell follows the camera height, about a badge's width on screen; the open
// record stays out of it. Up close only records at nearly the same place remain together, so a stack stays reachable.
export function clusterPins(pins) {
  const cell = Math.max(0.01, state.alt),
    cells = new Map();
  for (const p of pins) {
    if (p.id === state.selected) continue;
    const key = `${isMajor(p) ? 'major' : 'quiet'}:${Math.floor(p.lat / cell)}:${Math.floor(p.lon / cell)}`; // major records never disappear into a stack of quiet ones
    (cells.get(key) || cells.set(key, []).get(key)).push(p);
  }
  const out = pins.filter(p => p.id === state.selected);
  for (const [key, group] of cells) {
    if (group.length < (key.startsWith('major') || state.alt < 0.3 ? 2 : 3)) {
      out.push(...group);
      continue;
    }
    group.sort((a, b) => rankOf(b) - rankOf(a) || b.importance - a.importance);
    const top = group[0],
      lat = group.reduce((a, p) => a + p.lat, 0) / group.length,
      lon = group.reduce((a, p) => a + p.lon, 0) / group.length;
    out.push({
      id: `cluster:${key}`,
      cluster: group,
      lat,
      lon,
      importance: top.importance,
      domains: top.domains,
      outline: top.outline,
      title: `${top.title} +${group.length - 1}`,
      start: Math.min(...group.map(p => p.start)),
      end: Math.max(...group.map(p => p.end)),
      until: Math.max(...group.map(p => p.until)),
    });
  }
  return out;
}
