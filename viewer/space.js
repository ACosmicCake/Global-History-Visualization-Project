// Space scene for the Living Atlas globe: satellite Earth with a day/night terminator, ocean glint, clouds,
// a starfield with a Milky Way band, the Sun, and the Moon. Sun and Moon directions come from low-precision
// astronomical formulas (accurate to well under a degree, plenty for a view). Distances are not to scale.
// Exposes window.Space = { init(globe), update({ date, sunMode, nightLights, clouds }) }.
(function () {
  const { THREE } = window;
  const R = 100;                       // globe.gl globe radius
  const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
  const norm = a => ((a % 360) + 360) % 360;
  // run fn once the page has settled: after `ms`, then when the browser is idle (so a heavy download never competes
  // with the first frames)
  const idle = (fn, ms) => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 4000 }) : fn()), ms);

  // ---------- astronomy: sub-solar and sub-lunar points for a JS Date (UTC)
  function daysJ2000(date) { return date.getTime() / 864e5 - 10957.5; }   // days since 2000-01-01 12:00 UTC
  function gmst(d) { return norm(280.46061837 + 360.98564736629 * d); }
  function eclToSub(lambda, beta, d) {           // ecliptic lon/lat (deg) -> sub-point lat/lng on Earth
    const eps = rad(23.439 - 0.0000004 * d), l = rad(lambda), b = rad(beta);
    const ra = Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
    const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
    let lng = norm(deg(ra) - gmst(d)); if (lng > 180) lng -= 360;
    return { lat: deg(dec), lng };
  }
  function subSolar(date) {
    const d = daysJ2000(date), g = rad(norm(357.529 + 0.98560028 * d)), L = norm(280.459 + 0.98564736 * d);
    return eclToSub(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g), 0, d);
  }
  function subLunar(date) {
    const d = daysJ2000(date);
    const L = norm(218.316 + 13.176396 * d), M = rad(norm(134.963 + 13.064993 * d)), F = rad(norm(93.272 + 13.229350 * d));
    return eclToSub(L + 6.289 * Math.sin(M), 5.128 * Math.sin(F), d);
  }

  // ---------- procedural textures
  function glowTexture(stops) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d'), grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [o, col] of stops) grd.addColorStop(o, col);
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }

  let flatMat, isFlat = false, atmoMat;
  const CLOUD_OPACITY = 0.3;
  let globe, earthMat, clouds, cloudMat, sun, sunCore, moon, moonMat, stars, sunDir = new THREE.Vector3(1, 0.3, 0.5).normalize();
  const loader = new THREE.TextureLoader();
  const dirOf = (lat, lng) => { const c = globe.getCoords(lat, lng, 0); return new THREE.Vector3(c.x, c.y, c.z).normalize(); };

  function init(g) {
    globe = g;
    const cam = globe.camera(); cam.far = 60000; cam.updateProjectionMatrix();
    const scene = globe.scene();

    // Earth: day/night blend with terrain relief, ocean sheen and an atmospheric haze at the limb.
    // Night lights only where the caller allows (they are modern, c. 2012).
    const topo = loader.load('assets/earth-topology.png');
    earthMat = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: loader.load('assets/earth-day.jpg') }, nightMap: { value: loader.load('assets/earth-night.jpg') },
        waterMap: { value: loader.load('assets/earth-water.png') }, topoMap: { value: topo }, sunDir: { value: sunDir.clone() },
        nightLights: { value: 0 }, relief: { value: 0.0 },   // 0: NASA imagery as photographed, no added relief
        paleoOn: { value: 0 },
        detailMap: { value: null }, detailBounds: { value: new THREE.Vector4(0, 0, 0.25, 0.5) }, detailMix: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D waterMap; uniform sampler2D topoMap;
        uniform vec3 sunDir; uniform float nightLights; uniform float relief;
        uniform sampler2D detailMap; uniform vec4 detailBounds; uniform float detailMix;
        uniform float paleoOn;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){
          vec3 n0 = normalize(vN), L = normalize(sunDir), v = normalize(cameraPosition - vW);
          float water = texture2D(waterMap, vUv).r;
          // relief: tilt the normal by the height gradient (globe.gl: +Y north, longitude grows toward +X from +Z)
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n0) + vec3(1e-5, 0.0, 0.0)), north = cross(n0, east);
          float h0 = texture2D(topoMap, vUv).r;
          float hx = texture2D(topoMap, vUv + vec2(1.0 / 2048.0, 0.0)).r - h0, hy = texture2D(topoMap, vUv + vec2(0.0, 1.0 / 1024.0)).r - h0;
          vec3 n = normalize(n0 - (east * hx + north * hy) * relief * 60.0 * (1.0 - water) * (1.0 - 0.85 * detailMix));
          float ndl0 = dot(n0, L), ndl = dot(n, L);
          float lit = smoothstep(-0.12, 0.25, ndl0);
          // colour: slight contrast lift, deeper oceans
          vec3 day = texture2D(dayMap, vUv).rgb;
          if (detailMix > 0.0) {   // sharper NASA imagery for the region in view, faded in at its edges
            vec2 d = vec2(fract(vUv.x - detailBounds.x) / detailBounds.z, (vUv.y - detailBounds.y) / detailBounds.w);
            if (d.y > 0.0 && d.y < 1.0 && d.x < 1.0) {
              float e = smoothstep(0.0, 0.04, d.x) * smoothstep(1.0, 0.96, d.x) * smoothstep(0.0, 0.04, d.y) * smoothstep(1.0, 0.96, d.y);
              day = mix(day, texture2D(detailMap, d).rgb, e * detailMix);
            }
          }
          if (paleoOn > 0.0) {   // deep time: today's imagery gives way to open ocean under the moving land mesh
            day = mix(day, vec3(0.04, 0.12, 0.25), paleoOn);   // open ocean; the land mesh is drawn on top
            water = mix(water, 1.0, paleoOn);
          }
          vec3 night = texture2D(nightMap, vUv).rgb;
          vec3 dayCol = day * (0.16 + 1.0 * max(mix(ndl0, ndl, 0.85), 0.0));
          vec3 nightCol = day * 0.04 + night * vec3(1.0, 0.8, 0.52) * 1.7 * nightLights;
          vec3 col = mix(nightCol, dayCol, lit);
          // ocean: a tight sun glint and a broad sheen
          vec3 h = normalize(L + v); float nh = max(dot(n0, h), 0.0);
          col += vec3(1.0, 0.94, 0.82) * (pow(nh, 320.0) * 0.35 + pow(nh, 30.0) * 0.05) * water * lit;
          // atmosphere: blue haze at the limb on the day side, warm at the terminator
          float fres = pow(1.0 - max(dot(n0, v), 0.0), 2.6);
          vec3 sky = mix(vec3(1.0, 0.52, 0.25), vec3(0.42, 0.66, 1.0), smoothstep(-0.05, 0.35, ndl0));
          col = mix(col, sky, fres * 0.4 * smoothstep(-0.25, 0.2, ndl0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    flatMat = new THREE.MeshPhongMaterial({ color: 0x0d1d33, shininess: 4 });
    globe.globeMaterial(earthMat);
    const caps = globe.renderer().capabilities, aniso = caps.getMaxAnisotropy();
    for (const k of ['dayMap', 'nightMap']) earthMat.uniforms[k].value.anisotropy = aniso;
    // The globe opens on the 4K day map (1.5 MB); once the page is idle, a desktop-class device swaps in the 8K Blue
    // Marble (4 MB, ~130 MB of GPU memory). Phones and small GPUs keep the 4K map; close-up detail comes from the
    // Blue Marble tiles either way.
    const strong = caps.maxTextureSize >= 8192 && !matchMedia('(pointer: coarse)').matches && (navigator.deviceMemory ?? 8) >= 4;
    if (strong) idle(() => loader.load('assets/earth-bluemarble-8k.jpg', t => {
      t.anisotropy = aniso; const old = earthMat.uniforms.dayMap.value; earthMat.uniforms.dayMap.value = t; old.dispose();
    }), 4000);

    // Clouds: a translucent shell lit by the same sun
    // the cloud image (4.4 MB) loads after the globe has drawn; until then the shell is fully transparent
    const cloudUniforms = { map: { value: new THREE.Texture() }, sunDir: { value: sunDir.clone() }, opacity: { value: 0 } };
    idle(() => loader.load('assets/earth-clouds.png', t => { cloudUniforms.map.value = t; cloudUniforms.opacity.value = CLOUD_OPACITY; }), 1500);
    cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: cloudUniforms,
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
        vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      // only the denser cloud systems, kept thin so the map shows through; fuller toward the limb, where real clouds pile up in view
      fragmentShader: `uniform sampler2D map; uniform vec3 sunDir; uniform float opacity; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){ vec4 t = texture2D(map, vUv); float a = smoothstep(0.35, 0.95, t.a * max(t.r, max(t.g, t.b)));
          vec3 n = normalize(vN); float l = smoothstep(-0.1, 0.3, dot(n, normalize(sunDir)));
          float limb = 1.0 - max(dot(n, normalize(cameraPosition - vW)), 0.0);
          gl_FragColor = vec4(vec3(0.95 + 0.05 * l) * (0.1 + 0.9 * l), a * opacity * (0.2 + 0.8 * l) * (0.55 + 0.9 * limb)); }`,
    });
    clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.008, 96, 64), cloudMat);
    clouds.renderOrder = 1;
    scene.add(clouds);

    // Atmosphere: a shell seen from behind, glowing blue over the day side and fading out over the night side
    globe.showAtmosphere(false);
    atmoMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
      uniforms: { sunDir: { value: sunDir.clone() } },
      vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal);
        vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
      fragmentShader: `uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 n = normalize(vN); float d = -dot(n, normalize(cameraPosition - vW));
          float glow = pow(clamp(d / 0.32, 0.0, 1.0), 2.6) * 0.8;
          float s = dot(n, normalize(sunDir)); float day = smoothstep(-0.35, 0.25, s);
          vec3 c = mix(vec3(0.9, 0.42, 0.22), vec3(0.32, 0.58, 1.0), smoothstep(-0.15, 0.3, s));
          gl_FragColor = vec4(c * glow * (0.04 + 1.0 * day), 1.0); }`,
    });
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.055, 96, 64), atmoMat);
    atmo.renderOrder = 2; scene.add(atmo);

    // Stars: a uniform field plus a denser Milky Way band (tilted ~60° to the equator, as seen from Earth)
    const N = 9000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
    const tilt = new THREE.Matrix4().makeRotationX(rad(62.9)).multiply(new THREE.Matrix4().makeRotationY(rad(30)));
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      if (i < N * 0.45) { // galactic band
        const lon = Math.random() * Math.PI * 2, lat = (Math.random() + Math.random() + Math.random() - 1.5) * 0.18;
        v.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)).applyMatrix4(tilt);
      } else { v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize(); }
      v.multiplyScalar(40000); pos.set([v.x, v.y, v.z], i * 3);
      const t = Math.random(), warm = t < 0.25, blue = t > 0.8;
      col.set(warm ? [1, 0.82, 0.62] : blue ? [0.72, 0.82, 1] : [1, 0.97, 0.92], i * 3);
      size[i] = Math.pow(Math.random(), 6) * 3.2 + 0.6;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); sg.setAttribute('color', new THREE.BufferAttribute(col, 3)); sg.setAttribute('size', new THREE.BufferAttribute(size, 1));
    stars = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      uniforms: { pr: { value: Math.min(2, devicePixelRatio || 1) } },
      vertexShader: `attribute float size; uniform float pr; varying vec3 vC; void main(){ vC = color;
        gl_PointSize = size * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        gl_FragColor = vec4(vC, smoothstep(0.5, 0.0, d)); }`,
    }));
    stars.renderOrder = -10; scene.add(stars);

    // Sun: a bright core and a wide soft glow, far away along the sun direction
    sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([[0, 'rgba(255,248,230,0.95)'], [0.12, 'rgba(255,220,160,0.55)'], [0.4, 'rgba(255,170,90,0.12)'], [1, 'rgba(255,140,60,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sunCore = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,250,235,1)'], [0.5, 'rgba(255,240,210,0.6)'], [1, 'rgba(255,230,200,0)']]), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sun.scale.setScalar(9000); sunCore.scale.setScalar(1400);
    scene.add(sun); scene.add(sunCore);

    // Moon: true relative size (0.273 Earth radii), shown nearer than its real distance (60 radii) so it can be seen
    moonMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: loader.load('assets/moon.jpg') }, sunDir: { value: sunDir.clone() } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN;
        void main(){ float l = max(dot(normalize(vN), normalize(sunDir)), 0.0); vec3 c = texture2D(map, vUv).rgb;
          gl_FragColor = vec4(c * (0.02 + 1.1 * l), 1.0); }`,
    });
    moon = new THREE.Mesh(new THREE.SphereGeometry(R * 0.273, 64, 48), moonMat);
    scene.add(moon);

    // dim globe.gl's camera-attached light so the shader's sun dominates; keep pins readable on the night side
    scene.traverse(o => { if (o.isDirectionalLight) o.intensity = 0.35; if (o.isAmbientLight) o.intensity = 0.9; });
    let last = performance.now();
    (function spin(now) { const dt = (now - last) / 1000; last = now; clouds.rotation.y += dt * 0.004; if (sunMode === 'camera') aimStudioSun(); checkDetail(now); requestAnimationFrame(spin); })(last);
  }

  // Studio sun: lights the hemisphere facing the camera from upper left, so the side being explored is in daylight
  let sunMode = 'camera';
  function aimStudioSun() {
    const cam = globe.camera().position.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(up, cam).normalize();
    setSun(cam.multiplyScalar(0.82).add(side.multiplyScalar(-0.45)).add(up.multiplyScalar(0.28)).normalize());
  }
  function setSun(dir) {
    sunDir.copy(dir);
    for (const m of [earthMat, cloudMat, moonMat, atmoMat, landMat]) m && m.uniforms.sunDir.value.copy(dir);
    sun.position.copy(dir).multiplyScalar(30000); sunCore.position.copy(sun.position);
  }

  // ---------- detail imagery: NASA Blue Marble (21600 px) cut into 8 × 4 tiles of 45°; when zoomed in, the 2 × 2 tiles
  // around the view are composed into one texture and blended over the base map
  const tileImgs = new Map(), DETAIL_ALT = 1.1;
  let detailKey = null, detailTex = null, detailCanvas = null, lastDetailCheck = 0;
  const tileImg = (r, c) => {
    const k = `${r}-${c}`;
    if (!tileImgs.has(k)) tileImgs.set(k, new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = `assets/tiles/bm-${k}.jpg`; }));
    return tileImgs.get(k);
  };
  function checkDetail(now) {
    if (now - lastDetailCheck < 300 || !earthMat) return; lastDetailCheck = now;
    const u = earthMat.uniforms, pov = globe.pointOfView();
    const want = !isFlat && pov.altitude < DETAIL_ALT;
    const target = want && detailKey ? Math.min(1, (DETAIL_ALT - pov.altitude) / 0.35) : 0;
    u.detailMix.value += (target - u.detailMix.value) * 0.6;
    if (!want) return;
    const c0 = ((Math.floor((pov.lng + 180) / 45 - 0.5) % 8) + 8) % 8, r0 = Math.max(0, Math.min(2, Math.floor((90 - pov.lat) / 45 - 0.5)));
    const key = `${r0}-${c0}`;
    if (key === detailKey || detailKey === 'loading:' + key) return;
    detailKey = 'loading:' + key;
    Promise.all([[r0, c0], [r0, (c0 + 1) % 8], [r0 + 1, c0], [r0 + 1, (c0 + 1) % 8]].map(([r, c]) => tileImg(r, c))).then(imgs => {
      if (detailKey !== 'loading:' + key) return;   // the view moved on
      if (!detailCanvas) { detailCanvas = document.createElement('canvas'); detailCanvas.width = detailCanvas.height = 4096; }
      const g = detailCanvas.getContext('2d');
      imgs.forEach((im, i) => im && g.drawImage(im, (i % 2) * 2048, Math.floor(i / 2) * 2048, 2048, 2048));
      if (!detailTex) {
        detailTex = new THREE.CanvasTexture(detailCanvas);
        detailTex.anisotropy = globe.renderer().capabilities.getMaxAnisotropy();
        detailTex.wrapS = detailTex.wrapT = THREE.ClampToEdgeWrapping;
        u.detailMap.value = detailTex;
      } else detailTex.needsUpdate = true;
      u.detailBounds.value.set(c0 / 8, 1 - (r0 + 2) / 4, 0.25, 0.5);
      detailKey = key;
    });
  }

  // ---------- deep time: continents moved by plate rotations (MERDITH2021 plate model; viewer/paleo/build_morph.mjs).
  // Today's coastlines are triangulated once into a land mesh whose vertices carry their plate; each frame the
  // plates' rotations are interpolated between 10 Ma steps (quaternion slerp) and the vertex shader turns the land,
  // so the continents glide continuously. The globe beneath shows open ocean while this is on.
  const PALEO_MAX = 1000;
  let morph = null, morphLoad = null, land = null, landMat = null, rotTex = null, rotData = null, paleoMa = null;
  function slerp(a, b, f) {
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d > 0.9995) { const q = a.map((x, i) => x + (b[i] - x) * f), n = Math.hypot(...q); return q.map(x => x / n); }
    const th = Math.acos(Math.min(1, d)), s = Math.sin(th), wa = Math.sin((1 - f) * th) / s, wb = Math.sin(f * th) / s;
    return a.map((x, i) => wa * x + wb * b[i]);
  }
  function buildLand(m) {
    const pos = [], plate = [], MAXSEG = (1.5 * Math.PI) / 180;
    // rotations in morph.json act on geographic unit vectors (x toward 0°E, z north); keep the mesh in that frame
    const geo = ([lon, lat]) => { const a = (lon * Math.PI) / 180, b = (lat * Math.PI) / 180; return new THREE.Vector3(Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)); };
    const tri = (a, b, c, p, depth = 0) => {   // subdivide big triangles so the land hugs the sphere
      if (depth < 7 && Math.max(a.angleTo(b), b.angleTo(c), c.angleTo(a)) > MAXSEG) {
        const mab = a.clone().add(b).normalize(), mbc = b.clone().add(c).normalize(), mca = c.clone().add(a).normalize();
        tri(a, mab, mca, p, depth + 1); tri(mab, b, mbc, p, depth + 1); tri(mca, mbc, c, p, depth + 1); tri(mab, mbc, mca, p, depth + 1);
        return;
      }
      for (const v of [a, b, c]) { pos.push(v.x, v.y, v.z); plate.push(p); }
    };
    for (const r of m.rings) {
      const vs = r.pts.map(geo);
      const c = vs.reduce((s, v) => s.add(v), new THREE.Vector3()).normalize();
      // stereographic projection about the ring's centre: a flat outline for the triangulator
      const e = new THREE.Vector3(0, 0, 1).cross(c); if (e.lengthSq() < 1e-8) e.set(1, 0, 0); e.normalize();
      const n = c.clone().cross(e);
      const flat = vs.map(v => { const k = 1 / (1 + v.dot(c)); return new THREE.Vector2(v.dot(e) * k, v.dot(n) * k); });
      let faces; try { faces = THREE.ShapeUtils.triangulateShape(flat, []); } catch (err) { continue; }
      for (const [i, j, k] of faces) tri(vs[i], vs[j], vs[k], r.p);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('plate', new THREE.Float32BufferAttribute(plate, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.01);
    rotData = new Float32Array(m.plates.length * 4);
    rotTex = new THREE.DataTexture(rotData, m.plates.length, 1, THREE.RGBAFormat, THREE.FloatType);
    rotTex.magFilter = rotTex.minFilter = THREE.NearestFilter;
    landMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide,
      uniforms: { rot: { value: rotTex }, nPlates: { value: m.plates.length }, sunDir: { value: sunDir.clone() }, opacity: { value: 0 }, veg: { value: 1 }, R: { value: R * 1.0008 } },
      // geographic (x 0°E, y 90°E, z north) to globe.gl's frame (x 90°E, y north, z 0°E)
      vertexShader: `uniform sampler2D rot; uniform float nPlates; uniform float R; attribute float plate; varying vec3 vN; varying float vOk;
        void main(){ vec4 q = texture2D(rot, vec2((plate + 0.5) / nPlates, 0.5)); vOk = step(0.5, dot(q, q));
          vec3 v = position; vec3 t = 2.0 * cross(q.yzw, v); vec3 p = v + q.x * t + cross(q.yzw, t);
          vec3 w = vec3(p.y, p.z, p.x);
          vN = normalize(mat3(modelMatrix) * w); gl_Position = projectionMatrix * modelViewMatrix * vec4(w * R, 1.0); }`,
      fragmentShader: `uniform vec3 sunDir; uniform float opacity; uniform float veg; varying vec3 vN; varying float vOk;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
        void main(){ if (vOk < 0.5) discard;
          vec3 n = normalize(vN); float ndl = dot(n, normalize(sunDir)), lit = smoothstep(-0.12, 0.25, ndl);
          float tex = noise(n * 5.3) * 0.5 + noise(n.zxy * 13.7 + 3.1) * 0.3 + noise(n.yzx * 37.0 + 7.7) * 0.2;
          // schematic climate belts by latitude then: dry near 25° (subtropical highs), wetter in the tropics and mid-latitudes
          float lat = abs(asin(clamp(n.y, -1.0, 1.0))) * 57.2958;
          float arid = clamp(exp(-pow((lat - 25.0) / 14.0, 2.0)) * 0.7 + (tex - 0.5) * 1.6 + 0.12, 0.0, 1.0);
          vec3 rock = vec3(0.50, 0.40, 0.31), dry = vec3(0.60, 0.48, 0.33), green = vec3(0.27, 0.35, 0.20), cold = vec3(0.40, 0.42, 0.34);
          vec3 wet = mix(green, cold, smoothstep(50.0, 70.0, lat));
          vec3 c = mix(rock, mix(wet, dry, smoothstep(0.25, 0.75, arid)), veg) * (0.9 + 0.18 * tex);
          vec3 col = mix(c * 0.04, c * (0.16 + 1.0 * max(ndl, 0.0)), lit);
          gl_FragColor = vec4(col, opacity); }`,
    });
    land = new THREE.Mesh(g, landMat); land.renderOrder = 0; land.visible = false; land.frustumCulled = false;
    globe.scene().add(land);
  }
  const loadMorph = () => morphLoad || (morphLoad = fetch('paleo/morph.json').then(r => r.json()).then(m => { morph = m; buildLand(m); return m; }).catch(err => { console.error('paleo morph', err); return null; }));
  function applyPaleo() {
    if (!morph || paleoMa == null) return;
    const m = morph, ma = paleoMa, i = Math.min(m.times.length - 2, Math.floor(ma / m.step)), f = Math.min(1, (ma - m.times[i]) / m.step);
    m.plates.forEach((p, k) => {
      const a = p.q[i], b = p.q[i + 1], q = a && b ? slerp(a, b, f) : a && f < 0.5 ? a : b && f >= 0.5 ? b : [0, 0, 0, 0];
      rotData.set(q, k * 4);
    });
    rotTex.needsUpdate = true;
    landMat.uniforms.veg.value = Math.min(1, Math.max(0, (470 - ma) / 70));   // bare rock and soil before land plants spread (c. 470-400 Ma)
  }
  // ma: millions of years before present, or null for today's Earth. Returns the age shown.
  function setPaleo(ma) {
    const u = earthMat.uniforms;
    if (ma == null || ma < 2) { paleoMa = null; u.paleoOn.value = 0; if (land) land.visible = false; return null; }
    paleoMa = Math.min(ma, PALEO_MAX);
    loadMorph().then(() => {
      if (paleoMa == null || !land) return;
      const on = Math.min(1, (ma - 2) / 8);   // fade in between 2 and 10 Ma, where the continents still look like today's
      const beyond = Math.min(1, Math.max(0, (PALEO_MAX + 100 - ma) / 100));   // past the model's reach the land fades away: no continents are invented
      u.paleoOn.value = on; landMat.uniforms.opacity.value = on * beyond; land.visible = beyond > 0;
      applyPaleo();
    });
    return paleoMa;
  }

  function update({ date, sunMode: mode, nightLights, clouds: showClouds, zoomAlt, flat }) {
    if (!globe) return;
    if (!!flat !== isFlat) { isFlat = !!flat; globe.globeMaterial(isFlat ? flatMat : earthMat); }
    const when = date && !isNaN(date) ? date : new Date();
    sunMode = mode;
    if (mode === 'real') { const s = subSolar(when); setSun(dirOf(s.lat, s.lng)); }
    const m = subLunar(when);
    moon.position.copy(dirOf(m.lat, m.lng)).multiplyScalar(R * 14);
    moon.lookAt(0, 0, 0); // keep the familiar near side facing Earth
    earthMat.uniforms.nightLights.value = nightLights ? 1 : 0;
    clouds.visible = showClouds;
    cloudMat.uniforms.opacity.value = CLOUD_OPACITY * Math.min(1, Math.max(0, ((zoomAlt ?? 2) - 0.6) / 1.2)); // clear the view well before zooming in
  }

  window.Space = { init, update, setPaleo, PALEO_MAX, subSolar, subLunar, get debug() { return { sun, sunCore, moon, sunDir, stars, land }; } };
})();
