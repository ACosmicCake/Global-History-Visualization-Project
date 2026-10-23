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
    return { count: steps, verts, at: n => verts[Math.max(0, Math.min(steps, n))], get drawn() { return drawn; }, draw, stepOf, ghost };
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

  // ---------- build beats: record's own, or a generated point template for outlines (spec 6.2)
  function beatsFor(rec) {
    const own = rec.animation?.beats;
    if (own && own.length) return own;
    const wp = rec.where?.geometry?.waypoints || [];
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
    const home = { lat: rec.where?.lat ?? 0, lng: rec.where?.lon ?? 0 };
    beatCount = beats.length; cur = 0; ctx.onStart(beats.length);
    const startYear = spanYear(beats[0]?.span) ?? rec.when?.start?.year;
    if (startYear != null) ctx.setTime(startYear);
    const view = wp.length >= 2 ? routeView(ctx, wp) : null;
    if (view) fly(ctx, view.lat, view.lng, view.overview); else fly(ctx, home.lat, home.lng, 0.45);
    await wait(reduced ? 200 : 1500);
    let wpIndex = 0, trace = null;
    // a beat that moves along the route: a route verb, or a moving marker/person that names where it goes ("marker.pin" stays put)
    const isPath = (name, params = {}) => wp.length >= 2 && (/path|trace|route|march|voyage|migrat/.test(name) || /person|marker/.test(name) && Array.isArray(params.to));
    const isPt = a => Array.isArray(a) && Number.isFinite(a[0]) && Number.isFinite(a[1]);
    // how far along the route a moving beat ends: its "to" point if it names one, else the end of the route
    const pathEnd = params => isPt(params.to) ? Math.max(trace.drawn, trace.stepOf(params.to[0], params.to[1], trace.drawn)) : trace.count;
    // which point does beat i happen at? explicit lat/lon, a waypoint named in the caption, or the next waypoint
    const placeOf = (i, params) => {
      if (Number.isFinite(params.lat) && Number.isFinite(params.lon)) return { lat: params.lat, lng: params.lon };
      if (isPt(params.at)) return { lat: params.at[0], lng: params.at[1] };
      if (wp.length) {
        const cap = String(beats[i].caption || '').toLowerCase();
        const hit = wp.findIndex(w => String(w.label || '').split(/[,:(]/)[0].trim().length > 3 && cap.includes(String(w.label).split(/[,:(]/)[0].trim().toLowerCase()));
        if (hit >= 0) wpIndex = hit; return { lat: wp[wpIndex].lat, lng: wp[wpIndex].lon };
      }
      if (regions.length) { const r = regions[i % regions.length]; return { lat: r.lat, lng: r.lon }; }
      return home;
    };
    const after = (name, params) => { wpIndex = isPath(name, params) ? wp.length - 1 : wp.length ? Math.min(wp.length - 1, wpIndex + 1) : wpIndex; };
    // jumping (back, or ahead by several beats): redraw the scene as it stood when beat t began, with routes and
    // filled regions from earlier beats already complete and passing pulses left out
    const rebuildTo = t => {
      while (layer.children.length) layer.remove(layer.children[0]);
      wpIndex = 0; trace = null;
      for (let j = 0; j < t; j++) {
        const { name, params } = parseAction(beats[j].action), at = placeOf(j, params);
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
      const at = placeOf(i, params);
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
