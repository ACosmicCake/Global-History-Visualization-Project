// Quality gate (spec section 10). Usage: node atlas/tools/gate.mjs <id> [<id> ...] | --all
// Exit code 0 when every record passes. Prints FAIL lines (blocking) and WARN lines (advisory).
import { ENUMS, SCHEMA_VERSION, allIds, exists, load, words } from './lib.mjs';

// Wikipedia and its mirrors are maps to sources, never sources (spec 5.2)
const WIKI = /wikipedia.org|wikiwand.com|handwiki.org|dbpedia.org|wiki2.org|everybodywiki.com|alchetron.com|justapedia.org|wikizero|wikimili.com|baike\.baidu\.com|baike\.com|fandom\.com|erenow\.(org|net|com)|libgen|z-lib|annas-archive|pdfdrive|vdoc\.pub|dokumen\.pub|newworldencyclopedia.org|infogalactic|everipedia|academic\.ru|en-academic\.com|ancient-origins\.net/i;   // wikis, mirrors, pirated book copies
const CROWD = /wikidata\.org|geonames\.org|gplates\.org|openstreetmap\.org|nominatim/i;   // gazetteers and position services: fine for coordinates, not independent publishers of facts
// English Wikipedia may be cited only for Featured or Good articles (user decision, 2026-10-22), at a pinned revision,
// marked wiki_quality "FA" or "GA"; wiki.mjs checks the badge against Wikidata. Every other wiki and mirror stays banned.
const wikiOK = s => /^https:\/\/en\.wikipedia\.org\/w\/index\.php\?(.*&)?oldid=\d+/.test(s.url || '') && ['FA', 'GA'].includes(s.wiki_quality);
const isStr = s => typeof s === 'string' && s.trim().length > 0;
const isNum = n => typeof n === 'number' && Number.isFinite(n);

export function gate(rec) {
  const fail = [], warn = [];
  const F = (c, m) => { if (!c) fail.push(m); };
  const W = (c, m) => { if (!c) warn.push(m); };

  if (rec.status === 'stub') {
    F(isStr(rec.id) && isStr(rec.title) && ENUMS.kind.includes(rec.kind), 'stub needs id, title, kind');
    return { fail, warn, stub: true };
  }
  if (rec.tier === 'outline') return outlineGate(rec, F, W, fail, warn);

  // --- required scalar fields
  for (const k of ['id', 'title', 'summary', 'card', 'what', 'how', 'why_it_matters', 'reviewer_note'])
    F(isStr(rec[k]), `missing ${k}`);
  F(rec.schema_version === SCHEMA_VERSION, `schema_version must be ${SCHEMA_VERSION}`);
  F(ENUMS.status.includes(rec.status), 'bad status');
  F(ENUMS.kind.includes(rec.kind), 'bad kind');
  F(ENUMS.scale.includes(rec.scale), 'bad scale');
  F(ENUMS.confidence.includes(rec.confidence), 'bad confidence');
  F(rec.importance && [1, 2, 3, 4, 5].includes(rec.importance.score) && isStr(rec.importance.justification),
    'importance needs score 1-5 and justification');

  // --- reading depths
  W(words(rec.summary) <= 45, `summary is ${words(rec.summary)} words (target ≤ 45)`);
  F(words(rec.summary) <= 70, 'summary over 70 words');
  F(words(rec.card) >= 25 && words(rec.card) <= 120, `card is ${words(rec.card)} words (25-120)`);
  F(words(rec.what) >= 150 && words(rec.what) <= 420, `what is ${words(rec.what)} words (150-400)`);
  F(words(rec.why_it_matters) >= 100 && words(rec.why_it_matters) <= 320, `why_it_matters is ${words(rec.why_it_matters)} words (100-300)`);
  F(words(rec.how) >= 60, `how is ${words(rec.how)} words (≥ 60)`);
  F(rec.summary !== rec.card && !String(rec.what || '').startsWith(String(rec.card || '').slice(0, 80)),
    'summary, card and what must be written separately');
  W(/\b(if|without|had|would|might|could have)\b/i.test(rec.why_it_matters || ''),
    'why_it_matters: no counterfactual wording found');

  // --- sources
  const srcs = Array.isArray(rec.sources) ? rec.sources : [];
  const srcIds = new Set(srcs.map(s => s.id));
  F(srcs.length >= 3, 'fewer than 3 sources');
  for (const s of srcs) {
    F(isStr(s.id) && isStr(s.url) && isStr(s.title) && isStr(s.publisher) && isStr(s.accessed),
      `source ${s.id || '?'} needs id, url, title, publisher, accessed`);
    F(s.opened === true, `source ${s.id} not marked opened`);
    F(ENUMS.sourceClass.includes(s.class), `source ${s.id} bad class`);
    F(Array.isArray(s.supports) && s.supports.length > 0, `source ${s.id} supports nothing`);
    F(!WIKI.test(s.url || '') || wikiOK(s), `source ${s.id} is Wikipedia or a mirror (only Featured or Good English Wikipedia articles at a pinned oldid revision may be cited)`);
  }
  F(srcs.some(s => ['primary', 'scholarly'].includes(s.class)), 'no primary or scholarly source');
  const pubs = new Set(srcs.map(s => String(s.publisher || '').toLowerCase().trim()));
  F(pubs.size >= 3, 'fewer than 3 independent publishers');
  const refOk = id => srcIds.has(id);

  // --- when
  const w = rec.when || {};
  F(w.start && isNum(w.start.year), 'when.start.year missing');
  F(w.end && isNum(w.end.year), 'when.end.year missing (use start for instantaneous events)');
  if (w.start && w.end && isNum(w.start.year) && isNum(w.end.year)) F(w.end.year >= w.start.year, 'when.end before start');
  F(ENUMS.precision.includes(w.precision), 'when.precision bad');
  F(Array.isArray(w.as_recorded) && w.as_recorded.length > 0 &&
    w.as_recorded.every(a => isStr(a.calendar) && isStr(a.value) && refOk(a.source)),
    'when.as_recorded needs calendar, value, source (a source id)');
  F(isStr(w.display), 'when.display missing');
  F(w.uncertainty && typeof w.uncertainty === 'object', 'when.uncertainty missing (use zeros if exact)');
  const nowYear = new Date().getUTCFullYear();
  if (w.start && isNum(w.start.year)) {
    F(w.start.year <= nowYear - 1, 'event under one year old (spec 11.7)');
    if (w.start.year >= nowYear - 5) F(rec.provisional === true, 'event under five years old must be provisional');
  }
  if (w.start && w.start.iso) F(/^-?\d{4}/.test(w.start.iso), 'when.start.iso malformed');

  // --- where
  const g = rec.where || {};
  F(isNum(g.lat) && g.lat >= -90 && g.lat <= 90 && isNum(g.lon) && g.lon >= -180 && g.lon <= 180, 'where.lat/lon bad');
  F(g.elevation_m === null || isNum(g.elevation_m), 'where.elevation_m must be number or null');
  F(isStr(g.modern_name) && isStr(g.historical_name), 'where.modern_name and historical_name required');
  F(g.geometry && ENUMS.geometry.includes(g.geometry.type), 'where.geometry.type bad');
  if (g.geometry && g.geometry.type === 'path') {
    const wp = g.geometry.waypoints || [];
    F(wp.length >= 2, 'path geometry needs ≥ 2 waypoints');
    F(wp.every(p => isNum(p.lat) && isNum(p.lon) && isStr(p.date) && refOk(p.source)), 'every waypoint needs lat, lon, date, source id');
  }
  if (g.geometry && g.geometry.type === 'regions') {
    F((g.geometry.regions || []).length >= 1 && g.geometry.regions.every(r => isNum(r.lat) && isNum(r.lon) && refOk(r.source)),
      'regions geometry: each region needs lat, lon, source id');
  }
  F(Array.isArray(g.coordinate_sources) && g.coordinate_sources.length >= 2 && g.coordinate_sources.every(refOk),
    'where.coordinate_sources needs ≥ 2 valid source ids');
  F(isNum(g.uncertainty_km), 'where.uncertainty_km missing');
  if (w.start && isNum(w.start.year) && w.start.year < -1000000) {
    const p = g.paleo || {};
    F(isStr(p.not_applicable) || (isNum(p.lat) && isNum(p.lon) && isNum(p.age_ma) && isStr(p.plate_model) && refOk(p.source)),
      'older than 1 Ma: where.paleo needs lat, lon, age_ma, plate_model, source (or not_applicable reason)');
  } else {
    F(isStr(g.historical_geography_source) ? refOk(g.historical_geography_source) : false,
      'where.historical_geography_source must be a source id');
  }
  F(Array.isArray(rec.regions) && rec.regions.length > 0 && rec.regions.every(r => ENUMS.regions.includes(r)), 'regions bad');

  // --- who
  F(Array.isArray(rec.who) && rec.who.length > 0 && rec.who.every(p => isStr(p.name) && ENUMS.whoType.includes(p.type)),
    'who needs ≥ 1 entry with name and valid type');

  // --- domains, related
  F(Array.isArray(rec.domains) && rec.domains.length > 0 && rec.domains.every(d => ENUMS.domains.includes(d)), 'domains bad');
  const rel = Array.isArray(rec.related) ? rec.related : [];
  F(rel.length >= 5, `only ${rel.length} related links (≥ 5)`);
  for (const r of rel) {
    F(isStr(r.id) && ENUMS.related.includes(r.type), `related ${r.id}: bad id/type`);
    if (['caused', 'caused_by'].includes(r.type)) F(words(r.because) >= 6, `related ${r.id}: causal link needs a because sentence`);
    F(r.id !== rec.id, 'record links to itself');
  }
  W(rel.some(r => ['caused', 'caused_by'].includes(r.type)), 'no causal links');

  // --- media
  const media = Array.isArray(rec.media) ? rec.media : [];
  F(media.some(m => m.type === 'image'), 'no image');
  for (const m of media) {
    F(isStr(m.license) && isStr(m.credit) && isStr(m.source_url) && isStr(m.file_url || m.source_url), `media ${m.title}: license, credit, source_url required`);
    F(m.verified === true, `media ${m.title}: license not verified on its source page`);
    W(!/\bNC\b|\bND\b|non-?commercial|no-?deriv/i.test(m.license || ''), `media ${m.title}: NC/ND license`);
  }

  // --- animation
  const a = rec.animation || {};
  F(ENUMS.template.includes(a.template), 'animation.template bad');
  if (a.template === 'directed') F(rec.importance && rec.importance.score >= 4, 'directed sequences only for importance 4-5');
  F(Array.isArray(a.beats) && a.beats.length >= 2, 'animation needs ≥ 2 beats');
  for (const b of a.beats || []) F(isStr(b.span) && isStr(b.action) && isStr(b.caption) && refOk(b.source), `beat "${(b.caption || '').slice(0, 30)}": span, action, caption, source id`);
  F((a.beats || []).some(b => b.consequence === true), 'no beat flagged consequence: true');
  F(isNum(a.duration_s) && (a.template === 'directed' ? a.duration_s <= 180 : a.duration_s < 60), 'animation.duration_s out of range');
  if (rec.kind === 'person') W(a.template === 'person' || a.template === 'directed', 'person record should use person template');

  // --- confidence & perspectives
  if (rec.confidence === 'contested') F(Array.isArray(rec.perspectives) && rec.perspectives.length >= 2 &&
    rec.perspectives.every(p => isStr(p.holder) && isStr(p.account) && (p.sources || []).every(refOk) && (p.sources || []).length > 0),
    'contested: ≥ 2 sourced perspectives');
  for (const p of rec.perspectives || []) F((p.sources || []).every(refOk), `perspective ${p.holder}: unknown source id`);

  // --- numbers
  for (const n of rec.numbers || []) {
    F(isStr(n.field) && isStr(n.unit) && refOk(n.source), `number ${n.field}: field, unit, source id`);
    F(isNum(n.low) && isNum(n.high) && n.high >= n.low, `number ${n.field}: needs low ≤ high`);
    if (n.low === n.high) W(isStr(n.note), `number ${n.field}: single value — note why no range`);
  }

  // --- guardrails
  if ((rec.domains || []).includes('atrocity_injustice')) F(isStr(rec.audience_note), 'atrocity record needs audience_note');
  if ((rec.domains || []).includes('wars_conflict')) W(isStr(rec.audience_note), 'war record: consider audience_note');
  const prose = [rec.summary, rec.card, rec.what, rec.how, rec.why_it_matters,
    ...(rec.animation?.beats || []).map(b => b.caption), ...(rec.perspectives || []).map(p => p.account)].join('\n');
  for (const m of prose.matchAll(/["“]([^"”\n]{3,})["”]/g)) F(words(m[1]) <= 15, `quotation over 15 words: "${m[1].slice(0, 40)}…"`);
  F(Array.isArray(rec.aliases) && rec.aliases.length > 0 && rec.aliases.every(x => isStr(x.name) && isStr(x.language) && isStr(x.period)),
    'aliases: ≥ 1, each with name, language, period');
  F(Array.isArray(rec.layers), 'layers missing');

  // --- model
  if (rec.kind === 'place' && rec.importance && rec.importance.score >= 3) {
    const m = rec.model || {};
    F(m.footprint && refOk(m.footprint.source), 'model.footprint.source required');
    F(m.geometry && ['scan', 'procedural', 'reconstruction'].includes(m.geometry.type) && refOk(m.geometry.source), 'model.geometry type + source required');
    F(Array.isArray(m.lod) && m.lod.length >= 3, 'model.lod needs ≥ 3 levels');
    F(Array.isArray(m.phases) && m.phases.length >= 1 && m.phases.every(p => isNum(p.start_year) && isStr(p.state) && refOk(p.source)), 'model.phases need start_year, state, source');
    F(Array.isArray(m.materials) && m.materials.length >= 1 && m.materials.every(x => isStr(x.material) && refOk(x.source)), 'model.materials need material + source');
    F((m.geometry?.measurements || []).every(x => refOk(x.source)), 'model measurements need source ids');
  }
  if ((rec.related || []).some(r => r.type === 'part_of') && (rec.numbers || []).length)
    W(isStr(rec.parent_reconciliation), 'child with numbers: add parent_reconciliation');

  return { fail, warn };
}

// Outline tier (spec amendment A1, atlas/SPEC_AMENDMENTS.md): a sourced pin, written breadth-first and upgraded
// to a full record later. Less content, same accuracy rules: every date and coordinate comes from an opened source.
function outlineGate(rec, F, W, fail, warn) {
  for (const k of ['id', 'title', 'summary', 'reviewer_note']) F(isStr(rec[k]), `missing ${k}`);
  F(rec.schema_version === SCHEMA_VERSION, `schema_version must be ${SCHEMA_VERSION}`);
  F(ENUMS.kind.includes(rec.kind), 'bad kind');
  F(ENUMS.scale.includes(rec.scale), 'bad scale');
  F(ENUMS.confidence.includes(rec.confidence), 'bad confidence');
  F(rec.importance && [1, 2, 3, 4, 5].includes(rec.importance.score) && isStr(rec.importance.justification), 'importance needs score 1-5 and justification');
  F(words(rec.summary) >= 15 && words(rec.summary) <= 90, `summary is ${words(rec.summary)} words (15-90)`);
  const srcs = Array.isArray(rec.sources) ? rec.sources : [], ids = new Set(srcs.map(s => s.id));
  F(srcs.length >= 2, 'outline needs ≥ 2 opened sources');
  for (const s of srcs) {
    F(isStr(s.id) && isStr(s.url) && isStr(s.title) && isStr(s.publisher) && isStr(s.accessed), `source ${s.id || '?'} needs id, url, title, publisher, accessed`);
    F(s.opened === true, `source ${s.id} not marked opened`);
    F(ENUMS.sourceClass.includes(s.class), `source ${s.id} bad class`);
    F(!WIKI.test(s.url || '') || wikiOK(s), `source ${s.id} is Wikipedia or a mirror (only Featured or Good English Wikipedia articles at a pinned oldid revision may be cited)`);
  }
  F(new Set(srcs.filter(s => !CROWD.test(s.url || '')).map(s => String(s.publisher).toLowerCase())).size >= 2, 'outline needs 2 independent publishers (Wikidata, GeoNames, GPlates and OpenStreetMap do not count)');
  F(srcs.some(s => s.class !== 'other'), 'outline needs at least one source that is not class "other"');
  const w = rec.when || {};
  F(w.start && isNum(w.start.year) && w.end && isNum(w.end.year) && w.end.year >= w.start.year, 'when.start/end years required');
  F(ENUMS.precision.includes(w.precision), 'when.precision bad');
  F(isStr(w.display), 'when.display missing');
  F(Array.isArray(w.as_recorded) && w.as_recorded.length > 0 && w.as_recorded.every(a => isStr(a.value) && ids.has(a.source)), 'when.as_recorded needs value + source id');
  if (w.start && isNum(w.start.year)) F(w.start.year <= new Date().getUTCFullYear() - 1, 'event under one year old');
  const g = rec.where || {};
  F(isNum(g.lat) && Math.abs(g.lat) <= 90 && isNum(g.lon) && Math.abs(g.lon) <= 180, 'where.lat/lon bad');
  F(isStr(g.modern_name) && isStr(g.historical_name), 'where.modern_name and historical_name required');
  F(isNum(g.uncertainty_km), 'where.uncertainty_km missing');
  F(Array.isArray(g.coordinate_sources) && g.coordinate_sources.length >= 1 && g.coordinate_sources.every(x => ids.has(x)), 'where.coordinate_sources needs ≥ 1 source id');
  F(Array.isArray(rec.regions) && rec.regions.length && rec.regions.every(r => ENUMS.regions.includes(r)), 'regions bad');
  F(Array.isArray(rec.domains) && rec.domains.length && rec.domains.every(d => ENUMS.domains.includes(d)), 'domains bad');
  if ((rec.domains || []).includes('atrocity_injustice')) F(isStr(rec.audience_note), 'atrocity outline needs audience_note');
  for (const m of String(rec.summary).matchAll(/["“]([^"”\n]{3,})["”]/g)) F(words(m[1]) <= 15, 'quotation over 15 words');
  W(Array.isArray(rec.related) && rec.related.length > 0, 'no related links yet');
  if (rec.animation) { // optional at outline stage (OUTLINE_BRIEF.md); when present it must be sourced and stand alone
    const a = rec.animation, beats = Array.isArray(a.beats) ? a.beats : [];
    F(ENUMS.template.includes(a.template) && a.template !== 'directed', 'outline animation.template bad (directed is for importance 4-5 full records)');
    F(beats.length >= 1 && beats.every(b => isStr(b.span) && isStr(b.action) && isStr(b.caption) && ids.has(b.source)), 'every beat needs span, action, caption and a source id');
    F(beats.every(b => words(b.caption) <= 30), 'outline beat captions must be under 30 words');
    W(beats.some(b => b.consequence === true), 'no beat flagged consequence');
  } else W(false, 'no animation yet (the viewer generates a point template)');
  if (rec.model) { // monuments may carry a model already at outline stage (MODEL_BRIEF.md): same sourcing rules as full records
    const m = rec.model, meas = m.geometry?.measurements || [];
    F(m.footprint && ids.has(m.footprint.source), 'model.footprint.source required');
    F(m.geometry && ['scan', 'procedural', 'reconstruction'].includes(m.geometry.type) && ids.has(m.geometry.source), 'model.geometry type + source required');
    F(meas.some(x => /height/i.test(x.part) && isNum(x.value)), 'model needs a sourced height');
    F(meas.some(x => /base|length|width|diameter|side/i.test(x.part) && isNum(x.value)), 'model needs a sourced plan dimension');
    F(meas.every(x => ids.has(x.source) && isNum(x.value)), 'every model measurement needs a value and a source id');
    F(Array.isArray(m.phases) && m.phases.length > 0 && m.phases.every(p => isNum(p.start_year) && isStr(p.state) && ids.has(p.source)), 'model.phases need start_year, state, source');
    W(['pyramid', 'stepped_pyramid', 'ziggurat', 'dome', 'domed_building', 'tower', 'obelisk', 'block', 'arena', 'ring', 'statue_group', 'statue', 'stupa', 'temple_colonnade', 'round_hall', 'pagoda', 'spiral_minaret', 'wall', 'mound', 'cave'].includes(m.geometry?.shape), 'model.geometry.shape missing or unknown');
  }
  return { fail, warn, outline: true };
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}` || process.argv[1].endsWith('gate.mjs')) {
  const args = process.argv.slice(2);
  const ids = args[0] === '--all' ? allIds() : args;
  let bad = 0;
  for (const id of ids) {
    if (!exists(id)) { console.log(`FAIL ${id}: no such record`); bad++; continue; }
    let rec; try { rec = load(id); } catch (e) { console.log(`FAIL ${id}: invalid JSON (${e.message})`); bad++; continue; }
    const { fail, warn, stub } = gate(rec);
    if (args[0] === '--all' && stub && !fail.length) continue;
    console.log(`${fail.length ? 'FAIL' : 'PASS'} ${id}${stub ? ' (stub)' : ''}`);
    fail.forEach(m => console.log(`  ✗ ${m}`));
    warn.forEach(m => console.log(`  ! ${m}`));
    if (fail.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}
