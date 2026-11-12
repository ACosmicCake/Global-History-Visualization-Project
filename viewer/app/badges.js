// Pin badges: each domain's colour and glyph, drawn once per domain on a canvas, and the textures built from them
// (badge, dot, stack, crowd and the selection halo).
const { THREE } = window;

// name, colour, glyph: each domain has its own colour and its own symbol, so pins read apart even where hues are close
export const DOMAINS = {
  geology_climate: ['Geology & climate', '#6b8cff', 'mountain'],
  life_extinction: ['Life & extinction', '#4ade80', 'leaf'],
  human_evolution_migration: ['Human origins', '#fb923c', 'steps'],
  civilizations_empires: ['Civilizations', '#facc15', 'temple'],
  wars_conflict: ['War & conflict', '#ef4444', 'swords'],
  atrocity_injustice: ['Atrocity & injustice', '#c0266d', 'drop'],
  law_politics_rights: ['Law & rights', '#cbd5e1', 'scales'],
  people: ['People', '#f472b6', 'person'],
  science_technology: ['Science & tech', '#22d3ee', 'atom'],
  art_music_literature: ['Arts', '#a78bfa', 'note'],
  religion_philosophy: ['Religion & thought', '#fde68a', 'sun'],
  disease: ['Disease', '#a3e635', 'cross'],
  trade_exploration: ['Trade & exploration', '#2dd4bf', 'compass'],
  built_world: ['Built world', '#d6a77a', 'arch'],
};
export const baseColor = p => (DOMAINS[p.domains?.[0]] || [0, '#ffffff'])[1];
// outlines (amendment A1) draw as faint, translucent pins so full records stand out
export const colorOf = p => (p.outline ? baseColor(p) + '66' : baseColor(p));
// ---------- pin badges: a coloured disc with the domain's glyph, drawn once per domain on a canvas
export function drawGlyph(g, kind, s) {
  // s = glyph box size; origin at the badge centre; dark ink on the coloured disc
  const L = (pts, close) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
    if (close) g.closePath();
  };
  g.lineWidth = s * 0.13;
  g.lineCap = g.lineJoin = 'round';
  switch (kind) {
    case 'mountain':
      L(
        [
          [-0.5, 0.32],
          [-0.12, -0.3],
          [0.08, 0.02],
          [0.22, -0.14],
          [0.5, 0.32],
        ],
        true,
      );
      g.fill();
      break;
    case 'leaf':
      g.beginPath();
      g.ellipse(0, 0, s * 0.2, s * 0.42, Math.PI / 4, 0, 7);
      g.fill();
      break;
    case 'steps':
      for (const [x, y] of [
        [-0.18, 0.2],
        [0.18, -0.16],
      ]) {
        g.beginPath();
        g.ellipse(x * s, y * s, s * 0.11, s * 0.19, 0, 0, 7);
        g.fill();
      }
      break;
    case 'temple':
      L(
        [
          [-0.46, -0.16],
          [0, -0.42],
          [0.46, -0.16],
        ],
        true,
      );
      g.fill();
      g.fillRect(-0.46 * s, 0.28 * s, 0.92 * s, 0.12 * s);
      for (const x of [-0.33, 0, 0.33]) g.fillRect((x - 0.06) * s, -0.14 * s, 0.12 * s, 0.42 * s);
      break;
    case 'swords':
      L([
        [-0.36, -0.36],
        [0.36, 0.36],
      ]);
      g.stroke();
      L([
        [0.36, -0.36],
        [-0.36, 0.36],
      ]);
      g.stroke();
      break;
    case 'drop':
      L(
        [
          [0, -0.44],
          [0.3, 0.06],
          [0, 0.42],
          [-0.3, 0.06],
        ],
        true,
      );
      g.fill();
      break;
    case 'scales':
      L([
        [-0.4, -0.22],
        [0.4, -0.22],
      ]);
      g.stroke();
      L([
        [0, -0.4],
        [0, 0.36],
      ]);
      g.stroke();
      L([
        [-0.22, 0.36],
        [0.22, 0.36],
      ]);
      g.stroke();
      for (const x of [-0.4, 0.4]) {
        L(
          [
            [x - 0.16, 0.1],
            [x, -0.18],
            [x + 0.16, 0.1],
          ],
          true,
        );
        g.fill();
      }
      break;
    case 'person':
      g.beginPath();
      g.arc(0, -0.2 * s, s * 0.17, 0, 7);
      g.fill();
      g.beginPath();
      g.ellipse(0, 0.32 * s, s * 0.32, s * 0.22, 0, Math.PI, 0);
      g.fill();
      break;
    case 'atom':
      g.lineWidth = s * 0.08;
      for (const a of [0, Math.PI / 3, -Math.PI / 3]) {
        g.beginPath();
        g.ellipse(0, 0, s * 0.44, s * 0.16, a, 0, 7);
        g.stroke();
      }
      g.beginPath();
      g.arc(0, 0, s * 0.09, 0, 7);
      g.fill();
      break;
    case 'note':
      g.beginPath();
      g.ellipse(-0.1 * s, 0.26 * s, s * 0.17, s * 0.12, -0.4, 0, 7);
      g.fill();
      L([
        [0.06, 0.24],
        [0.06, -0.42],
        [0.32, -0.28],
      ]);
      g.stroke();
      break;
    case 'sun':
      g.beginPath();
      g.arc(0, 0, s * 0.18, 0, 7);
      g.fill();
      g.lineWidth = s * 0.09;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        L([
          [Math.cos(a) * 0.3, Math.sin(a) * 0.3],
          [Math.cos(a) * 0.44, Math.sin(a) * 0.44],
        ]);
        g.stroke();
      }
      break;
    case 'cross':
      g.fillRect(-0.12 * s, -0.4 * s, 0.24 * s, 0.8 * s);
      g.fillRect(-0.4 * s, -0.12 * s, 0.8 * s, 0.24 * s);
      break;
    case 'compass':
      L(
        [
          [0, -0.46],
          [0.13, 0],
          [0, 0.46],
          [-0.13, 0],
        ],
        true,
      );
      g.fill();
      L(
        [
          [-0.46, 0],
          [0, -0.13],
          [0.46, 0],
          [0, 0.13],
        ],
        true,
      );
      g.fill();
      break;
    case 'arch':
      g.beginPath();
      g.moveTo(-0.38 * s, 0.38 * s);
      g.lineTo(-0.38 * s, -0.04 * s);
      g.arc(0, -0.04 * s, 0.38 * s, Math.PI, 0);
      g.lineTo(0.38 * s, 0.38 * s);
      g.lineTo(0.18 * s, 0.38 * s);
      g.lineTo(0.18 * s, -0.04 * s);
      g.arc(0, -0.04 * s, 0.18 * s, 0, Math.PI, true);
      g.lineTo(-0.18 * s, 0.38 * s);
      g.closePath();
      g.fill();
      break;
    default:
      g.beginPath();
      g.arc(0, 0, s * 0.16, 0, 7);
      g.fill();
  }
}
export const BADGE_PX = 96,
  GOLD = '#e3bd6e',
  badgeCache = new Map();
export function badgeCanvas(domain, full) {
  const key = `${domain}|${full}`;
  if (badgeCache.has(key)) return badgeCache.get(key);
  const [, col, glyph] = DOMAINS[domain] || ['', '#e8edf4', ''];
  const c = document.createElement('canvas');
  c.width = c.height = BADGE_PX;
  const g = c.getContext('2d'),
    m = BADGE_PX / 2,
    r = BADGE_PX * 0.34;
  g.translate(m, m);
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = BADGE_PX * 0.09;
  g.shadowOffsetY = BADGE_PX * 0.02;
  g.beginPath();
  g.arc(0, 0, r, 0, 7);
  g.fillStyle = col;
  g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = full ? BADGE_PX * 0.07 : BADGE_PX * 0.025; // full records wear a gold ring, outlines a fine pale one
  g.strokeStyle = full ? GOLD : 'rgba(255,255,255,0.5)';
  g.stroke();
  g.fillStyle = g.strokeStyle = 'rgba(12,17,28,0.88)';
  drawGlyph(g, glyph, r * 1.15);
  badgeCache.set(key, c);
  return c;
}
export const urlCache = new Map();
export const badgeURL = (domain, full) => {
  const k = `${domain}|${full}`;
  if (!urlCache.has(k)) urlCache.set(k, badgeCanvas(domain, full).toDataURL());
  return urlCache.get(k);
};
export const texCache = new Map();
export function badgeTexture(domain, full) {
  const key = `${domain}|${full}`;
  if (!texCache.has(key)) {
    const t = new THREE.CanvasTexture(badgeCanvas(domain, full));
    t.anisotropy = 4;
    texCache.set(key, t);
  }
  return texCache.get(key);
}
// A quiet record is a small dot, drawn small inside its sprite so the sprite stays an easy target for the pointer.
export const DOT_R = BADGE_PX * 0.2,
  textureCache = new Map();
export function cachedTexture(key, draw) {
  if (textureCache.has(key)) return textureCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = BADGE_PX;
  const g = c.getContext('2d');
  g.translate(BADGE_PX / 2, BADGE_PX / 2);
  draw(g, c);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  textureCache.set(key, t);
  return t;
}
export const dotTexture = (domain, full) =>
  cachedTexture(`dot|${domain}|${full}`, g => {
    const col = (DOMAINS[domain] || ['', '#e8edf4'])[1];
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = BADGE_PX * 0.05;
    g.beginPath();
    g.arc(0, 0, DOT_R, 0, 7);
    g.fillStyle = col;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = full ? BADGE_PX * 0.07 : BADGE_PX * 0.03;
    g.strokeStyle = full ? GOLD : 'rgba(8,12,20,0.75)';
    g.stroke();
  });
// several quiet records at one spot: a small dark dot with a gold ring, which opens a list
export const stackTexture = () =>
  cachedTexture('stack', g => {
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = BADGE_PX * 0.05;
    g.beginPath();
    g.arc(0, 0, DOT_R * 1.05, 0, 7);
    g.fillStyle = '#10182a';
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = BADGE_PX * 0.065;
    g.strokeStyle = GOLD;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, DOT_R * 0.32, 0, 7);
    g.fillStyle = GOLD;
    g.fill();
  });
// major records that share a spot: the most important one's marker, with a count beside it
export const crowdTexture = (domain, full, n) => {
  const label = n > 99 ? '99+' : String(n);
  return cachedTexture(`crowd|${domain}|${full}|${label}`, g => {
    g.drawImage(badgeCanvas(domain, full), -BADGE_PX / 2, -BADGE_PX / 2);
    const x = BADGE_PX * 0.27,
      y = -BADGE_PX * 0.27,
      r = BADGE_PX * 0.17;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fillStyle = '#10182a';
    g.fill();
    g.lineWidth = BADGE_PX * 0.025;
    g.strokeStyle = GOLD;
    g.stroke();
    g.fillStyle = '#f4e7c8';
    g.font = `600 ${BADGE_PX * (label.length > 1 ? 0.15 : 0.2)}px "IBM Plex Sans", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x, y + BADGE_PX * 0.008);
  });
};
// which records stand out at this height: 5s and 4s always; lesser ones as the camera closes in
export const CLOSE_AT = { 3: 0.3, 2: 0.15, 1: 0.08 };
export const isMajor = p => p.importance >= 4;
export const standsOut = (p, alt) => isMajor(p) || alt < (CLOSE_AT[p.importance] ?? CLOSE_AT[1]);
export const pinTexture = (p, big) =>
  p.cluster
    ? isMajor(p)
      ? crowdTexture(p.domains?.[0], !p.outline, p.cluster.length)
      : stackTexture()
    : big
      ? badgeTexture(p.domains?.[0], !p.outline)
      : dotTexture(p.domains?.[0], !p.outline);
export const haloTexture = (() => {
  // soft pulsing ring behind the selected pin
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  g.beginPath();
  g.arc(0, 0, 52, 0, 7);
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 40, 0, 7);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fill();
  return new THREE.CanvasTexture(c);
})();
