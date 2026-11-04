// Fossils on the moving continents (paleo/fossils.json, from the Paleobiology Database; atlas/tools/build-fossils.mjs). Each dot is a place where a group
// has been found in rocks of a given age. It rides on the same plate rotations as the land and shows only while the date is within those rocks' age.
// Where the dots crowd says as much about where people have looked and which rocks survive as about where life was.
(function () {
  let globe = null, data = null, loading = false, points = null, mat = null, wanted = null, onReady = null, lastCount = null;
  const R = 100 * 1.0035, off = new Set();
  const COLORS = ['#ffb454', '#efe6b4', '#ff7ab6', '#5cc8ff', '#ff5a4a', '#c79bff', '#ffffff', '#c6ff5a'];
  const hex = c => [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];

  function build(d) {
    const n = d.lat.length, pos = new Float32Array(n * 3), plate = new Float32Array(n), ages = new Float32Array(n * 2), look = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = (d.lon[i] / 10 * Math.PI) / 180, b = (d.lat[i] / 10 * Math.PI) / 180;
      pos[i * 3] = Math.cos(b) * Math.cos(a); pos[i * 3 + 1] = Math.cos(b) * Math.sin(a); pos[i * 3 + 2] = Math.sin(b);   // geographic, like the land mesh
      plate[i] = d.plate[i]; ages[i * 2] = d.old[i] / 10; ages[i * 2 + 1] = d.young[i] / 10; look[i * 2] = d.group[i]; look[i * 2 + 1] = d.n[i];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('plate', new THREE.BufferAttribute(plate, 1));
    g.setAttribute('ages', new THREE.BufferAttribute(ages, 2));
    g.setAttribute('look', new THREE.BufferAttribute(look, 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.01);
    const rot = window.Space.plateRotations;
    mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { rot: { value: rot.texture }, nPlates: { value: rot.count }, ma: { value: 0 }, R: { value: R }, px: { value: 1 }, fade: { value: 1 }, colors: { value: COLORS.map(c => new THREE.Vector3(...hex(c))) }, show: { value: COLORS.map(() => 1) } },
      vertexShader: `uniform sampler2D rot; uniform float nPlates; uniform float ma; uniform float R; uniform float px; uniform vec3 colors[8]; uniform float show[8];
        attribute float plate; attribute vec2 ages; attribute vec2 look; varying vec3 vC; varying float vA;
        void main(){ int k = int(look.x + 0.5); vec4 q = texture2D(rot, vec2((plate + 0.5) / nPlates, 0.5));
          float a = smoothstep(ages.y - 1.2, ages.y, ma) * (1.0 - smoothstep(ages.x, ages.x + 1.2, ma)) * show[k] * step(0.5, dot(q, q));
          vC = colors[k]; vA = a;
          if (a <= 0.003) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
          vec3 v = position, t = 2.0 * cross(q.yzw, v), p = v + q.x * t + cross(q.yzw, t);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(vec3(p.y, p.z, p.x) * R, 1.0);
          gl_PointSize = (5.0 + 1.9 * log(1.0 + look.y)) * px; }`,
      fragmentShader: `uniform float fade; varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard;
          // a dark edge keeps a bright dot readable on pale land, and the halo gives it its glow on dark ocean
          float core = 1.0 - smoothstep(0.34, 0.5, d), edge = 1.0 - smoothstep(0.5, 0.68, d), halo = pow(1.0 - d, 1.6) * 0.42;
          gl_FragColor = vec4(mix(vC * 0.28, vC, core), max(core, max(edge * 0.55, halo)) * vA * fade); }`,
    });
    points = new THREE.Points(g, mat); points.renderOrder = 2; points.frustumCulled = false; points.visible = false;
    globe.scene().add(points);
  }
  function load() {
    if (data || loading || !window.Space.plateRotations) return;
    loading = true;
    fetch('paleo/fossils.json').then(r => r.json()).then(d => { data = d; build(d); onReady?.(); update(wanted); }).catch(err => { loading = false; console.error('fossils', err); });
  }
  // ma: millions of years ago, or null to hide
  function update(ma) {
    wanted = ma;
    if (ma == null || ma > 600) { if (points) points.visible = false; return; }
    if (!points) { load(); return; }
    points.visible = true; mat.uniforms.ma.value = ma;
    const alt = globe.camera().position.length() / 100 - 1;   // dots stay readable from afar and grow a little when you come close
    mat.uniforms.px.value = (window.devicePixelRatio || 1) * Math.min(1.5, Math.max(0.72, 1.3 - alt * 0.22));
    mat.uniforms.fade.value = Math.min(1, Math.max(0, (ma - 2) / 3)) * Math.min(1, (600 - ma) / 40);
  }
  // how many finds of each group at this date
  function counts(ma) {
    if (!data || ma == null) return null;
    const c = (data.groups || []).map(() => 0), lim = ma * 10;
    for (let i = 0; i < data.old.length; i++) if (data.old[i] >= lim && data.young[i] <= lim) c[data.group[i]] += data.n[i];
    lastCount = c; return c;
  }
  window.Fossils = {
    init(g, ready) { globe = g; onReady = ready; },
    update, counts, COLORS,
    get groups() { return data?.groups || null; }, get source() { return data?.source || ''; }, get last() { return lastCount; },
    setGroup(i, on) { if (on) off.delete(i); else off.add(i); if (mat) mat.uniforms.show.value[i] = on ? 1 : 0; },
    isOn: i => !off.has(i),
  };
})();
