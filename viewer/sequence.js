// Sequence player (spec 6.2): plays a record's declarative `animation` beats on the globe. The engine supplies
// camera, pacing and transitions; each beat contributes one action and a caption. Records without beats (outlines)
// get a generated `point` template. Exposes window.Sequence = { play(record, ctx), stop(), setPaused(p),
// step(±1), goTo(i), playing, beat }; step and goTo let the viewer skip back and forth between beats.
(function () {
  const { THREE } = window;
  const R = 100;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let run = 0, active = null, layer = null, paused = false;
  let skip = false, seekTo = null, cur = 0, beatCount = 0; // skipping back and forth between beats

  // ---------- beat parsing: "pulse { radius_m: 1600, intensity: 1.0 }" -> { name: 'pulse', params: {...} }
  function parseAction(s) {
    const m = String(s || '').match(/^\s*([\w.]+)\s*(\{([\s\S]*)\})?/);
    const params = {};
    if (m && m[3]) for (const part of m[3].split(/,(?![^\[]*\])/)) {
      const kv = part.split(':'); if (kv.length < 2) continue;
      const k = kv.shift().trim(), raw = kv.join(':').trim().replace(/^["']|["']$/g, '');
      if (/^\[.*\]$/.test(raw)) params[k] = raw.slice(1, -1).split(',').map(x => parseFloat(x));
      else params[k] = Number.isFinite(+raw) && raw !== '' ? +raw : raw;
    }
    return { name: (m && m[1] || 'caption').toLowerCase(), params };
  }
  // dates inside a span ("1945-08-06T08:15:17+09:00 / +0s", "-66043000 / +0s", "1492-10-12") -> astronomical year
  // also written dates: "21 September 325 BC", "October 1805", "c. 1350 CE", "AD 79"
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const AGO = /(\d+(?:\.\d+)?)\s*(ga|ma|ka|kyr|(?:cal\.?\s*)?(?:radiocarbon\s+)?(?:yr\s*|years\s*)?bp|(?:thousand|million|billion)?\s*years\s+ago)\b/;
  const norm = t => t.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1');     // "12,900" -> "12900"
  function spanYear(span) {
    const whole = String(span || ''), s = whole.split('/')[0].trim();
    const iso = s.match(/^(-?\d+)(?:-(\d{2}))?(?:-(\d{2}))?(?:T|\s*$)/);
    if (iso) {
      const y = +iso[1], mo = iso[2] ? +iso[2] - 1 : 0, d = iso[3] ? +iso[3] - 1 : 0;
      return Math.abs(y) > 99999 ? y : y + (mo * 30.44 + d) / 365.25;
    }
    const low = norm(s), all = norm(whole);
    // "12,900 cal BP / 11,700 cal BP", or "c. 24,000 / 16,000 cal BP" with the unit written once at the end
    const unitOnce = !low.match(AGO) && all.match(AGO) && low.match(/(\d+(?:\.\d+)?)/);
    const ago = low.match(AGO) || (unitOnce ? [null, unitOnce[1], all.match(AGO)[2]] : null);
    if (ago) {
      const n = +ago[1], u = ago[2];
      const mult = /^ga|billion/.test(u) ? 1e9 : /^ma|million/.test(u) ? 1e6 : /^ka|kyr|thousand/.test(u) ? 1e3 : 1;
      if (/bp/.test(u)) return 1950 - n;                                 // BP counts back from 1950
      return n * mult < 1e5 ? 2000 - n * mult : -n * mult;               // "4,000 years ago" is about 2000 BCE
    }
    const cen = low.match(/(\d{1,2})(?:st|nd|rd|th)\s+century\s*(bce|b\.?c\.?)?/);
    if (cen) return cen[2] ? 1 - (+cen[1] * 100 - 50) : +cen[1] * 100 - 50; // middle of the century
    const bc = low.match(/(\d{1,7})\s*(bce|b\.?\s?c\.?)(?![a-z])/);
    const ad = low.match(/\b(?:ad|a\.d\.)\s*(\d{1,4})\b|\b(\d{1,4})(?:\s*[-–]\s*\d{1,4})?\s*(?:ce|a\.?d\.?)(?![a-z])|\b(\d{3,4})\b/);
    let y = bc ? 1 - +bc[1] : ad ? +(ad[1] || ad[2] || ad[3]) : null;
    const mi = MONTHS.findIndex(m => new RegExp(`\\b${m}[a-z]*\\b`).test(low));
    if (mi >= 0 && !bc && !(ad && (ad[1] || ad[2] || ad[3]))) {
      // a day and month with no year in this part ("21 April / 12 August 1949"): take the year from the whole span;
      // failing that, the last number is the year ("24 August 79")
      const yr = all.match(/\b(\d{3,4})\b(?!.*\b\d{3,4}\b)/), nums = low.match(/\d+/g);
      y = yr ? +yr[1] : nums ? +nums[nums.length - 1] : null;
    }
    if (y == null) return null;
    if (mi >= 0) {
      const day = low.match(/\b([0-3]?\d)(?:st|nd|rd|th)?\b(?=\s+[a-z]+\s)/) || low.match(/\b[a-z]+\s+([0-3]?\d)\b/);
      const d = day && +day[1] >= 1 && +day[1] <= 31 ? +day[1] - 1 : 0;
      y += (mi * 30.44 + d) / 365.25;
    }
    return y;
  }

  // ---------- scene helpers
  function anchor(ctx, lat, lng, alt = 0.004) { const c = ctx.globe.getCoords(lat, lng, alt); return new THREE.Vector3(c.x, c.y, c.z); }
  function surfaceRing(ctx, lat, lng, radiusKm, color, filled) {
    const rad = Math.max(0.4, radiusKm / 63.71);     // km -> globe units (R = 100 = 6371 km)
    const geo = filled ? new THREE.CircleGeometry(rad, 64) : new THREE.RingGeometry(rad * 0.86, rad, 96);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: filled ? 0.28 : 0.9, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(anchor(ctx, lat, lng, 0.006)); mesh.lookAt(0, 0, 0); mesh.renderOrder = 5;
    layer.add(mesh); return mesh;
  }
  function greatCircle(ctx, pts, alt = 0.01) {     // interpolated points along consecutive waypoints
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = anchor(ctx, pts[i].lat, pts[i].lon, 0).normalize(), b = anchor(ctx, pts[i + 1].lat, pts[i + 1].lon, 0).normalize();
      const n = Math.max(8, Math.ceil(a.angleTo(b) * 60));
      for (let k = 0; k <= n; k++) { const v = new THREE.Vector3().copy(a).lerp(b, k / n).normalize(); out.push(v.multiplyScalar(R * (1 + alt + 0.02 * Math.sin(Math.PI * k / n) * a.angleTo(b)))); }
    }
    return out;
  }
  // A soft round glow, shared by every route's head.
  let glowTex = null;
  function glowTexture() {
    if (glowTex) return glowTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.65)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return (glowTex = new THREE.CanvasTexture(c));
  }
  // The route as a smooth curve: great-circle hops between waypoints, rounded through a centripetal Catmull-Rom
  // spline and resampled at even spacing, so the line has no kinks and draws at a steady pace. It is a thin tube
  // with a wider additive glow, a faint preview of the whole route ahead, and a glowing head at the drawn tip.
  // trace.count is the number of steps; trace.at(n) is the point n steps along; trace.drawn / trace.draw(n) reveal it.
  function traceLine(ctx, pts, color) {
    // thin the great-circle points to about one per degree, then round each turn with three passes of Chaikin
    // corner cutting (ends kept), so a change of heading at a waypoint becomes a gentle bend, not a kink
    const dense = greatCircle(ctx, pts);
    let raw = [dense[0]];                              // 1.7 globe units is about one degree of arc
    for (let i = 1; i < dense.length - 1; i++) if (dense[i].distanceTo(raw[raw.length - 1]) >= 1.7) raw.push(dense[i]);
    raw.push(dense[dense.length - 1]);
    if (raw.length < 3) raw = dense;                   // a very short route: nothing to thin
    for (let pass = 0; pass < 3; pass++) {
      const out = [raw[0]];
      for (let i = 0; i < raw.length - 1; i++) out.push(raw[i].clone().lerp(raw[i + 1], 0.25), raw[i].clone().lerp(raw[i + 1], 0.75));
      out.push(raw[raw.length - 1]); raw = out;
    }
    const curve = new THREE.CatmullRomCurve3(raw, false, 'centripetal');
    const steps = Math.max(64, Math.min(1600, Math.round(curve.getLength() * 3)));
    const verts = curve.getSpacedPoints(steps), smooth = new THREE.CatmullRomCurve3(verts, false, 'centripetal');
    const radial = 6, perStep = radial * 6;           // index count TubeGeometry uses per tubular segment
    const tube = (r, opacity, additive) => {
      const geo = new THREE.TubeGeometry(smooth, steps, r, radial, false);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      mesh.renderOrder = 6; layer.add(mesh); return mesh;
    };
    const ghost = tube(0.07, 0.16, false);          // the whole route, faint, so the viewer sees where it goes
    const glow = tube(0.42, 0.22, true), core = tube(0.11, 0.98, false);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    head.renderOrder = 7; head.visible = false; layer.add(head);
    let drawn = 0, pulse = 0;
    const draw = n => {
      drawn = Math.max(0, Math.min(steps, n));
      for (const m of [glow, core]) m.geometry.setDrawRange(0, Math.round(drawn) * perStep);
      head.visible = drawn > 0 && drawn < steps;
      if (head.visible) {
        const i = Math.floor(drawn);
        head.position.copy(verts[i]).lerp(verts[Math.min(steps, i + 1)], drawn - i);
        pulse += 0.12; head.scale.setScalar(2.4 + 0.5 * Math.sin(pulse));
      }
    };
    draw(0);
    // the step nearest a place, searching only ahead of `from`, so a route that returns home ends at its end
    const stepOf = (lat, lng, from = 0) => {
      const p = anchor(ctx, lat, lng, 0).normalize();
      let best = steps, bd = Infinity;
      for (let i = Math.ceil(from); i <= steps; i++) { const d = verts[i].clone().normalize().distanceToSquared(p); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    // the step at waypoint i, by its share of the route's length: the steps are evenly spaced, and a route that passes
    // near one place twice (out from Plymouth, home to Falmouth) can't confuse it
    const dirs = pts.map(w => anchor(ctx, w.lat, w.lon, 0).normalize()), run = [0];
    for (let i = 1; i < dirs.length; i++) run.push(run[i - 1] + dirs[i - 1].angleTo(dirs[i]));
    const stopStep = i => Math.round(steps * run[Math.min(i, run.length - 1)] / (run[run.length - 1] || 1));
    return { count: steps, verts, at: n => verts[Math.max(0, Math.min(steps, n))], get drawn() { return drawn; }, draw, stepOf, stopStep, ghost };
  }
  // time counts only while playing, so a pause doesn't eat into the beat; a skip finishes the beat at once
  const tween = (ms, fn) => new Promise(res => {
    const id = run; let last = performance.now(), elapsed = 0;
    (function step(now) {
      if (id !== run) return res(false);
      if (skip) { fn(1); return res(true); }
      if (!paused) elapsed += now - last;
      last = now;
      if (paused) { requestAnimationFrame(step); return; }
      const k = Math.min(1, elapsed / ms); fn(k);
      k < 1 ? requestAnimationFrame(step) : res(true);
    })(last);
  });
  const wait = ms => tween(ms, () => {});
  const fly = (ctx, lat, lng, altitude, ms = 1600) => ctx.globe.pointOfView({ lat, lng, altitude }, reduced ? 0 : ms);
  const fmt = n => Math.round(n).toLocaleString();
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

  // Camera heights (globe radii above the surface). A route is framed by its own extent, so a march across one
  // province stays close and a voyage across an ocean pulls back only as far as it needs.
  function routeView(ctx, wp) {
    const dirs = wp.map(w => anchor(ctx, w.lat, w.lon, 0).normalize());
    const c = dirs.reduce((s, d) => s.add(d), new THREE.Vector3()).normalize();
    const span = Math.max(...dirs.map(d => d.angleTo(c)));                   // radians from the centre to the farthest stop
    const g = ctx.globe.toGeoCoords({ x: c.x * R, y: c.y * R, z: c.z * R });
    return { lat: g.lat, lng: g.lng, overview: clamp(span * 2.1, 0.3, 1.05), follow: clamp(span * 1.1, 0.22, 0.6) };
  }
  const pointAlt = km => clamp(km / 450, 0.18, 0.6);

  // Smooth follow: each frame the camera direction eases toward the target with a time constant, instead of
  // snapping to the newest vertex (which stutters), and the target itself is interpolated between vertices.
  function follower(ctx, altitude) {
    const cam0 = ctx.globe.camera().position.clone().normalize();
    let dir = cam0, last = performance.now();
    return target => {
      const now = performance.now(), dt = Math.min(64, now - last); last = now;
      dir = dir.clone().lerp(target.clone().normalize(), 1 - Math.exp(-dt / 220)).normalize();
      const g = ctx.globe.toGeoCoords({ x: dir.x * R, y: dir.y * R, z: dir.z * R });
      ctx.globe.pointOfView({ lat: g.lat, lng: g.lng, altitude }, 0);
    };
  }

  // ---------- prehistoric scenes: effects for moments with no reconstruction to draw. The place, and the size where the
  // record states one, come from the record; the motion is illustrative, and the viewer labels it as schematic.
  const glow = (color, size, opacity = 1) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(size); s.renderOrder = 8; return s;
  };
  const unit = (ctx, p) => anchor(ctx, p.lat, p.lng, 0).normalize();
  const tangents = dir => { const u = new THREE.Vector3(0, 1, 0).cross(dir); if (u.lengthSq() < 1e-4) u.set(1, 0, 0); u.normalize(); return [u, dir.clone().cross(u)]; };
  const sceneGroup = () => { const g = new THREE.Group(); layer?.add(g); return g; };
  const ms = t => (reduced ? 1 : t);
  // a patch of the sphere around a direction that follows the curve at any size; "hollow" keeps only the outer band,
  // "rough" frays the edge like a lava front
  function patch(dir, color, opacity, { hollow = 0, rough = 0 } = {}) {
    const seg = 96, rings = hollow ? 1 : 8, pos = new Float32Array((seg + 1) * (rings + 1) * 3), idx = [], [u, v] = tangents(dir);
    for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) { const a = r * (seg + 1) + s; idx.push(a, a + seg + 1, a + 1, a + 1, a + seg + 1, a + seg + 2); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 6; m.frustumCulled = false;
    const fray = Array.from({ length: seg + 1 }, (_, s) => { const t = (s % seg) / seg * Math.PI * 2; return 1 + rough * (0.55 * Math.sin(t * 3 + dir.x * 9 + rough * 40) + 0.3 * Math.sin(t * 7 + dir.y * 7 + rough * 90) + 0.15 * Math.sin(t * 17 + dir.z * 5)); });
    m.setAngle = a => {
      let n = 0;
      for (let r = 0; r <= rings; r++) for (let s = 0; s <= seg; s++) {
        const th = a * fray[s] * (hollow ? (r ? 1 : hollow) : r / rings), t = (s / seg) * Math.PI * 2, c = Math.cos(th), k = Math.sin(th), x = Math.cos(t) * k, y = Math.sin(t) * k;
        pos[n++] = (dir.x * c + u.x * x + v.x * y) * R * 1.007; pos[n++] = (dir.y * c + u.y * x + v.y * y) * R * 1.007; pos[n++] = (dir.z * c + u.z * x + v.z * y) * R * 1.007;
      }
      geo.attributes.position.needsUpdate = true;
    };
    m.setAngle(0.0001);
    return m;
  }
  // particles leaving a point: a single throw, or with "loop" a steady stream
  function burst(dir, n, color, size, { spread, height, loop = false, drift = 0 }) {
    const pos = new Float32Array(n * 3), [u, v] = tangents(dir), seed = Array.from({ length: n }, () => [Math.random() * Math.PI * 2, Math.random(), Math.random()]);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color, size, transparent: true, opacity: 0.9, depthWrite: false, blending: loop ? THREE.NormalBlending : THREE.AdditiveBlending }));
    p.frustumCulled = false; p.renderOrder = 7;
    p.step = k => {
      seed.forEach(([th, a, b], i) => {
        const t = loop ? (k * 3 + b) % 1 : k, d = spread * a * (loop ? t : 1 - (1 - t) * (1 - t)), h = height * (loop ? t * (0.6 + a * 0.4) : 4 * t * (1 - t) * (0.4 + b * 0.6));
        const x = dir.x + (u.x * Math.cos(th) + v.x * Math.sin(th)) * d + u.x * drift * t, y = dir.y + (u.y * Math.cos(th) + v.y * Math.sin(th)) * d + u.y * drift * t, z = dir.z + (u.z * Math.cos(th) + v.z * Math.sin(th)) * d + u.z * drift * t;
        const f = (R * (1.01 + h)) / Math.hypot(x, y, z);
        pos[i * 3] = x * f; pos[i * 3 + 1] = y * f; pos[i * 3 + 2] = z * f;
      });
      geo.attributes.position.needsUpdate = true;
    };
    p.step(0);
    return p;
  }
  const shell = (color, level) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 48, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
    m.renderOrder = 5; m.userData.level = level; return m;
  };
  const FOLLOW = { india: [20, 78] };
  const SCENES = {
    // an asteroid comes in, a flash, shock rings and ejecta, and a crater left glowing. km: the crater, where the record says
    async impact(ctx, at, o) {
      const g = sceneGroup(), dir = unit(ctx, at), km = o.km || 100, end = dir.clone().multiplyScalar(R), side = new THREE.Vector3(0.3, 1, 0.2).cross(dir).normalize();
      fly(ctx, at.lat, at.lng, o.alt ?? clamp(km / 200, 0.4, 1), 900);
      await wait(ms(900));
      if (!o.alive()) return;
      const start = dir.clone().multiplyScalar(R * 1.9).add(side.multiplyScalar(R * 0.7)), head = glow('#fff3d6', 4), tail = Array.from({ length: 16 }, (_, i) => glow('#ffb45e', 3 - i * 0.14, 0.55 - i * 0.03));
      g.add(head, ...tail);
      await tween(ms(1000), k => { const f = k * k; head.position.lerpVectors(start, end, f); tail.forEach((t, i) => t.position.lerpVectors(start, end, Math.max(0, f - (i + 1) * 0.012))); });
      g.remove(head, ...tail);
      if (!o.alive()) return;
      const reach = Math.max(500, km * 10) / 6371, crater = patch(dir, '#ff7a2a', 0.9, { rough: 0.08 }), rings = [0, 1, 2].map(() => patch(dir, '#ffe0b0', 0.8, { hollow: 0.93 }));
      const flash = glow('#ffffff', 12); flash.position.copy(dir).multiplyScalar(R * 1.02);
      const ejecta = burst(dir, 260, '#ff8f3c', 1.6, { spread: Math.min(0.5, reach * 1.2), height: 0.16 });
      g.add(crater, ...rings, flash, ejecta); crater.setAngle(Math.max(40, km / 2) / 6371);
      await tween(ms(3000), k => {
        flash.scale.setScalar(12 + 70 * Math.min(1, k * 5)); flash.material.opacity = Math.max(0, 1 - k * 3.2);
        rings.forEach((r, i) => { const p = Math.max(0, Math.min(1, (k - i * 0.14) / 0.72)); r.setAngle(0.002 + reach * p); r.material.opacity = 0.8 * (1 - p); });
        ejecta.step(k); ejecta.material.opacity = 0.9 * (1 - k * k);
        crater.material.opacity = 0.9 - 0.55 * k;
      });
      g.remove(flash, ejecta, crater, ...rings);
    },
    // lava spreading over the land with ash rising downwind. km: the lava's reach, ash: an ash cloud's, where the record says
    async eruption(ctx, at, o) {
      const g = sceneGroup(), dir = unit(ctx, at), km = o.km || 500, ash = o.ash || km * 0.8, angle = km / 6371, dur = Math.max(4200, o.ms - 1000);
      fly(ctx, at.lat, at.lng, o.alt ?? clamp(Math.max(km, ash) / 500, 0.45, 1.3), 900);
      await wait(ms(900));
      if (!o.alive()) return;
      const lava = patch(dir, '#ff6a1f', 0.85, { rough: 0.22 }), core = patch(dir, '#ffd27a', 0.8, { rough: 0.3 }), cloud = patch(dir, '#8a8580', 0, { rough: 0.3 }), plume = burst(dir, 320, '#8f8780', 3.6, { spread: Math.min(0.5, ash / 6371), height: clamp(ash / 6000, 0.05, 0.14), loop: true, drift: 0.08 });
      const light = glow('#ff8a3a', 8, 0.7); light.position.copy(dir).multiplyScalar(R * 1.02);
      g.add(lava, core, cloud, plume, light);
      await tween(ms(dur), k => {
        const e = 1 - (1 - k) * (1 - k);
        lava.setAngle(0.002 + angle * e); core.setAngle(0.001 + angle * 0.55 * Math.min(1, k * 1.3));
        core.material.opacity = 0.8 * (1 - k * 0.8); lava.material.color.setHSL(0.05, 0.95, 0.55 - 0.3 * k);
        cloud.setAngle(0.002 + (ash / 6371) * e); cloud.material.opacity = 0.42 * Math.min(1, k * 2);
        plume.step(k); light.material.opacity = (0.55 + 0.15 * Math.sin(k * 40)) * (1 - k * 0.5); light.scale.setScalar(8 + Math.min(40, km / 25) * e);
      });
      g.remove(plume, light, core, lava, cloud);   // fixed to the sphere, so it can't stay while the plates move on
    },
    // the whole globe darkens and recovers: darkness after an impact, or a dying ocean
    async dim(ctx, at, o) {
      const g = sceneGroup(), s = shell(o.color || '#06040a', o.level ?? 0.62), dir = unit(ctx, at), rings = [0, 1].map(() => patch(dir, o.color ? '#ffffff' : '#ff6a5a', 0.5, { hollow: 0.95 }));
      g.add(s, ...rings);
      fly(ctx, at.lat, at.lng, o.alt ?? 1.5, 900);
      await tween(ms(Math.max(4200, o.ms)), k => {
        s.material.opacity = s.userData.level * Math.pow(Math.sin(Math.PI * Math.min(1, k * 1.02)), 0.6);
        rings.forEach((r, i) => { const p = (k * 2 + i * 0.5) % 1; r.setAngle(0.01 + 0.9 * p); r.material.opacity = 0.5 * (1 - p) * (1 - k); });
      });
      g.remove(s, ...rings);
    },
    // waves running out from a point
    async wave(ctx, at, o) {
      const g = sceneGroup(), dir = unit(ctx, at), km = o.km || 1000, reach = km / 6371, rings = [0, 1, 2, 3].map(() => patch(dir, '#9fdcf5', 0.8, { hollow: 0.965 }));
      g.add(...rings);
      fly(ctx, at.lat, at.lng, o.alt ?? clamp(km / 2000, 0.45, 1), 900);
      await tween(ms(Math.max(4200, o.ms)), k => rings.forEach((r, i) => { const p = Math.min(1, Math.max(0, k * 1.3 - i * 0.1)); r.setAngle(0.002 + reach * p); r.material.opacity = 0.85 * (1 - p); }));
      g.remove(...rings);
    },
    // many small impacts over one side of a young planet
    async bombard(ctx, at, o) {
      const g = sceneGroup(), dir = unit(ctx, at), [u, v] = tangents(dir), n = 16, dur = Math.max(5200, o.ms - 1000);
      fly(ctx, at.lat, at.lng, o.alt ?? 1.5, 900);
      await wait(ms(900));
      if (!o.alive()) return;
      const hits = Array.from({ length: n }, (_, i) => {
        const th = i * 2.4, d = 0.15 + 0.65 * Math.sqrt(i / n), p = dir.clone().add(u.clone().multiplyScalar(Math.cos(th) * d)).add(v.clone().multiplyScalar(Math.sin(th) * d)).normalize();
        const ring = patch(p, '#ffc48a', 0, { hollow: 0.9 }), scar = patch(p, '#ff7a2a', 0, { rough: 0.1 }), flash = glow('#ffffff', 10, 0); flash.position.copy(p).multiplyScalar(R * 1.02);
        g.add(ring, scar, flash); scar.setAngle(0.012 + 0.018 * (i % 3)); return { ring, scar, flash, at: i / n * 0.8 };
      });
      await tween(ms(dur), k => hits.forEach(h => {
        const q = (k - h.at) / 0.2; if (q < 0) return;
        const p = Math.min(1, q); h.flash.material.opacity = Math.max(0, 1 - p * 2.6); h.flash.scale.setScalar(6 + 16 * p);
        h.ring.setAngle(0.005 + 0.09 * p); h.ring.material.opacity = 0.8 * (1 - p); h.scar.material.opacity = 0.8 - 0.45 * Math.min(1, q / 3);
      }));
    },
    // a Mars-sized body strikes, and the debris gathers into the Moon
    async giant(ctx, at, o) {
      const g = sceneGroup(), dir = unit(ctx, at), side = new THREE.Vector3(0.2, 1, 0.1).cross(dir).normalize(), dur = Math.max(4600, o.ms - 3200);
      fly(ctx, at.lat, at.lng, 3.2, 1000);
      await wait(ms(1000));
      if (!o.alive()) return;
      const start = dir.clone().multiplyScalar(R * 3.4).add(side.clone().multiplyScalar(R * 2.6)), end = dir.clone().multiplyScalar(R * 1.3);
      const body = new THREE.Mesh(new THREE.SphereGeometry(R * 0.53, 32, 24), new THREE.MeshBasicMaterial({ color: '#5a4436' })), rim = glow('#ff9a4a', R * 1.5, 0.35);
      g.add(body, rim);
      await tween(ms(1900), k => { const f = k * k; body.position.lerpVectors(start, end, f); rim.position.copy(body.position); rim.material.opacity = 0.2 + 0.5 * f; });
      g.remove(body, rim);
      if (!o.alive()) return;
      const flash = glow('#ffffff', R * 3), n = 900, pos = new Float32Array(n * 3), geo = new THREE.BufferGeometry(), [u, v] = tangents(new THREE.Vector3(0.25, 0.95, 0.15).normalize());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const debris = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTexture(), color: '#ffbf7a', size: 4.4, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending })), seed = Array.from({ length: n }, () => [Math.random() * Math.PI * 2, 1.12 + Math.random() * 1.5]);
      const moon = glow('#fff0d8', 1, 0); debris.frustumCulled = false;
      flash.position.copy(dir).multiplyScalar(R * 1.1); g.add(flash, debris, moon);
      await tween(ms(dur), k => {
        flash.material.opacity = Math.max(0, 1 - k * 3.5); flash.scale.setScalar(R * (3 + 4 * k));
        const gather = Math.max(0, (k - 0.45) / 0.55), mt = 2.4 + k * 2.2, mx = Math.cos(mt) * R * 2.1, my = Math.sin(mt) * R * 2.1;
        seed.forEach(([th, r], i) => {
          const a = th + k * (3.4 / r), x = Math.cos(a) * r * R * Math.min(1, k * 5), y = Math.sin(a) * r * R * Math.min(1, k * 5), f = gather * gather;
          const px = x + (mx - x) * f, py = y + (my - y) * f;
          pos[i * 3] = u.x * px + v.x * py; pos[i * 3 + 1] = u.y * px + v.y * py; pos[i * 3 + 2] = u.z * px + v.z * py;
        });
        geo.attributes.position.needsUpdate = true;
        debris.material.opacity = 0.95 * (1 - gather * 0.75); moon.material.opacity = gather; moon.scale.setScalar(4 + 40 * gather);
        moon.position.set(u.x * mx + v.x * my, u.y * mx + v.y * my, u.z * mx + v.z * my);
      });
    },
    // time runs through a span while the continents glide; the camera stays with a place on the moving land
    async plates(ctx, at, o) {
      const alt = o.alt ?? 1.7, ride = o.ride, here = () => ride({ lat: at.lat, lng: at.lng });
      ctx.setTime(-o.from_ma * 1e6);
      const h0 = here(); fly(ctx, h0.lat, h0.lng, alt, 900);
      await wait(ms(900));
      if (!o.alive()) return;
      const follow = reduced ? null : follower(ctx, alt), tip = new THREE.Vector3(); let last = 0;
      await tween(ms(Math.max(4200, o.ms - 900)), k => {
        const now = performance.now(); if (k < 1 && now - last < 40) { if (follow) follow(tip); return; }
        last = now;
        const f = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        ctx.setTime(-(o.from_ma + (o.to_ma - o.from_ma) * f) * 1e6);
        const p = here(); if (follow) follow(tip.copy(anchor(ctx, p.lat, p.lng, 0)));
      });
    },
    // the clock moves to a date and the camera to a place
    async arrive(ctx, at, o) {
      if (o.year != null) ctx.setTime(o.year);
      fly(ctx, at.lat, at.lng, o.alt ?? 1.4, 1200);
      const d = dirPulse(ctx, at); await tween(ms(Math.max(4200, o.ms)), k => d(k));
    },
  };
  const dirPulse = (ctx, at) => { const g = sceneGroup(), rings = [0, 1, 2].map(() => surfaceRing(ctx, at.lat, at.lng, 90, new THREE.Color('#d9b36a'), false)); rings.forEach(m => g.add(m)); return k => rings.forEach((m, j) => { const p = (k * 2 + j / 3) % 1; m.scale.setScalar(0.15 + p * 1.6); m.material.opacity = 0.9 * (1 - p); }); };

  // ---------- build beats: record's own, or a generated point template for outlines (spec 6.2)
  function beatsFor(rec) {
    const own = rec.animation?.beats;
    if (own && own.length) return own;
    const wp = rec.where?.geometry?.waypoints || [];
    // a dated route: one step per stop, moving the clock along with it
    if (wp.length >= 3 && wp.every(w => typeof w.year === 'number')) return wp.map((w, i) => ({ span: String(w.year), action: i ? `path.trace { stop: ${i} }` : `pulse { lat: ${w.lat}, lon: ${w.lon}, radius_km: 60 }`, caption: `${w.date}. ${w.label}` }));
    const b = [{ span: String(rec.when?.start?.year ?? ''), action: `pulse { radius_km: ${Math.max(30, rec.where?.uncertainty_km || 40)} }`, caption: rec.summary || rec.title }];
    if (wp.length >= 2) b.push({ span: String(rec.when?.start?.year ?? ''), action: 'path.trace {}', caption: `Route: ${wp.map(w => w.label || '').filter(Boolean).slice(0, 4).join(' → ')}` });
    return b;
  }

  async function play(rec, ctx) {
    stop(); const id = ++run; paused = false;
    layer = new THREE.Group(); ctx.globe.scene().add(layer);
    active = rec;
    const color = new THREE.Color(ctx.color || '#d9b36a');
    const beats = beatsFor(rec), wp = rec.where?.geometry?.waypoints || [], regions = rec.where?.geometry?.regions || [];
    const total = rec.animation?.duration_s ? rec.animation.duration_s * 1000 : beats.length * 6000;
    const per = Math.max(4200, Math.min(9000, total / beats.length));
    const home = { lat: rec.where?.lat ?? 0, lng: rec.where?.lon ?? 0 }, ride = p => (ctx.ride ? ctx.ride(p) : p);
    beatCount = beats.length; cur = 0; ctx.onStart(beats.length);
    const startYear = spanYear(beats[0]?.span) ?? rec.when?.start?.year;
    if (startYear != null) ctx.setTime(startYear);
    const view = wp.length >= 2 ? routeView(ctx, wp) : null;
    if (view) fly(ctx, view.lat, view.lng, view.overview); else { const h = ride(home); fly(ctx, h.lat, h.lng, 0.45); }
    await wait(reduced ? 200 : 1500);
    let wpIndex = 0, trace = null;
    // a beat that moves along the route: a route verb, or a moving marker/person that names where it goes ("marker.pin" stays put)
    const isPath = (name, params = {}) => wp.length >= 2 && (/path|trace|route|march|voyage|migrat/.test(name) || /person|marker/.test(name) && Array.isArray(params.to));
    const isPt = a => Array.isArray(a) && Number.isFinite(a[0]) && Number.isFinite(a[1]);
    // how far along the route a moving beat ends: the stop or "to" point it names, else the end of the route
    const pathEnd = params => Number.isFinite(params.stop) ? trace.stopStep(params.stop) : isPt(params.to) ? Math.max(trace.drawn, trace.stepOf(params.to[0], params.to[1], trace.drawn)) : trace.count;
    // which point does beat i happen at? explicit lat/lon, a waypoint named in the caption, or the next waypoint
    const placeOf = (i, params) => {
      if (Number.isFinite(params.lat) && Number.isFinite(params.lon)) return { lat: params.lat, lng: params.lon };
      if (isPt(params.anchor)) return { lat: params.anchor[0], lng: params.anchor[1] };
      if (isPt(params.to) && !wp.length) return { lat: params.to[0], lng: params.to[1] };
      if (isPt(params.at)) return { lat: params.at[0], lng: params.at[1] };
      if (wp.length) {
        const cap = String(beats[i].caption || '').toLowerCase();
        const hit = wp.findIndex(w => String(w.label || '').split(/[,:(]/)[0].trim().length > 3 && cap.includes(String(w.label).split(/[,:(]/)[0].trim().toLowerCase()));
        if (hit >= 0) wpIndex = hit; return { lat: wp[wpIndex].lat, lng: wp[wpIndex].lon };
      }
      if (regions.length) { const r = regions[i % regions.length]; return { lat: r.lat, lng: r.lon }; }
      return home;
    };
    // a beat that has a scene: the one this record is given, a scene named outright, or a verb that describes one
    const sceneFor = (i, name, params) => {
      if (ctx.scene && i === (ctx.scene.beat || 0)) return ctx.scene;
      if (name.startsWith('scene.')) return { ...params, type: name.slice(6) };
      if (/scrub/.test(name) && Number.isFinite(params.from_ma)) return { type: 'plates', from_ma: params.from_ma, to_ma: params.to_ma, at: params.at || FOLLOW[params.follow], alt: params.alt };
      if (Array.isArray(params.waypoints_ma)) return { type: 'plates', from_ma: params.waypoints_ma[0], to_ma: params.waypoints_ma[params.waypoints_ma.length - 1], at: FOLLOW[params.feature] };
      if (name === 'impact.sequence') return { type: 'giant' };
      if (name === 'overlay.wave') return { type: 'wave', km: 1000 };
      if (name === 'layer.climate' && /darkness/.test(String(params.effect))) return { type: 'dim' };
      if (name === 'layer.ocean') return { type: 'dim', color: params.field === 'ph' ? '#7a8f2a' : '#a83a1e', level: 0.32 };
      return null;
    };
    const after = (name, params) => { wpIndex = isPath(name, params) ? wp.length - 1 : wp.length ? Math.min(wp.length - 1, wpIndex + 1) : wpIndex; };
    // jumping (back, or ahead by several beats): redraw the scene as it stood when beat t began, with routes and
    // filled regions from earlier beats already complete and passing pulses left out
    const rebuildTo = t => {
      while (layer.children.length) layer.remove(layer.children[0]);
      wpIndex = 0; trace = null;
      for (let j = 0; j < t; j++) {
        const { name, params } = parseAction(beats[j].action), at = ride(placeOf(j, params)), sc = sceneFor(j, name, params);
        if (sc) { if (sc.type === 'plates') ctx.setTime(-sc.to_ma * 1e6); after(name, params); continue; }
        if (isPath(name, params)) { trace = trace || traceLine(ctx, wp, color); trace.draw(pathEnd(params)); }
        else if (/region|fill|area|front/.test(name)) surfaceRing(ctx, at.lat, at.lng, params.radius_km || (params.radius_m ? params.radius_m / 1000 : 200), color, true);
        after(name, params);
      }
    };
    for (let i = 0; ; i++) {
      if (id !== run) return;
      if (i >= beats.length) { // the end: a short hold, unless the viewer steps back into the sequence
        await wait(900); if (id !== run) return;
        if (seekTo == null) break;
      } else {
        cur = i;
        await runBeat(i);
        if (id !== run) return;
      }
      skip = false;
      if (seekTo != null) { const t = seekTo; seekTo = null; if (t !== i + 1) rebuildTo(t); i = t - 1; }
    }
    cleanup(ctx); ctx.onEnd();

    async function runBeat(i) {
      const beat = beats[i], { name, params } = parseAction(beat.action);
      const y = spanYear(beat.span); if (y != null && Math.abs(y) < 1e7) ctx.setTime(y);
      ctx.caption(i, beat.caption || '', beat.consequence);
      const sc = sceneFor(i, name, params);
      if (sc) {
        ctx.schematic?.();
        if (sc.ma != null) ctx.setTime(-sc.ma * 1e6);
        const raw = sc.at ? { lat: sc.at[0], lng: sc.at[1] } : placeOf(i, params), started = performance.now();
        const target = reduced ? 3000 : Math.max(per, String(beat.caption || '').length * 55);    // long enough to read the caption
        await SCENES[sc.type](ctx, sc.type === 'plates' ? raw : ride(raw), { ...sc, ms: target, ride, alive: () => id === run });
        const left = target - (performance.now() - started);
        if (left > 0 && id === run) await wait(left);
        after(name, params); return;
      }
      const at = ride(placeOf(i, params));
      if (isPath(name, params)) {
        trace = trace || traceLine(ctx, wp, color);
        const from = trace.drawn, to = pathEnd(params);
        const follow = reduced ? null : follower(ctx, view ? view.follow : 0.5), tip = new THREE.Vector3();
        await tween(per, k => {
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;        // ease in and out along the route
          const f = from + (to - from) * e, n = Math.floor(f);
          trace.draw(f);
          if (follow) follow(tip.copy(trace.at(n)).lerp(trace.at(n + 1), f - n));
        });
        after(name, params); return;
      }
      if (!/numbers/.test(name)) fly(ctx, at.lat, at.lng, pointAlt(params.radius_km || (params.radius_m || 0) / 1000 || 120));
      if (/region|fill|area|front/.test(name)) {
        const disc = surfaceRing(ctx, at.lat, at.lng, params.radius_km || (params.radius_m ? params.radius_m / 1000 : 200), color, true);
        await tween(per, k => { disc.scale.setScalar(0.2 + 0.8 * Math.min(1, k * 1.6)); });
      } else if (/numbers|counter/.test(name)) {
        const [lo, hi] = Array.isArray(params.range) ? params.range : [params.from || 0, params.to || 0];
        await tween(per, k => ctx.caption(i, `${beat.caption || ''}`, beat.consequence, lo === hi ? fmt(lo * Math.min(1, k * 1.5)) : `${fmt(lo * Math.min(1, k * 1.5))}–${fmt(hi * Math.min(1, k * 1.5))}`));
      } else { // pulse, layer.*, overlay.*, camera, anything else: a pulse at the beat's place
        const km = params.radius_km || (params.radius_m ? params.radius_m / 1000 : 60);
        const rings = [0, 1, 2].map(() => surfaceRing(ctx, at.lat, at.lng, km, color, false));
        await tween(per, k => rings.forEach((m, j) => { const p = (k * 2 + j / 3) % 1; m.scale.setScalar(0.15 + p * 1.6); m.material.opacity = 0.9 * (1 - p); }));
        rings.forEach(m => m.parent?.remove(m)); // the layer is gone if the sequence was stopped mid-pulse
      }
      after(name, params);
    }
  }
  function cleanup(ctx) { if (layer && layer.parent) layer.parent.remove(layer); layer = null; active = null; }
  function stop() { run++; paused = false; skip = false; seekTo = null; if (layer && layer.parent) layer.parent.remove(layer); layer = null; active = null; }
  function setPaused(p) { paused = p; }
  // step to another beat: the current one finishes at once and playback continues from beat i (clamped to the sequence)
  function goTo(i) { if (!active) return; seekTo = Math.max(0, Math.min(beatCount - 1, i)); skip = true; }
  function step(delta) { goTo((seekTo ?? cur) + delta); }
  window.Sequence = { play, stop, setPaused, goTo, step, get playing() { return !!active; }, get recordId() { return active?.id || null; }, get beat() { return cur; }, parseAction, spanYear };
})();
