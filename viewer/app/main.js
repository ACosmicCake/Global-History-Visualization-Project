// Living Atlas viewer: a rotatable globe with a nested-scale time axis (spec section 2), pins filtered by
// time level and importance (spec 11.1), and routes for moving events.
// Data comes from api/pins.json: live from server.mjs locally, refreshed every 15 seconds; a static file, fetched once, on the published site.
// Libraries load as pinned UMD scripts in index.html: three@0.149.0, globe.gl@2.27.2.
import './webgl-check.js';   // first: stops here, with a message, where the globe can't run
import { $, esc, show } from './dom.js';
import { state } from './state.js';
import { EARTH, EONS, LEVELS, NOW, checkToday, domainOn, fmtSpan, fmtYear, inLevel, minImportance, paleoOn, range, rankOf, scaleIndex, wholeNow, windowNow } from './time.js';
const { THREE, Globe } = window;

// name, colour, glyph: each domain has its own colour and its own symbol, so pins read apart even where hues are close
const DOMAINS = {
  geology_climate: ['Geology & climate', '#6b8cff', 'mountain'], life_extinction: ['Life & extinction', '#4ade80', 'leaf'],
  human_evolution_migration: ['Human origins', '#fb923c', 'steps'], civilizations_empires: ['Civilizations', '#facc15', 'temple'],
  wars_conflict: ['War & conflict', '#ef4444', 'swords'], atrocity_injustice: ['Atrocity & injustice', '#c0266d', 'drop'],
  law_politics_rights: ['Law & rights', '#cbd5e1', 'scales'], people: ['People', '#f472b6', 'person'], science_technology: ['Science & tech', '#22d3ee', 'atom'],
  art_music_literature: ['Arts', '#a78bfa', 'note'], religion_philosophy: ['Religion & thought', '#fde68a', 'sun'], disease: ['Disease', '#a3e635', 'cross'],
  trade_exploration: ['Trade & exploration', '#2dd4bf', 'compass'], built_world: ['Built world', '#d6a77a', 'arch'],
};
const baseColor = p => (DOMAINS[p.domains?.[0]] || [0, '#ffffff'])[1];
// outlines (amendment A1) draw as faint, translucent pins so full records stand out
const colorOf = p => (p.outline ? baseColor(p) + '66' : baseColor(p));
const GLOBE_R = 100;


// in deep time a pin rides on its plate: today's find spot turned with the same rotation as the continents shown,
// else the record's own sourced paleo-position, else today's coordinates (past the plate model's reach)
const placed = p => {
  if (!paleoOn() || p.lat == null) return p;
  const q = window.Space.platePos?.(p.lat, p.lon) || (p.paleo?.lat != null && { lat: p.paleo.lat, lon: p.paleo.lon });
  return q ? { ...p, lat: q.lat, lon: q.lon } : p;
};
window.addEventListener('paleo-ready', () => render());
function visiblePins() {
  if (state.film) return [];   // the film is about the Earth; the pins come back when it ends
  const win = windowNow(), mi = minImportance();
  // the open record always shows (with its route), whatever the time scale, filters or zoom thinning: a sequence can
  // move the time axis to a scale the record isn't classed at, and its pin must not vanish while it is being read
  return state.pins.filter(p => p.lat != null && (p.id === state.selected || inLevel(p) && domainOn(p) && rankOf(p) >= mi
    && p.until >= win.from && p.start <= win.to)).map(placed);
}

// ---------- pin badges: a coloured disc with the domain's glyph, drawn once per domain on a canvas
function drawGlyph(g, kind, s) { // s = glyph box size; origin at the badge centre; dark ink on the coloured disc
  const L = (pts, close) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s))); if (close) g.closePath(); };
  g.lineWidth = s * 0.13; g.lineCap = g.lineJoin = 'round';
  switch (kind) {
    case 'mountain': L([[-0.5, 0.32], [-0.12, -0.3], [0.08, 0.02], [0.22, -0.14], [0.5, 0.32]], true); g.fill(); break;
    case 'leaf': g.beginPath(); g.ellipse(0, 0, s * 0.2, s * 0.42, Math.PI / 4, 0, 7); g.fill(); break;
    case 'steps': for (const [x, y] of [[-0.18, 0.2], [0.18, -0.16]]) { g.beginPath(); g.ellipse(x * s, y * s, s * 0.11, s * 0.19, 0, 0, 7); g.fill(); } break;
    case 'temple': L([[-0.46, -0.16], [0, -0.42], [0.46, -0.16]], true); g.fill(); g.fillRect(-0.46 * s, 0.28 * s, 0.92 * s, 0.12 * s);
      for (const x of [-0.33, 0, 0.33]) g.fillRect((x - 0.06) * s, -0.14 * s, 0.12 * s, 0.42 * s); break;
    case 'swords': L([[-0.36, -0.36], [0.36, 0.36]]); g.stroke(); L([[0.36, -0.36], [-0.36, 0.36]]); g.stroke(); break;
    case 'drop': L([[0, -0.44], [0.3, 0.06], [0, 0.42], [-0.3, 0.06]], true); g.fill(); break;
    case 'scales': L([[-0.4, -0.22], [0.4, -0.22]]); g.stroke(); L([[0, -0.4], [0, 0.36]]); g.stroke(); L([[-0.22, 0.36], [0.22, 0.36]]); g.stroke();
      for (const x of [-0.4, 0.4]) { L([[x - 0.16, 0.1], [x, -0.18], [x + 0.16, 0.1]], true); g.fill(); } break;
    case 'person': g.beginPath(); g.arc(0, -0.2 * s, s * 0.17, 0, 7); g.fill(); g.beginPath(); g.ellipse(0, 0.32 * s, s * 0.32, s * 0.22, 0, Math.PI, 0); g.fill(); break;
    case 'atom': g.lineWidth = s * 0.08; for (const a of [0, Math.PI / 3, -Math.PI / 3]) { g.beginPath(); g.ellipse(0, 0, s * 0.44, s * 0.16, a, 0, 7); g.stroke(); }
      g.beginPath(); g.arc(0, 0, s * 0.09, 0, 7); g.fill(); break;
    case 'note': g.beginPath(); g.ellipse(-0.1 * s, 0.26 * s, s * 0.17, s * 0.12, -0.4, 0, 7); g.fill(); L([[0.06, 0.24], [0.06, -0.42], [0.32, -0.28]]); g.stroke(); break;
    case 'sun': g.beginPath(); g.arc(0, 0, s * 0.18, 0, 7); g.fill(); g.lineWidth = s * 0.09;
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; L([[Math.cos(a) * 0.3, Math.sin(a) * 0.3], [Math.cos(a) * 0.44, Math.sin(a) * 0.44]]); g.stroke(); } break;
    case 'cross': g.fillRect(-0.12 * s, -0.4 * s, 0.24 * s, 0.8 * s); g.fillRect(-0.4 * s, -0.12 * s, 0.8 * s, 0.24 * s); break;
    case 'compass': L([[0, -0.46], [0.13, 0], [0, 0.46], [-0.13, 0]], true); g.fill(); L([[-0.46, 0], [0, -0.13], [0.46, 0], [0, 0.13]], true); g.fill(); break;
    case 'arch': g.beginPath(); g.moveTo(-0.38 * s, 0.38 * s); g.lineTo(-0.38 * s, -0.04 * s); g.arc(0, -0.04 * s, 0.38 * s, Math.PI, 0); g.lineTo(0.38 * s, 0.38 * s);
      g.lineTo(0.18 * s, 0.38 * s); g.lineTo(0.18 * s, -0.04 * s); g.arc(0, -0.04 * s, 0.18 * s, 0, Math.PI, true); g.lineTo(-0.18 * s, 0.38 * s); g.closePath(); g.fill(); break;
    default: g.beginPath(); g.arc(0, 0, s * 0.16, 0, 7); g.fill();
  }
}
const BADGE_PX = 96, GOLD = '#e3bd6e', badgeCache = new Map();
function badgeCanvas(domain, full) {
  const key = `${domain}|${full}`;
  if (badgeCache.has(key)) return badgeCache.get(key);
  const [, col, glyph] = DOMAINS[domain] || ['', '#e8edf4', ''];
  const c = document.createElement('canvas'); c.width = c.height = BADGE_PX;
  const g = c.getContext('2d'), m = BADGE_PX / 2, r = BADGE_PX * 0.34;
  g.translate(m, m);
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = BADGE_PX * 0.09; g.shadowOffsetY = BADGE_PX * 0.02;
  g.beginPath(); g.arc(0, 0, r, 0, 7); g.fillStyle = col; g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = full ? BADGE_PX * 0.07 : BADGE_PX * 0.025;             // full records wear a gold ring, outlines a fine pale one
  g.strokeStyle = full ? GOLD : 'rgba(255,255,255,0.5)'; g.stroke();
  g.fillStyle = g.strokeStyle = 'rgba(12,17,28,0.88)';
  drawGlyph(g, glyph, r * 1.15);
  badgeCache.set(key, c);
  return c;
}
const urlCache = new Map();
const badgeURL = (domain, full) => { const k = `${domain}|${full}`; if (!urlCache.has(k)) urlCache.set(k, badgeCanvas(domain, full).toDataURL()); return urlCache.get(k); };
const texCache = new Map();
function badgeTexture(domain, full) {
  const key = `${domain}|${full}`;
  if (!texCache.has(key)) { const t = new THREE.CanvasTexture(badgeCanvas(domain, full)); t.anisotropy = 4; texCache.set(key, t); }
  return texCache.get(key);
}
// A quiet record is a small dot, drawn small inside its sprite so the sprite stays an easy target for the pointer.
const DOT_R = BADGE_PX * 0.2, textureCache = new Map();
function cachedTexture(key, draw) {
  if (textureCache.has(key)) return textureCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = BADGE_PX;
  const g = c.getContext('2d'); g.translate(BADGE_PX / 2, BADGE_PX / 2); draw(g, c);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; textureCache.set(key, t);
  return t;
}
const dotTexture = (domain, full) => cachedTexture(`dot|${domain}|${full}`, g => {
  const col = (DOMAINS[domain] || ['', '#e8edf4'])[1];
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = BADGE_PX * 0.05;
  g.beginPath(); g.arc(0, 0, DOT_R, 0, 7); g.fillStyle = col; g.fill();
  g.shadowColor = 'transparent'; g.lineWidth = full ? BADGE_PX * 0.07 : BADGE_PX * 0.03; g.strokeStyle = full ? GOLD : 'rgba(8,12,20,0.75)'; g.stroke();
});
// several quiet records at one spot: a small dark dot with a gold ring, which opens a list
const stackTexture = () => cachedTexture('stack', g => {
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = BADGE_PX * 0.05;
  g.beginPath(); g.arc(0, 0, DOT_R * 1.05, 0, 7); g.fillStyle = '#10182a'; g.fill();
  g.shadowColor = 'transparent'; g.lineWidth = BADGE_PX * 0.065; g.strokeStyle = GOLD; g.stroke();
  g.beginPath(); g.arc(0, 0, DOT_R * 0.32, 0, 7); g.fillStyle = GOLD; g.fill();
});
// major records that share a spot: the most important one's marker, with a count beside it
const crowdTexture = (domain, full, n) => { const label = n > 99 ? '99+' : String(n); return cachedTexture(`crowd|${domain}|${full}|${label}`, g => {
  g.drawImage(badgeCanvas(domain, full), -BADGE_PX / 2, -BADGE_PX / 2);
  const x = BADGE_PX * 0.27, y = -BADGE_PX * 0.27, r = BADGE_PX * 0.17;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = '#10182a'; g.fill(); g.lineWidth = BADGE_PX * 0.025; g.strokeStyle = GOLD; g.stroke();
  g.fillStyle = '#f4e7c8'; g.font = `600 ${BADGE_PX * (label.length > 1 ? 0.15 : 0.2)}px "IBM Plex Sans", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x, y + BADGE_PX * 0.008);
}); };
// which records stand out at this height: 5s and 4s always; lesser ones as the camera closes in
const CLOSE_AT = { 3: 0.3, 2: 0.15, 1: 0.08 };
const isMajor = p => p.importance >= 4;
const standsOut = (p, alt) => isMajor(p) || alt < (CLOSE_AT[p.importance] ?? CLOSE_AT[1]);
const pinTexture = (p, big) => (p.cluster ? (isMajor(p) ? crowdTexture(p.domains?.[0], !p.outline, p.cluster.length) : stackTexture()) : big ? badgeTexture(p.domains?.[0], !p.outline) : dotTexture(p.domains?.[0], !p.outline));
const haloTexture = (() => { // soft pulsing ring behind the selected pin
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); g.translate(64, 64);
  g.beginPath(); g.arc(0, 0, 52, 0, 7); g.lineWidth = 6; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.stroke();
  g.beginPath(); g.arc(0, 0, 40, 0, 7); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fill();
  return new THREE.CanvasTexture(c);
})();

// Sprite size in screen pixels. Importance sets how loud a pin is: large markers for 5s, medium for 4s, small dots for the rest, which become markers as the camera closes in. The camera height eases
// it (a little larger close in), and the hovered and selected pins grow. Sprites keep a constant pixel size, so pins stay crisp at every zoom.
let hoverId = null;
const PIN_SIZE = { 5: 38, 4: 26 }, DOT_SIZE = { 3: 20, 2: 17, 1: 15 };
function pinPx(p, alt, big) {
  const near = 1 - Math.min(1, Math.max(0, (Math.log(alt) - Math.log(0.08)) / (Math.log(3) - Math.log(0.08)))); // 0 far .. 1 close
  const stack = p.cluster && !isMajor(p), base = (stack ? 20 : big ? PIN_SIZE[p.importance] ?? 24 : DOT_SIZE[p.importance] ?? 15) * (0.82 + 0.38 * near);
  return base * (p.id === state.selected ? 1.4 : p.id === hoverId ? 1.2 : 1);
}
// Labels: crisp screen-facing text beside the badge, with a dark halo for legibility on land and sea
const LABEL_PX = 13, LABEL_RES = 3;
const labelCache = new Map();
function labelTexture(text) { // cached: pins are rebuilt on every data refresh and zoom tier
  if (!labelCache.has(text)) labelCache.set(text, drawLabel(text));
  return labelCache.get(text);
}
function drawLabel(text) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), font = `500 ${LABEL_PX * LABEL_RES}px Inter, "Segoe UI", system-ui, sans-serif`;
  g.font = font;
  const t = text.length > 34 ? text.slice(0, 32) + '…' : text, pad = 4 * LABEL_RES;
  c.width = Math.ceil(g.measureText(t).width) + pad * 2; c.height = Math.ceil(LABEL_PX * LABEL_RES * 1.5);
  g.font = font; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 4 * LABEL_RES; g.strokeStyle = 'rgba(6,9,16,0.78)'; g.strokeText(t, pad, c.height / 2);
  g.fillStyle = 'rgba(240,243,248,0.96)'; g.fillText(t, pad, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 4;
  return { tex, w: c.width / LABEL_RES, h: c.height / LABEL_RES };
}
const labelMin = () => { const a = state.alt; return a > 1.9 ? 5 : a >= CLOSE_AT[3] ? 4 : a >= CLOSE_AT[2] ? 3 : a >= CLOSE_AT[1] ? 2 : 1; };   // 5s are always named, 4s when there's room, the rest as they come to stand out, or on hover

const pinSprites = new Map(); // id -> { group, sprite, halo, label, p }
const pinData = new Map();    // id -> the datum object handed to globe.gl (kept stable between renders)
const _v = new THREE.Vector3();
function placePinSprites() { // per frame: size, horizon fade, selection pulse, label collisions
  const cam = globe.camera(), el = globe.renderer().domElement, H = el.clientHeight || innerHeight, W = el.clientWidth || innerWidth;
  const p11 = cam.projectionMatrix.elements[5], camPos = cam.position, cd = camPos.length(), now = performance.now();
  const k = 2 / (H * p11), lm = labelMin(), wanted = [];
  const win = windowNow(), reach = LEVELS[state.level].key === 'event' || wholeNow() ? Infinity : (win.to - win.from) / 2;
  for (const entry of pinSprites.values()) {
    const { group, sprite, halo, label, p } = entry, pos = group.position, r = pos.length();
    if (!r) continue;
    const facing = pos.dot(camPos) / (r * cd);                  // cosine between the pin and the camera direction
    const horizon = GLOBE_R / cd;                               // below this the pin is behind the Earth's limb
    const vis = Math.min(1, Math.max(0, (facing - horizon) / 0.06));
    sprite.visible = vis > 0.01;
    // a record fades and shrinks with its distance from the date shown, so what happened then reads first
    const special = p.id === state.selected || p.id === hoverId;
    const far = special ? 0 : Math.min(1, Math.max(0, p.start - state.t, state.t - p.until) / reach);
    const big = special || standsOut(p, state.alt), tex = pinTexture(p, big);
    if (sprite.material.map !== tex) { sprite.material.map = tex; sprite.material.needsUpdate = true; }
    sprite.material.opacity = vis * (1 - 0.65 * far) * (big ? 1 : 0.88);
    const px = pinPx(p, state.alt, big) * (1 - 0.25 * far);
    sprite.scale.setScalar(px * k);
    if (halo) {
      const pulse = 1.9 + 0.35 * Math.sin(now / 380);
      halo.visible = sprite.visible; halo.material.opacity = 0.55 * vis;
      halo.scale.setScalar(px * pulse * k);
    }
    if (label) {
      label.visible = false;
      if (vis > 0.3 && (special || p.importance >= lm && far < 0.6)) {
        _v.copy(pos).project(cam);
        const x = (_v.x + 1) * W / 2 + px / 2 + 2, y = (1 - _v.y) * H / 2;
        wanted.push({ entry, vis, rank: (special ? 100 : 0) + p.importance + (p.outline ? 0 : 0.5) - 2 * far, box: [x, y - label.userData.h / 2, x + label.userData.w, y + label.userData.h / 2], px });
      }
    }
  }
  // greedy placement: the most important names first, skipping any that would overlap one already placed
  wanted.sort((a, b) => b.rank - a.rank);
  const placed = [];
  window.DeepTime?.placeLabels(placed, state.alt, k, W, H, cam);    // supercontinents and old oceans come first
  for (const w of wanted) {
    const [x0, y0, x1, y1] = w.box;
    if (placed.some(([a0, b0, a1, b1]) => x0 < a1 && x1 > a0 && y0 < b1 && y1 > b0)) continue;
    placed.push(w.box);
    const { label } = w.entry, { w: lw, h: lh } = label.userData;
    label.visible = true; label.material.opacity = w.vis;
    label.scale.set(lw * k, lh * k, 1);
    label.center.set(-(w.px / 2 + 2) / lw, 0.5);              // anchor the text just right of the badge
  }
  window.Borders?.placeLabels(placed, state.alt, k, W, H, cam);   // polity names take what space is left
}

// ---------- globe
const zoomK = () => Math.min(1, Math.max(0.0015, state.alt / 1.8)); // pins and labels shrink as the camera comes in, down to street scale
const tip = p => (p.cluster
  ? `<div class="tip"><span class="d">${p.cluster.length} records here</span>${p.cluster.slice(0, 6).map(x => `<p>${esc(x.title)}</p>`).join('')}${p.cluster.length > 6 ? '<p>…</p>' : ''}</div>`
  : `<div class="tip"><span class="d">${esc(p.display)}${p.outline ? '' : ' · full story'}${p.unc >= 100 ? ` · place within about ${Math.round(p.unc).toLocaleString()} km` : ''}</span><b>${esc(p.title)}</b>${p.summary ? `<p>${esc(p.summary)}</p>` : ''}</div>`);
// High-density screens (2x, 3x) would render 4–9 times the pixels for little visible gain on a moving globe: cap the
// drawing resolution at 1.5x (and antialias only at 1x, where it is needed and cheap)
const PR = Math.min(window.devicePixelRatio || 1, 1.5);
const globe = Globe({ animateIn: true, rendererConfig: { antialias: PR < 1.25, alpha: true, powerPreference: 'high-performance' } })($('#globe'))
  .backgroundColor('rgba(0,0,0,0)')
  .showGraticules(false).showAtmosphere(false)
  .pointsTransitionDuration(0).pathTransitionDuration(0).labelsTransitionDuration(0)
  .customThreeObject(p => { // pins are screen-sized badge sprites (see placePinSprites)
    const mat = new THREE.SpriteMaterial({ map: pinTexture(p, standsOut(p, state.alt)), transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    const group = new THREE.Group(), sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 10 + p.importance; sprite.visible = false; group.add(sprite); // shown by placePinSprites once sized
    sprite.raycast = function (r, hits) { if (this.visible) THREE.Sprite.prototype.raycast.call(this, r, hits); }; // no clicks on hidden pins
    const lt = labelTexture(p.title || '');
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    label.userData = { w: lt.w, h: lt.h }; label.renderOrder = 20; label.visible = false; label.raycast = () => {}; group.add(label);
    pinSprites.set(p.id, { group, sprite, halo: null, label, p });
    return group;
  })
  .customThreeObjectUpdate((obj, p) => { // runs for every pin on each render: move it, and add or drop the selection halo
    Object.assign(obj.position, globe.getCoords(p.lat, p.lon, 0.004 + p.importance * 0.0012));   // the most important pin wins the pointer where pins overlap
    const e = pinSprites.get(p.id);
    if (!e) return;
    e.p = p;
    const lt = labelTexture(p.title || '');
    if (e.label.material.map !== lt.tex) { e.label.material.map = lt.tex; e.label.userData = { w: lt.w, h: lt.h }; e.label.material.needsUpdate = true; }
    if (p.id === state.selected && !e.halo) {
      e.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color: baseColor(p), transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
      e.halo.renderOrder = 9; e.halo.visible = false; e.halo.raycast = () => {}; obj.add(e.halo);
    } else if (p.id !== state.selected && e.halo) { obj.remove(e.halo); e.halo.material.dispose(); e.halo = null; }
  })
  .customLayerLabel(tip).onCustomLayerClick(p => (p.cluster ? openCluster(p) : openRecord(p.id)))
  .onCustomLayerHover(p => { $('#globe').style.cursor = p ? 'pointer' : ''; hoverId = p?.id ?? null; fetchSoon(p && !p.cluster ? p.id : null); })
  .labelLat('lat').labelLng('lon').labelText('title').labelSize(() => 0.5 * zoomK()).labelDotRadius(0)
  .labelColor(() => 'rgba(233,237,244,0.82)').labelAltitude(0.03).labelResolution(2).labelLabel(tip).onLabelClick(p => openRecord(p.id))
  .pathPoints('pts').pathPointLat(p => p.lat).pathPointLng(p => p.lon)
  .pathColor(p => (p.ring ? p.color : [p.color, 'rgba(255,255,255,0.15)'])).pathStroke(p => (p.ring ? 0.7 : p.wall ? 2.2 : p.dated ? 1.8 : 1.1))
  .pathDashLength(p => (p.wall || p.ring ? 1 : 0.04)).pathDashGap(p => (p.wall || p.ring ? 0 : 0.02)).pathDashAnimateTime(p => (p.wall || p.ring ? 0 : 9000))
  .arcStartLat('a').arcStartLng('b').arcEndLat('c').arcEndLng('d').arcColor('color').arcStroke(0.45).arcAltitudeAutoScale(0.3).arcDashLength(0.35).arcDashGap(0.12).arcDashAnimateTime(2600).arcsTransitionDuration(0)
  .arcLabel(a => `<div class="tip"><span class="d">${esc(a.label)}</span><b>${esc(a.title)}</b>${a.because ? `<p>${esc(a.because)}</p>` : ''}</div>`).onArcClick(a => goTo(a.id));
window.Space.init(globe); // satellite Earth, clouds, stars, Sun and Moon (space.js)
window.Fossils.init(globe, () => { fossilCountMa = null; render(); });
window.Coastlines.init(globe);
window.Borders?.init(globe); // dated polity borders (borders.js)
// deep-time visuals: scenes for records, names on the moving continents, marks on the time bar, the film (deeptime.json)
let deepTime = null, marksKey = '';
fetch('deeptime.json').then(r => r.json()).then(d => { deepTime = d; window.DeepTime?.init(globe, d.labels); render(); }).catch(err => console.error('deeptime', err));
// spacecraft in the sky (spacecraft.js): clicking one opens its record once that record is published
window.Spacecraft?.init(globe, { onPick: id => openRecord(id), known: id => state.pins.some(p => p.id === id) });
globe.pointOfView({ lat: 28, lng: 25, altitude: state.alt });
globe.controls().autoRotate = false;

// Smooth zoom and drag: the stock wheel zoom jumps one step per notch, so we take over the wheel and ease the
// camera altitude toward a target in log space every frame; rotation gets inertia from the controls' damping.
globe.renderer().setPixelRatio(PR);
const controls = globe.controls();
controls.enableZoom = false;
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = 0.55;
const ALT_MIN = 0.04, ALT_MAX = 6;
const camAlt = () => globe.camera().position.length() / GLOBE_R - 1;
let zoomTarget = null;
$('#globe').addEventListener('wheel', e => {
  e.preventDefault();
  const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY; // lines/pages -> pixels
  const from = zoomTarget ?? camAlt();
  zoomTarget = Math.min(ALT_MAX, Math.max(ALT_MIN, from * Math.exp(Math.max(-200, Math.min(200, step)) * 0.0022)));
}, { passive: false });
let pinch = null; // two-finger pinch feeds the same eased zoom
$('#globe').addEventListener('touchstart', e => {
  if (e.touches.length === 2) pinch = { d: Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY), alt: globe.pointOfView().altitude };
}, { passive: true });
$('#globe').addEventListener('touchmove', e => {
  if (!pinch || e.touches.length !== 2) return;
  const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  zoomTarget = Math.min(ALT_MAX, Math.max(ALT_MIN, pinch.alt * (pinch.d / d)));
}, { passive: true });
$('#globe').addEventListener('touchend', () => { pinch = null; }, { passive: true });

// Per frame: ease the camera distance in log space (frame-rate independent).
// Rebuilding pins and labels is expensive, so that waits until the camera settles and the detail tier changes.
let lastFrame = performance.now(), settleTimer = null, tierKey = '';
const tier = () => `${minImportance()}|${Math.round(Math.log2(zoomK()) * 3)}`;
// ---------- planet-wide records: no single place, so no pin. A faint ring at the globe's edge says "something
// planet-wide is happening now", and one small pill in the left column names how many; clicking it opens a short list.
let planetList = [], planetOpen = false, planetKey = '';
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
      planetOpen = !planetOpen; renderPlanet(planetList);
    };
    $('#planet').querySelectorAll('button[data-id]').forEach(b => { b.onclick = () => { planetOpen = false; openRecord(b.dataset.id); }; });
  }
  show($('#planet'), on); show($('#planet-ring'), on);
  placePlanetOrbit();
}
addEventListener('pointerdown', e => { if (planetOpen && !e.target.closest('#planet')) { planetOpen = false; renderPlanet(planetList); } });
addEventListener('keydown', e => { if (e.key === 'Escape' && planetOpen) { planetOpen = false; renderPlanet(planetList); } });
const _o = new THREE.Vector3();
function placePlanetOrbit() { // per frame: the ring on the globe's edge (cheap: one style write)
  const box = $('#planet');
  if (box.hidden) return;
  const cam = globe.camera(), el = globe.renderer().domElement, W = el.clientWidth || innerWidth, H = el.clientHeight || innerHeight;
  _o.set(0, 0, 0).project(cam);
  const cx = (_o.x + 1) * W / 2, cy = (1 - _o.y) * H / 2, d = cam.position.length();
  const r = Math.tan(Math.asin(Math.min(0.999, GLOBE_R / d))) / Math.tan((cam.fov * Math.PI / 180) / 2) * H / 2; // the globe's radius in px
  const ring = $('#planet-ring'), fits = r * 2 < Math.min(W, H) * 1.05;
  ring.hidden = !fits;
  if (fits) ring.style.cssText = `left:${cx - r - 3}px;top:${cy - r - 3}px;width:${r * 2 + 6}px;height:${r * 2 + 6}px`;
}

(function zoomFrame(now) {
  const dt = Math.min(64, (now ?? performance.now()) - lastFrame); lastFrame = now ?? performance.now();
  if (zoomTarget != null) {
    const cam = globe.camera(), cur = camAlt();
    const ease = 1 - Math.pow(1 - 0.24, dt / 16.7);
    let next = Math.exp(Math.log(cur) + (Math.log(zoomTarget) - Math.log(cur)) * ease);
    if (Math.abs(Math.log(next / zoomTarget)) < 0.001) { next = zoomTarget; zoomTarget = null; }
    cam.position.setLength(GLOBE_R * (1 + next));
    controls.rotateSpeed = 0.55 * Math.min(1, Math.max(0.06, next / 2)); // calmer dragging close in
    cameraMoved(next);
  }
  placePinSprites(); placePlanetOrbit();
  requestAnimationFrame(zoomFrame);
})();
let skyAlt = 0;
function cameraMoved(alt) {
  state.alt = alt;
  // the sky depends only on height, so a pan (or a sequence following a route) skips that work
  if (Math.abs(Math.log(alt / (skyAlt || alt * 2))) > 0.01) { skyAlt = alt; updateSky(); }
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { const t = tier(); if (t !== tierKey) { tierKey = t; render(); } }, 160);
}
controls.addEventListener('change', () => cameraMoved(camAlt())); // drags
setInterval(() => { const a = camAlt(); if (Math.abs(a - state.alt) / state.alt > 0.05) cameraMoved(a); }, 250); // tweened fly-tos
addEventListener('resize', () => { globe.width(innerWidth).height(innerHeight); drawDensity(); });
// Sea level through the ice ages (Spratt and Lisiecki 2016, thousand-year steps back to 798,000 years ago), how far below
// today's it stood at the date shown. Fetched the first time the date is old enough to need it. Small values near the
// present are within the study's margin, so nothing is drawn for them.
let seaCurve = null, seaLoading = false;
// The African Humid Period, when the Sahara held lakes, animals and people: about 11,000 to 5,000 years ago, ending within a few centuries
const humidAt = bp => Math.min(1, Math.max(0, (11500 - bp) / 500)) * Math.min(1, Math.max(0, (bp - 4700) / 300));
function seaDropAt(t) {
  const ka = (1950 - t) / 1000;
  if (ka < 8 || ka > 798) return 0;
  if (!seaCurve) {
    if (!seaLoading) { seaLoading = true; fetch('paleo/sealevel.json').then(r => r.json()).then(d => { seaCurve = d.curve; render(); }).catch(() => { seaLoading = false; }); }
    return 0;
  }
  const i = Math.min(seaCurve.length - 2, Math.floor(ka)), [a, ma] = seaCurve[i], [b, mb] = seaCurve[i + 1];
  const drop = -(ma + (mb - ma) * (ka - a) / (b - a));
  return drop >= 5 ? drop : 0;
}
// Earth's vital signs (paleo/vitals.json, built by atlas/tools/build-vitals.mjs): each curve runs from today back as far as there are estimates.
// Reconstructed values carry a ≈ and are rounded to what they can bear; older than a curve's oldest estimate shows a dash, not a guess.
let vitals = null;
const VITAL_MIN_SPAN = { temp: 1, co2: 30, sea: 5, day: 0.2, moon: 2000, life: 100 };   // the curve on the time bar won't stretch less than this to fill its height, so a flat stretch stays flat
fetch('paleo/vitals.json').then(r => r.json()).then(d => {
  vitals = d;
  $('#v-rows').innerHTML = Object.entries(d.series).map(([k, s]) => `<button class="v-row" data-k="${k}" title="${esc(s.source)}"><span>${esc(s.label).replace(/ (.+)/, '<i> $1</i>')}</span><b></b></button>`).join('');
  $('#v-rows').querySelectorAll('button').forEach(b => { b.onclick = () => { state.vitalCurve = b.dataset.k; showVitalSource(); drawDensity(); }; });
  showVitalSource(); render();
}).catch(err => console.error('vitals', err));
// the time console's height depends on how its controls wrap, so the panel measures it rather than assuming
new ResizeObserver(() => document.documentElement.style.setProperty('--time-top', `${Math.round(document.documentElement.clientHeight - $('#time').getBoundingClientRect().top)}px`)).observe($('#time'));
function showVitalSource() {
  $('#v-rows').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.k === state.vitalCurve));
  $('#v-source').textContent = `${vitals.series[state.vitalCurve].source} ${vitals.note}`;
}
function vitalAt(s, ma) {
  const p = s.points;
  if (ma > p[p.length - 1][0]) return null;
  if (ma <= p[0][0]) return p[0][1];
  let a = 0, b = p.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (p[m][0] <= ma) a = m; else b = m; }
  return p[a][1] + (p[b][1] - p[a][1]) * (ma - p[a][0]) / (p[b][0] - p[a][0]);
}
// the number alone, rounded for how well it is known at that age
function vitalNumber(k, v, ma) {
  if (k === 'temp') return `${ma <= 1e-4 ? v.toFixed(1) : Math.round(v)}°C`;
  if (k === 'co2') return `${(ma <= 9e-6 ? Math.round(v) : ma <= 0.81 ? Math.round(v / 5) * 5 : Math.round(v / 50) * 50).toLocaleString()} ppm`;
  if (k === 'sea') { const m = ma <= 0.81 ? Math.round(v) : Math.round(v / 5) * 5; return `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} m`; }
  if (k === 'day') return `${v.toFixed(1)} h`;
  if (k === 'life') return (Math.round(v / 10) * 10).toLocaleString();
  return `${(Math.round(v / 1000) * 1000).toLocaleString()} km`;
}
const vitalMeasured = (k, ma) => (k === 'temp' ? ma <= 1e-4 : k === 'co2' ? ma <= 9e-6 : ma <= 1e-4);
const vitalText = (k, v, ma) => (v == null ? '—' : `${vitalMeasured(k, ma) ? '' : '≈ '}${vitalNumber(k, v, ma)}`);
// the fossil groups, with how many finds of each are known from rocks of this age; a click hides or shows a group
let fossilCountMa = null;
function renderFossilKey() {
  const groups = window.Fossils.groups, ma = -state.t / 1e6, on = !!(state.fossils && groups && state.paleoMa != null && ma <= 600), box = $('#v-fossils');
  show(box, on);
  if (!on) return false;
  const chips = $('#v-chips');
  if (!chips.children.length) {
    chips.innerHTML = groups.map((g, i) => `<button class="f-chip" data-i="${i}" aria-pressed="true" style="color:${window.Fossils.COLORS[i]}" title="Show or hide ${esc(g)}"><i></i><span>${esc(g)}</span><b></b></button>`).join('');
    chips.querySelectorAll('button').forEach(b => { b.onclick = () => { const i = +b.dataset.i, now = !window.Fossils.isOn(i); window.Fossils.setGroup(i, now); b.setAttribute('aria-pressed', now); }; });
  }
  if (fossilCountMa == null || Math.abs(fossilCountMa - ma) >= 0.25) {
    fossilCountMa = ma;
    window.Fossils.counts(ma).forEach((n, i) => { const b = chips.children[i], text = n ? n.toLocaleString() : '—'; if (b.lastElementChild.textContent !== text) { b.lastElementChild.textContent = text; b.classList.toggle('none', !n); } });
  }
  return true;
}
function renderVitals() {
  const key = renderFossilKey();
  show($('#vitals'), (!!vitals && state.vitals) || key);
  $('#vitals').classList.toggle('only-key', !state.vitals);
  if (!vitals || !state.vitals) return;
  const ma = (1950 - state.t) / 1e6;
  for (const b of $('#v-rows').children) { const k = b.dataset.k, text = vitalText(k, vitalAt(vitals.series[k], ma), ma), el = b.lastElementChild; if (el.textContent !== text) el.textContent = text; }
}
// the chosen sign along the time bar, scaled to what it does on this scale; the panel says what that range is
function drawVitalCurve(g, w, h, from, to) {
  const k = state.vitalCurve, s = state.vitals && vitals?.series[k];
  if (!s) return;
  const n = Math.max(2, Math.ceil(w / 2)), ys = Array.from({ length: n }, (_, i) => vitalAt(s, (1950 - (from + (to - from) * i / (n - 1))) / 1e6)), known = ys.filter(v => v != null);
  const say = text => { const r = $('#v-range'); if (r.textContent !== text) r.textContent = text; };
  if (!known.length) { say(`${s.label}: no estimate this far back.`); return; }
  const lo = Math.min(...known), hi = Math.max(...known), pad = Math.max(0, VITAL_MIN_SPAN[k] - (hi - lo)) / 2, y0 = lo - pad, span = hi + pad - y0, Y = v => h - 3 - ((v - y0) / span) * (h - 6);
  const age = Math.max(0, (1950 - from) / 1e6);
  say(`On the time bar: ${s.label}, ${vitalNumber(k, lo, age)} to ${vitalNumber(k, hi, age)} at this scale`);
  g.beginPath();
  let pen = false;
  ys.forEach((v, i) => { if (v == null) { pen = false; return; } const x = (i / (n - 1)) * w; if (pen) g.lineTo(x, Y(v)); else g.moveTo(x, Y(v)); pen = true; });
  g.strokeStyle = 'rgba(150,215,240,.9)'; g.lineWidth = 1.25; g.lineJoin = 'round'; g.stroke();
}
// Sky: the Moon sits where it really was at the selected moment. The Sun lights the side being explored, or with Real sunlight on it stands where it does right now, at this time of day and year, which is
// the real sky at today's date and a fair one at any other: most scales show a year, with no day or hour to place it by. On the One year scale, which does show a day, the season follows that day and the
// time of day stays the clock's, so scrubbing changes the season rather than spinning the Earth under the Sun. City lights are modern (c. 2012), so they appear only from 1900 on.
function yearToDate(y) {
  if (!(y > -270000 && y < 270000)) return new Date();
  const d = new Date(Date.UTC(2000, 0, 1)); d.setUTCFullYear(Math.floor(y));
  return new Date(d.getTime() + (y - Math.floor(y)) * 365.2425 * 864e5);
}
function sunMoment() {
  const now = new Date();
  if (LEVELS[state.level].key !== 'event' || state.t <= -4000) return now;
  const d = yearToDate(state.t); d.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), 0, 0);
  return d;
}
function updateSky() {
  const present = state.t >= NOW - 1, cloudBtn = $('#clouds');   // the cloud image is today's weather, so it shows only in the present day
  if (cloudBtn.disabled === present) { cloudBtn.disabled = !present; cloudBtn.title = present ? 'Clouds from a recent satellite image' : 'Clouds show only in the present day'; }
  window.Space.update({ date: state.t > -4000 ? yearToDate(state.t) : new Date(), sunDate: sunMoment(), sunMode: state.realSun ? 'real' : 'camera',
    nightLights: state.t >= 1900, clouds: state.clouds && present, zoomAlt: state.alt });
  window.Space.showPlateEdges(state.plateEdges);
  state.paleoMa = window.Space.setPaleo(state.t < -2e6 ? -state.t / 1e6 : null);
  const lifeMa = state.t < -2e6 && -state.t / 1e6 <= 560 ? -state.t / 1e6 : null, coastBtn = $('#coastlines');   // the Life period, easing out just past it
  if (coastBtn.disabled === (lifeMa != null)) { coastBtn.disabled = lifeMa == null; coastBtn.title = lifeMa != null ? 'Today’s coastlines, carried back with the plates, to show where today’s continents were' : 'Today’s coastlines show on the moving plates in the Life period, the last 540 million years'; }
  window.Coastlines.update(state.coastlines && !state.film ? lifeMa : null);
  state.seaDrop = seaDropAt(state.t);
  const bp = 1950 - state.t;
  window.Space.setSeaDrop(state.seaDrop * Math.min(1, Math.max(0, (bp - 8000) / 1000)));   // the shelves flood gradually, not at a stroke, as the curve ends
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
  const next = w.find(x => x.year > state.t), last = pts[pts.length - 1];
  if (last && next) { const f = (state.t - last.year) / (next.year - last.year); pts.push({ lat: last.lat + (next.lat - last.lat) * f, lon: last.lon + (next.lon - last.lon) * f }); }
  return pts;
}
// Deep time between records: rather than "nothing recorded", the geological period in view with a one-line general
// picture of it, plainly marked as background (not a sourced atlas record), and the nearest records either side.
// Period boundaries in millions of years, from the International Chronostratigraphic Chart (ICS, v2024/12).
const PERIODS = [
  [4567, 4031, 'Hadean', 'The young Earth forms and is hit by a Mars-sized body, making the Moon. A molten surface cools to a first crust; the oldest surviving mineral grains date from late in this eon.'],
  [4031, 3600, 'Eoarchean', 'The oldest rocks that survive form. Oceans already cover most of the planet, and the first life may already be in them.'],
  [3600, 3200, 'Paleoarchean', 'Microbial mats build stromatolites in shallow seas, among the oldest widely accepted signs of life. The air holds almost no oxygen.'],
  [3200, 2800, 'Mesoarchean', 'Small continents grow from volcanic island arcs. Some microbes may already be making oxygen by photosynthesis.'],
  [2800, 2500, 'Neoarchean', 'Continental crust grows quickly and the first large stable cores of continents form. Oxygen is made, but used up as fast as it appears.'],
  [2500, 2300, 'Siderian', 'Banded iron formations are laid down as oxygen from microbes rusts the iron dissolved in the oceans.'],
  [2300, 2050, 'Rhyacian', 'The Great Oxidation Event: oxygen builds up in the air for the first time, and long glaciations follow as greenhouse methane falls.'],
  [2050, 1800, 'Orosirian', 'Mountain building assembles an early supercontinent, often called Columbia or Nuna. Two of Earth’s largest known impact craters, Vredefort and Sudbury, form.'],
  [1800, 1600, 'Statherian', 'Continents stabilise. Cells with a nucleus (eukaryotes) are known from fossils of about this age.'],
  [1600, 1400, 'Calymmian', 'Platform sediments spread over stable continents; the long, quiet "boring billion" is under way.'],
  [1400, 1200, 'Ectasian', 'Sea life is still mostly single-celled; the first red algae, early multicellular life, appear around this time.'],
  [1200, 1000, 'Stenian', 'Grenville mountain building welds continents into the supercontinent Rodinia.'],
  [1000, 720, 'Tonian', 'Rodinia is complete and begins to break apart. Oxygen begins to rise again, and simple animals may have appeared.'],
  [720, 635, 'Cryogenian', '"Snowball Earth": ice spreads from the poles to the tropics, at least twice, and the oceans are largely frozen over.'],
  [635, 538.8, 'Ediacaran', 'After the ice, the first large complex organisms, the soft-bodied Ediacaran biota, live on the sea floor.'],
  [538.8, 486.85, 'Cambrian', 'The Cambrian explosion: most major animal groups appear in the seas, many with shells and eyes. The land is still bare.'],
  [486.85, 443.1, 'Ordovician', 'Sea life diversifies greatly, the first plants reach land, and the period ends in an ice age and a mass extinction.'],
  [443.1, 419.62, 'Silurian', 'Reefs recover and jawed fish spread. Small vascular plants and the first land animals, arthropods, colonise the shores.'],
  [419.62, 358.86, 'Devonian', 'The Age of Fishes. The first forests grow, and the first four-limbed vertebrates crawl from the water.'],
  [358.86, 298.9, 'Carboniferous', 'Vast swamp forests lay down today’s coal. Oxygen is high, insects grow huge, and the first reptiles appear.'],
  [298.9, 251.9, 'Permian', 'The supercontinent Pangaea is assembled, with a dry interior. The period ends in the largest mass extinction in Earth’s history.'],
  [251.9, 201.4, 'Triassic', 'Life recovers on Pangaea; the first dinosaurs and mammals appear, and another mass extinction ends the period.'],
  [201.4, 143.1, 'Jurassic', 'Pangaea splits and the Atlantic begins to open. Dinosaurs dominate the land; the first birds appear.'],
  [143.1, 66, 'Cretaceous', 'Flowering plants spread, and the continents near their modern shapes. An asteroid impact ends the reign of the non-avian dinosaurs.'],
  [66, 23.04, 'Paleogene', 'Mammals and birds diversify into the empty niches. A hot climate gives way to cooling, and Antarctica freezes over.'],
  [23.04, 2.58, 'Neogene', 'Grasslands spread, the climate keeps cooling, and the first hominins appear in Africa.'],
  [2.58, 0.0117, 'Pleistocene', 'Ice ages come and go. Several kinds of humans live side by side, and modern humans spread from Africa across the world.'],
];
const periodAt = ma => PERIODS.find(([a, b]) => ma <= a && ma > b) || null;
function renderPeriod([a, b, name, text]) {
  const span = a >= 1000 ? `${(a / 1000).toFixed(2)}–${(b / 1000).toFixed(2)} billion years ago` : b < 1 ? `${a} million – ${Math.round(b * 1000)} thousand years ago` : `${a}–${b} million years ago`;
  $('#empty-text').innerHTML = `<b>${esc(name)}</b><small>${esc(span)}</small>${esc(text)}<em>Background sketch, not a sourced record: the general scientific picture, simplified.</em>`;
  renderNearest();
}
// the nearest records either side of the window, so a gap is one click away from something real
function renderNearest() {
  const win = windowNow(), mi = minImportance(), cand = state.pins.filter(p => p.lat != null && inLevel(p) && domainOn(p) && rankOf(p) >= mi);
  const before = cand.filter(p => p.until < win.from).sort((x, y) => y.until - x.until)[0], after = cand.filter(p => p.start > win.to).sort((x, y) => x.start - y.start)[0];
  $('#empty-near').replaceChildren(...[[before, '←'], [after, '→']].filter(([p]) => p).map(([p, arrow]) => {
    const b2 = document.createElement('button');
    b2.textContent = arrow === '←' ? `← ${p.title}` : `${p.title} →`;
    b2.title = `Go to ${fmtYear(p.start)}`;
    b2.onclick = () => { state.t = Math.min(p.start, NOW); render(); };
    return b2;
  }));
}
// past the plate model's reach: what the Earth was like, as an artist's impression (no continents are reconstructed)
function eonNote(ma) {
  const ga = ma / 1000;
  const scene = ga > 4.0 ? 'Hadean Earth: a young crust cracked over magma and scarred by impacts, under a thick hot sky.'
    : ga > 2.5 ? 'Archean Earth: a water world with few small islands, under an orange, oxygen-poor haze; microbial life in the seas.'
    : ga > 2.1 && ga < 2.45 ? 'Huronian glaciation: ice reaching far toward the equator as oxygen rose and greenhouse methane fell.'
    : 'Proterozoic Earth: growing continents and shallow seas, oxygen slowly building up; life still mostly single-celled.';
  return `${scene} Artist’s impression: no plate model reaches back past ${window.Space.PALEO_MAX} million years, so where the land lay is unknown. Pins mark where the evidence is found today.`;
}
// Dense spots become one count badge. The cell follows the camera height, about a badge's width on screen; the open
// record stays out of it. Up close only records at nearly the same place remain together, so a stack stays reachable.
function clusterPins(pins) {
  const cell = Math.max(0.01, state.alt), cells = new Map();
  for (const p of pins) {
    if (p.id === state.selected) continue;
    const key = `${isMajor(p) ? 'major' : 'quiet'}:${Math.floor(p.lat / cell)}:${Math.floor(p.lon / cell)}`;   // major records never disappear into a stack of quiet ones
    (cells.get(key) || cells.set(key, []).get(key)).push(p);
  }
  const out = pins.filter(p => p.id === state.selected);
  for (const [key, group] of cells) {
    if (group.length < (key.startsWith('major') || state.alt < 0.3 ? 2 : 3)) { out.push(...group); continue; }
    group.sort((a, b) => rankOf(b) - rankOf(a) || b.importance - a.importance);
    const top = group[0], lat = group.reduce((a, p) => a + p.lat, 0) / group.length, lon = group.reduce((a, p) => a + p.lon, 0) / group.length;
    out.push({ id: `cluster:${key}`, cluster: group, lat, lon, importance: top.importance, domains: top.domains, outline: top.outline,
      title: `${top.title} +${group.length - 1}`, start: Math.min(...group.map(p => p.start)), end: Math.max(...group.map(p => p.end)), until: Math.max(...group.map(p => p.until)) });
  }
  return out;
}
function uncertaintyRing(p) { // the open record's margin of error for its place, as a circle on the globe
  const q = placed(p), r = p.unc / 6371, lat = q.lat * Math.PI / 180, lon = q.lon * Math.PI / 180, pts = [];
  for (let i = 0; i <= 72; i++) {
    const b = i / 72 * 2 * Math.PI, la = Math.asin(Math.sin(lat) * Math.cos(r) + Math.cos(lat) * Math.sin(r) * Math.cos(b));
    pts.push({ lat: la * 180 / Math.PI, lon: (lon + Math.atan2(Math.sin(b) * Math.sin(r) * Math.cos(lat), Math.cos(r) - Math.sin(lat) * Math.sin(la))) * 180 / Math.PI });
  }
  return { pts, color: 'rgba(255,255,255,0.7)', ring: true };
}
let shownArcs = null;
function render() {
  tierKey = tier(); updateSky(); checkToday();
  const shown = visiblePins();
  const pins = shown.filter(p => !p.global), planet = shown.filter(p => p.global);   // planet-wide records get a chip, not a misleading pin
  renderPlanet(planet);
  // One persistent datum per pin, so globe.gl keeps each badge and only adds or removes the pins entering or
  // leaving the time window (fresh objects every render would rebuild every sprite and make the pins flash)
  const drawn = clusterPins(pins), ids = new Set(drawn.map(p => p.id));
  for (const id of [...pinData.keys()]) if (!ids.has(id)) { pinData.delete(id); pinSprites.delete(id); }
  if (hoverId && !ids.has(hoverId)) hoverId = null;
  globe.customLayerData(drawn.map(p => { const d = pinData.get(p.id); if (d) return Object.assign(d, p); const n = { ...p }; pinData.set(p.id, n); return n; }));
  placePinSprites();
  // place names are drawn by the pin sprites themselves (placePinSprites), with collision avoidance
  // routes stay hidden unless the Routes layer is on; an opened record still shows its own route
  // a playing sequence draws its own smooth route, so the static one for that record steps aside
  globe.pathsData(pins.filter(p => p.waypoints?.length >= 2 && (state.paths || p.id === state.selected) && p.id !== window.Sequence?.recordId)
    .map(p => ({ pts: routeSoFar(p), color: colorOf(p), wall: /wall/i.test(p.title), dated: p.waypoints.every(x => typeof x.year === 'number') }))
    .filter(x => x.pts.length >= 2)
    .concat(pins.filter(p => p.id === state.selected && p.unc >= 5 && p.unc < 5000 && (!p.geometry || p.geometry === 'point')).map(uncertaintyRing)));
  const arcs = window.Sequence?.playing ? [] : state.arcs;
  if (arcs !== shownArcs) { shownArcs = arcs; globe.arcsData(arcs); }

  const { from, to } = range();
  const within = state.autoWhole ? ` across ${LEVELS[state.level].name}` : state.whole || LEVELS[state.level].key === 'event' ? '' : ` within ${fmtSpan((windowNow().to - windowNow().from) / 2)}`;
  $('#now').innerHTML = `${esc(fmtYear(state.t))}<small>${pins.length} shown${esc(within)}</small>`;
  $('#slider').setAttribute('aria-valuetext', fmtYear(state.t));
  $('#t0').textContent = fmtYear(from, true);
  $('#tm').textContent = LEVELS[state.level].key === 'event' ? '' : fmtYear((from + to) / 2, true);
  $('#t1').textContent = LEVELS[state.level].key === 'event' ? fmtYear(to, true) : 'today';
  if (!slideRange) $('#slider').value = Math.round(((state.t - from) / (to - from)) * 1000);
  const full = NOW - EARTH, left = (from - EARTH) / full, width = Math.max((to - from) / full, 0.004);
  Object.assign($('#context .win').style, { left: `${Math.min(left, 1 - width) * 100}%`, width: `${width * 100}%` });

  const notice = state.paleoMa != null && -state.t / 1e6 > window.Space.PALEO_MAX ? eonNote(-state.t / 1e6)
    : state.paleoMa >= 10 ? innerWidth <= 760 ? `Earth ${Math.round(state.paleoMa)} million years ago. ${state.paleoMa <= 540 ? '' : 'Land is a stand-in. '}Sources in About.` : `Earth ${Math.round(state.paleoMa)} million years ago. ${state.paleoMa <= 540 ? 'Land and sea floor: PALEOMAP PaleoDEMs (Scotese and Wright 2018). ' : 'No maps reach this far. Which rock is here comes from plate models; its coasts and heights are a stand-in, from the 540 million-year-old map. '}`
    : state.paleoMa != null ? 'Today’s imagery, carried back with the plates, fading into the PALEOMAP maps of land and sea floor.'
    : state.t < -1e6 ? 'The map shows today’s continents, which have barely moved in the last few million years.'
    : state.seaDrop > 0 ? `Sea level about ${Math.round(state.seaDrop / 5) * 5} m below today’s, so the coastlines are drawn further out (sea level: Spratt and Lisiecki 2016; depths: NOAA ETOPO1). ${state.t > -80000 ? 'Ice sheets: PaleoMIST 1.0 (Gowan et al. 2021).' : 'Ice sheets are drawn only for the last 80,000 years.'} Plant cover is schematic.`
    : state.t < -12000 ? state.humid > 0 ? 'The Sahara is tinted green for the African Humid Period, about 11,000 to 5,000 years ago. Plant cover is schematic.' : `The map shows today’s coastlines. ${state.t > -80000 ? 'Ice sheets: PaleoMIST 1.0 (Gowan et al. 2021).' : 'Sea level is drawn only for the last 800,000 years, and ice sheets for the last 80,000.'}` : '';
  $('#notice').textContent = notice; show($('#notice'), !!notice && $('#panel').hidden && !(innerWidth <= 760 && !$('#seqbar').hidden));   // on a phone it would cover what a sequence is showing
  const anyInLevel = state.pins.some(p => inLevel(p) && domainOn(p) && p.until >= from && p.start <= to), anyPublished = anyInLevel || state.pins.some(p => inLevel(p) && p.until >= from && p.start <= to);
  show($('#empty'), state.pins.length > 0 && pins.length === 0 && $('#seqbar').hidden);
  const period = state.t < -11700 && periodAt(-state.t / 1e6);
  $('#empty').classList.toggle('period', !!period);
  if (period && pins.length === 0) renderPeriod(period);
  else {
    $('#empty-text').textContent = !anyInLevel && anyPublished ? 'Your filters are hiding every record here. Turn on an importance level or a domain to see them.'
      : wholeNow() || !anyInLevel
      ? (anyInLevel ? 'Zoom in to see smaller events here.' : `No published records in the ${LEVELS[state.level].name.toLowerCase()} scale yet.`)
      : `Nothing recorded near ${fmtYear(state.t)} yet.`;
    if (pins.length === 0) renderNearest();
  }
  show($('#empty-btn'), !period && !wholeNow() && anyInLevel);
  renderVitals();
  drawDensity();
  queueURL();
}

// mass extinctions and ice ages on the time bar, for the scales that reach them. A click on an extinction opens its record. Ice ages are only a tint: they sit where people grab the bar, and one that
// fills most of the scale, as Antarctica's ice does on every short one, says nothing there, so it isn't drawn.
function drawMarks(from, to) {
  const key = `${from}|${to}|${!!deepTime}`;
  if (key === marksKey || !deepTime) return;
  marksKey = key;
  const X = ma => ((-ma * 1e6 - from) / (to - from)) * 100, box = $('#marks');
  box.innerHTML = deepTime.marks.map(m => {
    const title = esc(m.label), tag = m.id ? 'button' : 'span', attr = m.id ? `data-id="${esc(m.id)}" aria-label="${title}"` : '';
    if (m.kind === 'extinction') { const x = X(m.ma); return x < 0 || x > 100 ? '' : `<${tag} class="mark ext" style="left:${x.toFixed(2)}%" title="${title}" ${attr}></${tag}>`; }
    const a = Math.max(0, X(m.from)), b = Math.min(100, X(m.to));
    return b <= a || b - a > 40 ? '' : `<span class="mark ice" style="left:${a.toFixed(2)}%;width:${Math.max(0.4, b - a).toFixed(2)}%"></span>`;
  }).join('');
  box.querySelectorAll('button').forEach(b => { b.onclick = () => goTo(b.dataset.id); });
}
// density strip: how many records fall at each point of the current scale (so empty stretches are visible)
function drawDensity() {
  const c = $('#density'), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
  if (!w) return;
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
  const { from, to } = range(), bins = new Array(Math.max(20, Math.floor(w / 4))).fill(0);
  drawMarks(from, to);
  for (const p of state.pins) {
    if (!inLevel(p) || !domainOn(p) || p.until < from || p.start > to) continue;
    // count where each record begins (long periods would otherwise flood every bin)
    const i = Math.floor(((Math.max(p.start, from) - from) / (to - from)) * bins.length);
    bins[Math.min(bins.length - 1, Math.max(0, i))] += p.start >= from ? 1 : 0.35;
  }
  const max = Math.max(1, ...bins), bw = w / bins.length;
  g.fillStyle = 'rgba(190,205,230,0.08)'; g.fillRect(0, h - 1, w, 1);
  bins.forEach((n, i) => {
    if (!n) return;
    const bh = 3 + (n / max) * (h - 5);
    g.fillStyle = `rgba(217,179,106,${0.25 + 0.55 * (n / max)})`;
    g.fillRect(i * bw + 0.5, h - bh, Math.max(1, bw - 1), bh);
  });
  drawVitalCurve(g, w, h, from, to);
  // the open record's dates, with its stated uncertainty as a soft edge rather than a crisp end (spec 11.5)
  const r = state.openRec, y0 = r?.when?.start?.year;
  if (y0 == null) return;
  const u = r.when.uncertainty || {}, y1 = r.when.end?.year ?? y0, X = y => ((y - from) / (to - from)) * w;
  const s0 = X(y0 - (u.start_minus_years || 0)), s1 = X(y0 + (u.start_plus_years || 0)), e0 = X(y1 - (u.end_minus_years || 0)), e1 = X(y1 + (u.end_plus_years || 0));
  if (e1 < 0 || s0 > w) return;
  const x0 = Math.max(0, s0), x1 = Math.min(w, Math.max(e1, s0 + 2));
  const grad = g.createLinearGradient(x0, 0, x1, 0), stop = x => Math.min(1, Math.max(0, (x - x0) / Math.max(1, x1 - x0)));
  grad.addColorStop(0, s0 < s1 ? 'rgba(240,243,248,0)' : 'rgba(240,243,248,.34)'); grad.addColorStop(stop(s1), 'rgba(240,243,248,.34)');
  grad.addColorStop(Math.max(stop(s1), stop(e0)), 'rgba(240,243,248,.34)'); grad.addColorStop(1, e0 < e1 ? 'rgba(240,243,248,0)' : 'rgba(240,243,248,.34)');
  g.fillStyle = grad; g.fillRect(x0, 0, x1 - x0, h);
}

function buildChrome() {
  $('#levels').innerHTML = LEVELS.map((l, i) => `<button role="tab" data-i="${i}">${l.name}</button>`).join('');
  $('#levels').querySelectorAll('button').forEach(b => { b.onclick = () => setLevel(+b.dataset.i); });
  $('#levels').querySelectorAll('button').forEach(b => { const from = LEVELS[+b.dataset.i].from; if (from < -2e6) prefetchPaleo(b); if (from < -10000) prefetchIceAge(b); });
  $('#context').innerHTML = EONS.map(e => `<div class="eon" style="flex:${e.to - e.from};background:${e.color}" title="${e.name} eon"><span>${e.name}</span></div>`).join('')
    + '<div class="win"></div><div class="humans" title="Human history"></div>';
}
function buildLegend() {
  const counts = {};
  for (const p of state.pins) for (const d of p.domains || []) counts[d] = (counts[d] || 0) + 1;
  $('#domains').innerHTML = Object.entries(DOMAINS).filter(([k]) => counts[k]).map(([k, [name, col]]) =>
    `<li><button data-d="${k}" aria-pressed="${!state.off.has(k)}"><img class="sw" alt="" src="${badgeURL(k, true)}">${name}<span class="n">${counts[k]}</span></button></li>`).join('');
  $('#domains').querySelectorAll('button').forEach(b => {
    b.onclick = () => { const d = b.dataset.d; state.off.has(d) ? state.off.delete(d) : state.off.add(d); b.setAttribute('aria-pressed', !state.off.has(d)); render(); };
  });
  // importance levels: each switches its pins on or off (5 = most important); "Only" keeps just that level
  const lv = {};
  for (const p of state.pins) lv[p.importance || 0] = (lv[p.importance || 0] || 0) + 1;
  $('#imp-levels').innerHTML = [5, 4, 3, 2, 1].filter(l => lv[l]).map(l =>
    `<button data-l="${l}" aria-pressed="${!state.impOff.has(l)}" title="Importance ${l} of 5: click to show or hide; double-click to show only this level"><span class="dots">${'●'.repeat(l)}${'○'.repeat(5 - l)}</span><span class="n">${lv[l].toLocaleString()}</span></button>`).join('');
  $('#imp-levels').querySelectorAll('button').forEach(b => {
    const l = +b.dataset.l;
    b.onclick = () => { state.impOff.has(l) ? state.impOff.delete(l) : state.impOff.add(l); buildLegend(); render(); };
    b.ondblclick = () => { // only this level, or everything again if it already was the only one
      const only = [1, 2, 3, 4, 5].every(x => x === l || state.impOff.has(x)) && !state.impOff.has(l);
      state.impOff = new Set(only ? [] : [1, 2, 3, 4, 5].filter(x => x !== l)); buildLegend(); render();
    };
  });
}
function setLevel(i, keepT = false) {
  state.level = i;
  const { from, to } = range();
  if (!keepT && LEVELS[i].key !== 'event') state.t = Math.min(Math.max(state.t, from), to);
  $('#levels').querySelectorAll('button').forEach(b => { const on = +b.dataset.i === i; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  const tabs = $('#levels'), on = tabs.querySelector('.on'); // keep the active scale visible when the tabs scroll (phones)
  if (on && tabs.scrollWidth > tabs.clientWidth) tabs.scrollTo({ left: on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2, behavior: 'smooth' });
  render();
}
// Dragging the time slider: the scale is fixed when the drag starts (in the one-year scale the range follows the
// year, so recomputing it mid-drag made the thumb run away), the slider's own value is left alone while it is held,
// and the globe redraws at most once a frame however fast the input events come
let slideRange = null, slideFrame = 0, sliding = null;
const slider = $('#slider');
function slideTo(v) {
  const { from, to } = slideRange || range();
  state.t = from + (to - from) * (v / 1000);
  if (!slideFrame) slideFrame = requestAnimationFrame(() => { slideFrame = 0; render(); });
}
// The slider follows the pointer itself, with the pointer captured, so nothing else on the page can make it let go. The keyboard still works through the input's own events.
const valueAtPointer = x => { const r = slider.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (x - r.left - 10) / Math.max(1, r.width - 20))) * 1000); };
slider.addEventListener('pointerdown', e => {
  if (e.button) return;
  e.preventDefault(); slider.focus({ preventScroll: true, focusVisible: false });
  if (timer) stopPlay();   // playback would otherwise fight the drag for the date
  slideRange = range(); sliding = e.pointerId;
  try { slider.setPointerCapture(e.pointerId); } catch {}
  slider.value = valueAtPointer(e.clientX); slideTo(+slider.value);
});
slider.addEventListener('pointermove', e => { if (e.pointerId !== sliding) return; slider.value = valueAtPointer(e.clientX); slideTo(+slider.value); });
const slideEnd = e => { if (e.pointerId !== sliding) return; sliding = null; slideRange = null; render(); };
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) slider.addEventListener(ev, slideEnd);
slider.oninput = e => { slideTo(+e.target.value); };
$('#context').onclick = e => {
  const r = e.currentTarget.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
  if (f > 0.985) { state.t = -500; return setLevel(4); }  // the Humans sliver opens Civilization (spec 2)
  state.t = EARTH + f * (NOW - EARTH); setLevel(0);
};
const ctx = $('#context');
ctx.tabIndex = 0; ctx.setAttribute('role', 'button'); ctx.setAttribute('aria-label', 'Jump to human history');
ctx.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.t = -500; setLevel(4); } };
$('#empty-btn').onclick = () => { state.whole = true; $('#whole').setAttribute('aria-pressed', true); render(); };
let timer = null;
const PLAY = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="currentColor"/></svg>';
const PAUSE = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>';
// Play: the base speed scales with the level (spec 2), a whole scale in about 40 seconds at 1x, or about 12 days a
// second in the one-year scale; the speed chip multiplies it. Playback stops at the present day rather than looping.
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
let speed = 1;
try { const s = +localStorage.getItem('atlas-speed'); if (SPEEDS.includes(s)) speed = s; } catch {}
const presentT = () => { const d = new Date(), y0 = Date.UTC(d.getUTCFullYear(), 0, 1); return NOW + (d - y0) / (Date.UTC(NOW + 1, 0, 1) - y0); };
const speedLabel = () => (speed < 1 ? `${speed}×`.replace('0.', '.') : `${speed}×`);
function stopPlay() { cancelAnimationFrame(timer); timer = null; $('#play').innerHTML = PLAY; $('#play').setAttribute('aria-label', 'Play through time'); }
$('#play').onclick = () => {
  if (timer) return stopPlay();
  const end = () => Math.min(range().to, presentT());
  if (state.t >= end() - 1e-6) { state.t = range().from; render(); }   // at the end already: start the scale over
  $('#play').innerHTML = PAUSE; $('#play').setAttribute('aria-label', 'Pause');
  let last = performance.now();
  const step = now => {
    if (!timer) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const { from, to } = range(), event = LEVELS[state.level].key === 'event';
    const rate = (event ? 12.5 / 365 : (to - from) / 40) * speed;   // years per second
    // the one-year scale's window follows the year, so it plays on into the next year until the present day
    const stop = event ? presentT() : Math.min(to, presentT());
    state.t = Math.min(stop, state.t + rate * dt);
    render();
    if (state.t >= stop - 1e-9) stopPlay(); else timer = requestAnimationFrame(step);
  };
  timer = requestAnimationFrame(step);
};
$('#speed').textContent = speedLabel();
$('#speed').onclick = e => {   // click for faster, shift-click or right-click for slower
  const i = SPEEDS.indexOf(speed), back = e.shiftKey;
  speed = SPEEDS[(i + (back ? SPEEDS.length - 1 : 1)) % SPEEDS.length];
  $('#speed').textContent = speedLabel();
  try { localStorage.setItem('atlas-speed', speed); } catch {}
};
$('#speed').oncontextmenu = e => { e.preventDefault(); $('#speed').onclick({ shiftKey: true }); };
setInterval(() => { if (state.realSun) updateSky(); }, 60000);   // the real Sun keeps moving while the page sits still
for (const [id, key] of [['#borders', 'borders'], ['#whole', 'whole'], ['#paths', 'paths'], ['#coastlines', 'coastlines'], ['#clouds', 'clouds'], ['#realsun', 'realSun'], ['#vitals-toggle', 'vitals'], ['#fossils-toggle', 'fossils']]) {
  $(id).onclick = () => { state[key] = !state[key]; $(id).setAttribute('aria-pressed', state[key]); render(); updateSky(); };
}

// ---------- search: titles, aliases and other names (spec 11.6), then places and summaries, and dates ("1945", "500 BCE")
const fold = t => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const STOP = new Set(['the', 'of', 'and', 'in', 'a', 'an', 'on', 'to']);
let searchIndex = null, searchLoading = null;
function loadSearch() { // other names and summaries are a separate file, fetched the first time someone searches
  searchLoading = searchLoading || fetch('api/search.json').then(r => r.json())
    .then(rows => { searchIndex = new Map(rows.map(([id, names, text]) => [id, { names: fold(names).split('\n').filter(Boolean), text: ` ${fold(text)}` }])); renderSearch(); })
    .catch(() => { searchLoading = null; });
  return searchLoading;
}
const foldedPins = new Map();
function foldedPin(p) {
  if (!foldedPins.has(p.id)) foldedPins.set(p.id, { title: fold(p.title), aliases: (p.aliases || []).map(fold) });
  return foldedPins.get(p.id);
}
function searchScore(p, q, words) {
  const f = foldedPin(p), x = searchIndex?.get(p.id), names = [...f.aliases, ...(x?.names || [])];
  if (f.title.startsWith(q)) return 7;
  if (` ${f.title}`.includes(` ${q}`)) return 6;
  if (f.title.includes(q)) return 5;
  if (names.some(n => n.startsWith(q))) return 4;
  if (names.some(n => n.includes(q))) return 3;
  if (!words.length) return 0;
  if (words.every(w => f.title.includes(w) || names.some(n => n.includes(w)))) return 2;
  return q.length >= 3 && x && words.every(w => x.text.includes(` ${w}`)) ? 1 : 0;
}
function parseDate(q) {
  let m;
  if ((m = q.match(/^(\d+(?:\.\d+)?)\s*(ga|billion(?: years(?: ago)?)?)$/))) return -m[1] * 1e9;
  if ((m = q.match(/^(\d+(?:\.\d+)?)\s*(ma|mya|million(?: years(?: ago)?)?)$/))) return -m[1] * 1e6;
  if ((m = q.match(/^(\d+(?:\.\d+)?)\s*(ka|thousand(?: years(?: ago)?)?)$/))) return -m[1] * 1e3;
  if ((m = q.match(/^(\d{1,5})\s*(bce|bc)$/))) return 1 - +m[1];
  if ((m = q.match(/^(?:(?:ad|ce)\s*)?(\d{1,4})(?:\s*(?:ad|ce))?$/))) return +m[1] <= NOW ? +m[1] : null;
  return null;
}
function renderSearch() {
  const q = fold($('#q').value).trim().replace(/\s+/g, ' ');
  if (q.length < 2) return show($('#results'), false);
  const asRoman = q.replace(/\b2\b/g, 'ii').replace(/\b1\b/g, 'i');    // "world war 2"
  const words = q.split(' ').filter(w => !STOP.has(w)), wordsR = asRoman.split(' ').filter(w => !STOP.has(w)), year = parseDate(q);
  const hits = state.pins.map(p => {
    let score = Math.max(searchScore(p, q, words), asRoman !== q ? searchScore(p, asRoman, wordsR) : 0);
    if (!score && year != null && p.start <= year && p.end >= year && p.end - p.start <= 50) score = 1.5; // what was under way that year
    return { p, score };
  }).filter(h => h.score).sort((x, y) => y.score - x.score || y.p.importance - x.p.importance || x.p.start - y.p.start);
  const dateRow = year != null ? `<li><button class="goto" data-year="${year}"><span class="t">Go to ${esc(fmtYear(year))} →</span></button></li>` : '';
  $('#results').innerHTML = dateRow + (hits.length ? hits.slice(0, 30).map(({ p }) => `<li><button data-id="${esc(p.id)}"><img class="dot" alt="" src="${badgeURL(p.domains?.[0], !p.outline)}"><span class="t">${esc(p.title)}</span><span class="d">${esc(p.display)}<span class="imp" title="Importance ${p.importance} of 5">${'●'.repeat(p.importance)}</span></span></button></li>`).join('')
    : dateRow ? '' : '<li style="padding:8px;color:var(--muted);font-size:12px">No record matches. <a href="browse.html" style="color:var(--brass)">Browse all records</a></li>');
  show($('#results'), true);
  $('#results').querySelectorAll('button[data-id]').forEach(b => { b.onclick = () => { show($('#results'), false); $('#q').value = ''; goTo(b.dataset.id); }; });
  $('#results').querySelector('button[data-year]')?.addEventListener('click', e => {
    show($('#results'), false); $('#q').value = '';
    state.t = +e.currentTarget.dataset.year; setLevel(levelFor(state.t), true);
  });
}
$('#q').oninput = () => { loadSearch(); renderSearch(); };
$('#q').onfocus = loadSearch;
addEventListener('pointerdown', e => { if (!e.target.closest('.search')) show($('#results'), false); }); // a click elsewhere closes the list
$('#q').onkeydown = e => {
  if (e.key === 'Escape') { e.target.value = ''; show($('#results'), false); }
  if (e.key === 'Enter') $('#results button')?.click();
  if (e.key === 'ArrowDown') { e.preventDefault(); $('#results button')?.focus(); }
};
$('#results').onkeydown = e => { // up and down through the results; Escape goes back to the box
  const all = [...$('#results').querySelectorAll('button')], i = all.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); all[Math.min(all.length - 1, i + 1)]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? all[i - 1] : $('#q')).focus(); }
  if (e.key === 'Escape') { show($('#results'), false); $('#q').focus(); }
};

// jump the time axis to a record's own level and date, then open it
async function goTo(id) {
  await dataReady; // a jump requested before the records arrive waits for them
  closePinList();
  const p = state.pins.find(x => x.id === id);
  if (p) {
    const lvl = Math.max(scaleIndex(p), p.start < -1e6 ? 0 : p.start < -10000 ? 3 : p.start < 1500 ? 4 : 5);
    state.t = Math.min(Math.max(p.start, range(lvl).from ?? p.start), NOW);
    setLevel(Math.min(lvl, 5), true);
  }
  openRecord(id);
}

// ---------- record panel (all record text is escaped: records are data written by agents)
const CONF_LABEL = { established: 'Established', probable: 'Probable', contested: 'Contested', legendary: 'Legendary' };
// A record opens at once from what its pin already knows, then fills in when the full record arrives. Hovering a pin fetches its record ahead of the click.
const recordCache = new Map(); let openToken = 0, hoverFetch = null;
function fetchRecord(id) {
  let got = recordCache.get(id);
  if (!got) {
    got = fetch(`api/record/${encodeURIComponent(id)}.json`).then(res => (res.ok ? res.json() : null));
    recordCache.set(id, got); got.then(r => { if (!r) recordCache.delete(id); }, () => recordCache.delete(id));
  }
  return got;
}
function fetchSoon(id) { clearTimeout(hoverFetch); if (id) hoverFetch = setTimeout(() => fetchRecord(id).catch(() => {}), 100); }
// keep the pin in the open part of the screen: left of the side panel, or above the phone's bottom sheet
function frameRecord(lat, lon, unc) {
  if (lat == null || (unc ?? 0) >= 5000) return;
  const phone = innerWidth <= 760, k = Math.min(1, state.alt);
  globe.pointOfView({ lat: phone ? Math.max(-80, lat - 26 * k) : lat, lng: lon + (phone ? 0 : 14 * k), altitude: Math.min(state.alt, 1.5) }, 1100);
}
const CLOSE_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6"/></svg>';
function panelFromPin(p) {
  const panel = $('#panel');
  panel.innerHTML = `<div class="p-head"><button class="p-close" aria-label="Close record">${CLOSE_ICON}</button></div>
    <div class="p-body"><div class="p-kicker">${esc((DOMAINS[p.domains?.[0]] || [p.kind])[0])} · ${esc(p.kind)}</div><h2>${esc(p.title)}</h2><div class="p-when">${esc(p.display)}</div><div class="prose">${p.summary ? `<p>${esc(p.summary)}</p>` : ''}</div></div>`;
  show(panel, true); show($('#notice'), false);
  panel.querySelector('.p-close').onclick = closePanel;
  panel.querySelector('.p-close').focus({ preventScroll: true });
}
async function openRecord(id) {
  const token = ++openToken, pin = state.pins.find(p => p.id === id);
  if (document.activeElement && !$('#panel').contains(document.activeElement)) lastFocus = document.activeElement;
  if (pin) {
    panelFromPin(pin);
    state.selected = id; state.openRec = null; state.arcs = []; render(); writeURL(true);
    document.title = `${pin.title} · Living Atlas`;
    frameRecord(pin.lat, pin.lon, pin.unc);
  }
  const r = await fetchRecord(id).catch(() => null);
  if (token !== openToken) return;   // closed, or another record opened, while this one was on its way
  if (!r) { if (pin) closePanel(); flash(`“${id}” is not published yet.`); return; }
  state.selected = id; state.openRec = r; state.arcs = causalArcs(r); render(); writeURL(true);
  document.title = `${r.title} · Living Atlas`;
  if (state.tour) { const i = state.tour.stops.indexOf(id); if (i >= 0) state.tour.i = i; }
  const img = (r.media || []).find(m => m.type === 'image' || m.type === 'map');
  const paras = s => esc(s).split(/\n+/).filter(Boolean).map(x => `<p>${x}</p>`).join('');
  const known = new Set(state.pins.map(p => p.id));
  const relLabel = { caused: 'led to', caused_by: 'caused by', part_of: 'part of', has_part: 'includes', same_person: 'same person', same_place: 'same place', contemporary: 'same time', related: 'related', mentions: 'mentions', mentioned_in: 'mentioned in' };
  const num = n => n.low === n.high ? Number(n.low).toLocaleString() : `${Number(n.low).toLocaleString()}–${Number(n.high).toLocaleString()}`;
  const panel = $('#panel');
  panel.innerHTML = `
    <div class="p-head">
      ${img ? `<img class="p-hero" src="${esc(img.file_url)}" alt="${esc(img.title)}">` : r.wiki ? '<img class="p-hero wiki-hero" alt="" hidden>' : ''}
      <button class="p-close" aria-label="Close record"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.6"/></svg></button>
    </div>
    ${img ? `<div class="p-credit">${esc(img.title)} · ${esc(img.credit)} · ${esc(img.license)}</div>` : r.wiki ? '<div class="p-credit wiki-credit" hidden></div>' : ''}
    <div class="p-body">
      ${tourNav()}
      ${r.status === 'outline' ? '<div class="outline-note">A short record: a summary drawn from the sources below.</div>' : ''}
      <div class="p-kicker">${esc((DOMAINS[r.domains?.[0]] || [r.kind])[0])} · ${esc(r.kind)}</div>
      <h2>${esc(r.title)}</h2>
      <div class="p-when">${esc(r.when?.display)}</div>
      <div class="p-where">${esc(r.where?.historical_name)}${uncertaintyLine(r)}</div>
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
      ${(r.related || []).length ? `<section><h3>Connections</h3><div class="rel">${r.related.map(x => `<button data-id="${esc(x.id)}" ${known.has(x.id) ? '' : 'disabled title="Not written yet"'}><i>${esc(relLabel[x.type] || x.type)}</i>${esc(x.title || (state.pins.find(p => p.id === x.id)?.title) || x.id)}${x.because ? `<span class="because">${esc(x.because)}</span>` : ''}</button>`).join('')}</div></section>` : ''}
      ${meanwhile(r)}
      ${r.where?.paleo?.lat != null ? `<section><h3>Position then</h3><div class="prose"><p>${esc(r.where.paleo.lat)}°, ${esc(r.where.paleo.lon)}° at ${esc(r.where.paleo.age_ma)} million years ago (${esc(r.where.paleo.plate_model)}).</p></div></section>` : ''}
      <section><details><summary><h3>Sources (${(r.sources || []).length})</h3></summary><ol class="srcs">${(r.sources || []).map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> <span class="cls">${esc(s.class)}</span>${s.original_url ? ' <span class="cls">archived copy</span>' : ''}<br><span style="color:var(--muted)">${esc(s.publisher)}</span></li>`).join('')}</ol></details></section>
      ${r.wiki ? `<section class="wiki"><h3>On Wikipedia${r.wiki.quality ? ` <span class="wq">${r.wiki.quality === 'FA' ? 'Featured article' : 'Good article'}</span>` : ''}</h3><div class="wiki-body">Loading the article summary…</div></section>` : ''}
      ${r.visitor_note ? `<section><h3>Least certain</h3><div class="prose"><p style="font-size:13px;color:var(--soft)">${esc(r.visitor_note)}</p></div></section>` : ''}
      <div class="meta-line">Drafted and reviewed by AI models, then checked against its sources by automated tools. <a href="about.html" target="_blank" rel="noopener">How this is made</a> · <a href="${esc(reportLink(r))}" target="_blank" rel="noopener noreferrer">Report a problem</a><br>${esc(r.id)} · version ${esc(r.record_version)} · updated ${esc(r.updated)}</div>
    </div>`;
  show(panel, true); show($('#notice'), false);
  panel.querySelector('.p-body').scrollTop = 0;
  panel.querySelector('.p-close').onclick = closePanel;
  panel.querySelector('.p-close').focus({ preventScroll: true });
  panel.querySelector('#p-share').onclick = shareRecord;
  panel.querySelector('#tour-prev')?.addEventListener('click', () => tourStep(-1));
  panel.querySelector('#tour-next')?.addEventListener('click', () => tourStep(1));
  panel.querySelector('#tour-end')?.addEventListener('click', () => { state.tour = null; panel.querySelector('.tour-nav').remove(); writeURL(false); });
  const playBtn = panel.querySelector('#play-seq'); if (playBtn) playBtn.onclick = () => playSequence(r);
  panel.querySelectorAll('.rel button:not([disabled])').forEach(b => { b.onclick = () => goTo(b.dataset.id); });
  if (r.wiki) wikiSummary(id, r.wiki);
  if (!pin) frameRecord(r.where?.lat, r.where?.lon, r.where?.uncertainty_km);
}
// The linked Wikipedia article's lead, fetched live (always current, nothing stored); shown as further reading
const wikiCache = new Map();
async function wikiSummary(id, w) {
  const box = $('#panel .wiki-body');
  try {
    if (!wikiCache.has(w.title)) {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(w.title.replace(/ /g, '_'))}`);
      if (!res.ok) throw new Error(res.status);
      wikiCache.set(w.title, await res.json());
    }
    if (state.selected !== id || !box?.isConnected) return; // the reader has moved on
    const s = wikiCache.get(w.title), url = s.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(w.title)}`;
    box.innerHTML = `<p class="wiki-text">${esc(s.extract || '')}</p>
      <a class="wiki-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Read “${esc(s.title || w.title)}” on Wikipedia →</a>
      <div class="wiki-note">Text from Wikipedia, CC BY-SA 4.0. Further reading, not one of this record’s sources.</div>`;
    wikiImage(id, s);
  } catch {
    if (box?.isConnected) box.innerHTML = `<a class="wiki-link" href="https://en.wikipedia.org/wiki/${encodeURIComponent(w.title.replace(/ /g, '_'))}" target="_blank" rel="noopener noreferrer">Read “${esc(w.title)}” on Wikipedia →</a>`;
  }
}
// The article's lead image as the panel picture, for records without media of their own. Only freely licensed
// Wikimedia Commons files are used (an English-Wikipedia-only upload may be a non-free "fair use" image), each
// credited with its author and licence from the file's Commons metadata; with no licence on record, no image.
const imageCredit = new Map();
async function wikiImage(id, s) {
  const hero = $('#panel .wiki-hero'), credit = $('#panel .wiki-credit');
  const src = s.thumbnail?.source || s.originalimage?.source;
  if (!hero || !src || !/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(src)) return;
  const file = decodeURIComponent((src.match(/\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/) || [])[1] || '');
  if (!file) return;
  try {
    if (!imageCredit.has(file)) {
      const j = await (await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=extmetadata|url&titles=${encodeURIComponent('File:' + file)}`)).json();
      const info = Object.values(j.query?.pages || {})[0]?.imageinfo?.[0], m = info?.extmetadata || {};
      // plain text from Commons' HTML; a name its markup repeats ("Unknown authorUnknown author") is said once
      const text = h => new DOMParser().parseFromString(String(h || ''), 'text/html').body.textContent.replace(/\s+/g, ' ').trim()
        .replace(/^(.+?)\s*\1$/, '$1').replace(/\.$/, '');
      imageCredit.set(file, info && m.LicenseShortName ? { author: text(m.Artist?.value).slice(0, 80), license: text(m.LicenseShortName.value), page: info.descriptionurl } : null);
    }
    const c = imageCredit.get(file);
    if (!c || state.selected !== id || !hero.isConnected) return;
    hero.src = src.replace(/\/(\d+)px-/, (x, n) => (+n < 960 ? '/960px-' : x)); // a sharper thumbnail; Commons serves standard widths (500, 960…), not 640
    // a file smaller than 960px has no 960px thumbnail: fall back to the article's own one, then give up quietly
    hero.alt = s.title || ''; hero.onerror = () => { if (hero.src !== src) hero.src = src; else { show(hero, false); show(credit, false); } };
    credit.innerHTML = `${c.author ? esc(c.author) + ' · ' : ''}${esc(c.license)} · <a href="${esc(c.page)}" target="_blank" rel="noopener noreferrer">Wikimedia Commons</a>`;
    show(hero, true); show(credit, true);
  } catch {}
}
// ---------- authored sequences (spec 6.2): the time axis locks to each beat; the panel steps aside while playing
function levelFor(y) { return y < -5.4e8 ? 0 : y < -7e6 ? 1 : y < -3e5 ? 2 : y < -10000 ? 3 : y < 1500 ? 4 : 5; }
function playSequence(r) {
  const pin = state.pins.find(p => p.id === r.id);
  window.Sequence.play(r, {
    globe, color: pin ? baseColor(pin) : '#d9b36a', scene: deepTime?.scenes[r.id], getTime: () => state.t,
    ride: ({ lat, lng }) => { const q = placed({ lat, lon: lng }); return { lat: q.lat, lng: q.lon }; },
    schematic: () => { $('#seq-title').textContent = `${r.title} · schematic animation`; },
    setTime: y => { state.t = Math.min(y, NOW); const lv = levelFor(state.t); if (lv !== state.level && state.level !== 6) setLevel(lv, true); else render(); },
    onStart: n => {
      show($('#panel'), false); show($('#seqbar'), true); show($('#hint'), false);
      $('#seq-title').textContent = r.title; $('#seq-caption').textContent = ''; $('#seq-num').textContent = '';
      $('#seq-dots').innerHTML = Array.from({ length: n }, () => '<i></i>').join('');
    },
    caption: (i, text, consequence, num) => {
      $('#seq-caption').textContent = text; $('#seq-num').textContent = num || '';
      $('#seq-dots').querySelectorAll('i').forEach((d, j) => { d.classList.toggle('on', j <= i); d.classList.toggle('now', j === i); if (j === i) d.classList.toggle('cons', !!consequence); });
    },
    onEnd: () => { show($('#seqbar'), false); show($('#panel'), !!state.selected); render(); },
  });
}
let seqPaused = false;
$('#seq-pause').onclick = () => { seqPaused = !seqPaused; window.Sequence.setPaused(seqPaused); $('#seq-pause').setAttribute('aria-label', seqPaused ? 'Resume sequence' : 'Pause sequence'); $('#seq-pause').innerHTML = seqPaused ? PLAY.replace('12" height="12"', '11" height="11"') : PAUSE.replace('12" height="12"', '11" height="11"'); };
$('#seq-stop').onclick = () => { window.Sequence.stop(); seqPaused = false; show($('#seqbar'), false); show($('#panel'), !!state.selected); render(); };
// skip back and forth: the buttons, the arrow keys, or a click on one of the beat dots
$('#seq-prev').onclick = () => window.Sequence.step(-1);
$('#seq-next').onclick = () => window.Sequence.step(1);
$('#seq-dots').onclick = e => { const dots = [...$('#seq-dots').children], i = dots.indexOf(e.target); if (i >= 0) window.Sequence.goTo(i); };
addEventListener('keydown', e => {
  if ($('#seqbar').hidden || !window.Sequence.playing || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); window.Sequence.step(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); window.Sequence.step(1); }
});

function closePanel() {
  openToken++; show($('#panel'), false); state.selected = null; state.openRec = null; state.arcs = []; state.tour = null; document.title = 'Living Atlas';
  render(); writeURL(true);
  if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
}
let lastFocus = null;
state.arcs = [];
// ---------- helpers for the record panel
const REPO = 'ACosmicCake/Global-History-Visualization-Project';
function reportLink(r) {
  const body = `Record: ${r.id}\nPage: ${location.origin}${location.pathname.replace(/[^/]*$/, '')}r/${r.id}.html\n\nWhat looks wrong:\n\nA source that shows this (a link, if you have one):\n`;
  return `https://github.com/${REPO}/issues/new?labels=correction&title=${encodeURIComponent(`Correction: ${r.title}`)}&body=${encodeURIComponent(body)}`;
}
function uncertaintyLine(r) { // how exact the pin and the date are, in the record's own stated margins
  const km = r.where?.uncertainty_km, u = r.when?.uncertainty || {}, yrs = Math.max(u.start_minus_years || 0, u.start_plus_years || 0, u.end_minus_years || 0, u.end_plus_years || 0), bits = [];
  if (km >= 5 && km < 5000) bits.push(`Place within about ${Math.round(km).toLocaleString()} km`);
  if (yrs >= 1) bits.push(`dates within about ${fmtSpan(yrs)}`);
  return bits.length ? `<small>${esc(bits.join(' · '))}</small>` : '';
}
async function shareRecord(e) { // the plain page carries a preview for chat apps and search engines, and links on to the globe
  const r = state.openRec, url = LIVE ? location.href : new URL(`r/${r.id}.html`, location.href.split('#')[0]).href, b = e.currentTarget;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: r.title, url }); } catch {} return; }
  try { await navigator.clipboard.writeText(url); b.textContent = 'Link copied'; } catch { prompt('Copy this link', url); }
  setTimeout(() => { if (b.isConnected) b.textContent = 'Copy link'; }, 1600);
}
// Cause and effect drawn on the globe (spec 11.8): an arc from each cause to its effect, for the open record's causal links
function causalArcs(r) {
  if (r.where?.lat == null || (r.where.uncertainty_km ?? 0) >= 5000) return [];
  const here = placed({ lat: r.where.lat, lon: r.where.lon });
  return (r.related || []).filter(x => x.type === 'caused' || x.type === 'caused_by').flatMap(x => {
    const p = state.pins.find(q => q.id === x.id);
    if (!p || p.lat == null || p.global) return [];
    const there = placed(p), out = x.type === 'caused';
    return [{ id: p.id, title: p.title, because: x.because, label: out ? 'Led to' : 'Caused by', color: out ? ['#d9b36a', '#f0d9a4'] : ['#8fb0e8', '#d9b36a'],
      a: out ? here.lat : there.lat, b: out ? here.lon : there.lon, c: out ? there.lat : here.lat, d: out ? there.lon : here.lon }];
  });
}
function kmBetween(a, b, c, d) {
  const R = Math.PI / 180, h = Math.sin((c - a) * R / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin((d - b) * R / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
// What else was happening: other records of about the same date, near this one and across the other regions of the world
function meanwhile(r) {
  const y = r.when?.start?.year;
  if (y == null) return '';
  const w = Math.max(5, (NOW - y) * 0.02), longest = Math.max(150, w * 10), listed = new Set((r.related || []).map(x => x.id));
  const others = state.pins.filter(p => p.id !== r.id && p.lat != null && !p.global && !listed.has(p.id) && p.start <= y + w && p.until >= y - w && p.until - p.start <= longest)
    .sort((a, b) => (a.kind === 'person') - (b.kind === 'person') || b.importance - a.importance || Math.abs(a.start - y) - Math.abs(b.start - y));   // people last: a long life overlaps nearly everything
  const pinned = r.where?.lat != null && (r.where.uncertainty_km ?? 0) < 5000;
  const near = pinned ? others.filter(p => kmBetween(r.where.lat, r.where.lon, p.lat, p.lon) < 1000).slice(0, 4) : [];
  const regions = new Set([r.regions?.[0]]), far = [];
  for (const p of others) { if (far.length >= 5) break; if (!near.includes(p) && p.region && !regions.has(p.region)) { regions.add(p.region); far.push(p); } }
  if (!near.length && !far.length) return '';
  const row = p => `<button data-id="${esc(p.id)}"><i>${esc(fmtYear(p.start, true))}</i>${esc(p.title)}</button>`;
  return `<section><h3>Meanwhile</h3>${near.length ? `<div class="mw-h">Nearby</div><div class="rel">${near.map(row).join('')}</div>` : ''}${far.length ? `<div class="mw-h">Elsewhere in the world</div><div class="rel">${far.map(row).join('')}</div>` : ''}</section>`;
}
// ---------- lists of pins: a dense spot opened, or everything shown now (for the keyboard and for crowded screens)
function openPinList(title, pins) {
  const box = $('#pinlist');
  box.innerHTML = `<h2>${esc(title)}<button aria-label="Close list">×</button></h2><ul>${pins.map(p => `<li><button data-id="${esc(p.id)}"><img alt="" src="${badgeURL(p.domains?.[0], !p.outline)}"><span>${esc(p.title)}</span><span class="d">${esc(p.display || '')}</span></button></li>`).join('')}</ul>`;
  box.querySelector('h2 button').onclick = closePinList;
  box.querySelectorAll('button[data-id]').forEach(b => { b.onclick = () => openRecord(b.dataset.id); });
  show(box, true); $('#list-btn').setAttribute('aria-expanded', 'true');
  box.querySelector('button[data-id]')?.focus({ preventScroll: true });
}
function closePinList() { show($('#pinlist'), false); $('#list-btn').setAttribute('aria-expanded', 'false'); }
function openCluster(c) {
  openPinList(`${c.cluster.length} records here`, c.cluster);
  globe.pointOfView({ lat: c.lat, lng: c.lon, altitude: Math.max(0.15, state.alt * 0.55) }, 800);
}
$('#list-btn').onclick = () => {
  if (!$('#pinlist').hidden) return closePinList();
  const pins = visiblePins().filter(p => !p.global).sort((a, b) => b.importance - a.importance || a.start - b.start);
  openPinList(`${pins.length} records shown now`, pins.slice(0, 200));
};
addEventListener('keydown', e => { if (e.key === 'Escape') { closePinList(); closeWelcome(); } });
// ---------- tours: a fixed order of existing records, each opened in turn; no text beyond the records' own
let tours = null;
const loadTours = async () => { if (!tours) { await dataReady; const known = new Set(state.pins.map(p => p.id)); tours = (await (await fetch('tours.json')).json()).map(t => ({ ...t, stops: t.stops.filter(id => known.has(id)) })).filter(t => t.stops.length >= 2); } return tours; };
function tourNav() {
  const t = state.tour;
  return t ? `<div class="tour-nav"><span>${esc(t.title)} · ${t.i + 1} of ${t.stops.length}</span><button id="tour-prev" aria-label="Previous stop" ${t.i ? '' : 'disabled'}>‹</button><button id="tour-next" aria-label="Next stop" ${t.i < t.stops.length - 1 ? '' : 'disabled'}>›</button><button id="tour-end" aria-label="Leave the tour">×</button></div>` : '';
}
function tourStep(d) { const t = state.tour; if (t && t.stops[t.i + d]) goTo(t.stops[t.i + d]); }
async function startTour(id, i = 0) {
  const t = (await loadTours()).find(x => x.id === id);
  if (!t) return;
  closeWelcome();
  state.tour = { id, title: t.title, stops: t.stops, i: Math.min(i, t.stops.length - 1) };
  goTo(state.tour.stops[state.tour.i]);
}
// ---------- the film: the last billion years, played like a record's sequence, each caption drawn from the record it names
const filmDate = ma => {
  if (ma >= 999.5) return '1 billion years ago';
  if (ma >= 1) return `${Math.round(ma)} million years ago`;
  const y = ma * 1e6 + NOW;   // the clock counts from year 0, the words from today
  if (y < 200) return 'Today';
  return `${(Math.round(y / (y >= 100000 ? 10000 : y >= 10000 ? 1000 : 100)) * (y >= 100000 ? 10000 : y >= 10000 ? 1000 : 100)).toLocaleString('en-US')} years ago`;
};
function endFilm() {
  state.film = false; document.body.classList.remove('film'); show($('#film'), false);
  globe.camera().clearViewOffset(); globe.controls().enabled = true; seqPaused = false; updateSky(); render();
}
// The plate model loads on demand; a pointer or focus on a way into deep time starts the download early.
const loadPaleo = () => window.Space?.loadPaleo?.() || Promise.resolve();
function prefetchIceAge(el) { for (const ev of ['pointerenter', 'focus', 'touchstart']) el.addEventListener(ev, () => window.Space?.loadIceAge?.(), { once: true, passive: true }); }
function prefetchPaleo(el) { for (const ev of ['pointerenter', 'focus', 'touchstart']) el.addEventListener(ev, () => loadPaleo(), { once: true, passive: true }); }
async function startFilm() {
  if (!deepTime) return;
  closeWelcome(); if (state.selected) closePanel(); if (timer) stopPlay();
  const f = deepTime.film, box = $('#film');
  state.film = true; document.body.classList.add('film'); globe.controls().enabled = false; show(box, true); render();
  $('#film-credit').textContent = f.credit; $('#film-big').textContent = f.title; $('#film-big').classList.add('on');
  $('#film-pause').innerHTML = PAUSE.replace('12" height="12"', '13" height="13"'); $('#film-pause').setAttribute('aria-label', 'Pause film');
  $('#film-text').classList.remove('on'); $('#film-bar').style.width = '0';
  seqPaused = false; box.focus({ preventScroll: true });
  globe.camera().setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.08, innerWidth, innerHeight);
  const chapter = c => {
    $('#film-text').classList.remove('on');
    setTimeout(() => {
      if (!state.film) return;
      if (c) $('#film-big').classList.remove('on');   // the title stays until the first chapter
      $('#film-chapter').textContent = c ? c.title : ''; $('#film-caption').textContent = c ? c.caption : '';
      if (c) $('#film-text').classList.add('on');
    }, 350);
  };
  await loadPaleo();   // the moving continents must be ready before the first frame
  if (!state.film) return;   // closed while it loaded
  let lastDate = '', ended = false;
  window.Sequence.film(f, {
    globe, getTime: () => state.t,
    setTime: y => { state.t = Math.min(y, NOW); const lv = levelFor(state.t); if (lv !== state.level && state.level !== 6) setLevel(lv, true); else render(); },
    ride: ({ lat, lng }) => { const q = placed({ lat, lon: lng }); return { lat: q.lat, lng: q.lon }; },
    ui: {
      fade: on => $('#film-fade').classList.toggle('on', on),
      title: () => {},
      chapter,
      progress: (k, ma) => {
        $('#film-bar').style.width = `${Math.min(100, k * 100).toFixed(2)}%`;
        const d = filmDate(ma); if (d !== lastDate) { lastDate = d; $('#film-date').textContent = d; }
        if (vitals) { const line = [['temp', 'Temperature'], ['co2', 'CO₂'], ['day', 'Day']].map(([k, l]) => { const v = vitalAt(vitals.series[k], ma); return v == null ? '' : `${l} ${vitalText(k, v, ma)}`; }).filter(Boolean).join('  ·  '), el = $('#film-vitals'); if (el.textContent !== line) el.textContent = line; }
        if (k * f.length >= f.endAt && !ended) { ended = true; chapter(null); setTimeout(() => { if (state.film) { $('#film-big').innerHTML = `Today<small>${esc(f.end)}</small>`; $('#film-big').classList.add('on'); } }, 400); }
      },
    },
    onEnd: endFilm,
  });
}
const closeFilm = () => { window.Sequence.stop(); $('#film-fade').classList.remove('on'); endFilm(); };
$('#film-close').onclick = closeFilm;
$('#film-pause').onclick = () => { seqPaused = !seqPaused; window.Sequence.setPaused(seqPaused); $('#film-pause').setAttribute('aria-label', seqPaused ? 'Resume film' : 'Pause film'); $('#film-pause').innerHTML = (seqPaused ? PLAY : PAUSE).replace('12" height="12"', '13" height="13"'); };
$('#film-prev').onclick = () => window.Sequence.filmControl?.step(-1);
$('#film-next').onclick = () => window.Sequence.filmControl?.step(1);
addEventListener('keydown', e => {
  if (!state.film) return;
  if (e.key === 'Escape') { e.preventDefault(); closeFilm(); }
  else if (e.key === ' ' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); $('#film-pause').click(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); $('#film-prev').click(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); $('#film-next').click(); }
});
// ---------- welcome card: what this is, where to start, what happened on this date
function onThisDay() {
  const d = new Date(), md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return state.pins.filter(p => p.md === md).sort((a, b) => b.importance - a.importance || b.start - a.start).slice(0, 3);
}
async function openWelcome() {
  const list = await loadTours(), today = onThisDay(), box = $('#welcome');
  box.innerHTML = `<h2>Living Atlas</h2>
    <p>Earth and human history, placed where and when it happened. Drag the globe, move the time bar, and open any pin to read its record and sources.</p>
    ${today.length ? `<h3>On this day</h3><ul class="tour-list">${today.map(p => `<li><button data-id="${esc(p.id)}"><b>${esc(p.title)}</b><span>${esc(p.display)}</span></button></li>`).join('')}</ul>` : ''}
    <h3>Watch</h3><ul class="tour-list"><li><button id="film-btn"><b>${esc(deepTime?.film.title || 'A billion years of Earth')}</b><span>${esc(deepTime?.film.blurb || '')}</span></button></li></ul>
    <h3>Take a tour</h3><ul class="tour-list">${list.map(t => `<li><button data-tour="${esc(t.id)}"><b>${esc(t.title)}</b><span>${esc(t.blurb)} ${t.stops.length} stops.</span></button></li>`).join('')}</ul>
    <div class="welcome-foot"><span>Written by AI models from cited sources. <a href="about.html">How this is made</a></span><button id="welcome-close">Explore on my own</button></div>`;
  box.querySelectorAll('button[data-tour]').forEach(b => { b.onclick = () => startTour(b.dataset.tour); });
  box.querySelectorAll('button[data-id]').forEach(b => { b.onclick = () => { closeWelcome(); goTo(b.dataset.id); }; });
  box.querySelector('#welcome-close').onclick = closeWelcome;
  box.querySelector('#film-btn').onclick = startFilm; prefetchPaleo(box.querySelector('#film-btn'));
  show(box, true); box.querySelector('button')?.focus({ preventScroll: true });
}
function closeWelcome() { if ($('#welcome').hidden) return; show($('#welcome'), false); try { localStorage.setItem('atlas.welcomed', '1'); } catch {} }
$('#start').onclick = openWelcome;
// ---------- the address bar: #t=1945&l=modern&r=<record id>&tour=<id>. Opening or closing a record adds a history entry,
// so Back returns to the record before; moving through time only updates the current entry.
let urlTimer = 0, restoring = true;   // nothing is written until the records have loaded, or the opening view would overwrite a shared link
function stateHash() {
  const h = new URLSearchParams(), level = LEVELS[state.level].key;
  if (state.selected || state.t !== -500 || level !== 'civilization') { h.set('t', String(+state.t.toPrecision(7))); h.set('l', level); }
  if (state.selected) h.set('r', state.selected);
  if (state.tour) h.set('tour', state.tour.id);
  const out = h.toString();
  return out ? `#${out}` : '';
}
function writeURL(push) {
  clearTimeout(urlTimer);
  if (restoring) return;
  const h = stateHash();
  if (h !== location.hash) history[push ? 'pushState' : 'replaceState'](null, '', h || location.pathname + location.search);
}
function queueURL() { clearTimeout(urlTimer); urlTimer = setTimeout(() => writeURL(false), 400); }
async function applyHash() {
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
function flash(msg) { const n = $('#notice'); n.textContent = msg; show(n, true); setTimeout(() => render(), 2500); }

// ---------- live data
let lastSig = '';
async function refresh() {
  try {
    const d = await (await fetch('api/pins.json', { cache: LIVE ? 'no-store' : 'default' })).json();
    const sig = d.pins.map(p => p.id + p.updated).join('|');
    if (sig === lastSig) return;
    if (lastSig) recordCache.clear();   // something changed on the live server
    lastSig = sig; state.pins = d.pins.map(window.AtlasPins.expand);
    $('#count').textContent = `${(d.count + d.outlines).toLocaleString()} records`;
    $('#count').title = `${d.count} full records, ${d.outlines.toLocaleString()} outlines`;
    buildLegend(); render();
    if (teasers || teasersWanted) applyTeasers();
  } catch (e) {
    // a failed check for new records changes nothing while the records already loaded are on screen: stay quiet and try again next time
    if (state.pins.length) console.warn('atlas data refresh failed', e);
    else flash(`The atlas data could not be loaded (${e.message}). ${LIVE ? 'Is the viewer server running?' : 'Check your connection and reload the page.'}`);
  }
  $('#loading').classList.add('gone');
  setTimeout(() => show($('#loading'), false), 700); // don't rely on the fade finishing
}
// Tooltip teasers (api/teasers.json, 0.5 MB) load at the visitor's first move, tap or key press, so a first visit that
// only looks does not download them; until they arrive a tooltip or the instant panel shows no summary. Locally they
// are fetched again whenever the pins change.
let teasers = null, teasersSig = '', teasersWanted = false, teasersLoad = null;
function wantTeasers(e) {
  if (teasersWanted || (e.type === 'pointermove' && !e.movementX && !e.movementY)) return;   // the browser's own synthetic moves don't count
  teasersWanted = true; dataReady.then(applyTeasers);
}
for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) addEventListener(ev, wantTeasers, { passive: true });
async function applyTeasers() {
  if (!teasers || (LIVE && teasersSig !== lastSig)) {
    const sig = lastSig;   // one request at a time, shared by every caller
    teasersLoad = teasersLoad || fetch('api/teasers.json', { cache: LIVE ? 'no-store' : 'default' }).then(r => r.json()).finally(() => { teasersLoad = null; });
    try { teasers = await teasersLoad; teasersSig = sig; }
    catch (e) { console.warn('atlas teasers failed', e); return; }
  }
  for (const p of state.pins) if (teasers[p.id] != null) p.summary = teasers[p.id];
}
// collapsible legend; remembered per viewer (storage may be unavailable, so it is optional)
const legendKey = `atlas.legend.collapsed.${innerWidth < 760 ? 'phone' : 'desktop'}`;
let collapsed = innerWidth < 760;
try { const v = localStorage.getItem(legendKey); if (v != null) collapsed = v === '1'; } catch {}
function setLegend(c) {
  collapsed = c; $('#legend').classList.toggle('collapsed', c); $('#legend-toggle').setAttribute('aria-expanded', String(!c));
  try { localStorage.setItem(legendKey, c ? '1' : '0'); } catch {}
}
$('#legend-toggle').onclick = () => setLegend(!collapsed);
setLegend(collapsed);
// first-visit hint: fades on the first real interaction with the globe
const dismissHint = () => { $('#hint').classList.add('fade'); setTimeout(() => show($('#hint'), false), 900); };
for (const ev of ['pointerdown', 'wheel', 'touchstart']) $('#globe').addEventListener(ev, dismissHint, { once: true, passive: true });
setTimeout(dismissHint, 12000);
window.atlas = { openRecord, goTo, state, globe, startTour, startFilm }; // handy for debugging from the console
buildChrome(); setLevel(4);
// Live refresh only against the local server, where records are being published; the static site's data changes
// only with a new deploy, so it is fetched once (and can be cached).
const LIVE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const dataReady = refresh(); if (LIVE) setInterval(refresh, 15000);
dataReady.then(() => { // a link to a place in the atlas opens there; a first visit with no link gets the welcome card
  if (location.hash.length > 1) return applyHash();
  restoring = false;
  let seen = false;
  try { seen = !!localStorage.getItem('atlas.welcomed'); } catch {}
  if (!seen) openWelcome();
});
