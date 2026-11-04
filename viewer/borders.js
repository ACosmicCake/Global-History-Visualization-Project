// Borders layer: dated polity shapes from Cliopatria (Seshat Global History Databank, CC BY 4.0; atlas/tools/build-borders.mjs).
// A soft colour wash is painted onto a canvas wrapped round the globe, crisp outlines are drawn as lines above it, and the
// largest polities are named. Borders snap between dated entries (spec 6.1). Where nothing is drawn, no polity is mapped:
// that doesn't mean nobody lived there.
window.Borders = (() => {
  const { THREE } = window, R = 100, FIRST = -3400, LAST = 2024, LABEL_PX = 12, LABEL_RES = 3;
  const BINS = [-3400, -1000, 0, 500, 1000, 1250, 1500, 1750, 1900, 2025];   // one file per span (atlas/tools/build-borders.mjs)
  const files = new Map();   // first year of the span -> { geoms, features } or the promise of them
  let globe = null, data = null, shown = null, wanted = null, lastBuild = 0, timer = 0;
  let wash, washTex, canvas, ctx, lines, lineMat, labelGroup;
  const labels = new Map(), _v = new THREE.Vector3();

  function init(g) {
    globe = g;
    const big = globe.renderer().capabilities.maxTextureSize >= 4096 && !matchMedia('(pointer: coarse)').matches;
    canvas = document.createElement('canvas'); canvas.width = big ? 2048 : 1024; canvas.height = canvas.width / 2;
    ctx = canvas.getContext('2d');
    washTex = new THREE.CanvasTexture(canvas);
    wash = new THREE.Mesh(new THREE.SphereGeometry(R * 1.0015, 96, 64), new THREE.MeshBasicMaterial({ map: washTex, transparent: true, depthWrite: false }));
    wash.rotation.y = -Math.PI / 2;   // the same turn globe.gl gives its own sphere, so lon/lat line up
    wash.renderOrder = 0.5; wash.visible = false;
    lineMat = new THREE.LineBasicMaterial({ color: 0xffeec8, transparent: true, opacity: 0.5, depthWrite: false });
    lines = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
    lines.renderOrder = 0.6; lines.visible = false; lines.frustumCulled = false;
    labelGroup = new THREE.Group();
    const scene = globe.scene(); scene.add(wash); scene.add(lines); scene.add(labelGroup);
  }
  const binOf = y => BINS[Math.max(0, BINS.findLastIndex(b => b <= y))];
  function load(bin) {
    if (files.has(bin)) return;
    files.set(bin, null);
    fetch(`site/borders/${bin}.json`).then(r => r.json()).then(d => { files.set(bin, d); if (wanted != null && binOf(wanted) === bin) { data = d; build(); } }).catch(() => files.delete(bin));
  }
  const xyz = (lat, lon, r = R * 1.0025) => {
    const phi = (90 - lat) * Math.PI / 180, th = (90 - lon) * Math.PI / 180;
    return [r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th)];
  };
  const decode = flat => { const out = []; let x = 0, y = 0; for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; out.push([x / 100, y / 100]); } return out; };
  const decoded = new WeakMap();
  const shape = g => { const raw = data.geoms[g]; if (!decoded.has(raw)) decoded.set(raw, raw.map(decode)); return decoded.get(raw); };
  const hue = name => { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360; return h; };

  function labelSprite(name) {
    if (labels.has(name)) return labels.get(name);
    const c = document.createElement('canvas'), g = c.getContext('2d'), font = `italic 500 ${LABEL_PX * LABEL_RES}px Spectral, Georgia, serif`;
    g.font = font; const t = name.length > 30 ? name.slice(0, 28) + '…' : name, pad = 4 * LABEL_RES;
    c.width = Math.ceil(g.measureText(t).width) + pad * 2; c.height = Math.ceil(LABEL_PX * LABEL_RES * 1.5);
    g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 3 * LABEL_RES; g.strokeStyle = 'rgba(6,9,16,0.7)';
    g.strokeText(t, c.width / 2, c.height / 2); g.fillStyle = 'rgba(255,238,200,0.92)'; g.fillText(t, c.width / 2, c.height / 2);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    s.raycast = () => {}; s.renderOrder = 8; s.visible = false; s.userData = { w: c.width / LABEL_RES, h: c.height / LABEL_RES };
    labels.set(name, s);
    return s;
  }
  function build() {
    if (!data || wanted == null) return;
    const year = wanted, active = data.features.filter(f => f[1] <= year && f[2] >= year), W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const seg = [];
    labelGroup.clear();
    for (const [name, , , area, g] of active) {
      const rings = shape(g);
      ctx.beginPath();
      for (const r of rings) {
        r.forEach(([lon, lat], i) => { const x = (lon + 180) / 360 * W, y = (90 - lat) / 180 * H; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.closePath();
        for (let i = 0; i < r.length - 1; i++) { // long straight borders are split so they follow the curve of the globe
          const [a, b] = r[i], [c, d] = r[i + 1], steps = Math.min(40, Math.ceil(Math.hypot(c - a, d - b) / 2));
          for (let k = 0; k < steps; k++) seg.push(...xyz(b + (d - b) * k / steps, a + (c - a) * k / steps), ...xyz(b + (d - b) * (k + 1) / steps, a + (c - a) * (k + 1) / steps));
        }
      }
      ctx.fillStyle = `hsla(${hue(name)}, 55%, 62%, 0.2)`; ctx.fill('evenodd');
      if (area >= 40000) { // named at the middle of its largest ring
        const big = rings.reduce((m, r) => (r.length > m.length ? r : m), rings[0]);
        const lon = big.reduce((a, p) => a + p[0], 0) / big.length, lat = big.reduce((a, p) => a + p[1], 0) / big.length;
        const s = labelSprite(name); s.position.set(...xyz(lat, lon)); s.userData.area = area; s.visible = false; labelGroup.add(s);
      }
    }
    washTex.needsUpdate = true;
    lines.geometry.dispose(); lines.geometry = new THREE.BufferGeometry();
    lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    shown = year; lastBuild = performance.now();
    wash.visible = lines.visible = true;
  }
  // year: the date shown; on: whether the layer is wanted. Rebuilds at most every 120 ms, however fast the slider moves.
  function update(year, on) {
    const y = Math.floor(year);
    if (!on || y < FIRST) { wanted = null; shown = null; if (wash) { wash.visible = lines.visible = false; labelGroup.clear(); } return; }
    const clamped = Math.min(y, LAST);
    if (clamped === shown && wash.visible) return;
    wanted = clamped;
    data = files.get(binOf(clamped)) || null;
    if (!data) { load(binOf(clamped)); return; }
    clearTimeout(timer);
    const wait = 120 - (performance.now() - lastBuild);
    if (wait <= 0) build(); else timer = setTimeout(build, wait);
  }
  // per frame: name the largest polities facing the camera, in the space the pin names left free
  function placeLabels(taken, alt, k, W, H, cam) {
    if (!labelGroup || !labelGroup.children.length) return;
    const min = alt > 1.6 ? 8e5 : alt > 0.8 ? 2e5 : 40000, camPos = cam.position, cd = camPos.length(), horizon = R / cd;
    const list = [...labelGroup.children].sort((a, b) => b.userData.area - a.userData.area);
    for (const s of list) {
      s.visible = false;
      if (s.userData.area < min) continue;
      const pos = s.position, facing = pos.dot(camPos) / (pos.length() * cd);
      if (facing < horizon + 0.08) continue;
      _v.copy(pos).project(cam);
      const x = (_v.x + 1) * W / 2, y = (1 - _v.y) * H / 2, { w, h } = s.userData, box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (taken.some(([a, b, c, d]) => box[0] < c && box[2] > a && box[1] < d && box[3] > b)) continue;
      taken.push(box);
      s.visible = true; s.scale.set(w * k, h * k, 1); s.material.opacity = Math.min(1, (facing - horizon - 0.08) / 0.1);
    }
  }
  return { init, update, placeLabels, FIRST };
})();
