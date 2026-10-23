// Fast outlines from Wikipedia: instead of an agent searching the web over many turns, code gathers the material and
// one model call writes the outline from it.
//   1. Wikidata: coordinates (cited as a dataset) and dates (leads only).
//   2. English Wikipedia: the article text, citable only when it is Featured or Good (pinned oldid permalink).
//   3. Institutional pages from the article's references, fetched directly (no searching).
//   4. One structured model call writes the outline from those texts only.
//   5. Code checks every quoted date against the text it cites, then runs the gate.
// Targets whose sources can't be fetched or verified are left for the agent runner (claude-agent.mjs).
// Usage: node atlas/tools/wiki-outline.mjs next <batch> <n> | <batch> <id> [<id> ...]   [--model claude-sonnet-5-5] [--concurrency 4] [--fallback]
//   --fallback sends every skipped target on to claude-agent.mjs (report: inbox/<batch>-agent.report.md)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import Anthropic from '@anthropic-ai/sdk';
import { ROOT, RECORDS, readJSON, today, ENUMS, SCHEMA_VERSION } from './lib.mjs';
import { article, getJSON, GOOD, BAD } from './wiki.mjs';
import { addSpend, ledger, nextOpen, queueItems, parseArgs } from './agent-core.mjs';

const PRICES = { 'claude-opus-5-5': [4, 20, 5, 0.2], 'claude-sonnet-5-5': [2, 10, 2.5, 0.2], 'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.01] };
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; LivingAtlas/1.0; history atlas research tool)' };
const { flags, pos } = parseArgs(process.argv.slice(2));
const model = flags.model || 'claude-sonnet-5-5';

// ---------- fetching a reference page as text
const htmlText = h => h.replace(/<(script|style|noscript|nav|header|footer)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#0?39;|&#x27;|&rsquo;/g, "'").replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const publicUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !/^(localhost|127\.|10\.|192\.168\.)/.test(x.hostname) ? x : null; } catch { return null; } };
async function fetchOnce(url) {
  try {
    const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (!res.ok || !/html|text/.test(res.headers.get('content-type') || '')) return { status: res.status };
    const html = await res.text();
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.replace(/\s+/g, ' ').trim() || url.hostname;
    return { url: res.url, title: htmlText(title), text: htmlText(html) };
  } catch { return { status: 0 }; }
}
// sites that refuse automated fetches (Britannica, Smithsonian…) usually have Wayback Machine copies; the citation
// keeps the original publisher and points at the archived copy that was actually read
async function fetchPage(u) {
  const url = publicUrl(u); if (!url) return null;
  const r = await fetchOnce(url);
  if (r.text) return r;
  if (/web\.archive\.org/.test(url.hostname) || ![401, 403, 429].includes(r.status)) return null;
  const w = await fetchOnce(new URL(`https://web.archive.org/web/2025/${url.href}`));
  return w.text && !/Wayback Machine has not archived/.test(w.text) ? w : null;
}

// Direct institutional URLs from the topic's Wikidata identifiers (Britannica, Stanford Encyclopedia, Iranica, UNESCO
// World Heritage, MacTutor, national biographies…), built with each identifier's own formatter URL (P1630)
const formatterCache = {};
async function idSources(e) {
  const props = Object.entries(e.claims || {}).filter(([, cs]) => cs[0]?.mainsnak?.datatype === 'external-id').map(([p]) => p);
  const need = props.filter(p => !(p in formatterCache));
  for (let i = 0; i < need.length; i += 50) {
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${need.slice(i, i + 50).join('|')}`);
    for (const p of need.slice(i, i + 50)) formatterCache[p] = j?.entities?.[p]?.claims?.P1630?.[0]?.mainsnak?.datavalue?.value || null;
  }
  const urls = [];
  for (const p of props) {
    const f = formatterCache[p], id = e.claims[p][0]?.mainsnak?.datavalue?.value;
    if (!f || typeof id !== 'string') continue;
    const u = f.replace('$1', encodeURI(id));
    if (GOOD.test(u) && !BAD.test(u) && !/wikipedia|commons|wikimedia/.test(u)) urls.push(u);
  }
  return urls;
}
const PUBLISHERS = [[/britannica\.com/, 'Encyclopaedia Britannica', 'reference'], [/unesco\.org/, 'UNESCO', 'government'], [/encyclopedia\.com/, 'Encyclopedia.com (Gale)', 'reference'],
  [/ebsco\.com/, 'EBSCO Research Starters', 'reference'], [/iranicaonline/, 'Encyclopaedia Iranica', 'reference'], [/plato\.stanford/, 'Stanford Encyclopedia of Philosophy', 'reference'],
  [/worldhistory\.org/, 'World History Encyclopedia', 'reference'], [/nam\.ac\.uk/, 'National Army Museum', 'museum'], [/britishmuseum/, 'The British Museum', 'museum'],
  [/metmuseum/, 'The Metropolitan Museum of Art', 'museum'], [/smithsonian|si\.edu/, 'Smithsonian Institution', 'museum'], [/nps\.gov/, 'U.S. National Park Service', 'government'],
  [/loc\.gov/, 'Library of Congress', 'government'], [/history\.state\.gov/, 'U.S. Department of State, Office of the Historian', 'government'],
  [/nature\.com/, 'Nature Portfolio', 'scholarly'], [/ncbi\.nlm|pubmed/, 'U.S. National Library of Medicine', 'scholarly'], [/jstor\.org/, 'JSTOR', 'scholarly'],
  [/cambridge\.org/, 'Cambridge University Press', 'scholarly'], [/oup\.com/, 'Oxford University Press', 'scholarly'], [/parliament\.uk/, 'UK Parliament (Hansard)', 'archive'],
  [/nationalarchives/, 'The National Archives', 'archive'], [/ciao.*columbia\.edu/, 'Columbia International Affairs Online (Columbia University)', 'scholarly'], [/historicengland|english-heritage/, 'Historic England / English Heritage', 'government']];
function publisherOf(url) {
  url = url.replace(/^https?:\/\/web\.archive\.org\/web\/[^/]+\//, ''); // an archived copy keeps its original publisher
  const h = new URL(url).hostname.replace(/^www\./, '');
  // match the hostname (plus its leading dot), so jewishencyclopedia.com is never taken for encyclopedia.com
  for (const [re, name, cls] of PUBLISHERS) if (new RegExp(`\\.(${re.source})`).test('.' + h)) return { publisher: name, class: cls };
  if (/\.(gov|gouv|gob|go|govt)(\.|$)/.test(h)) return { publisher: h, class: 'government' };
  if (/\.edu$|\.ac\.[a-z]+$|univ/.test(h)) return { publisher: h, class: 'scholarly' };
  if (/museum|musee|museo/.test(h)) return { publisher: h, class: 'museum' };
  return { publisher: h, class: 'reference' };
}

// ---------- Wikidata facts: coordinates (citable as a dataset) and dates (leads)
const entity = async qid => (await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`))?.entities?.[qid] || null;
const claimVals = (e, p) => (e?.claims?.[p] || []).map(c => c.mainsnak?.datavalue?.value).filter(Boolean);
async function wikidataFacts(qid) {
  const e = await entity(qid);
  if (!e) return null;
  const val = p => claimVals(e, p);
  let coord = val('P625')[0], proxy = null;
  // wars and other spread-out subjects have no coordinates of their own: use the coordinates of the location
  // (P276) or country (P17) that Wikidata gives for them, as a labelled proxy pin (looked up, never computed).
  // Only an unambiguous single value is used: with several (e.g. Spain listed first for the Hundred Years' War) the target goes to the agent.
  for (const p of ['P276', 'P17']) {
    if (coord) break;
    const refs = val(p); if (refs.length !== 1) continue;
    const ref = refs[0]?.id; if (!ref) continue;
    const le = await entity(ref), c = claimVals(le, 'P625')[0];
    if (c) { coord = c; proxy = { qid: ref, name: le.labels?.en?.value || ref, prop: p === 'P276' ? 'location' : 'country' }; }
  }
  const dates = {}; for (const [p, k] of [['P585', 'point_in_time'], ['P580', 'start'], ['P582', 'end'], ['P571', 'inception'], ['P569', 'born'], ['P570', 'died']]) { const v = val(p)[0]; if (v?.time) dates[k] = v.time; }
  return { coord: coord ? { lat: coord.latitude, lon: coord.longitude } : null, proxy, dates, entity: e };
}

// A low-effort draft can trail off into a run of one-word sentences ("Done. Ok. Fine. End."); cut from the first such
// run and cap the length, so a note never reaches a record that way.
const trimNote = s => String(s || '').replace(/(\s*[A-Z][a-z]*(?: [a-z]+){0,2}\.(?=\s*[A-Z]|\s*$)){3,}[\s\S]*$/, '').trim().slice(0, 600);

// ---------- the one model call
const enumOf = a => ({ type: 'string', enum: a });
const SCHEMA = { type: 'object', additionalProperties: false,
  required: ['usable', 'skip_reason', 'off_topic_sources', 'kind', 'title', 'summary', 'start_year', 'end_year', 'precision', 'display', 'quotes', 'modern_name', 'historical_name', 'uncertainty_km', 'regions', 'domains', 'scale', 'importance', 'importance_justification', 'confidence', 'audience_note', 'reviewer_note'],
  properties: {
    usable: { type: 'boolean' }, skip_reason: { type: 'string' }, off_topic_sources: { type: 'array', items: { type: 'string' } },
    kind: enumOf(ENUMS.kind), title: { type: 'string' }, summary: { type: 'string' },
    start_year: { type: 'integer' }, end_year: { type: 'integer' }, precision: enumOf(ENUMS.precision), display: { type: 'string' },
    quotes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['source_id', 'text'], properties: { source_id: { type: 'string' }, text: { type: 'string' } } } },
    modern_name: { type: 'string' }, historical_name: { type: 'string' }, uncertainty_km: { type: 'number' },
    regions: { type: 'array', items: enumOf(ENUMS.regions) }, domains: { type: 'array', items: enumOf(ENUMS.domains) },
    scale: enumOf(ENUMS.scale), importance: { type: 'integer' }, importance_justification: { type: 'string' },
    confidence: enumOf(ENUMS.confidence), audience_note: { type: 'string' }, reviewer_note: { type: 'string' } } };

const client = new Anthropic({ maxRetries: 4 });
async function draft(item, texts, wd) {
  const docs = texts.map(t => `<source id="${t.id}" publisher="${t.publisher}" url="${t.url}">\n${t.text.slice(0, 14000)}\n</source>`).join('\n\n');
  const prompt = `Write a Living Atlas outline record for "${item.title}" (atlas id ${item.id}; the id's year is only a lookup key).
Use ONLY the sources below. Every fact in the summary must be stated in at least one of them; add nothing from your own knowledge. Keep numbers exactly as the sources give them.
- summary: 15-90 words in your own words: what happened (or who/what it is) and why it mattered.
- start_year/end_year: astronomical years (1 BCE = 0, 500 BCE = -499) taken from the sources. Wikidata dates are leads only: ${JSON.stringify(wd?.dates || {})}
- quotes: 1-3 exact, verbatim snippets (under 80 characters) from the sources that state the dates; source_id must be the source that contains that exact text. These are checked by machine.
- display: a short human-readable date, e.g. "14 October 1066" or "c. 1350–1450".
- modern_name/historical_name: the place, as the sources describe it. uncertainty_km: how precise the place is (1 for a building, 50 for a region, 5000+ for something planet-wide).
- importance 1-5 (5 = world-historical) with a one-line justification. confidence: established unless the sources disagree (contested) or call it tradition (legendary).
- audience_note: a short content warning for atrocities, mass death or abuse, else "".
- reviewer_note: what you are least sure of, and any disagreement between sources, in at most three sentences.
- off_topic_sources: ids of any source that is not actually about this subject (a front page, a different topic, a passing mention).
- If the sources do not support a sound outline (they are about something else, or give no date), set usable false and explain in skip_reason.
Neutral voice; no quotation longer than 15 words in the summary.

${docs}`;
  const res = await client.messages.create({
    model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA }, effort: 'low' },
  });
  const [i, o, cw, cr] = PRICES[model];
  const u = res.usage, usd = ((u.input_tokens || 0) * i + (u.output_tokens || 0) * o + (u.cache_creation_input_tokens || 0) * cw + (u.cache_read_input_tokens || 0) * cr) / 1e6;
  addSpend({ id: item.id, model, usd, turn: 0, tokens: { in: u.input_tokens, out: u.output_tokens, pipeline: 'wiki-outline' } });
  if (res.stop_reason === 'refusal') return { usd, out: null, why: 'declined' };
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  try { return { usd, out: JSON.parse(text) }; } catch { return { usd, out: null, why: 'unparseable output' }; }
}

// ---------- one target
const norm = s => String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
async function outlineOne(item) {
  const title = item.title.replace(/\s+—.*$/, '');
  const a = await article(title).catch(() => null);
  if (!a?.qid) return { stop: 'no Wikipedia article' };
  const wd = await wikidataFacts(a.qid);
  if (!wd?.coord) return { stop: 'no Wikidata coordinates' };
  const citable = a.quality === 'FA' || a.quality === 'GA';
  const texts = [];
  if (citable) texts.push({ id: 'src-wp', url: a.permalink, title: `${a.title} (Wikipedia, revision ${a.oldid})`, publisher: 'Wikipedia', class: 'reference', wiki_quality: a.quality, text: a.text });
  // institutional pages from the article's references: keep the first ones that load and are about this topic
  const key = title.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 3);
  const whe = `https://www.worldhistory.org/${encodeURIComponent(a.title.replace(/ /g, '_'))}/`;
  const candidates = [...new Set([...(await idSources(wd.entity).catch(() => [])), whe, ...a.leads])];
  for (const u of candidates) {
    if (texts.filter(t => t.id !== 'src-wp').length >= (citable ? 1 : 2)) break;
    const p = await fetchPage(u.replace(/^https?:\/\/web\.archive\.org\/web\/[^/]+\//, '') ) || (/web\.archive\.org/.test(u) ? await fetchPage(u) : null);
    if (!p || p.text.length < 1500) continue;
    if (new URL(p.url).pathname.replace(/\/+$/, '') === '') continue;           // redirected to a front page
    const low = p.text.toLowerCase(), phrase = title.toLowerCase().replace(/[‘’]/g, "'");
    if (!low.includes(phrase) && key.filter(k => low.includes(k)).length < Math.min(2, key.length)) continue; // not about this topic
    const pub = publisherOf(p.url);
    if (texts.some(t => t.publisher === pub.publisher)) continue;          // independent publishers only
    texts.push({ id: `src-ref${texts.length + 1}`, url: p.url, title: p.title.slice(0, 200), ...pub, text: p.text });
  }
  const inst = texts.filter(t => t.id !== 'src-wp');
  if (!inst.length || texts.length < 2) return { stop: `too few fetchable sources (${citable ? 'Wikipedia ' + a.quality + ' + ' : ''}${inst.length} institutional)` };
  const { usd, out, why } = await draft(item, texts, wd);
  if (!out) return { usd, stop: why };
  if (!out.usable) return { usd, stop: `model: ${out.skip_reason}` };
  // drop sources the model found off-topic, then re-check that two independent publishers remain
  const off = new Set(out.off_topic_sources || []);
  for (let k = texts.length - 1; k >= 0; k--) if (off.has(texts[k].id)) texts.splice(k, 1);
  if (texts.length < 2 || !texts.some(t => t.id !== 'src-wp')) return { usd, stop: `off-topic sources left too few (${[...off].join(', ')})` };
  // machine check: every quote must be in the text of the source it cites
  const byId = Object.fromEntries(texts.map(t => [t.id, norm(t.text)]));
  const quotes = out.quotes.filter(q => byId[q.source_id]?.includes(norm(q.text)));
  if (!quotes.length) return { usd, stop: 'no date quote matched its source text' };
  const used = new Set(quotes.map(q => q.source_id));
  const sources = texts.map(t => ({ id: t.id, url: t.url, title: t.title, publisher: t.publisher, accessed: today(), class: t.class, opened: true,
    ...(t.wiki_quality ? { wiki_quality: t.wiki_quality } : {}), supports: [...(used.has(t.id) ? ['when.as_recorded'] : []), 'summary'] }));
  sources.push({ id: 'src-wikidata', url: `https://www.wikidata.org/wiki/${wd.proxy ? wd.proxy.qid : a.qid}`, title: `Wikidata ${wd.proxy ? wd.proxy.qid + ' (' + wd.proxy.name + ', coordinates of the ' + wd.proxy.prop + ' Wikidata gives for ' + a.qid + ')' : a.qid + ' (coordinates)'}`, publisher: 'Wikidata', accessed: today(), class: 'dataset', opened: true, supports: ['where'] });
  const rec = {
    id: item.id, schema_version: SCHEMA_VERSION, record_version: 1, tier: 'outline', status: 'needs_review', kind: out.kind, title: out.title || title,
    summary: out.summary,
    when: { start: { year: out.start_year }, end: { year: Math.max(out.end_year, out.start_year) }, precision: out.precision, display: out.display,
      as_recorded: quotes.map(q => ({ calendar: 'as written', value: q.text, source: q.source_id })) },
    where: { lat: +wd.coord.lat.toFixed(5), lon: +wd.coord.lon.toFixed(5), elevation_m: null, modern_name: wd.proxy ? `${out.modern_name || wd.proxy.name} (proxy pin: ${wd.proxy.name}, the ${wd.proxy.prop} Wikidata lists)` : (out.modern_name || a.title), historical_name: out.historical_name || out.modern_name || wd.proxy?.name || a.title,
      geometry: { type: 'point' }, uncertainty_km: wd.proxy ? Math.max(out.uncertainty_km, wd.proxy.prop === 'country' ? 1000 : 300) : out.uncertainty_km, coordinate_sources: ['src-wikidata'] },
    regions: out.regions, domains: out.domains, scale: out.scale,
    importance: { score: Math.min(5, Math.max(1, out.importance)), justification: out.importance_justification },
    confidence: out.confidence, audience_note: out.audience_note || null, related: [], sources,
    reviewer_note: `${trimNote(out.reviewer_note)} (Drafted by the Wikipedia pipeline from ${texts.map(t => t.publisher).join(', ')}; quotes machine-checked.)`,
    author: `wiki-pipeline:${model}`, updated: today(),
  };
  const file = path.join(RECORDS, `${item.id}.json`);
  if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).status !== 'stub') return { usd, stop: 'a record already exists' };
  fs.writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');
  let gate = ''; try { gate = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'gate.mjs'), item.id], { encoding: 'utf8' }); } catch (e) { gate = e.stdout || ''; }
  const pass = /^PASS/m.test(gate);
  if (!pass) { fs.unlinkSync(file); return { usd, stop: `gate: ${gate.split('\n').filter(l => /✗/.test(l)).join('; ').slice(0, 300)}` }; }
  return { usd, ok: true, note: `${a.quality !== 'none' ? 'Wikipedia ' + a.quality + ' + ' : ''}${inst.map(t => t.publisher).join(', ')}` };
}

// ---------- batch
const [first, ...rest] = pos;
const batch = first === 'next' ? rest[0] : first;
if (!batch) { console.log('usage: wiki-outline.mjs next <batch> <n> | <batch> <id> [...]'); process.exit(1); }
const ids = first === 'next' ? await nextOpen(Number(rest[1] || 10)) : rest;
const l0 = ledger(); if (l0.total_usd >= l0.cap_usd) { console.log('spending cap reached'); process.exit(0); }
const items = queueItems(ids), lines = []; let spent = 0;
const work = [...items];
await Promise.all(Array.from({ length: Math.min(Number(flags.concurrency || 4), items.length) }, async () => {
  for (let it; (it = work.shift());) {
    let r; try { r = await outlineOne(it); } catch (e) { r = { stop: `error: ${e.message}` }; }
    spent += r.usd || 0;
    lines.push(`- ${it.id}: ${r.ok ? 'PASS' : 'skipped'}; $${(r.usd || 0).toFixed(3)}; ${r.ok ? r.note : r.stop}`);
    console.log(`${it.id}: ${r.ok ? 'PASS' : 'skipped'} ($${(r.usd || 0).toFixed(3)}) ${r.ok ? r.note : r.stop}`);
  }
}));
fs.writeFileSync(path.join(ROOT, 'inbox', `${batch}.report.md`), `# ${batch} (wiki-outline, ${model}, ${today()})\nSpent about $${spent.toFixed(2)}.\n\n${lines.join('\n')}\n`);
console.log(`report: atlas/inbox/${batch}.report.md  ($${spent.toFixed(2)} for ${items.length} targets)`);

// --fallback: hand every target the pipeline skipped to the agent runner (claude-agent.mjs), which researches it
// from scratch; its report is atlas/inbox/<batch>-agent.report.md
if (flags.fallback) {
  const skipped = lines.filter(l => / skipped;/.test(l) && !/already exists/.test(l)).map(l => l.match(/^- (\S+):/)[1]);
  if (skipped.length) {
    console.log(`\nfallback: ${skipped.length} targets to the agent runner`);
    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'claude-agent.mjs'), 'outline', `${batch}-agent`, ...skipped, '--model', model, '--concurrency', String(flags.concurrency || 4)],
      { stdio: 'inherit', env: process.env });
  }
} else {
  // no agent fallback: park the skips with their reason, so the next batch moves on and the agent runner can take them later
  for (const l of lines.filter(l => / skipped;/.test(l) && !/already exists/.test(l))) {
    const [, id, why] = l.match(/^- (\S+): skipped; [^;]*; (.*)$/) || [];
    if (id) execFileSync(process.execPath, [path.join(ROOT, 'tools', 'queue.mjs'), 'park', id, `wiki pipeline skipped (${(why || '').slice(0, 160)}); for the agent runner`], { stdio: 'inherit' });
  }
}
