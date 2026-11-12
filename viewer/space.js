// Space scene for the Living Atlas globe: satellite Earth with a day/night terminator, ocean glint, clouds,
// a starfield with a Milky Way band, the Sun, and the Moon. Sun and Moon directions come from low-precision
// astronomical formulas (accurate to well under a degree, plenty for a view). Distances are not to scale.
// Exposes window.Space = { init(globe), update({ date, sunDate, sunMode, nightLights, clouds }) }.
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

  let atmoMat;
  const CLOUD_OPACITY = 0.3;
  let loadClouds = () => {};
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
      extensions: { derivatives: true }, defines: globe.renderer().capabilities.isWebGL2 ? { DEEP3D: 1 } : {},
      uniforms: {
        detail: { value: 1 }, rockIds: { value: null }, rotMap: { value: null }, rockOn: { value: 0 }, worldMap: { value: null }, flowMap: { value: null }, worldA: { value: 0 }, worldB: { value: 0 }, worldMix: { value: 0 }, flowZ: { value: 0 }, worldOn: { value: 0 }, veg: { value: 1 }, flora: { value: new THREE.Vector3(0.25, 0.36, 0.18) }, warm: { value: 0 }, aridity: { value: 0 },
        dayMap: { value: loader.load('assets/earth-day.jpg') }, nightMap: { value: loader.load('assets/earth-night.jpg') },
        waterMap: { value: loader.load('assets/earth-water.png') }, topoMap: { value: topo }, sunDir: { value: sunDir.clone() },
        nightFloor: { value: 0.24 }, nightLights: { value: 0 }, relief: { value: 0.0 },   // 0: NASA imagery as photographed, no added relief
        paleoOn: { value: 0 }, early: { value: 0 }, ageGa: { value: 0 }, iceLat: { value: 90 }, iceSouth: { value: 0 }, studio: { value: 1 },
        shelfMap: { value: null }, seaDrop: { value: 0 },
        iceA: { value: null }, iceB: { value: null }, iceMix: { value: 0 }, iceOn: { value: 0 }, iceAge: { value: 0 }, humid: { value: 0 },
        detailMap: { value: null }, detailBounds: { value: new THREE.Vector4(0, 0, 0.25, 0.5) }, detailMix: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D waterMap; uniform sampler2D topoMap;
        uniform vec3 sunDir; uniform float nightLights; uniform float relief; uniform float nightFloor;
        uniform sampler2D detailMap; uniform vec4 detailBounds; uniform float detailMix;
        uniform sampler2D shelfMap; uniform float seaDrop;
        uniform sampler2D iceA; uniform sampler2D iceB; uniform float iceMix; uniform float iceOn; uniform float iceAge; uniform float humid;
        uniform float paleoOn; uniform float early; uniform float ageGa; uniform float iceLat; uniform float iceSouth; uniform float studio;
        #ifdef DEEP3D
        uniform highp sampler3D worldMap; uniform highp sampler3D flowMap; uniform highp sampler3D rockIds; uniform highp sampler2D rotMap;
        #endif
        uniform float rockOn; uniform float worldA; uniform float worldB; uniform float worldMix; uniform float flowZ; uniform float worldOn; uniform float detail; uniform float veg; uniform vec3 flora; uniform float warm; uniform float aridity;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
        float fbm(vec3 p){ return noise(p) * 0.5 + noise(p * 2.03 + 1.7) * 0.25 + noise(p * 4.11 + 5.3) * 0.15 + noise(p * 8.3 + 9.1) * 0.1; }
        ${LAND_GLSL}
        #ifdef DEEP3D
        // The plates around a spot on one map, from the four cells around it. Plates turned within a degree of each other count as one, their rotations averaged, so most of the globe has just one.
        vec4 rockFirst[4], rockSum[4]; float rockShare[4]; int rockCount;
        void rockCorners(vec2 p, int frame, float share){
          vec2 st = p * vec2(180.0, 90.0) - 0.5, c = floor(st), f = st - c;
          for (int b = 0; b < 2; b++) for (int a = 0; a < 2; a++) {
            float w = share * (a == 0 ? 1.0 - f.x : f.x) * (b == 0 ? 1.0 - f.y : f.y);
            if (w <= 0.0) continue;
            ivec2 cell = ivec2(c) + ivec2(a, b); cell.x = ((cell.x % 180) + 180) % 180; cell.y = clamp(cell.y, 0, 89);
            vec2 code = texelFetch(rockIds, ivec3(cell, frame), 0).rg * 255.0;
            int id = int(code.x + 0.5) * 256 + int(code.y + 0.5) - 1;
            vec4 q = id < 0 ? vec4(0.0) : texelFetch(rotMap, ivec2(id, 0), 0);
            if (dot(q, q) < 0.5) q = vec4(1.0, 0.0, 0.0, 0.0); else q = normalize(q);
            bool found = false;
            for (int i = 0; i < rockCount; i++) { float d = dot(q, rockFirst[i]); if (abs(d) > 0.99996) { rockSum[i] += (d < 0.0 ? -w : w) * q; rockShare[i] += w; found = true; break; } }
            if (!found && rockCount < 4) { rockFirst[rockCount] = q; rockSum[rockCount] = w * q; rockShare[rockCount] = w; rockCount++; }
          }
        }
        vec3 rockSpot(vec4 q, vec3 g){ vec3 ax = -q.yzw, tw = 2.0 * cross(ax, g); return normalize(g + q.x * tw + cross(ax, tw)); }
        vec3 imageryAt(vec2 uv, vec2 dx, vec2 dy){
          vec3 c = textureGrad(dayMap, uv, dx, dy).rgb;
          if (detailMix > 0.0) { vec2 d = vec2(fract(uv.x - detailBounds.x) / detailBounds.z, (uv.y - detailBounds.y) / detailBounds.w); if (d.y > 0.0 && d.y < 1.0 && d.x < 1.0) { float e = smoothstep(0.0, 0.04, d.x) * smoothstep(1.0, 0.96, d.x) * smoothstep(0.0, 0.04, d.y) * smoothstep(1.0, 0.96, d.y); c = mix(c, textureGrad(detailMap, d, dx / detailBounds.zw, dy / detailBounds.zw).rgb, e * detailMix); } }
          return c;
        }
        #endif
        void main(){
          vec3 n0 = normalize(vN), L = normalize(sunDir), v = normalize(cameraPosition - vW);
          float water = texture2D(waterMap, vUv).r;
          // relief: tilt the normal by the height gradient (globe.gl: +Y north, longitude grows toward +X from +Z)
          vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), n0) + vec3(1e-5, 0.0, 0.0)), north = cross(n0, east);
          float h0 = texture2D(topoMap, vUv).r;
          float hx = texture2D(topoMap, vUv + vec2(1.0 / 2048.0, 0.0)).r - h0, hy = texture2D(topoMap, vUv + vec2(0.0, 1.0 / 1024.0)).r - h0;
          vec3 n = normalize(n0 - (east * hx + north * hy) * relief * 60.0 * (1.0 - water) * (1.0 - 0.85 * detailMix));
          float ndl0 = dot(n0, L), ndl = dot(n, L);
          float lit = mix(smoothstep(-0.12, 0.25, ndl0), 1.0, studio);   // normal lighting has no night side: all that's in view is in daylight, and only the real Sun casts a night
          // colour: slight contrast lift, deeper oceans
          vec3 day = texture2D(dayMap, vUv).rgb;
          if (detailMix > 0.0) {   // sharper NASA imagery for the region in view, faded in at its edges
            vec2 d = vec2(fract(vUv.x - detailBounds.x) / detailBounds.z, (vUv.y - detailBounds.y) / detailBounds.w);
            if (d.y > 0.0 && d.y < 1.0 && d.x < 1.0) {
              float e = smoothstep(0.0, 0.04, d.x) * smoothstep(1.0, 0.96, d.x) * smoothstep(0.0, 0.04, d.y) * smoothstep(1.0, 0.96, d.y);
              day = mix(day, texture2D(detailMap, d).rgb, e * detailMix);
            }
          }
          // Today's forests and deserts aren't those of the past (schematic; the imagery is all there is to work from). In a cold age
          // forest gives way to steppe-tundra, most strongly away from the tropics; in the African Humid Period the Sahara turns green.
          if (iceAge > 0.0 || humid > 0.0) {
            float latN = asin(clamp(n0.y, -1.0, 1.0)) * 57.2958, lonE = (vUv.x - 0.5) * 360.0, patches = fbm(n0 * 9.0), ground = 1.0 - water;
            float forest = smoothstep(-0.02, 0.05, day.g - day.r) * ground;
            day = mix(day, mix(vec3(0.42, 0.40, 0.26), vec3(0.50, 0.47, 0.34), patches), forest * iceAge * mix(0.3, 0.9, smoothstep(15.0, 38.0, abs(latN))));
            float wob = (patches - 0.5) * 16.0, sahara = smoothstep(11.0, 18.0, latN + wob) * (1.0 - smoothstep(26.0, 34.0, latN + wob)) * smoothstep(-24.0, -12.0, lonE + wob) * (1.0 - smoothstep(30.0, 42.0, lonE + wob));
            day = mix(day, mix(vec3(0.20, 0.31, 0.12), vec3(0.36, 0.41, 0.19), smoothstep(0.3, 0.7, patches)), humid * sahara * ground * smoothstep(0.0, 0.06, day.r - day.g) * 0.85);
          }
          if (seaDrop > 0.0) {   // ice-age sea level: sea floor shallower than the drop stands exposed as dry land (shelf-depth.png)
            float s = texture2D(shelfMap, vUv).r, depth = (s * 255.0 - 1.0) * 150.0 / 254.0;
            float dry = s > 0.002 ? 1.0 - smoothstep(seaDrop - 5.0, seaDrop + 5.0, depth) : 0.0;
            day = mix(day, vec3(0.37, 0.35, 0.23), dry); water = mix(water, 0.0, dry);
          }
          if (iceOn > 0.0) {   // ice sheets of the last 80,000 years (ice-sheets.png): thicker ice is whiter, and a 1-degree edge gets a ragged line
            float th = mix(texture2D(iceA, vUv).r, texture2D(iceB, vUv).r, iceMix);
            float sheet = smoothstep(0.07, 0.15, th + (fbm(n0 * 30.0) - 0.5) * 0.06) * iceOn;
            float slope = (texture2D(iceA, vUv + vec2(1.5 / 360.0, 0.0)).r - texture2D(iceA, vUv - vec2(1.5 / 360.0, 0.0)).r) - (texture2D(iceA, vUv + vec2(0.0, 1.5 / 181.0)).r - texture2D(iceA, vUv - vec2(0.0, 1.5 / 181.0)).r);
            vec3 iceColor = mix(vec3(0.52, 0.63, 0.74), vec3(0.80, 0.85, 0.90), smoothstep(0.2, 0.8, th)) * clamp(1.0 + slope * 2.2 + (fbm(n0 * 60.0) - 0.5) * 0.08, 0.72, 1.12);
            day = mix(day, iceColor, sheet); water *= 1.0 - sheet;
          }
          if (paleoOn > 0.0) {
            // Deep time is one surface: the PALEOMAP PaleoDEMs, land and sea floor, and past 540 Ma that map's surface carried back on the rock the plate model has at that age (paleo-world.png; atlas/tools/build-world.mjs). Between two maps the surface glides by the
            // plates' own motion (paleo-flow.png), each map moved toward the moment shown and then blended, so land travels rather than dissolving and reappearing.
            bool drawn = false;
            #ifdef DEEP3D
            if (worldOn > 0.0) {
              drawn = true;
              float px = max(length(dFdx(n0)), length(dFdy(n0))) * detail, latAbs = abs(asin(clamp(n0.y, -1.0, 1.0))) * 57.2958, cosL = max(0.15, length(n0.xz));
              vec2 base = vec2(vUv.x, 1.0 - vUv.y);
              vec2 fl = (texture(flowMap, vec3(base, flowZ)).rg * 255.0 - 128.0) / 127.0 * 16.0, move = vec2(fl.x / (360.0 * cosL), -fl.y / 180.0), pa = base - worldMix * move, pb = base + (1.0 - worldMix) * move;
              float frames = float(textureSize(worldMap, 0).z), roughly = mix(texture(worldMap, vec3(pa, worldA)).r, texture(worldMap, vec3(pb, worldB)).r, worldMix);
              // Fine detail is pinned to the rock: this spot is turned back to where its rock lies today, and the noise is read there. Each plate near this spot gets its own undistorted reading, weighted by how near it is, because
              // blending the rotations themselves would squeeze the pattern into streaks along the seam. Two maps' plates count, as with the heights, so a seam moves smoothly from one map to the next.
              // Open ocean, far below any coast, needs none of it. Plant belts still go by the latitude the land stands at now.
              vec3 wob = vec3(0.0), past = vec3(0.0); float rough = 0.0, grain = 0.0, tex = 0.0, broad = 0.0, pastWater = 0.0, spread = 0.0;
              if (roughly > 0.33 || paleoOn < 1.0) {
                rockCount = 0;
                if (rockOn > 0.5) { rockCorners(pa, int(worldA * frames), 1.0 - worldMix); if (worldMix > 0.0) rockCorners(pb, int(worldB * frames), worldMix); }
                if (rockCount == 0) { rockCount = 1; rockSum[0] = vec4(1.0, 0.0, 0.0, 0.0); rockShare[0] = 1.0; }
                float shares = 0.0; for (int i = 0; i < rockCount; i++) shares += rockShare[i];
                vec3 g = vec3(n0.z, n0.x, n0.y); vec2 dx = dFdx(vUv), dy = dFdy(vUv);
                for (int i = 0; i < rockCount; i++) {
                  float w = rockShare[i] / shares; vec3 rp = rockSpot(normalize(rockSum[i]), g); spread += w * w;
                  vec3 wb = vec3(noise(rp * 17.0), noise(rp.yzx * 17.0 + 3.0), noise(rp.zxy * 17.0 + 7.0)) - 0.5, wp = normalize(rp + wb * 0.012);
                  wob += w * wb; rough += w * landRough(wp, px); grain += w * (noise(wp * 90.0) - 0.5) * octave(90.0, px);
                  tex += w * (noise(rp * 5.3) * 0.5 + noise(rp.zxy * 13.7 + 3.1) * 0.3 + noise(rp.yzx * 37.0 + 7.7) * 0.2); broad += w * (noise(rp * 2.1 + 4.0) * 0.6 + noise(rp.yzx * 4.7 + 2.0) * 0.4);
                  if (paleoOn < 1.0) { vec2 off = vec2(atan(rp.y, rp.x) - atan(g.y, g.x), asin(clamp(rp.z, -1.0, 1.0)) - asin(clamp(g.z, -1.0, 1.0))) / vec2(6.2831853, 3.14159265); off.x -= floor(off.x + 0.5); vec2 today = vUv + off; today.x = fract(today.x); past += w * imageryAt(today, dx, dy); pastWater += w * textureGrad(waterMap, today, dx, dy).r; }
                }
                // noise patterns added together are flatter than any one of them, which would show as a soft band along a seam, so the contrast is put back
                float lift = 1.0 / sqrt(spread), middle = roughMean(px); wob *= lift; rough = middle + (rough - middle) * lift; grain *= lift; tex = 0.5 + (tex - 0.5) * lift; broad = 0.5 + (broad - 0.5) * lift;
              }
              float wander = 0.012 * smoothstep(0.33, 0.36, roughly);
              vec2 shift = vec2(wob.x * wander / (6.2831853 * cosL), -wob.y * wander / 3.14159265);
              vec3 qa = vec3(pa + shift, worldA), qb = vec3(pb + shift, worldB);
              float height = mix(texture(worldMap, qa).r, texture(worldMap, qb).r, worldMix), soft = mix(smooth3(worldMap, qa, vec2(360.0, 180.0)), smooth3(worldMap, qb, vec2(360.0, 180.0)), worldMix);
              float dry = landDry(height, rough - roughMean(px), grain, px);
              // the sea floor from the same maps: pale over the shelves, blue down the slope, dark in the deep ocean
              float s = max(0.0, 0.5 - soft) / 0.5, depth = s * s * 6000.0;
              vec3 sea = mix(vec3(0.13, 0.38, 0.44), vec3(0.055, 0.21, 0.35), smoothstep(30.0, 500.0, depth));
              sea = mix(sea, vec3(0.03, 0.115, 0.24), smoothstep(500.0, 2600.0, depth));
              sea = mix(sea, vec3(0.016, 0.06, 0.15), smoothstep(2600.0, 5200.0, depth));
              float metres = landMetres(soft), relief = metres + rough * (90.0 + smoothstep(200.0, 2200.0, metres) * 900.0);
              vec3 bumped = landBump(n0 * 100.0, n0, relief * 0.00055);
              vec3 ground = landTint(plantCover(latAbs, smoothstep(150.0, 700.0, metres) * 0.6, tex, broad, veg, flora, warm, aridity), relief, latAbs, rough, tex) * landHill(n0, bumped);
              // Near the present the picture is today's own imagery, carried with its rock, and the maps fade in over it. The rock reaches today's position exactly as they fade out, so the film ends on today's map, not beside it.
              float change = mix(paleoOn, smoothstep(0.4, 0.6, paleoOn + (broad - 0.5) * 0.7), abs(dry - (1.0 - pastWater)));
              day = mix(past, mix(sea, ground, dry), change);
              water = mix(pastWater, 1.0 - dry, change);
              ndl = mix(ndl, dot(bumped, L), dry * 0.45 * paleoOn);
            }
            #endif
            if (!drawn) { day = mix(day, vec3(0.03, 0.10, 0.22), paleoOn); water = mix(water, 1.0, paleoOn); }
            // ice ages: sea ice poleward of the ice line, with a ragged edge (schematic, by latitude only)
            float lat0 = abs(asin(clamp(n0.y, -1.0, 1.0))) * 57.2958;
            float seaIce = smoothstep(iceLat - 3.0, iceLat + 3.0, lat0 + (noise(n0 * 7.0) - 0.5) * 10.0) * paleoOn * (n0.y < 0.0 ? 1.0 : 1.0 - iceSouth);
            day = mix(day, vec3(0.80, 0.86, 0.92), seaIce); water *= 1.0 - seaIce;
          }
          // Before the plate model (older than 1 billion years) nobody can map the continents, so the globe shows an
          // artist's impression of the eon instead, plainly labelled as such by the viewer: a molten, cratered
          // Hadean; an Archean water world with a few small islands under an orange haze; Proterozoic land of unknown
          // shape, iced over in the Huronian glaciation (c. 2.4-2.1 Ga).
          float glow = 0.0; vec3 haze = vec3(0.0);
          if (early > 0.0) {
            vec3 p = n0 * 2.2;
            float f = fbm(p * 1.6), g = fbm(p * 6.0 + 3.0);
            float hadean = smoothstep(3.95, 4.15, ageGa), proto = 1.0 - smoothstep(2.4, 2.6, ageGa);
            float landAmt = mix(0.70, 0.60, proto);                       // a few islands, later larger land of unknown shape
            float isLand = smoothstep(landAmt - 0.03, landAmt + 0.03, f);
            vec3 sea = mix(vec3(0.03, 0.10, 0.16), vec3(0.03, 0.12, 0.24), proto);
            vec3 rock = mix(vec3(0.24, 0.22, 0.20), vec3(0.38, 0.33, 0.28), proto) * (0.8 + 0.4 * g);
            vec3 c = mix(sea, rock, isLand); float w = 1.0 - isLand;
            float ice = smoothstep(2.15, 2.22, ageGa) * (1.0 - smoothstep(2.4, 2.47, ageGa));   // Huronian glaciation window
            c = mix(c, vec3(0.86, 0.90, 0.95), ice * smoothstep(0.55, 0.75, fbm(p * 3.0 + 7.0) * 0.6 + abs(n0.y) * 0.7)); w *= 1.0 - ice * 0.7;
            // Hadean: dark crust split by glowing magma and scarred by impacts
            float crack = 1.0 - smoothstep(0.0, 0.035, abs(fbm(p * 3.3) - 0.5));
            float crater = smoothstep(0.86, 0.9, noise(p * 9.0)) * (1.0 - smoothstep(0.9, 0.94, noise(p * 9.0)));
            c = mix(c, vec3(0.09, 0.07, 0.06) * (0.7 + 0.6 * g) + crater * 0.12, hadean); w *= 1.0 - hadean;
            glow = crack * hadean;
            day = mix(day, c, early); water = mix(water, w, early);
            haze = mix(vec3(0.0), vec3(1.0, 0.55, 0.25), (1.0 - hadean) * (1.0 - proto)) * early;   // Archean orange haze
          }
          vec3 night = texture2D(nightMap, vUv).rgb;
          float sunNow = mix(ndl0, ndl, 0.85);
          vec3 dayCol = day * mix(0.16 + max(sunNow, 0.0), 0.5 + 0.5 * clamp((sunNow + 0.3) / 1.05, 0.0, 1.0), studio);   // in normal lighting the far edge eases to half, so the globe still looks round
          vec3 nightCol = day * nightFloor * vec3(0.72, 0.82, 1.0) + vec3(0.016, 0.034, 0.066) * water + night * vec3(1.0, 0.8, 0.52) * 1.7 * nightLights;
          vec3 col = mix(nightCol, dayCol, lit);
          // ocean: a tight sun glint and a broad sheen
          vec3 h = normalize(L + v); float nh = max(dot(n0, h), 0.0);
          col += vec3(1.0, 0.94, 0.82) * (pow(nh, 320.0) * 0.35 + pow(nh, 30.0) * 0.05) * water * lit * (1.0 - studio);   // the sun's glint belongs to a real Sun: a light beside the camera would put a white smudge mid-ocean
          // atmosphere: blue haze at the limb on the day side, warm at the terminator
          float fres = pow(1.0 - max(dot(n0, v), 0.0), 2.6);
          vec3 sky = mix(vec3(1.0, 0.52, 0.25), vec3(0.42, 0.66, 1.0), max(studio, smoothstep(-0.05, 0.35, ndl0)));
          col = mix(col, sky, fres * 0.4 * max(studio, smoothstep(-0.25, 0.2, ndl0)));
          col += vec3(1.0, 0.36, 0.08) * glow * 0.9;                               // magma glows on the night side too
          col = mix(col, haze, fres * 0.55 * length(haze) * 0.8);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
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
    // the cloud image (0.4 MB) loads the first time clouds are turned on; until then the shell is fully transparent
    const cloudUniforms = { map: { value: new THREE.Texture() }, sunDir: { value: sunDir.clone() }, opacity: { value: 0 } };
    // The plate data (4 MB) is not loaded up front: setPaleo loads it when the date passes 2 million years ago, and the viewer
    // prefetches it when a pointer or focus reaches a deep-time scale or the film (Space.loadPaleo).
    idle(() => { if (!navigator.connection?.saveData) { loadShelf(); loadIce(); } }, 9000);   // likewise the ice-age coastlines and ice sheets
    loadClouds = () => { loadClouds = () => {}; loader.load('assets/earth-clouds.jpg', t => { cloudUniforms.map.value = t; cloudUniforms.opacity.value = CLOUD_OPACITY; }); };
    cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: cloudUniforms,
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
        vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      // only the denser cloud systems, kept thin so the map shows through; fuller toward the limb, where real clouds pile up in view
      fragmentShader: `uniform sampler2D map; uniform vec3 sunDir; uniform float opacity; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main(){ vec4 t = texture2D(map, vUv); float a = smoothstep(0.35, 0.95, t.r);
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
      uniforms: { sunDir: { value: sunDir.clone() }, studio: { value: 1 } },
      vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal);
        vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW,1.0); }`,
      fragmentShader: `uniform vec3 sunDir; uniform float studio; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 n = normalize(vN); float d = -dot(n, normalize(cameraPosition - vW));
          float glow = pow(clamp(d / 0.32, 0.0, 1.0), 2.6) * 0.8;
          float s = mix(dot(n, normalize(sunDir)), 1.0, studio); float day = smoothstep(-0.35, 0.25, s);
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
      vertexShader: `attribute float size; uniform float pr; varying vec3 vC; void main(){ float s = size * pr; vC = color * min(1.0, s * 0.5);   // anything under two pixels is dimmed rather than shrunk: a smaller point snaps from pixel to pixel and twinkles
        gl_PointSize = max(2.0, s); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
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
    // Aim the studio sun from the very camera about to be drawn. Aimed in its own animation callback, it was a frame behind, and the halo and glint visibly chased the globe as it turned.
    // The near plane follows the camera. Fixed close to it, a far camera has no depth precision left at the globe, and everything just above the surface flickers against it.
    let shownNear = 0;
    scene.onBeforeRender = () => {
      if (sunMode === 'camera') aimStudioSun();
      const c = globe.camera(), d = c.position.length(), near = Math.max(0.1, Math.min((d - R) * 0.4, d * 0.02));
      if (Math.abs(near - shownNear) > shownNear * 0.02) { shownNear = near; c.near = near; c.updateProjectionMatrix(); }
    };
    let last = performance.now();
    (function spin(now) { const dt = (now - last) / 1000; last = now; clouds.rotation.y += dt * 0.004; liftNight(); plateTick(dt); watchSpeed(dt); checkDetail(now); requestAnimationFrame(spin); })(last);
  }

  // Normal lighting: a light just above and to the left of the camera, so all that's in view is lit, with enough angle to model the relief
  let sunMode = 'camera';
  // The studio sun's far side keeps 0.24 of daylight seen from afar, up to 0.62 close to the ground, so nothing is ever lost in the dark. Under the real Sun, night is night, with just enough left to find your way.
  function liftNight() {
    const alt = globe.camera().position.length() / R - 1, close = 1 - Math.min(1, Math.max(0, (alt - 0.4) / 1.6)), f = sunMode === 'real' ? 0.09 + 0.07 * close : 0.24 + 0.38 * close;
    earthMat.uniforms.nightFloor.value = f; if (landMat) landMat.uniforms.nightFloor.value = f;
  }
  function aimStudioSun() {
    const cam = globe.camera().position.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3().crossVectors(up, cam).normalize();
    setSun(cam.multiplyScalar(0.95).add(side.multiplyScalar(-0.24)).add(up.multiplyScalar(0.16)).normalize());
  }
  function setSun(dir) {
    sunDir.copy(dir);
    for (const m of [earthMat, cloudMat, moonMat, atmoMat, landMat]) m && m.uniforms.sunDir.value.copy(dir);
    sun.position.copy(dir).multiplyScalar(30000); sunCore.position.copy(sun.position);
  }

  // ---------- detail imagery: NASA Blue Marble (21600 px) cut into 8 × 4 tiles of 45°; when zoomed in, the 2 × 2 tiles
  // around the view are composed into one texture and blended over the base map
  const tileImgs = new Map(), DETAIL_ALT = 1.1;
  let detailKey = null, detailTex = null, detailCanvas = null, lastDetailCheck = 0, lastPov = null;
  const tileImg = (r, c) => {
    const k = `${r}-${c}`;
    if (!tileImgs.has(k)) tileImgs.set(k, new Promise(ok => { const i = new Image(); i.src = `assets/tiles/bm-${k}.jpg`; (i.decode ? i.decode() : new Promise((y, n) => { i.onload = y; i.onerror = n; })).then(() => ok(i), () => ok(null)); }));
    return tileImgs.get(k);
  };
  function checkDetail(now) {
    if (now - lastDetailCheck < 300 || !earthMat) return; lastDetailCheck = now;
    const u = earthMat.uniforms, pov = globe.pointOfView();
    const want = pov.altitude < DETAIL_ALT;
    const target = want && detailKey ? Math.min(1, (DETAIL_ALT - pov.altitude) / 0.35) : 0;
    u.detailMix.value += (target - u.detailMix.value) * 0.6;
    const moved = !lastPov || Math.abs(pov.lat - lastPov.lat) + Math.abs(pov.lng - lastPov.lng) > 0.6 || Math.abs(pov.altitude - lastPov.altitude) > 0.02;
    lastPov = pov;
    if (!want || moved || window.Sequence?.playing) return;   // the upload takes a moment, so it waits until nothing is moving
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
        detailTex.anisotropy = globe.renderer().capabilities.getMaxAnisotropy(); detailTex.generateMipmaps = false; detailTex.minFilter = THREE.LinearFilter;
        detailTex.wrapS = detailTex.wrapT = THREE.ClampToEdgeWrapping;
        u.detailMap.value = detailTex;
      } else detailTex.needsUpdate = true;
      u.detailBounds.value.set(c0 / 8, 1 - (r0 + 2) / 4, 0.25, 0.5);
      detailKey = key;
    });
  }

  // What the moving land and the ground between its pieces have in common, so they read as one surface. Heights are real at 1 degree; anything finer is fractal detail, each
  // octave fading before it gets smaller than a pixel so nothing shimmers. The relief is drawn with a fixed light from the upper left, as on a map, as well as the sun, because
  // the default sun sits behind the viewer, where it shows no slopes at all.
  const LAND_GLSL = `
    float ridge(vec3 p){ vec3 q = vec3(0.80 * p.x + 0.48 * p.y + 0.36 * p.z, -0.60 * p.x + 0.64 * p.y + 0.48 * p.z, -0.60 * p.y + 0.80 * p.z); float v = 2.0 * noise(q) - 1.0; return 1.0 - sqrt(v * v + 0.012); }
    float octave(float f, float px){ return 1.0 - smoothstep(0.12, 0.45, f * px); }
    // each octave is only worked out when it would show, so the far view costs far less than the close one
    float landRough(vec3 p, float px){ float r = 0.0, w = octave(24.0, px); if (w > 0.0) r += w * (ridge(p * 24.0) - 0.5); w = octave(53.0, px); if (w > 0.0) r += w * 0.55 * (ridge(p.yzx * 53.0 + 1.0) - 0.5); w = octave(117.0, px); if (w > 0.0) r += w * 0.3 * (ridge(p.zxy * 117.0 + 5.0) - 0.5); w = octave(260.0, px); if (w > 0.0) r += w * 0.14 * (noise(p * 260.0) - 0.5); return r; }
    #ifdef DEEP3D
    // a smooth (cubic) reading of a height image: straight-line blending between 1-degree cells is what draws polygons in the shading
    float smooth3(highp sampler3D map, vec3 p, vec2 size){
      vec2 st = p.xy * size - 0.5, i = floor(st), f = st - i, f2 = f * f, f3 = f2 * f;
      vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0, w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0, g0 = w0 + w1, g1 = w2 + w3;
      vec2 a = (i - 0.5 + w1 / g0) / size, b = (i + 1.5 + w3 / g1) / size;
      return g0.y * (g0.x * texture(map, vec3(a.x, a.y, p.z)).r + g1.x * texture(map, vec3(b.x, a.y, p.z)).r) + g1.y * (g0.x * texture(map, vec3(a.x, b.y, p.z)).r + g1.x * texture(map, vec3(b.x, b.y, p.z)).r);
    }
    #endif
    float landMetres(float h){ float s = max(0.0, h - 0.502) / 0.498; return s * s * 6000.0; }
    // what landRough averages to with its octaves on, so the coast test can take it off and leave the coast where the map puts it
    float roughMean(float px){ return 0.1664 * (octave(24.0, px) + 0.55 * octave(53.0, px) + 0.3 * octave(117.0, px)); }
    float landDry(float h, float rough, float grain, float px){ float edge = clamp(px * 5.0, 0.003, 0.03); return smoothstep(-edge, edge, h - 0.5 + rough * 0.13 + grain * 0.04); }
    vec3 plantCover(float lat, float inland, float tex, float broad, float veg, vec3 flora, float warm, float aridity){
      // schematic plant cover by the latitude the land stood at then, how far inland it lies, and the age: wet tropics, dry subtropical belts, then temperate and boreal forest and tundra, with the belts moved poleward in warm ages
      float belt = lat - warm * 0.3;
      float arid = clamp(exp(-pow((belt - 26.0) / 11.0, 2.0)) * 0.85 + inland * 0.5 * smoothstep(8.0, 22.0, belt) + aridity + (broad - 0.5) * 1.1 + (tex - 0.5) * 0.5 - 0.1, 0.0, 1.0);
      vec3 rock = vec3(0.50, 0.40, 0.31), sand = vec3(0.62, 0.50, 0.34), steppe = vec3(0.47, 0.44, 0.25), tundra = vec3(0.40, 0.42, 0.34);
      vec3 forest = flora * mix(vec3(0.70, 1.02, 0.80), vec3(1.08, 1.0, 0.88), smoothstep(8.0, 38.0, belt)) * mix(0.74, 1.2, smoothstep(0.25, 0.75, broad));
      forest = mix(forest, flora * vec3(0.60, 0.80, 0.78), smoothstep(46.0 + warm, 60.0 + warm, lat));
      forest = mix(forest, tundra, smoothstep(60.0 + warm, 74.0 + warm, lat));
      vec3 plants = mix(mix(forest, steppe, smoothstep(0.22, 0.48, arid)), sand, smoothstep(0.52, 0.8, arid));
      return mix(rock, plants, veg) * (0.9 + 0.18 * tex);
    }
    vec3 landTint(vec3 c, float relief, float lat, float rough, float tex){
      // lowlands keep their plants and sit a little darker; then tan hills, brown and grey rock, and snow on the highest ground
      c *= 0.86 + 0.2 * smoothstep(0.0, 700.0, relief);
      c = mix(c, vec3(0.60, 0.51, 0.37) * (0.86 + 0.28 * tex), smoothstep(450.0, 1300.0, relief) * 0.8);
      c = mix(c, mix(vec3(0.47, 0.39, 0.31), vec3(0.51, 0.46, 0.40), smoothstep(2000.0, 3600.0, relief + (tex - 0.5) * 2200.0)) * (0.8 + 0.4 * tex), smoothstep(1200.0, 2300.0, relief));
      // the snow line is high in the tropics and falls toward the poles. Heights are only known to a degree, so snow lies in broken patches along the fractal ridges, and a high plateau stays bare between them
      float line = 5900.0 - 3400.0 * smoothstep(32.0, 75.0, lat), snow = smoothstep(0.0, 0.1, rough - 0.69 + (tex - 0.5) * 0.3 + (relief - line) / 6000.0);
      return mix(c, vec3(0.86, 0.88, 0.91), snow * 0.9);
    }
    vec3 landBump(vec3 world, vec3 n, float lift){ vec3 sx = dFdx(world), sy = dFdy(world), r1 = cross(sy, n), r2 = cross(n, sx); float det = dot(sx, r1); return normalize(abs(det) * n - sign(det) * (dFdx(lift) * r1 + dFdy(lift) * r2)); }
    float landHill(vec3 n, vec3 bumped){
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]), back = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
      vec3 l = normalize(-0.62 * right + 0.66 * up + 0.42 * back);
      return clamp(1.0 + (dot(bumped, l) / max(dot(n, l), 0.3) - 1.0) * 1.35, 0.55, 1.38);
    }
  `;
  // ---------- deep time: the rotations everything rides on (paleo/morph.json; atlas/tools/build-world.mjs), PALEOMAP to 580 Ma, turning into MERDITH2021 by 680 Ma. They are
  // interpolated between 10 Ma steps each frame, for pins, names and fossils. The surface itself is in the globe's shader. Today's coastlines, turned by these rotations in a mesh
  // whose vertices carry their plate, remain only for browsers without WebGL2.
  const PALEO_MAX = 1000;
  let morph = null, morphLoad = null, land = null, landMat = null, rotTex = null, rotData = null, paleoMa = null, shownMa = null;
  function slerp(a, b, f) {
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d > 0.9995) { const q = a.map((x, i) => x + (b[i] - x) * f), n = Math.hypot(...q); return q.map(x => x / n); }
    const th = Math.acos(Math.min(1, d)), s = Math.sin(th), wa = Math.sin((1 - f) * th) / s, wb = Math.sin(f * th) / s;
    return a.map((x, i) => wa * x + wb * b[i]);
  }
  // through four rotations in a row, so a plate doesn't change direction with a jolt at each step; a real lurch in the model stays a straight turn, since a curve would overshoot it
  function smoothTurn(z, a, b, y, f) {
    const align = (q, ref) => (q && q[0] * ref[0] + q[1] * ref[1] + q[2] * ref[2] + q[3] * ref[3] < 0 ? q.map(v => -v) : q), near = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2] + p[3] * q[3] > 0.95;
    const b1 = align(b, a), z1 = align(z, a), y1 = align(y, b1);
    if (!z1 || !y1 || !near(z1, a) || !near(a, b1) || !near(b1, y1)) return slerp(a, b1, f);
    const f2 = f * f, f3 = f2 * f, q = a.map((v, k) => 0.5 * (2 * v + (b1[k] - z1[k]) * f + (2 * z1[k] - 5 * v + 4 * b1[k] - y1[k]) * f2 + (3 * v - z1[k] - 3 * b1[k] + y1[k]) * f3)), n = Math.hypot(...q);
    return q.map(v => v / n);
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
    for (const r of [...m.rings].sort((a, b) => a.pts.length - b.pts.length)) {   // smallest first, so a continent is never cut by a sliver drawn over it
      const vs = r.pts.map(geo);
      const c = vs.reduce((s, v) => s.add(v), new THREE.Vector3()).normalize();
      // stereographic projection about the ring's centre: a flat outline for the triangulator
      const e = new THREE.Vector3(0, 0, 1).cross(c); if (e.lengthSq() < 1e-8) e.set(1, 0, 0); e.normalize();
      const n = c.clone().cross(e);
      const flat = vs.map(v => { const k = 1 / (1 + v.dot(c)); return new THREE.Vector2(v.dot(e) * k, v.dot(n) * k); });
      let faces; try { faces = THREE.ShapeUtils.triangulateShape(flat, []); } catch (err) { continue; }
      for (const [i, j, k] of faces) tri(vs[i], vs[j], vs[k], r.p);
    }
    // how far inland each point lies: steps from the nearest coast on a 1-degree grid, 0 at the coast and 1 from about 1,500 km in
    const GW = 360, GH = 180, far = new Int16Array(GW * GH).fill(-1), queue = [];
    for (const r of m.rings) for (const [lon, lat] of r.pts) { const i = Math.min(GH - 1, Math.floor(90 - lat)) * GW + (Math.floor(lon + 180) % GW + GW) % GW; if (far[i] < 0) { far[i] = 0; queue.push(i); } }
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h], y = Math.floor(i / GW), x = i - y * GW;
      for (const j of [y * GW + (x + 1) % GW, y * GW + (x + GW - 1) % GW, y > 0 ? i - GW : -1, y < GH - 1 ? i + GW : -1]) if (j >= 0 && far[j] < 0) { far[j] = far[i] + 1; queue.push(j); }
    }
    const inland = new Float32Array(pos.length / 3);
    for (let v = 0; v < inland.length; v++) { const lat = (Math.asin(Math.max(-1, Math.min(1, pos[v * 3 + 2]))) * 180) / Math.PI, lon = (Math.atan2(pos[v * 3 + 1], pos[v * 3]) * 180) / Math.PI; const fx = lon + 180 - 0.5, fy = 90 - lat - 0.5, x0 = Math.floor(fx), y0 = Math.max(0, Math.min(GH - 2, Math.floor(fy))), tx = fx - x0, ty = Math.max(0, Math.min(1, fy - y0)), at = (x, y) => far[y * GW + ((x % GW) + GW) % GW]; inland[v] = Math.min(1, ((at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty) / 14); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('inland', new THREE.BufferAttribute(inland, 1));
    g.setAttribute('plate', new THREE.Float32BufferAttribute(plate, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.01);
    // first row: each plate's rotation; second row: how visible it is, so a plate whose reconstruction starts or stops can fade
    rotData = new Float32Array(m.plates.length * 8);
    rotTex = new THREE.DataTexture(rotData, m.plates.length, 2, THREE.RGBAFormat, THREE.FloatType);
    rotTex.magFilter = rotTex.minFilter = THREE.NearestFilter;
    earthMat.uniforms.rotMap.value = rotTex;
    landMat = new THREE.ShaderMaterial({
      // The pieces overlap where plates converge. They're all at one height, so writing depth would make them fight for each pixel; instead later pieces simply paint over earlier ones.
      transparent: true, depthWrite: false, side: THREE.DoubleSide, extensions: { derivatives: true }, defines: globe.renderer().capabilities.isWebGL2 ? { DEEP3D: 1 } : {},
      uniforms: { rot: { value: rotTex }, nPlates: { value: m.plates.length }, sunDir: { value: sunDir.clone() }, opacity: { value: 0 }, veg: { value: 1 }, iceLat: { value: 90 }, nightFloor: { value: 0.24 }, R: { value: R * 1.0008 }, flora: { value: new THREE.Vector3(0.25, 0.36, 0.18) }, warm: { value: 0 }, aridity: { value: 0 }, detail: { value: 1 } },
      // geographic (x 0°E, y 90°E, z north) to globe.gl's frame (x 90°E, y north, z 0°E)
      vertexShader: `uniform sampler2D rot; uniform float nPlates; uniform float R; attribute float plate; attribute float inland; varying vec3 vN; varying float vOk; varying vec3 vP; varying float vIn; varying float vFade;
        vec3 turn(vec4 q, vec3 v){ vec3 t = 2.0 * cross(q.yzw, v); return v + q.x * t + cross(q.yzw, t); }
        void main(){ vP = position; vIn = inland; vec4 q = texture2D(rot, vec2((plate + 0.5) / nPlates, 0.25)); vFade = texture2D(rot, vec2((plate + 0.5) / nPlates, 0.75)).r; vOk = step(0.5, dot(q, q));
          vec3 p = turn(q, position);
          vec3 w = vec3(p.y, p.z, p.x);
          vN = normalize(mat3(modelMatrix) * w); gl_Position = projectionMatrix * modelViewMatrix * vec4(w * R, 1.0); }`,
      fragmentShader: `uniform vec3 sunDir; uniform float opacity; uniform float veg; uniform float iceLat; uniform float nightFloor; uniform vec3 flora; uniform float warm; uniform float aridity; uniform float detail; varying vec3 vN; varying float vOk; varying vec3 vP; varying float vIn; varying float vFade;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
        ${LAND_GLSL}
        void main(){ if (vOk < 0.5 || vFade <= 0.0) discard;
          vec3 n = normalize(vN); float ndl = dot(n, normalize(sunDir)), lit = smoothstep(-0.12, 0.25, ndl), shade = ndl;
          // the pattern is fixed to the land (vP, today's position), so it travels with the continents
          float tex = noise(vP * 5.3) * 0.5 + noise(vP.zxy * 13.7 + 3.1) * 0.3 + noise(vP.yzx * 37.0 + 7.7) * 0.2;
          float broad = noise(vP * 2.1 + 4.0) * 0.6 + noise(vP.yzx * 4.7 + 2.0) * 0.4;
          // schematic plant cover by the latitude the land stood at then, how far inland it lies, and the age: wet tropics, dry subtropical
          // belts, then temperate and boreal forest and tundra, with the belts moved poleward in warm ages
          float lat = abs(asin(clamp(n.y, -1.0, 1.0))) * 57.2958;
          vec3 c = plantCover(lat, vIn, tex, broad, veg, flora, warm, aridity);
          // for browsers without WebGL2: today's coastlines, moved, with generated relief
          float px = max(length(dFdx(vP)), length(dFdy(vP))) * detail, rough = landRough(vP, px), relief = 150.0 + rough * 300.0, alpha = 1.0;
          vec3 bumped = landBump(n * 100.0, n, relief * 0.00034);
          shade = mix(ndl, dot(bumped, normalize(sunDir)), 0.45);
          c = landTint(c, relief, lat, rough, tex) * landHill(n, bumped);
          c = mix(c, vec3(0.90, 0.93, 0.96), smoothstep(iceLat - 4.0, iceLat + 2.0, lat + (tex - 0.5) * 14.0));   // ice sheets
          vec3 col = mix(c * nightFloor * vec3(0.72, 0.82, 1.0), c * (0.16 + 1.0 * max(shade, 0.0)), lit);
          gl_FragColor = vec4(col, opacity * alpha * vFade); }`,
    });
    land = new THREE.Mesh(g, landMat); land.renderOrder = 0; land.visible = false; land.frustumCulled = false;
    globe.scene().add(land);
  }
  const loadMorph = () => morphLoad || (morphLoad = fetch('paleo/morph.json').then(r => r.json()).then(m => { morph = m; buildLand(m); return m; }).catch(err => { console.error('paleo morph', err); return null; }));
  // Deep time hands over to today's globe at 2 Ma. Plates and maps run a little fast over the last 4 million years, so every plate is exactly home at that moment, and nothing jumps.
  const rockAge = ma => (ma == null || ma >= 6 ? ma : Math.max(0, (ma - 2) * 1.5));
  function applyPaleo() {
    if (!morph || paleoMa == null) return;
    const m = morph, ma = paleoMa, age = rockAge(ma), i = Math.min(m.times.length - 2, Math.floor(age / m.step)), f = Math.min(1, (age - m.times[i]) / m.step);
    m.plates.forEach((p, k) => {
      const a = p.q[i], b = p.q[i + 1], q = a && b ? smoothTurn(p.q[i - 1], a, b, p.q[i + 2], f) : a || b || [0, 0, 0, 0];
      rotData.set(q, k * 4);
      const e = a && b ? 1 : a ? 1 - f : b ? f : 0;
      rotData[(m.plates.length + k) * 4] = e * e * (3 - 2 * e);
    });
    rotTex.needsUpdate = true;
    landMat.uniforms.veg.value = Math.min(1, Math.max(0, (470 - ma) / 70));   // bare rock and soil before land plants spread (c. 470-400 Ma)
    // plants through the ages, schematic: colour, how far warmth moves the belts poleward (degrees), and extra dryness
    const FLORA = [[470, 0.38, 0.40, 0.27, 0, 0.1], [400, 0.26, 0.35, 0.20, 4, 0.05], [320, 0.13, 0.30, 0.15, 6, -0.1], [270, 0.27, 0.33, 0.19, 0, 0.22], [230, 0.33, 0.35, 0.20, 6, 0.3],
      [150, 0.18, 0.31, 0.18, 10, 0.08], [95, 0.20, 0.37, 0.18, 16, 0], [50, 0.15, 0.37, 0.17, 18, 0.04], [20, 0.27, 0.38, 0.19, 6, 0.08], [2, 0.25, 0.36, 0.18, 0, 0.05]];
    const fi = Math.max(0, FLORA.findIndex(x => x[0] <= ma)), hi = FLORA[Math.max(0, fi - 1)], lo = FLORA[fi], ft = hi === lo ? 0 : (hi[0] - ma) / (hi[0] - lo[0]), at = n => hi[n] + (lo[n] - hi[n]) * ft;
    const eu = earthMat.uniforms; eu.veg.value = landMat.uniforms.veg.value;
    for (const un of [landMat.uniforms, eu]) { un.flora.value.set(at(1), at(2), at(3)); un.warm.value = at(4); un.aridity.value = at(5); }
    landMat.uniforms.iceLat.value = earthMat.uniforms.iceLat.value = iceLine(ma);
    earthMat.uniforms.iceSouth.value = ma <= 42 ? 1 : 0;   // the present ice age: Antarctica's ice, from 34 Ma
    setDeepFrames(age);
  }
  // The time-lapse images are decoded once, away from the main thread, and handed to the graphics card as 3D textures, which blends between frames by itself.
  // Moving through time then only changes a number: nothing is copied or uploaded while the slider is being dragged.
  function loadVolume(src, w, h, cols, depth, channels) {
    return fetch(src).then(r => r.blob()).then(b => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })).then(bmp => {
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
      const src4 = g.getImageData(0, 0, bmp.width, bmp.height).data, data = new Uint8Array(w * h * depth * channels);
      for (let k = 0; k < depth; k++) { const ox = (k % cols) * w, oy = Math.floor(k / cols) * h; for (let y = 0; y < h; y++) { let o = (oy + y) * bmp.width * 4 + ox * 4, d = (k * h + y) * w * channels; for (let x = 0; x < w; x++, o += 4) { data[d++] = src4[o]; if (channels > 1) data[d++] = src4[o + 1]; } } }
      bmp.close(); c.width = c.height = 0;
      const t = new THREE.Data3DTexture(data, w, h, depth);
      t.format = channels > 1 ? THREE.RGFormat : THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping; t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.needsUpdate = true;
      return t;
    });
  }
  // frames are 5 million years apart back to 540 Ma and 10 million years apart from there to 1,000 Ma
  const WORLD_FRAMES = 155, worldFrame = ma => (ma <= 540 ? ma / 5 : 108 + (ma - 540) / 10);
  let volumesStarted = false;
  function startVolumes() {
    if (volumesStarted || !globe.renderer().capabilities.isWebGL2) return;
    volumesStarted = true;
    const u = earthMat.uniforms;
    loadVolume('assets/paleo-rock.png', 180, 90, 11, WORLD_FRAMES, 2).then(t => { u.rockIds.value = t; u.rockOn.value = 1; }).catch(err => console.error('deep-time rock', err));
    Promise.all([loadVolume('assets/paleo-world.png', 360, 180, 11, WORLD_FRAMES, 1), loadVolume('assets/paleo-flow.png', 180, 90, 11, WORLD_FRAMES - 1, 2)])
      .then(([world, flow]) => { u.worldMap.value = world; u.flowMap.value = flow; setDeepFrames(rockAge(paleoMa)); })
      .catch(err => console.error('deep-time images', err));
  }
  let meshOpacity = 0;
  let plateData = null, plateLoad = null, plateFade = 0, plateShow = false;
  const plateCuts = [null, null], plateGeo = new Map();
  // every age's boundaries get built ahead of time, a few at a moment when the page is idle, so a fast drag never has to stop and build them
  function buildAllPlates(i = 0) { if (!plateData || i >= plateData.frames.length) return; plateGeometry(i); idle(() => buildAllPlates(i + 1), 500); }
  // Each boundary is a ribbon a fixed number of pixels wide, shaded in the fragment shader: a fine bright line with a soft glow for ridges, a line with teeth on the overriding plate for
  // subduction zones (the usual map symbol), and a faint hairline for transforms. Blending by the brighter value means lines don't brighten where segments overlap.
  function plateGeometry(i) {
    if (plateGeo.has(i)) return plateGeo.get(i);
    const pa = [], pb = [], corner = [], along = [], kinds = [], index = [], f = plateData.frames[i], RR = R * 1.0024;
    const dir = (lon, lat) => { const a = (lon * Math.PI) / 180, b = (lat * Math.PI) / 180; return [Math.cos(b) * Math.sin(a), Math.sin(b), Math.cos(b) * Math.cos(a)]; };
    const unit = v => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; }, lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    const emit = (line, kind) => {
      // rounded corners: cut each corner once, then keep the chords short enough to stay above the sphere
      let pts = line; if (pts.length > 2) { const c = [pts[0]]; for (let k = 0; k + 1 < pts.length; k++) { if (k) c.push(unit(lerp(pts[k], pts[k + 1], 0.25))); if (k + 2 < pts.length) c.push(unit(lerp(pts[k], pts[k + 1], 0.75))); } c.push(pts[pts.length - 1]); pts = c; }
      let dist = 0;
      for (let k = 0; k + 1 < pts.length; k++) {
        const p = pts[k], q = pts[k + 1], len = Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])), n = Math.max(1, Math.ceil(len / 0.05));
        for (let j = 0; j < n; j++) {
          const a = unit(lerp(p, q, j / n)), b = unit(lerp(p, q, (j + 1) / n)), d0 = dist + (len * R * j) / n, d1 = dist + (len * R * (j + 1)) / n, v = pa.length / 3;
          for (const [t, s] of [[0, -1], [0, 1], [1, -1], [1, 1]]) { pa.push(a[0] * RR, a[1] * RR, a[2] * RR); pb.push(b[0] * RR, b[1] * RR, b[2] * RR); corner.push(t, s); along.push(t ? d1 : d0); kinds.push(kind); }
          index.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
        }
        dist += len * R;
      }
    };
    [[f.x, 2], [f.r, 0], [f.s, 1]].forEach(([lines, kind]) => { for (const l of lines) {
      let run = [];
      for (let k = 0; k < l.length; k += 2) { const p = dir(l[k], l[k + 1]), last = run[run.length - 1]; if (last && last[0] * p[0] + last[1] * p[1] + last[2] * p[2] < 0.9) { if (run.length > 1) emit(run, kind); run = []; } run.push(p); }
      if (run.length > 1) emit(run, kind);
    } });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pa, 3)); g.setAttribute('pb', new THREE.Float32BufferAttribute(pb, 3)); g.setAttribute('corner', new THREE.Float32BufferAttribute(corner, 2)); g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1)); g.setAttribute('kind', new THREE.Float32BufferAttribute(kinds, 1));
    g.setIndex(index);
    plateGeo.set(i, g);
    return g;
  }
  const plateMaterial = () => new THREE.ShaderMaterial({
    defines: globe.renderer().capabilities.isWebGL2 ? { DEEP3D: 1 } : {}, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    uniforms: { res: { value: new THREE.Vector2(1, 1) }, dpr: { value: 1 }, opacity: { value: 0 }, wpp: { value: 1 }, step1: { value: 4 }, stepFade: { value: 0 }, flowMap: { value: null }, flowZ: { value: 0 }, glide: { value: 0 } },
    vertexShader: `uniform vec2 res; uniform float dpr; attribute vec3 pb; attribute vec2 corner; attribute float along; attribute float kind; varying float vPx; varying float vAlong; varying float vKind; uniform float flowZ; uniform float glide;
      #ifdef DEEP3D
      uniform highp sampler3D flowMap;
      vec3 carried(vec3 p){ if (glide == 0.0) return p; float r = length(p), lat = asin(p.y / r), lon = atan(p.x, p.z); vec2 fl = (textureLod(flowMap, vec3(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265, flowZ), 0.0).rg * 255.0 - 128.0) / 127.0 * 16.0 * glide;
        lon += radians(fl.x / max(0.15, cos(lat))); lat = clamp(lat + radians(fl.y), -1.55, 1.55); return r * vec3(cos(lat) * sin(lon), sin(lat), cos(lat) * cos(lon)); }
      #else
      vec3 carried(vec3 p){ return p; }
      #endif
      void main(){ vec4 a = projectionMatrix * modelViewMatrix * vec4(carried(position), 1.0), b = projectionMatrix * modelViewMatrix * vec4(carried(pb), 1.0), c = corner.x > 0.5 ? b : a;
        vec2 d = (b.xy / b.w - a.xy / a.w) * res; float n = length(d); d = n > 1e-4 ? d / n : vec2(1.0, 0.0);
        float half_ = (kind > 0.5 && kind < 1.5 ? 10.0 : 6.0) * dpr;
        c.xy += (vec2(-d.y, d.x) * corner.y * half_ + d * (corner.x * 2.0 - 1.0) * dpr) / res * 2.0 * c.w;
        gl_Position = c; vPx = corner.y * half_; vAlong = along; vKind = kind; }`,
    fragmentShader: `uniform float dpr; uniform float opacity; uniform float wpp; uniform float step1; uniform float stepFade; varying float vPx; varying float vAlong; varying float vKind;
      float tooth(float sp){ float dx = abs(fract(vAlong / sp + 0.5) - 0.5) * sp / wpp, h = 5.5 * dpr * (1.0 - dx / (3.6 * dpr)); return smoothstep(-0.7, 0.7, h - vPx) * smoothstep(-0.5, 0.5, vPx); }
      void main(){ float d = abs(vPx) / dpr; vec3 col;
        if (vKind < 0.5) col = vec3(0.72, 0.91, 1.0) * (1.0 - smoothstep(0.25, 0.95, d)) * 0.78 + vec3(0.24, 0.52, 0.70) * exp(-d * d / 6.0) * 0.24;
        else if (vKind < 1.5) { float t = max(tooth(step1 * 2.0), tooth(step1) * stepFade); col = vec3(1.0, 0.66, 0.48) * max((1.0 - smoothstep(0.3, 1.0, d)) * 0.85, t * 0.72) + vec3(0.55, 0.22, 0.12) * exp(-d * d / 7.0) * 0.18; }
        else col = vec3(0.52, 0.66, 0.78) * (1.0 - smoothstep(0.2, 0.9, d)) * 0.4;
        col *= opacity; float a = max(col.r, max(col.g, col.b)); if (a < 0.004) discard; gl_FragColor = vec4(col, a); }`,
  });
  function setPlateLines(ma) {
    if (ma == null || !plateShow || plateFade <= 0) { for (const l of plateCuts) if (l) l.visible = false; plateLastMa = null; return; }
    if (!plateData) { plateLoad = plateLoad || fetch('paleo/boundaries.json').then(r => r.json()).then(d => { plateData = d; setDeepFrames(paleoMa); buildAllPlates(); }).catch(err => { console.error('plate boundaries', err); }); return; }
    if (!plateCuts[0]) for (let i = 0; i < 2; i++) { plateCuts[i] = new THREE.Mesh(new THREE.BufferGeometry(), plateMaterial()); plateCuts[i].renderOrder = 1; plateCuts[i].frustumCulled = false; globe.scene().add(plateCuts[i]); }
    const f = Math.min(plateData.frames.length - 1, ma / plateData.step), a = Math.min(plateData.frames.length - 2, Math.floor(f)), t = f - a;
    plateMix = Math.min(1, Math.max(0, (t - 0.38) / 0.24)); plateMix = plateMix * plateMix * (3 - 2 * plateMix);   // each map holds, then changes quickly to the next, so two sets of lines aren't on screen for long
    const flow = earthMat.uniforms.flowMap.value, slice = Math.min(WORLD_FRAMES - 2, Math.floor(worldFrame(ma))), span = ma < 540 ? 5 : 10;
    [a, a + 1].forEach((k, i) => { const l = plateCuts[i], g = plateGeometry(k), u = l.material.uniforms; if (l.geometry !== g) l.geometry = g; u.flowMap.value = flow; u.flowZ.value = (slice + 0.5) / (WORLD_FRAMES - 1); u.glide.value = flow ? (ma - k * plateData.step) / span : 0; });
    plateTick(0);
  }
  // The boundaries exist only every 10 million years. Between those they glide with the surface, and they dim a little while time is moving, because each map's lines end up slightly off the next
  const slowSamples = []; let lightened = false;
  function watchSpeed(dt) {
    if (lightened || paleoMa == null || document.visibilityState !== 'visible' || dt <= 0 || dt > 1) { slowSamples.length = 0; return; }
    slowSamples.push(dt);
    if (slowSamples.length < 60) return;
    const middle = [...slowSamples].sort((a, b) => a - b)[30]; slowSamples.length = 0;
    if (middle > 0.05) { lightened = true; const r = globe.renderer(); r.setPixelRatio(Math.min(1, r.getPixelRatio())); earthMat.uniforms.detail.value = landMat.uniforms.detail.value = 3; }
  }
  let plateMix = 0, plateRest = 1, plateLastMa = null, plateMoved = 0, plateWindow = 0, plateFast = false;
  function plateTick(dt) {
    if (!plateCuts[0]) return;
    const on = paleoMa != null && plateShow && plateFade > 0 && plateData;
    if (dt > 0 && on) {   // how fast the date has moved over the last third of a second: date changes don't arrive on every animation frame
      if (plateLastMa != null) plateMoved += Math.abs(paleoMa - plateLastMa);
      plateLastMa = paleoMa; plateWindow += dt;
      if (plateWindow > 0.33) { plateFast = plateMoved / plateWindow > 0.4; plateMoved = 0; plateWindow = 0; }
      plateRest += ((plateFast ? 0 : 1) - plateRest) * (1 - Math.exp(-dt / (plateFast ? 0.2 : 0.6)));
    }
    const o = on ? plateFade * (0.4 + 0.6 * plateRest) : 0;
    // pixel size and how far apart the teeth go: about 20 pixels, doubling in steps as you zoom, with the in-between teeth fading rather than popping
    const cam = globe.camera(), buf = globe.renderer().getDrawingBufferSize(new THREE.Vector2()), dpr = buf.y / Math.max(1, globe.renderer().domElement.clientHeight), wpp = (2 * Math.max(1, cam.position.length() - R) * Math.tan((cam.fov * Math.PI) / 360)) / buf.y;
    const level = Math.log2(Math.max(1e-3, 20 * dpr * wpp)), lo = Math.floor(level);
    [(1 - plateMix) * o, plateMix * o].forEach((op, i) => { const l = plateCuts[i], u = l.material.uniforms; u.opacity.value = op; u.res.value.copy(buf); u.dpr.value = dpr; u.wpp.value = wpp; u.step1.value = 2 ** lo; u.stepFade.value = 1 - (level - lo); l.visible = op > 0.01; });
  }
  function setDeepFrames(ma) {
    if (ma == null) { setPlateLines(null); return; }
    const u = earthMat.uniforms, ready = !!u.worldMap.value;
    startVolumes();
    const f = Math.min(WORLD_FRAMES - 1, worldFrame(ma)), a = Math.min(WORLD_FRAMES - 2, Math.floor(f));
    u.worldA.value = (a + 0.5) / WORLD_FRAMES; u.worldB.value = (a + 1.5) / WORLD_FRAMES; u.worldMix.value = f - a; u.flowZ.value = (a + 0.5) / (WORLD_FRAMES - 1);
    u.worldOn.value = ready ? 1 : 0;
    // today's coastlines only for a browser that can't draw the surface
    const stand = globe.renderer().capabilities.isWebGL2 ? 0 : 1;
    landMat.uniforms.opacity.value = meshOpacity * stand; land.visible = meshOpacity * stand > 0.001;
    plateFade = Math.min(1, Math.max(0, (ma - 2) / 8));
    setPlateLines(ma);
  }
  // The latitude poleward of which ice is drawn, for the major glaciations (a schematic picture by latitude, not a
  // reconstruction of the ice sheets): the Cryogenian "Snowball Earth" glaciations (Sturtian c. 717-660 Ma, Marinoan
  // c. 650-635 Ma) reach the tropics; the end-Ordovician (c. 445 Ma) and late Paleozoic (c. 335-260 Ma) ice ages
  // cover the polar regions; Antarctica's ice sheet grows from about 34 Ma. 90 means no ice.
  const ICE = [[717, 660, 8], [650, 635, 8], [446, 443, 58], [335, 260, 55], [34, 0, 68]];
  function iceLine(ma) {
    let lat = 90;
    for (const [a, b, l] of ICE) {
      const out = Math.max(0, b - ma, ma - a);   // millions of years outside the glaciation; the ice fades over 8 My, so a scrub through it doesn't flash
      if (out < 8) lat = Math.min(lat, l + ((90 - l) * out) / 8);
    }
    return lat;
  }
  // ma: millions of years before present, or null for today's Earth. Returns the age shown.
  function setPaleo(ma) {
    const u = earthMat.uniforms;
    if (ma == null || ma < 2) { paleoMa = null; u.paleoOn.value = 0; u.early.value = 0; u.worldOn.value = 0; if (land) land.visible = false; setPlateLines(null); return null; }
    paleoMa = Math.min(ma, PALEO_MAX); shownMa = ma;
    // past the model's reach the land fades away (no continents are invented) and the eon's artist's impression fades in
    const beyond = Math.min(1, Math.max(0, (PALEO_MAX + 100 - ma) / 100));
    u.early.value = 1 - beyond; u.ageGa.value = ma / 1000;
    const apply = () => {
      if (paleoMa == null || !land) return;
      const fade = Math.min(1, (ma - 2) / 13), on = fade * fade * (3 - 2 * fade);   // today's imagery gives way to the maps between 2 and 15 Ma
      u.paleoOn.value = on; meshOpacity = on * beyond;
      applyPaleo();
      if (beyond <= 0) setPlateLines(null);
    };
    // once the plate data is loaded the update is immediate, so pins placed right after this call ride the same rotation
    if (morph) apply(); else loadMorph().then(() => { apply(); window.dispatchEvent(new Event('paleo-ready')); });
    return paleoMa;
  }
  // which plate a present-day point sits on: inside one of today's coastline rings (each tagged with its plate), else
  // the plate of the nearest ring within about 8 degrees; null for open ocean far from any land
  const plateCache = new Map(); let plateCells = null;
  function inRing(lon, lat, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
    }
    return inside;
  }
  function plateOf(lat, lon) {
    if (!morph) return null;
    if (!plateCells && morph.grid) { plateCells = new Int32Array(360 * 180); let at = 0; for (let i = 0; i < morph.grid.length; i += 2) { plateCells.fill(morph.grid[i], at, at + morph.grid[i + 1]); at += morph.grid[i + 1]; } }
    if (plateCells) { const id = plateCells[Math.min(179, Math.max(0, Math.floor(90 - lat))) * 360 + Math.min(359, Math.max(0, Math.floor(lon + 180)))]; if (id >= 0) return id; }
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (plateCache.has(key)) return plateCache.get(key);
    let best = null, bd = 8;
    for (const r of morph.rings) {
      if (!r.box) { const xs = r.pts.map(p => p[0]), ys = r.pts.map(p => p[1]); r.box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
      const [x0, y0, x1, y1] = r.box;
      if (lat < y0 - 8 || lat > y1 + 8 || (lon < x0 - 12 && x1 - x0 < 300) || (lon > x1 + 12 && x1 - x0 < 300)) continue;
      if (inRing(lon, lat, r.pts)) { best = r.p; bd = -1; break; }
      for (const [x, y] of r.pts) { const d = Math.hypot((x - lon) * Math.cos((lat * Math.PI) / 180), y - lat); if (d < bd) { bd = d; best = r.p; } }
    }
    plateCache.set(key, best);
    return best;
  }
  // where a present-day point stood at the age now shown, turned with its plate (the same rotation as the land);
  // null when the plate has no reconstruction at that age or the point is not on a plate
  function platePos(lat, lon) {
    if (!morph || paleoMa == null || !rotData || shownMa > PALEO_MAX) return null;
    const k = plateOf(lat, lon); if (k == null) return null;
    const w = rotData[k * 4], qx = rotData[k * 4 + 1], qy = rotData[k * 4 + 2], qz = rotData[k * 4 + 3];
    if (w * w + qx * qx + qy * qy + qz * qz < 0.5) return null;
    const a = (lon * Math.PI) / 180, b = (lat * Math.PI) / 180, v = [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
    const t = [2 * (qy * v[2] - qz * v[1]), 2 * (qz * v[0] - qx * v[2]), 2 * (qx * v[1] - qy * v[0])];
    const p = [v[0] + w * t[0] + (qy * t[2] - qz * t[1]), v[1] + w * t[1] + (qz * t[0] - qx * t[2]), v[2] + w * t[2] + (qx * t[1] - qy * t[0])];
    return { lat: (Math.asin(Math.max(-1, Math.min(1, p[2]))) * 180) / Math.PI, lon: (Math.atan2(p[1], p[0]) * 180) / Math.PI };
  }

  // How far sea level stands below today's, in metres, for the ice-age coastlines. The depth map loads the first time it's needed.
  let shelfLoading = false;
  function loadShelf() {
    const u = earthMat.uniforms;
    if (u.shelfMap.value || shelfLoading) return;
    shelfLoading = true; loader.load('assets/shelf-depth.png', t => { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; u.shelfMap.value = t; u.seaDrop.value = window.__seaDrop || 0; });
  }
  function setSeaDrop(m) {
    const u = earthMat.uniforms;
    if (m > 0) loadShelf();
    window.__seaDrop = m;
    if (u.shelfMap.value) u.seaDrop.value = m;
  }
  // Ice sheets of the last 80,000 years (PaleoMIST 1.0, 33 frames 2,500 years apart in one image; atlas/tools/build-icesheets.mjs).
  // The two frames around the date go to the shader to blend, so ice grows and melts as time moves. bp: years before 1950, or null.
  // Near today it fades out, because the imagery already shows today's ice; past 80,000 years there's no data, so it fades out too.
  let iceImg = null, iceLoading = false, iceBp = null; const iceFrame = [-1, -1];
  const iceTex = () => { const c = document.createElement('canvas'); c.width = 360; c.height = 181; const t = new THREE.CanvasTexture(c); t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping; return t; };
  function loadIce() {
    if (iceImg || iceLoading) return;
    iceLoading = true;
    const img = new Image(), u = earthMat.uniforms;
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => { iceImg = img; u.iceA.value = iceTex(); u.iceB.value = iceTex(); setIce(iceBp); });
    img.onerror = () => { iceLoading = false; };
    img.src = 'assets/ice-sheets.png';
  }
  function setIce(bp) {
    const u = earthMat.uniforms; iceBp = bp;
    if (bp == null || bp < 500 || bp > 85000) { u.iceOn.value = 0; return; }
    if (!iceImg) { loadIce(); return; }
    const f = Math.min(32, bp / 2500), a = Math.floor(f), b = Math.min(32, a + 1);
    [[u.iceA.value, a], [u.iceB.value, b]].forEach(([t, k], i) => {
      if (iceFrame[i] === k) return;
      iceFrame[i] = k;
      const g = t.image.getContext('2d'); g.clearRect(0, 0, 360, 181); g.drawImage(iceImg, (k % 6) * 360, Math.floor(k / 6) * 181, 360, 181, 0, 0, 360, 181);
      t.needsUpdate = true;
    });
    u.iceMix.value = f - a; u.iceOn.value = Math.min(1, (bp - 500) / 2000) * Math.min(1, (85000 - bp) / 5000);
  }

  // how far the imagery's plant cover is shifted: cold (0-1, from how far sea level has fallen) and the African Humid Period (0-1)
  function setClimate(cold, wet) { earthMat.uniforms.iceAge.value = cold; earthMat.uniforms.humid.value = wet; }

  function update({ date, sunDate, sunMode: mode, nightLights, clouds: showClouds, zoomAlt }) {
    if (!globe) return;
    const when = date && !isNaN(date) ? date : new Date();
    sunMode = mode; earthMat.uniforms.studio.value = atmoMat.uniforms.studio.value = mode === 'real' ? 0 : 1;
    if (mode === 'real') { const s = subSolar(sunDate || when); setSun(dirOf(s.lat, s.lng)); }
    const m = subLunar(when);
    moon.position.copy(dirOf(m.lat, m.lng)).multiplyScalar(R * 14);
    moon.lookAt(0, 0, 0); // keep the familiar near side facing Earth
    earthMat.uniforms.nightLights.value = nightLights ? 1 : 0;
    clouds.visible = showClouds; if (showClouds) loadClouds();
    cloudMat.uniforms.opacity.value = CLOUD_OPACITY * Math.min(1, Math.max(0, ((zoomAlt ?? 2) - 0.6) / 1.2)); // clear the view well before zooming in
  }

  window.Space = { get morph() { return morph; }, get plateRotations() { return rotTex ? { texture: rotTex, count: morph.plates.length } : null; }, init, update, setPaleo, loadPaleo: () => loadMorph(), showPlateEdges(on) { if (on === plateShow) return; plateShow = on; if (paleoMa != null && landMat) setPlateLines(paleoMa); }, setSeaDrop, setIce, setClimate, platePos, PALEO_MAX, subSolar, subLunar, get debug() { return { sun, sunCore, moon, sunDir, stars, land }; } };
})();
