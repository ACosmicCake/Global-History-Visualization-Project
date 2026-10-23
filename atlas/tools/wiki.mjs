// Wikipedia and Wikidata as a map, never a source (spec 5.2): importance signals for ranking the queue, reference
// links as leads for historian agents, and discovery of well-covered topics the atlas is missing.
// Nothing from here is ever cited; agents still open and verify every page themselves.
// Usage:
//   node atlas/tools/wiki.mjs layer [--min 15]               build the viewer's Wikipedia pin layer (viewer/data/wiki-pins.json)
//   node atlas/tools/wiki.mjs link [--refresh]               match every record to its Wikipedia article (atlas/wiki_links.json)
//   node atlas/tools/wiki.mjs signals "<title>"            what Wikipedia knows: page, Wikidata id, editions, views, leads
//   node atlas/tools/wiki.mjs rank [--limit N] [--refresh]   score open outline targets from editions and pageviews
//   node atlas/tools/wiki.mjs discover <preset> [--min N] [--limit N]   write inbox/wiki-<preset>.targets.json
//      presets: battles wars treaties revolutions epidemics earthquakes eruptions heritage
// Signals: significance = editions of Wikipedia covering it (log scale, 250+ = 100);
//          demand = English pageviews over the last 12 months (log scale, 5 million = 100).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RECORDS, readJSON, writeJSON, normName, acquireLock, today } from './lib.mjs';

const UA = { 'User-Agent': 'LivingAtlas/1.0 (history atlas research tool; contact via project repository)', 'Api-User-Agent': 'LivingAtlas/1.0' };
const CACHE = 'wiki_cache.json';
const cache = readJSON(CACHE, {});
const saveCache = () => writeJSON(CACHE, cache);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Wikimedia asks for serial, unhurried requests: one queue, at most ~1.5 a second, and Retry-After honoured on 429
let lastReq = 0, chain = Promise.resolve();
const GAP_MS = 700;
export function getJSON(url, tries = 4) {
  const run = async () => {
    for (let i = 0; ; i++) {
      const wait = lastReq + GAP_MS - Date.now(); if (wait > 0) await sleep(wait);
      lastReq = Date.now();
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(40000) }).catch(e => ({ ok: false, status: 0, e, headers: new Map() }));
      if (res.ok) return res.json();
      if (i >= tries - 1 || ![0, 429, 500, 502, 503, 504].includes(res.status)) return null;
      await sleep(res.status === 429 ? Math.min(90, Number(res.headers.get?.('retry-after')) || 20 * (i + 1)) * 1000 : 2000 * 2 ** i);
    }
  };
  const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}

// domains whose pages agents may cite: institutions, journals and reference works (Wikipedia and mirrors excluded)
export const GOOD = /\.(gov|gob|gouv|go|govt|mil|edu|ac)\.[a-z.]+\/|\.gov\/|\.edu\/|\.int\/|unesco\.org|britannica\.com|encyclopedia\.com|ebsco\.com|iranicaonline|plato\.stanford|iep\.utm|worldhistory\.org|smithsonian|si\.edu|britishmuseum|metmuseum|museum|nationalarchives|archives\.gov|loc\.gov\/(item|resource|exhibits|rr)|nature\.com|science\.org|doi\.org|jstor\.org|cambridge\.org|oup\.com|academic\.oup|springer|wiley|tandfonline|sciencedirect|pnas\.org|ncbi\.nlm|usgs|noaa|nasa|nps\.gov|historicengland|culture\.gouv|bnf\.fr|biographi\.ca|anb\.org|oxforddnb|nationalarchives|parliament|un\.org|who\.int|worldbank|imf\.org/i;
export const BAD = /wikipedia|wikimedia|wikidata|wikiwand|fandom|baike|archive\.org\/details|books\.google|google\.com\/books|amazon\.|goodreads|youtube|facebook|twitter|x\.com|ancient-origins|academic\.ru|en-academic|id\.loc\.gov\/authorities|catalogue\.bnf|data\.bnf|viaf\.org|d-nb\.info|lux\.collections|worldcat|isni\.org|id\.ndl\.go\.jp|idref\.fr|\/auth(orit(y|ies))?\/|nla\.gov\.au\/anbd|nukat|catalogo|catalog\.|\/opac|meshb\.nlm|term\.museum-digital|\/thesaurus|getty\.edu\/(cona|vow|tgn|ulan|aat)|vocab\.getty/i;

// one Wikipedia page per title: search, then Wikidata id and English title
async function page(title) {
  const u = `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=1&gsrsearch=${encodeURIComponent(title)}&prop=pageprops&ppprop=wikibase_item&redirects=1`;
  const j = await getJSON(u);
  if (!j) throw new Error('Wikipedia did not answer');            // a failed request is not "no article": don't cache it
  const p = Object.values(j.query?.pages || {})[0];
  return p ? { title: p.title, qid: p.pageprops?.wikibase_item || null } : null;
}
async function sitelinks(qid) {
  const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&ids=${qid}`);
  if (!j) throw new Error('Wikidata did not answer');
  const e = j.entities?.[qid];
  return e?.sitelinks ? Object.keys(e.sitelinks).filter(k => k.endsWith('wiki') && !/commons|species|wikidata/.test(k)).length : 0;
}
async function views(title) {
  const end = new Date(), start = new Date(end); start.setUTCFullYear(end.getUTCFullYear() - 1);
  const f = d => d.toISOString().slice(0, 7).replace('-', '') + '0100';
  const j = await getJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(title.replace(/ /g, '_'))}/monthly/${f(start)}/${f(end)}`, 3);
  if (!j) throw new Error('pageviews service did not answer');
  return (j.items || []).reduce((s, x) => s + x.views, 0);
}
// judge an archived link by the page it wraps (web.archive.org/web/<stamp>/<url>)
const inner = u => u.replace(/^https?:\/\/web\.archive\.org\/web\/[^/]+\//, '');
async function leads(title) {
  const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=parse&format=json&prop=externallinks&redirects=1&page=${encodeURIComponent(title)}`);
  const links = (j?.parse?.externallinks || []).map(u => u.replace(/^\/\//, 'https://'));
  const keep = links.filter(u => /^https?:/.test(u) && GOOD.test(inner(u)) && !BAD.test(inner(u)));
  const seen = new Set(), out = [];
  for (const u of keep) { const k = inner(u).replace(/^https?:\/\//, ''); if (!seen.has(k)) { seen.add(k); out.push(u); } }
  return out.slice(0, 12);
}

// Featured / Good status of the English article, from its Wikidata sitelink badges
const BADGES = { Q17437796: 'FA', Q17437798: 'GA' };
export async function quality(qid) {
  if (!qid) return 'none';
  const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=${qid}`);
  const b = j?.entities?.[qid]?.sitelinks?.enwiki?.badges || [];
  return b.map(x => BADGES[x]).find(Boolean) || 'none';
}
// what an agent needs to use an article: quality, a pinned permalink, the text, and institutional reference links
export async function article(title) {
  const p = await page(title);
  if (!p) return null;
  const q = encodeURIComponent(p.title.replace(/ /g, "_"));
  const [qual, rev, ext, ld] = await Promise.all([
    quality(p.qid),
    getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=revisions&rvprop=ids|timestamp&titles=${q}`),
    getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&explaintext=1&titles=${q}`),
    leads(p.title)]);
  const r = Object.values(rev?.query?.pages || {})[0]?.revisions?.[0];
  const text = Object.values(ext?.query?.pages || {})[0]?.extract || '';
  return { title: p.title, qid: p.qid, quality: qual, oldid: r?.revid, timestamp: r?.timestamp,
    permalink: r ? `https://en.wikipedia.org/w/index.php?title=${q}&oldid=${r.revid}` : null, text, leads: ld };
}

export async function signals(title, { refresh = false } = {}) {
  const key = normName(title);
  if (!refresh && cache[key]) return cache[key];
  const p = await page(title);
  if (!p) { cache[key] = { title: null, at: today() }; return cache[key]; }
  const [sl, v, ld] = await Promise.all([p.qid ? sitelinks(p.qid) : 0, views(p.title), leads(p.title)]);
  cache[key] = { title: p.title, qid: p.qid, sitelinks: sl, views: v, leads: ld, at: today() };
  return cache[key];
}
export const significanceOf = s => Math.round(100 * Math.min(1, Math.log1p(s.sitelinks || 0) / Math.log1p(250)));
export const demandOf = s => Math.round(100 * Math.min(1, Math.log1p(s.views || 0) / Math.log1p(5e6)));
export const cachedLeads = title => cache[normName(title)]?.leads || [];

// ---------- discovery presets (Wikidata SPARQL): instance-of class, most-covered first
const PRESETS = {
  battles: 'wd:Q178561', wars: 'wd:Q198', treaties: 'wd:Q131569', revolutions: 'wd:Q10931',
  epidemics: 'wd:Q44512', earthquakes: 'wd:Q7944', eruptions: 'wd:Q7692360', heritage: null,
};
function regionOf(lat, lon) { // coarse UN-style region from coordinates, for the coverage map; agents refine it
  if (lat == null) return 'global';
  if (lat < -60) return 'antarctica';
  if (lon >= -170 && lon <= -30) return lat > 15 && !(lat < 32 && lon > -118 && lon < -60 && lat < 25) ? 'northern_america' : 'latin_america_caribbean';
  if (lon > 110 && lat < -10 || lon > 150 || lon < -150) return 'oceania';
  if (lat > 36 && lon > -25 && lon < 45) return 'europe';
  if (lat > 0 && lat <= 37 && lon > -20 && lon < 35) return lat > 18 ? 'northern_africa' : 'sub_saharan_africa';
  if (lat <= 0 && lon > -20 && lon < 52) return 'sub_saharan_africa';
  if (lon >= 35 && lon < 62 && lat > 12) return 'western_asia';
  if (lon >= 46 && lon < 90 && lat > 35) return 'central_asia';
  if (lon >= 60 && lon < 92 && lat <= 35) return 'southern_asia';
  if (lon >= 92 && lat < 22) return 'south_eastern_asia';
  if (lon >= 73) return 'eastern_asia';
  return 'global';
}
async function discover(preset, min, limit) {
  const cls = PRESETS[preset];
  if (cls === undefined) throw new Error(`unknown preset ${preset}; presets: ${Object.keys(PRESETS).join(' ')}`);
  const where = cls ? `?item wdt:P31 ${cls} .` : '?item wdt:P1435 wd:Q9259 .';   // heritage: UNESCO World Heritage designation
  const q = `SELECT ?item ?itemLabel ?sl (SAMPLE(?c) AS ?coord) (MIN(?d) AS ?date) WHERE {
    ${where} ?item wikibase:sitelinks ?sl . FILTER(?sl >= ${min})
    OPTIONAL { ?item wdt:P625 ?c } OPTIONAL { ?item wdt:P585|wdt:P580|wdt:P571|wdt:P569 ?d }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }
    GROUP BY ?item ?itemLabel ?sl ORDER BY DESC(?sl) LIMIT ${limit * 3}`;
  const j = await getJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, 2);
  if (!j) throw new Error('Wikidata query failed or timed out; try a higher --min');
  // what the atlas already has: record and queue titles, and Wikidata ids cited by records
  const have = new Set(), qids = new Set();
  for (const f of fs.readdirSync(RECORDS)) {
    const txt = fs.readFileSync(path.join(RECORDS, f), 'utf8');
    for (const m of txt.matchAll(/wikidata\.org\/(?:wiki|entity|wiki\/Special:EntityData)\/(Q\d+)/g)) qids.add(m[1]);
    try { const r = JSON.parse(txt); have.add(normName(r.title)); for (const a of r.aliases || []) have.add(normName(a)); } catch {}
  }
  for (const i of readJSON('queue.json', { items: [] }).items) have.add(normName(i.title));
  // records matched to a Wikipedia article (wiki.mjs link) carry that article's Wikidata id: "Battle of the Maureaco
  // Fields" is the Catalaunian Plains record under another name
  for (const l of Object.values(readJSON('wiki_links.json', {}))) if (l.qid) qids.add(l.qid);
  const out = [], haveList = [...have].filter(h => h.length >= 8), rejected = new Set(readJSON('discovery_rejected.json', { ids: [] }).ids);
  // "Normandy landings" is covered by "D-Day Normandy landings": a name inside an existing title (or the reverse) counts
  const covered = n => have.has(n) || (n.length >= 10 && haveList.some(h => h.includes(n) || n.includes(h) && h.length >= 14));
  for (const b of j.results.bindings) {
    const qid = b.item.value.split('/').pop(), label = b.itemLabel?.value || '';
    if (/^Q\d+$/.test(label) || qids.has(qid) || covered(normName(label))) continue;
    const m = b.coord?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
    const lon = m ? +m[1] : null, lat = m ? +m[2] : null;
    // Wikidata's query service gives astronomical years (0 = 1 BCE); atlas ids use the BCE number ("-0331-" = 331 BCE)
    const ym = b.date?.value.match(/^(-?)(\d+)-/), year = ym ? (ym[1] ? -(+ym[2]) : +ym[2]) : null;
    const idYear = year == null ? null : year <= 0 ? -(1 - year) : year;
    // ascii-only ids (the viewer accepts [-a-z0-9]), without a leading year the label already carries ("1952 Egyptian revolution")
    const slug = normName(label).normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^\d{3,4}-/, '').replace(/^-+|-+$/g, '').slice(0, 60);
    const id = preset === 'heritage' ? `place-${slug}` : `${idYear == null ? '0000' : (idYear < 0 ? '-' : '') + String(Math.abs(idYear)).padStart(4, '0')}-${slug}`;
    if (rejected.has(id)) continue; // turned down in an earlier review (atlas/discovery_rejected.json)
    const sl = +b.sl.value;
    out.push({ source: 'discovery', id, title: label, kind: preset === 'heritage' ? 'place' : 'event', region: regionOf(lat, lon), year: year ?? 0,
      domain: { battles: 'wars_conflict', wars: 'wars_conflict', treaties: 'law_politics_rights', revolutions: 'law_politics_rights', epidemics: 'disease',
        earthquakes: 'geology_climate', eruptions: 'geology_climate', heritage: 'built_world' }[preset],
      significance: significanceOf({ sitelinks: sl }), demand: 50, availability: 80, method: 'wikidata-gap', from: `wikidata:${qid}`,
      note: `Covered by ${sl} Wikipedia editions; ${year != null ? 'Wikidata date ' + year + ' and ' : ''}place are leads to verify, not sources.` });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- link every record to its English Wikipedia article (further reading in the viewer, not a source)
// 1) exact title lookups, 50 per request (redirects followed, disambiguation pages refused);
// 2) a search for the rest, kept only when the hit is plainly the same topic;
// 3) Featured/Good badges for all matches, 50 Wikidata ids per request. Output: atlas/wiki_links.json.
const cleanTitle = t => String(t || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*[—–:]\s.*$/, '').trim();
async function linkRecords({ refresh = false } = {}) {
  const links = refresh ? {} : readJSON('wiki_links.json', {});
  const recs = fs.readdirSync(RECORDS).map(f => { try { return JSON.parse(fs.readFileSync(path.join(RECORDS, f), 'utf8')); } catch { return null; } })
    .filter(r => r && (r.status === 'published' || r.status === 'outline') && !links[r.id]);
  console.log(`linking ${recs.length} records…`);
  // hand corrections win: atlas/wiki_overrides.json {id: "Article title" | null (no article)}
  const overrides = readJSON('wiki_overrides.json', {});
  for (const r of recs) if (r.id in overrides && overrides[r.id]) links[r.id] = { title: overrides[r.id], qid: null, match: 'override' };
  // 0) articles the atlas already knows: the Wikidata item a discovered target came from (its English sitelink), or
  // a Featured/Good article the record itself cites. Proxy-pin Wikidata sources are not used: they name a place.
  const fromQid = new Map(readJSON('queue.json', { items: [] }).items.filter(i => /^wikidata:Q\d+$/.test(i.from || '')).map(i => [i.id, i.from.slice(9)]));
  for (const r of recs) {
    if (links[r.id] || r.id in overrides) continue;
    const wp = (r.sources || []).find(s => /en\.wikipedia\.org\/w\/index\.php\?title=/.test(s.url || '') && ['FA', 'GA'].includes(s.wiki_quality));
    if (wp) links[r.id] = { title: decodeURIComponent(wp.url.match(/title=([^&]+)/)[1]).replace(/_/g, ' '), qid: null, match: 'cited' };
  }
  const byQid = recs.filter(r => !links[r.id] && fromQid.has(r.id));
  for (let i = 0; i < byQid.length; i += 50) {
    const chunk = byQid.slice(i, i + 50);
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=${chunk.map(r => fromQid.get(r.id)).join('|')}`);
    for (const r of chunk) { const q = fromQid.get(r.id), t = j?.entities?.[q]?.sitelinks?.enwiki?.title; if (t) links[r.id] = { title: t, qid: q, match: 'wikidata' }; }
  }
  const all = recs.filter(r => !(r.id in overrides) && !links[r.id]).map(r => ({ r, t: cleanTitle(r.title) })).filter(x => x.t);
  // 1) exact titles: the whole title, then the part before a comma ("Gelati Monastery, Kutaisi" -> "Gelati Monastery")
  const want = [...all, ...all.filter(x => x.t.includes(',')).map(x => ({ r: x.r, t: x.t.split(',')[0].trim() }))];
  for (let i = 0; i < want.length; i += 50) {
    const chunk = want.slice(i, i + 50).filter(x => !links[x.r.id]);
    if (!chunk.length) continue;
    const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=wikibase_item|disambiguation&titles=${encodeURIComponent(chunk.map(x => x.t).join('|'))}`);
    if (!j) continue;
    const map = new Map(); // requested title -> final title, through normalisation and redirects
    for (const n of j.query?.normalized || []) map.set(n.from, n.to);
    for (const rd of j.query?.redirects || []) map.set(rd.from, rd.to);
    const pages = new Map(Object.values(j.query?.pages || {}).filter(p => !('missing' in p) && !('invalid' in p)).map(p => [p.title, p]));
    for (const x of chunk) {
      let t = x.t; for (let k = 0; k < 3 && map.has(t); k++) t = map.get(t);
      const p = pages.get(t);
      if (p && !('disambiguation' in (p.pageprops || {}))) links[x.r.id] = { title: p.title, qid: p.pageprops?.wikibase_item || null, match: 'title' };
    }
    process.stdout.write(`  exact ${Math.min(i + 50, want.length)}/${want.length}\r`);
  }
  // 2) search the rest; keep a hit only if its title and the record's share their key words
  const rest = all.filter(x => !links[x.r.id]);
  console.log(`\n  ${all.length - rest.length} exact matches; searching ${rest.length}…`);
  const words = s => new Set(normName(s).split(' ').filter(w => w.length > 3 && !['battle', 'history', 'empire', 'kingdom', 'period'].includes(w)));
  for (const [k, x] of rest.entries()) {
    let p; try { p = await page(x.t); } catch { continue; }
    if (!p) continue;
    const a = words(x.t), b = words(p.title), shared = [...a].filter(w => b.has(w)).length;
    // at least half of the record's key words must be in the article title, so "Emergence of Homo sapiens" never lands on "Homo"
    if (shared && shared >= Math.min(a.size, b.size) * 0.67 && shared >= a.size * 0.5) links[x.r.id] = { title: p.title, qid: p.qid, match: 'search' };
    if (k % 25 === 0) { writeJSON('wiki_links.json', links); process.stdout.write(`  searched ${k + 1}/${rest.length}\r`); }
  }
  // 3) Featured / Good badges
  const qids = [...new Set(Object.values(links).map(l => l.qid).filter(Boolean))], badge = {};
  for (let i = 0; i < qids.length; i += 50) {
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=enwiki&ids=${qids.slice(i, i + 50).join('|')}`);
    for (const [q, e] of Object.entries(j?.entities || {})) badge[q] = (e.sitelinks?.enwiki?.badges || []).map(x => BADGES[x]).find(Boolean) || null;
  }
  for (const l of Object.values(links)) if (l.qid && l.qid in badge) l.quality = badge[l.qid];
  writeJSON('wiki_links.json', links);
  const v = Object.values(links);
  console.log(`\nlinked ${v.length} records (${v.filter(l => l.quality === 'FA').length} Featured, ${v.filter(l => l.quality === 'GA').length} Good)`);
}

// ---------- the viewer's Wikipedia layer: well-covered dated events with coordinates and an English article,
// fetched window by window from Wikidata into viewer/data/wiki-pins.json (compact: q, t, lat, lon, y, sl)
function* windows() {
  for (let y = -3000; y < 0; y += 100) yield [y, y + 100];
  for (let y = 0; y < 1500; y += 50) yield [y, y + 50];
  for (let y = 1500; y < 1900; y += 20) yield [y, y + 20];
  for (let y = 1900; y < 2030; y += 5) yield [y, y + 5];
}
const xsdYear = y => `${y < 0 ? '-' : ''}${String(Math.abs(y)).padStart(4, '0')}-01-01T00:00:00Z`; // astronomical years, as WDQS stores them
async function buildLayer(min) {
  const out = new Map();
  for (const [a, b] of windows()) {
    const q = `SELECT ?item ?title ?sl (SAMPLE(?c) AS ?coord) (MIN(?d) AS ?date) WHERE {
      { ?item wdt:P585 ?d } UNION { ?item wdt:P580 ?d }
      FILTER(?d >= "${xsdYear(a)}"^^xsd:dateTime && ?d < "${xsdYear(b)}"^^xsd:dateTime)
      ?item wdt:P625 ?c . ?item wikibase:sitelinks ?sl . FILTER(?sl >= ${min})
      ?art schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?title .
    } GROUP BY ?item ?title ?sl ORDER BY DESC(?sl) LIMIT 400`;
    const j = await getJSON(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, 3);
    if (!j) { console.log(`  ${a}..${b}: no answer (skipped)`); continue; }
    for (const r of j.results.bindings) {
      const m = r.coord?.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/), ym = r.date?.value.match(/^(-?)(\d+)-(\d\d)/);
      if (!m || !ym) continue;
      const qid = r.item.value.split('/').pop(), y = (ym[1] ? -(+ym[2]) : +ym[2]) + (+ym[3] - 1) / 12;
      if (!out.has(qid)) out.set(qid, { q: qid, t: r.title.value, lat: +(+m[2]).toFixed(3), lon: +(+m[1]).toFixed(3), y: +y.toFixed(2), sl: +r.sl.value });
    }
    process.stdout.write(`  ${a}..${b}: ${out.size} so far\r`);
  }
  const file = path.resolve(ROOT, '..', 'viewer', 'data', 'wiki-pins.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ built: today(), min_sitelinks: min, note: 'Wikidata (CC0) items with an English Wikipedia article; further reading, not atlas records', pins: [...out.values()] }));
  console.log(`\n${out.size} Wikipedia pins -> viewer/data/wiki-pins.json`);
}

// ---------- command line
if (process.argv[1]?.endsWith('wiki.mjs')) {
  const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const [cmd, arg] = args;
  if (cmd === 'layer') {
    await buildLayer(+flag('--min', 15));
  } else if (cmd === 'link') {
    await linkRecords({ refresh: args.includes('--refresh') });
  } else if (cmd === 'article') {
    const a = await article(arg);
    console.log(a ? JSON.stringify({ ...a, text: `${a.text.length} chars: ${a.text.slice(0, 300)}…` }, null, 2) : 'no article');
  } else if (cmd === 'verify') {
    // every Wikipedia citation in the records: is the article really Featured or Good, and is the URL a pinned revision?
    let n = 0, bad = 0;
    for (const f of fs.readdirSync(RECORDS)) {
      const r = JSON.parse(fs.readFileSync(path.join(RECORDS, f), 'utf8'));
      for (const s of r.sources || []) {
        if (!/en\.wikipedia\.org/.test(s.url || '')) continue;
        n++;
        const t = decodeURIComponent((s.url.match(/[?&]title=([^&]+)/) || [])[1] || '').replace(/_/g, ' ');
        const p = t && await page(t), real = p ? await quality(p.qid) : 'none';
        const ok = ['FA', 'GA'].includes(real) && real === s.wiki_quality && /oldid=\d+/.test(s.url);
        if (!ok) { bad++; console.log(`✗ ${r.id} ${s.id}: claimed ${s.wiki_quality || '-'}, Wikidata says ${real}, ${s.url}`); }
      }
    }
    console.log(`${n} Wikipedia citations checked, ${bad} problems`);
  } else if (cmd === 'signals') {
    const s = await signals(arg, { refresh: args.includes('--refresh') }); saveCache();
    console.log(JSON.stringify({ ...s, significance: significanceOf(s), demand: demandOf(s) }, null, 2));
  } else if (cmd === 'rank') {
    // open outline targets (no record yet), most recently queued first
    const q = readJSON('queue.json', { items: [] });
    const todo = q.items.filter(i => i.status === 'open' && !fs.existsSync(path.join(RECORDS, `${i.id}.json`)))
      .filter(i => args.includes('--refresh') || !i.wiki).slice(0, +flag('--limit', 500));
    console.log(`ranking ${todo.length} targets from Wikipedia signals…`);
    const res = {};
    for (let k = 0; k < todo.length; k += 1) { // one at a time: getJSON spaces the requests
      await Promise.all(todo.slice(k, k + 1).map(async it => {
        try { res[it.id] = await signals(it.title.replace(/\s+—.*$/, ''), { refresh: args.includes('--refresh') }); }
        catch { /* Wikipedia didn't answer: left unranked, retried on the next run */ }
      }));
      if (k % 40 === 0) { saveCache(); process.stdout.write(`  ${k + 4}/${todo.length}\r`); }
      await sleep(250);
    }
    saveCache();
    const release = acquireLock();
    const q2 = readJSON('queue.json', { items: [] });
    for (const it of q2.items) {
      const s = res[it.id]; if (!s) continue;
      if (!s.title) { it.wiki = { title: null }; continue; }
      it.wiki = { title: s.title, qid: s.qid, sitelinks: s.sitelinks, views: s.views, leads: s.leads.length };
      it.significance = significanceOf(s); it.demand = demandOf(s);
    }
    writeJSON('queue.json', q2); release();
    const top = Object.entries(res).filter(([, s]) => s.title).sort((a, b) => b[1].sitelinks - a[1].sitelinks);
    console.log(`\nranked ${top.length}; no Wikipedia page for ${Object.keys(res).length - top.length}. Top by editions:`);
    for (const [id, s] of top.slice(0, 12)) console.log(`  ${String(s.sitelinks).padStart(4)} editions  ${String(s.views).padStart(9)} views  ${id}`);
  } else if (cmd === 'discover') {
    const items = await discover(arg, +flag('--min', 40), +flag('--limit', 40));
    const file = path.join(ROOT, 'inbox', `wiki-${arg}-${today()}.targets.json`);
    fs.writeFileSync(file, JSON.stringify(items, null, 1));
    console.log(`${items.length} new targets -> ${path.relative(path.resolve(ROOT, '..'), file)} (review, then run ingest.mjs)`);
    for (const i of items.slice(0, 15)) console.log(`  ${i.significance}  ${i.id}  [${i.region}]`);
  } else {
    console.log('commands: signals "<title>" | rank [--limit N] [--refresh] | discover <preset> [--min N] [--limit N]');
  }
}
