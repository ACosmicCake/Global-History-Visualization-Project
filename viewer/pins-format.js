// The compact form of api/pins.json, shared by the data layer (api.mjs, which writes it) and the viewer (app.js,
// which reads it). A pin leaves out every field that holds its common value, and the viewer puts them back once after
// fetching, so the rest of the viewer reads the same fields as before. Tooltip teasers travel separately in
// api/teasers.json. Loaded as a classic script in the browser (window.AtlasPins) and with import in Node.
(function (root) {
  // field -> the value a pin has when the field is left out
  const DEFAULTS = { confidence: 'established', geometry: 'point', global: false, paleo: null };
  const LISTS = ['waypoints', 'regions', 'aliases'];   // left out when empty
  function compact(p) {
    const out = {};
    for (const [k, v] of Object.entries(p)) {
      if (k === 'summary' || k === 'outline' || v === undefined) continue;
      if (k in DEFAULTS && v === DEFAULTS[k]) continue;
      if (LISTS.includes(k) && Array.isArray(v) && !v.length) continue;
      if (k === 'end' && v === p.start) continue;
      if (k === 'until' && v === p.end) continue;
      out[k] = v;
    }
    if (!p.outline) out.full = true;   // full records are the few; outlines are the rule
    return out;
  }
  function expand(p) {
    for (const k in DEFAULTS) if (!(k in p)) p[k] = DEFAULTS[k];
    for (const k of LISTS) if (!p[k]) p[k] = [];
    if (!('end' in p)) p.end = p.start;
    if (!('until' in p)) p.until = p.end;
    p.outline = !p.full; delete p.full;
    return p;
  }
  const api = { DEFAULTS, LISTS, compact, expand };
  root.AtlasPins = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
