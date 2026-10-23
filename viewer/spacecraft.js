// Spacecraft in the sky (an artistic layer over real data): Earth-orbiting craft circle the globe on their real
// altitude and inclination while they were in service, the Apollo landing sites sit on the Moon from their landing
// dates, and the Voyager probes are marked in their real directions on the sky, heading out of the Solar System.
// Orbital speed is sped up and orbit height tripled so the motion reads (real heights would sit inside the globe's
// glow); positions along the orbit and the probes' distances are not to scale.
// Exposes window.Spacecraft = { init(globe, { onPick, known }), update(year, date) }.
(function () {
  const { THREE } = window;
  const R = 100, EARTH_KM = 6371;
  const rad = d => (d * Math.PI) / 180;
  const norm = a => ((a % 360) + 360) % 360;
  const gmst = date => norm(280.46061837 + 360.98564736629 * (date.getTime() / 864e5 - 10957.5));
  const yearOf = (y, m = 1, d = 1) => y + (m - 1) / 12 + (d - 1) / 365;

  // record: the atlas id each object opens (only when that record is published)
  const ORBITERS = [
    { id: '1957-launch-of-sputnik-1', name: 'Sputnik 1', km: 577, inc: 65.1, node: 30, from: yearOf(1957, 10, 4), to: yearOf(1958, 1, 4), period: 26 },
    { id: '1986-mir-space-station', name: 'Mir', km: 390, inc: 51.6, node: 140, from: yearOf(1986, 2, 20), to: yearOf(2001, 3, 23), period: 34 },
    { id: '1990-hubble-space-telescope', name: 'Hubble', km: 540, inc: 28.5, node: 250, from: yearOf(1990, 4, 24), to: Infinity, period: 38 },
    { id: '1998-international-space-station', name: 'ISS', km: 420, inc: 51.6, node: 330, from: yearOf(1998, 11, 20), to: Infinity, period: 32 },
  ];
  const APOLLO = [ // landing sites (selenographic lat, lon), from NASA's Apollo landing coordinates
    { id: '1969-07-20-apollo-11', name: 'Apollo 11', lat: 0.674, lon: 23.473, from: yearOf(1969, 7, 20) },
    { id: null, name: 'Apollo 12', lat: -3.012, lon: -23.422, from: yearOf(1969, 11, 19) },
    { id: null, name: 'Apollo 14', lat: -3.645, lon: -17.471, from: yearOf(1971, 2, 5) },
    { id: null, name: 'Apollo 15', lat: 26.132, lon: 3.634, from: yearOf(1971, 7, 30) },
    { id: null, name: 'Apollo 16', lat: -8.973, lon: 15.500, from: yearOf(1972, 4, 21) },
    { id: null, name: 'Apollo 17', lat: 20.191, lon: 30.772, from: yearOf(1972, 12, 11) },
  ];
  const PROBES = [ // present-day sky directions (right ascension, declination in degrees)
    { id: '1977-voyager-1', name: 'Voyager 1 · interstellar space', ra: 258.3, dec: 12.0, from: yearOf(1977, 9, 5) },
    { id: '1977-voyager-2', name: 'Voyager 2 · interstellar space', ra: 299.0, dec: -58.9, from: yearOf(1977, 8, 20) },
  ];

  let globe = null, opts = {}, root = null, moonGroup = null;
  const pickables = []; // { sprite, id }

  function labelSprite(text, color) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), px = 26, pad = 10;
    g.font = `500 ${px}px "IBM Plex Mono", ui-monospace, monospace`;
    c.width = Math.ceil(g.measureText(text).width) + pad * 2 + 30; c.height = px + pad * 2;
    g.font = `500 ${px}px "IBM Plex Mono", ui-monospace, monospace`; g.textBaseline = 'middle';
    g.fillStyle = color; g.beginPath(); g.arc(14, c.height / 2, 7, 0, 7); g.fill();
    g.lineWidth = 6; g.strokeStyle = 'rgba(6,9,16,0.85)'; g.strokeText(text, 30, c.height / 2);
    g.fillStyle = 'rgba(236,240,246,0.95)'; g.fillText(text, 30, c.height / 2);
    const tex = new THREE.CanvasTexture(c), s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false }));
    const h = 0.034; s.scale.set(h * c.width / c.height, h, 1); s.center.set(14 / c.width, 0.5); s.renderOrder = 9;
    return s;
  }
  function dot(color, size = 0.012) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, color); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false }));
    s.scale.setScalar(size); s.renderOrder = 9; return s;
  }

  function init(g, o = {}) {
    globe = g; opts = o;
    root = new THREE.Group(); globe.scene().add(root);
    // Earth orbiters: a faint ring on the orbit's plane and a bright craft riding it
    for (const ob of ORBITERS) {
      const r = R * (1 + 3 * ob.km / EARTH_KM), pts = []; // three times the real height, for visibility
      for (let i = 0; i <= 128; i++) { const a = (i / 128) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
      const plane = new THREE.Group();
      plane.rotation.order = 'YXZ'; plane.rotation.y = rad(ob.node); plane.rotation.x = rad(ob.inc);
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9cc3ff, transparent: true, opacity: 0.38, depthWrite: false }));
      const craft = dot('#bcd8ff', 0.013), label = labelSprite(ob.name, '#9cc3ff');
      plane.add(ring, craft, label); root.add(plane);
      Object.assign(ob, { plane, craft, label, r });
      pickables.push({ sprite: craft, id: ob.id }, { sprite: label, id: ob.id });
    }
    // Voyager probes: far out in their sky direction (placed each update, as the sky turns with the date)
    for (const p of PROBES) {
      p.mark = dot('#ffd27a', 0.016); p.label = labelSprite(p.name, '#ffd27a');
      root.add(p.mark, p.label); pickables.push({ sprite: p.mark, id: p.id }, { sprite: p.label, id: p.id });
    }
    // pointer picking: a click (not a drag) within a few pixels of a visible craft or label opens its record
    const el = globe.renderer().domElement; let down = null;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const hit = pick(e.clientX, e.clientY); if (hit && opts.onPick) opts.onPick(hit);
    });
  }
  // Apollo markers ride on the Moon mesh, at the texture spot for each landing site (SphereGeometry's uv mapping)
  function ensureMoon() {
    if (moonGroup) return true;
    const moon = window.Space?.debug?.moon;
    if (!moon) return false;
    moonGroup = new THREE.Group(); moon.add(moonGroup);
    const r = moon.geometry.parameters.radius * 1.01;
    for (const a of APOLLO) {
      const phi = rad(a.lon + 180), theta = rad(90 - a.lat);
      const pos = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)).multiplyScalar(r);
      a.mark = dot('#ffe9a8', 0.009); a.mark.position.copy(pos);
      a.label = a.name === 'Apollo 11' ? labelSprite('Apollo 11 · first Moon landing', '#ffe9a8') : null;
      if (a.label) a.label.position.copy(pos);
      moonGroup.add(a.mark); if (a.label) moonGroup.add(a.label);
      if (a.id) pickables.push({ sprite: a.mark, id: a.id }, ...(a.label ? [{ sprite: a.label, id: a.id }] : []));
    }
    return true;
  }

  const _v = new THREE.Vector3();
  function pick(x, y) {
    const cam = globe.camera(), el = globe.renderer().domElement, rect = el.getBoundingClientRect();
    let best = null, bd = 16;
    for (const p of pickables) {
      if (!p.id || !p.sprite.visible || !isVisible(p.sprite) || (opts.known && !opts.known(p.id))) continue;
      p.sprite.getWorldPosition(_v).project(cam);
      if (_v.z > 1) continue;
      const sx = rect.left + (_v.x + 1) * rect.width / 2, sy = rect.top + (1 - _v.y) * rect.height / 2;
      const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = p.id; }
    }
    return best;
  }
  const isVisible = o => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; };

  let lastYear = null, lastDate = new Date();
  function update(year, date) {
    if (!root) return;
    lastYear = year;
    const now = performance.now() / 1000;
    for (const ob of ORBITERS) {
      const on = year >= ob.from && year <= ob.to;
      ob.plane.visible = on;
      if (!on) continue;
      const a = (now / ob.period) * Math.PI * 2;
      ob.craft.position.set(Math.cos(a) * ob.r, 0, Math.sin(a) * ob.r);
      ob.label.position.copy(ob.craft.position); ob.label.visible = true; // clearHeader may hide it again this frame
    }
    const g = gmst(date && !isNaN(date) ? date : new Date());
    for (const p of PROBES) {
      const on = year >= p.from;
      p.mark.visible = p.label.visible = on;
      if (!on) continue;
      const c = globe.getCoords(p.dec, norm(p.ra - g + 180) - 180, 0);
      _v.set(c.x, c.y, c.z).normalize().multiplyScalar(R * 3.2);
      p.mark.position.copy(_v); p.label.position.copy(_v);
    }
    if (ensureMoon()) for (const a of APOLLO) { a.mark.visible = year >= a.from; if (a.label) a.label.visible = year >= a.from; }
    clearHeader();
  }
  // a label that would sit under the page's title and search box (drawn over the canvas) is hidden; its dot stays
  function clearHeader() {
    const head = document.querySelector('#masthead')?.getBoundingClientRect();
    if (!head) return;
    const cam = globe.camera(), rect = globe.renderer().domElement.getBoundingClientRect();
    for (const s of [...ORBITERS.map(o => o.label), ...PROBES.map(p => p.label), ...APOLLO.map(a => a.label)]) {
      if (!s || !isVisible(s.parent) || !s.visible) continue;
      s.getWorldPosition(_v).project(cam);
      const x = rect.left + (_v.x + 1) * rect.width / 2, y = rect.top + (1 - _v.y) * rect.height / 2;
      if (x > head.left - 8 && x < head.right + 220 && y > head.top - 8 && y < head.bottom + 8) s.visible = false;
    }
  }
  // keep the orbiting craft moving between time changes
  (function spin() { if (lastYear != null) update(lastYear, lastDate); requestAnimationFrame(spin); })();
  const setDate = d => { lastDate = d; };

  window.Spacecraft = { init, update: (year, date) => { setDate(date); update(year, date); } };
})();
