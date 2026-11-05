// Today's coastlines, carried back with the plates, as thin lines over the moving land, so you can see where today's continents were. The lines are traced from the water mask of today's map, at half a
// degree with tiny islets and ponds left out, and each stretch rides on the plate under it, using the same rotations as the surface (paleo/morph.json). Where plates part, so do the lines.
(function () {
  let globe = null, lines = null, mat = null, loading = false, wanted = null;
  const R = 100 * 1.0028, W = 720, H = 360, SMALLEST = 7;   // a grid of half-degree cells, and the fewest equatorial cells a piece of land or water must span

  // how watery each half-degree cell is, from 0 to 1
  async function waterGrid() {
    const bmp = await createImageBitmap(await (await fetch('assets/earth-water.png')).blob());
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, W, H); bmp.close();
    const d = g.getImageData(0, 0, W, H).data, f = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) f[i] = d[i * 4] / 255;
    return f;
  }
  function dropSpecks(f) {
    const seen = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (seen[i]) continue;
      const water = f[i] >= 0.5, q = [i]; seen[i] = 1; let area = 0;
      for (let h = 0; h < q.length; h++) {
        const c = q[h], y = Math.floor(c / W), x = c - y * W; area += Math.cos((90 - (y + 0.5) / 2) * Math.PI / 180);
        for (const n of [y * W + (x + 1) % W, y * W + (x + W - 1) % W, y ? c - W : -1, y < H - 1 ? c + W : -1]) if (n >= 0 && !seen[n] && (f[n] >= 0.5) === water) { seen[n] = 1; q.push(n); }
      }
      if (area < SMALLEST) for (const c of q) f[c] = water ? 0.2 : 0.8;
    }
  }
  async function build(m, rot) {
    const f = await waterGrid(); dropSpecks(f);
    const grid = new Int32Array(360 * 180); { let at = 0; for (let i = 0; i < m.grid.length; i += 2) { grid.fill(m.grid[i], at, at + m.grid[i + 1]); at += m.grid[i + 1]; } }
    const plateAt = (lon, lat) => {   // the plate under a point, or the nearest within a few degrees: a coast can lie just outside the cells that have one
      const x0 = Math.floor(lon + 180), y0 = Math.floor(90 - lat);
      for (let r = 0; r <= 4; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const y = y0 + dy; if (y < 0 || y >= 180) continue; const id = grid[y * 360 + ((x0 + dx + 360) % 360)]; if (id >= 0) return id; }
      return -1;
    };
    const geo = (lon, lat) => { const a = (lon * Math.PI) / 180, b = (lat * Math.PI) / 180; return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)]; };
    const lonOf = x => -180 + (x + 0.5) / 2, latOf = y => 90 - (y + 0.5) / 2, pos = [], plate = [];
    // marching squares: where the 50% line crosses each square of four cell centres
    for (let y = 0; y + 1 < H; y++) for (let x = 0; x < W; x++) {
      const x1 = (x + 1) % W, v = [f[y * W + x], f[y * W + x1], f[(y + 1) * W + x1], f[(y + 1) * W + x]];
      if (v.every(a => a >= 0.5) || v.every(a => a < 0.5)) continue;
      const corner = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]], cross = [];
      for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a >= 0.5) === (b >= 0.5)) continue; const s = (0.5 - a) / (b - a), [ax, ay] = corner[e], [bx, by] = corner[(e + 1) % 4]; cross.push([lonOf(ax + (bx - ax) * s), latOf(ay + (by - ay) * s)]); }
      for (let c = 0; c + 1 < cross.length; c += 2) {
        const [a, b] = [cross[c], cross[c + 1]], id = plateAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        if (id < 0 || Math.abs(a[0] - b[0]) > 180) continue;
        pos.push(...geo(a[0], a[1]), ...geo(b[0], b[1])); plate.push(id, id);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('plate', new THREE.BufferAttribute(new Float32Array(plate), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.01);
    mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { rot: { value: rot.texture }, nPlates: { value: rot.count }, R: { value: R }, fade: { value: 0 } },
      vertexShader: `uniform sampler2D rot; uniform float nPlates; uniform float R; attribute float plate; varying float vA;
        void main(){ vec4 q = texture2D(rot, vec2((plate + 0.5) / nPlates, 0.25));
          vA = step(0.5, dot(q, q)) * texture2D(rot, vec2((plate + 0.5) / nPlates, 0.75)).r;
          vec3 v = position, t = 2.0 * cross(q.yzw, v), p = v + q.x * t + cross(q.yzw, t);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(vec3(p.y, p.z, p.x) * R, 1.0); }`,
      fragmentShader: `uniform float fade; varying float vA;
        void main(){ if (vA <= 0.003) discard; gl_FragColor = vec4(1.0, 0.97, 0.86, 0.6 * vA * fade); }`,
    });
    lines = new THREE.LineSegments(g, mat); lines.renderOrder = 1; lines.frustumCulled = false; lines.visible = false;
    globe.scene().add(lines);
  }
  // ma: millions of years ago, or null to hide
  function update(ma) {
    wanted = ma;
    if (ma == null) { if (lines) lines.visible = false; return; }
    if (!lines) {
      const m = window.Space.morph, rot = window.Space.plateRotations;
      if (!loading && m && rot) { loading = true; build(m, rot).then(() => update(wanted)).catch(err => { loading = false; console.error('coastlines', err); }); }
      return;
    }
    lines.visible = true;
    mat.uniforms.fade.value = Math.min(1, Math.max(0, (ma - 2) / 3)) * Math.min(1, Math.max(0, (560 - ma) / 20));   // gone at the present, where the map shows them itself, and just past the Life period
  }
  window.Coastlines = { init(g) { globe = g; }, update };
})();
