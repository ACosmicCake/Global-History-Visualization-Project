// The viewer's data, shared by the live server (server.mjs) and the static build (build-static.mjs), so a local run
// and the published site serve exactly the same JSON: the pin list, and one full record per id.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RECORDS = path.resolve(HERE, '..', 'atlas', 'records');
const WIKI_LINKS = path.resolve(HERE, '..', 'atlas', 'wiki_links.json');
const WIKI_ALIASES = path.resolve(HERE, '..', 'atlas', 'wiki_aliases.json');
const QUEUE = path.resolve(HERE, '..', 'atlas', 'queue.json');

// Only the fields the engine needs for pins; the full record is fetched on click. The summary is only the hover
// tooltip's teaser, so it is cut to about two lines (it was most of the pin list's size).
const teaser = s => { s = String(s || ''); return s.length <= 180 ? s : s.slice(0, 180).replace(/\s+\S*$/, '') + '…'; };
// Month and day for "on this day", from the record's ISO date or else the date it displays ("24 May 1819", "July 4, 1776").
// Dates before the Gregorian calendar (1582) are left out rather than converted: a Julian date would land on the wrong day.
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function monthDay(r) {
  if (!['day', 'hour', 'minute'].includes(r.when?.precision)) return undefined;
  const pad = n => String(n).padStart(2, '0'), iso = String(r.when.start?.iso || '').match(/^(\d{4})-(\d\d)-(\d\d)/);
  if (iso) return +iso[1] >= 1582 ? `${iso[2]}-${iso[3]}` : undefined;
  if ((r.when.start?.year ?? 0) < 1582) return undefined;
  const d = String(r.when.display || ''), a = d.match(/^(\d{1,2}) ([A-Z][a-z]+),? \d{4}/), b = d.match(/^([A-Z][a-z]+) (\d{1,2}),? \d{4}/);
  const day = a?.[1] ?? b?.[2], month = MONTHS.indexOf((a?.[2] ?? b?.[1] ?? '').toLowerCase());
  return day && month >= 0 ? `${pad(month + 1)}-${pad(day)}` : undefined;
}
function pin(r, rank) {
  return {
    id: r.id, title: r.title, summary: teaser(r.summary), kind: r.kind, scale: r.scale, importance: r.importance?.score ?? 1,
    confidence: r.confidence, domains: r.domains, start: r.when?.start?.year, end: r.when?.end?.year ?? r.when?.start?.year,
    display: r.when?.display, lat: r.where?.lat, lon: r.where?.lon, global: (r.where?.uncertainty_km ?? 0) >= 5000 || r.where?.geometry?.type === 'global', paleo: r.where?.paleo?.lat != null ? r.where.paleo : null,
    geometry: r.where?.geometry?.type, waypoints: (r.where?.geometry?.waypoints || []).map(w => ({ lat: w.lat, lon: w.lon, year: typeof w.year === 'number' ? w.year : null, date: w.date, label: w.label })),
    regions: (r.where?.geometry?.regions || []).map(g => ({ lat: g.lat, lon: g.lon, name: g.name })),
    outline: r.status === 'outline', hasModel: !!r.model, updated: r.updated, aliases: (r.aliases || []).map(a => a.name).filter(Boolean),
    region: r.regions?.[0], unc: r.where?.uncertainty_km, md: monthDay(r), rank,
  };
}

// published records plus outlines (amendment A1); stubs and drafts stay out
const parsed = new Map();   // file name -> its last read: only files that changed are read again
let recordsVersion = 0;
export const recordsSeen = () => recordsVersion;
export function published() {
  const out = [], files = fs.readdirSync(RECORDS).filter(f => f.endsWith('.json'));
  if (files.length !== parsed.size) recordsVersion++;
  const here = new Set(files);
  for (const f of parsed.keys()) if (!here.has(f)) parsed.delete(f);
  for (const f of files) {
    const file = path.join(RECORDS, f), at = fs.statSync(file).mtimeMs; let seen = parsed.get(f);
    if (!seen || seen.at !== at) {
      let r;
      try { r = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) { if (process.env.CI) throw new Error(`${f}: ${e.message}`); console.error(`skipped ${f}: ${e.message}`); r = null; }
      seen = { at, r }; parsed.set(f, seen); recordsVersion++;
    }
    if (seen.r && (seen.r.status === 'published' || seen.r.status === 'outline')) out.push(seen.r);
  }
  return out;
}

// Which pins show when zoomed out. Importance alone barely filters (three in four records are 4 or 5), so among
// records of the same importance and region the less widely covered ones (queue significance: Wikipedia language
// editions and pageviews) step down one tier for zoom thinning. Ranking inside each region keeps this from favouring
// the regions Wikipedia covers best. Importance itself, shown on the record and in the filters, doesn't change.
function displayRanks(recs) {
  let sig = new Map();
  try { sig = new Map(JSON.parse(fs.readFileSync(QUEUE, 'utf8')).items.map(i => [i.id, i.significance])); } catch {}
  const groups = new Map(), ranks = new Map();
  for (const r of recs) {
    const score = r.importance?.score ?? 1, key = `${score}|${r.regions?.[0]}`;
    ranks.set(r.id, score);
    if (typeof sig.get(r.id) === 'number') (groups.get(key) || groups.set(key, []).get(key)).push(r);
  }
  for (const [key, group] of groups) {
    const score = +key.split('|')[0], cut = score === 5 ? 0.1 : score === 4 ? 0.5 : 0;    // the share that steps down
    group.sort((a, b) => sig.get(a.id) - sig.get(b.id));
    group.slice(0, Math.floor(group.length * cut)).forEach(r => ranks.set(r.id, score - 1));
  }
  return ranks;
}

export function pinsPayload(recs = published()) {
  const ranks = displayRanks(recs);
  return { generated: new Date().toISOString(), count: recs.filter(r => r.status === 'published').length, outlines: recs.filter(r => r.status === 'outline').length, pins: recs.map(r => pin(r, ranks.get(r.id))) };
}

const readLinks = () => { try { return JSON.parse(fs.readFileSync(WIKI_LINKS, 'utf8')); } catch { return {}; } };

// The search index, loaded the first time someone searches: other names (Wikidata labels and aliases, atlas/tools/aliases.mjs),
// the modern place name, and the whole summary. [id, names, place and summary]
export function searchPayload(recs = published()) {
  let wiki = {};
  try { wiki = JSON.parse(fs.readFileSync(WIKI_ALIASES, 'utf8')); } catch {}
  return recs.map(r => [r.id, (wiki[r.id] || []).join('\n'), `${r.where?.modern_name || ''} ${r.summary || ''}`]);
}

// Connections a record doesn't list itself: the other side of each link in other records (A "caused" B also shows on B
// as "caused by" A), and other records named word for word in its summary. Worked out here, so no record file changes.
const OPPOSITE = { caused: 'caused_by', caused_by: 'caused', part_of: 'has_part', has_part: 'part_of', related: 'related', same_place: 'same_place', same_person: 'same_person', contemporary: 'contemporary', consequence: 'caused_by' };
const GENERIC_TITLE = /^(the )?[a-z]+( [a-z]+)?$/;   // one or two ordinary lowercase words would match too much
export function linkIndex(recs = published()) {
  const extra = new Map(), add = (id, link) => (extra.get(id) || extra.set(id, []).get(id)).push(link);
  const listed = new Map(recs.map(r => [r.id, new Set((r.related || []).map(x => x.id))]));
  const seen = new Set(), link = (from, to, type, because) => {
    const key = `${from}|${to}`;
    if (from === to || !listed.has(from) || !listed.has(to) || listed.get(from).has(to) || seen.has(key)) return;
    seen.add(key); add(from, { id: to, type, ...(because ? { because } : {}) });
  };
  for (const r of recs) for (const x of r.related || []) link(x.id, r.id, OPPOSITE[x.type] || 'related', x.because);
  const named = recs.map(r => [r.id, r.title.toLowerCase()]).filter(([, t]) => t.length >= 9 && !GENERIC_TITLE.test(t));
  for (const r of recs) {
    const text = ` ${String(r.summary || '').toLowerCase()} `;
    for (const [id, t] of named) if (id !== r.id && text.includes(t)) { link(r.id, id, 'mentions'); link(id, r.id, 'mentioned_in'); }
  }
  return extra;
}
// Building the index reads every summary against every title, which takes seconds. The live server keeps it ready, and checks for changes after answering, so nobody waits on a click.
let linkCache = { at: 0, index: null, version: -1 };
export function warmLinks() { const recs = published(); if (linkCache.version !== recordsVersion) linkCache = { at: Date.now(), index: linkIndex(recs), version: recordsVersion }; else linkCache.at = Date.now(); }
const liveLinkIndex = () => {
  if (!linkCache.index) warmLinks();
  else if (Date.now() - linkCache.at > 15000) { linkCache.at = Date.now(); setTimeout(warmLinks, 0); }
  return linkCache.index;
};

// `reviewer_note` is the private process note: how the record was checked, which tool did what. Visitors get
// `visitor_note`, what remains uncertain about the history itself: the record's own field when it has one, otherwise
// the reviewer note with the process clauses dropped and first-person wording made neutral. No text is added, so a
// note about process alone leaves nothing to show.
const PROCESS = new RegExp([
  'Coordinator\\b', 'Link to', 'Link\\b', 'Drafted by', 'pipeline', 'machine-checked', 'WebFetch', 'spotcheck', 'HTTP \\d', '\\b40[34]\\b', '\\bqueue\\b', 'as_recorded', 'on upgrade', '\\breviewer\\b', 'Review wording', '\\bplaceholders?\\b', 'Rewritten \\d', 'Reworked from', 'withdrawn draft', 'dropped \\(', 'not researched', 'Beat dated',
  '\\bbatch\\b', 'blocked', 'could not (be )?(open|fetch|read|reach)', 'returned \\d', 'truncated', 'script-driven', '\\bOCR\\b', 'mirror', 'snippet', 'fetch',
  'search (page|lead)', '\\bgate\\b', '\\bsummary\\b', '\\bthe id\\b', '\\bid year\\b', '(3D|\\bno|\\bNo) model', 'model[- ](quality|written|block)', 'Linear \\(shape', '^Shape:', '\\bmesh',
  'confidence set', '\\bshape\\b', 'footprint', '\\bphases\\b', 'no_mesh', 'per instructions', 'unopened', 'record ID', 'P625', 'Coordinates now', 'atlas yet', '\\blinks?\\b', '\\boutline\\b', 'skipped', '^(Removed|Replaced|Tightened|Corrected|Reworded)\\b', 'was read\\b', 'read through', 'not opened', '\\bcitable\\b', '\\bclaimed\\b', 'lookup key',
].join('|'));
const NEUTRAL = [
  [/\b(?:pages?|sources?) I opened\b|\bopened (?:pages?|sources?)\b|\b(?:pages?|sources?) opened\b/g, m => (/pages\b|sources\b/.test(m) ? 'sources consulted' : 'source consulted')],
  [/\bI use(d)?\b/g, 'this record uses'], [/\bI follow(ed)?\b/g, 'this record follows'], [/\bI kept\b/g, 'this record keeps'], [/\bI show(ed)?\b/g, 'this record shows'], [/\bI record(ed)?\b/g, 'this record gives'],
  [/\bproxy\b/gi, 'stand-in'], [/\bcentroid\b/gi, 'centre'], [/^Least sure( of)?:\s*/, ''],
];
function neutralClause(c) {
  if (PROCESS.test(c)) return null;
  for (const [from, to] of NEUTRAL) c = c.replace(from, to);
  return /\b(I|my|opened)\b/.test(c) ? null : c.trim();   // anything still first-person is about the agent's own work
}
export function visitorNote(r) {
  if (typeof r.visitor_note === 'string') return r.visitor_note.trim() || null;
  const clean = String(r.reviewer_note || '').replace(/[{}]?\s*<\/?br\s*\/?>/gi, ' ').replace(/\}\s*$/, '');
  const out = clean.split(/(?<=[.!?])\s+(?=[A-Z("])/).map(s => {
    const parts = s.replace(/[.!?]$/, '').split(/;\s+/).map(neutralClause).filter(Boolean);
    if (!parts.length) return null;
    const t = parts.join('; ');
    return t[0].toUpperCase() + t.slice(1) + '.';
  }).filter(Boolean);
  return out.join(' ') || null;
}

// One record as visitors see it, with its English Wikipedia article attached (atlas/tools/wiki.mjs link): further
// reading, never one of its sources. Internal bookkeeping (changelog, author, parent_reconciliation, reviewer_note)
// stays out. Returns null for an unknown id or a record that is not published.
export function recordPayload(id, links = readLinks(), index = liveLinkIndex()) {
  if (!/^-?[a-z0-9-]+$/.test(id)) return null;
  const p = path.join(RECORDS, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (r.status !== 'published' && r.status !== 'outline') return null;
  const { changelog, author, parent_reconciliation, reviewer_note, ...pub } = r;
  pub.visitor_note = visitorNote(r);
  const more = index.get(id);
  if (more) pub.related = [...(r.related || []), ...more];
  if (links[id]) pub.wiki = links[id];
  return pub;
}
export { readLinks };
