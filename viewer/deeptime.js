// Names on the moving continents: supercontinents and old oceans, drawn while the plate model is showing. Each name rides
// on its plate, using the same rotation as the land; an ocean sits between the plates that bound it. Dates are approximate.
// Exposes window.DeepTime = { init(globe, labels), update(ma), placeLabels(taken, alt, k, W, H, cam) }.
window.DeepTime = (() => {
  const { THREE } = window, R = 100, RES = 2, _v = new THREE.Vector3();
  let globe = null, items = [], group = null;

  const unit = (lat, lon) => { const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180; return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)]; };
  const toGeo = ([x, y, z]) => { const n = Math.hypot(x, y, z) || 1; return { lat: (Math.asin(y / n) * 180) / Math.PI, lon: (Math.atan2(x, z) * 180) / Math.PI }; };
  const ride = ([lat, lon]) => window.Space.platePos?.(lat, lon) || null;

  function sprite(name, kind) {
    const c = document.createElement('canvas'), g = c.getContext('2d'), land = kind === 'land', px = (land ? 17 : 13) * RES;
    const text = land ? name : name.toUpperCase().split('').join(' '), font = `italic ${land ? 600 : 500} ${px}px Spectral, Georgia, serif`;
    g.font = font; c.width = Math.ceil(g.measureText(text).width) + 8 * RES; c.height = Math.ceil(px * 1.5);
    g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 3 * RES; g.strokeStyle = 'rgba(6,9,16,0.75)';
    g.strokeText(text, c.width / 2, c.height / 2); g.fillStyle = land ? 'rgba(255,226,170,0.96)' : 'rgba(165,210,240,0.9)'; g.fillText(text, c.width / 2, c.height / 2);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    s.raycast = () => {}; s.renderOrder = 8; s.visible = false; s.userData = { w: c.width / RES, h: c.height / RES };
    return s;
  }
  function init(g, labels) {
    globe = g; group = new THREE.Group(); globe.scene().add(group);
    items = labels.map(l => { const s = sprite(l.name, l.kind); group.add(s); return { ...l, s, on: 0 }; });
  }
  const where = l => {
    if (l.at) return ride(l.at);
    if (l.anti) { const q = ride(l.anti); return q && { lat: -q.lat, lon: q.lon > 0 ? q.lon - 180 : q.lon + 180 }; }
    const a = ride(l.between[0]), b = ride(l.between[1]);
    if (!a || !b) return null;
    const p = unit(a.lat, a.lon), q = unit(b.lat, b.lon);
    return toGeo([p[0] + q[0], p[1] + q[1], p[2] + q[2]]);
  };
  // ma: the age shown, or null when the plate model isn't showing
  function update(ma) {
    if (!group) return;
    for (const l of items) {
      l.on = ma == null ? 0 : Math.min(1, Math.max(0, Math.min(l.from - ma, ma - l.to) / 10 + 0.5));   // fades over 10 My at each end
      const q = l.on > 0 ? where(l) : null;
      if (!q) { l.on = 0; l.s.visible = false; continue; }
      const c = globe.getCoords(q.lat, q.lon, 0.012); l.s.position.set(c.x, c.y, c.z);
    }
  }
  // per frame, before the pin names: these few names matter most at this scale, so they take their place first
  function placeLabels(taken, alt, k, W, H, cam) {
    const camPos = cam.position, cd = camPos.length(), horizon = R / cd;
    for (const l of items) {
      const s = l.s; s.visible = false;
      if (!l.on) continue;
      const facing = s.position.dot(camPos) / (s.position.length() * cd);
      if (facing < horizon + 0.05) continue;
      _v.copy(s.position).project(cam);
      const x = (_v.x + 1) * W / 2, y = (1 - _v.y) * H / 2, { w, h } = s.userData, box = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
      if (taken.some(([a, b, c, d]) => box[0] < c && box[2] > a && box[1] < d && box[3] > b)) continue;
      taken.push(box);
      s.visible = true; s.scale.set(w * k, h * k, 1); s.material.opacity = l.on * Math.min(1, (facing - horizon - 0.05) / 0.1);
    }
  }
  return { init, update, placeLabels };
})();
