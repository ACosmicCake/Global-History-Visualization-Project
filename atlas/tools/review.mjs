// Coordinator's sceptical re-read aid (spec 7, step 6): compact view of a record's checkable facts.
// Usage: node atlas/tools/review.mjs <id>
import { load, words } from './lib.mjs';
import { gate } from './gate.mjs';

const r = load(process.argv[2]);
const { fail, warn } = gate(r);
console.log(`${r.id} [${r.status}] ${r.kind}/${r.scale} imp ${r.importance?.score} conf ${r.confidence} — ${r.title}`);
console.log(`gate: ${fail.length ? 'FAIL ' + fail.join('; ') : 'PASS'}${warn.length ? ' | warn: ' + warn.join('; ') : ''}`);
console.log(`words: summary ${words(r.summary)}, card ${words(r.card)}, what ${words(r.what)}, how ${words(r.how)}, why ${words(r.why_it_matters)}`);
console.log(`when: ${r.when?.display} [${r.when?.start?.year} → ${r.when?.end?.year}, ${r.when?.precision}]`);
for (const a of r.when?.as_recorded || []) console.log(`   as recorded: ${a.calendar}: ${a.value} (${a.source})`);
console.log(`where: ${r.where?.lat}, ${r.where?.lon} ±${r.where?.uncertainty_km} km — ${r.where?.modern_name} | then: ${r.where?.historical_name} | geom ${r.where?.geometry?.type} | coords from ${r.where?.coordinate_sources}`);
if (r.where?.paleo) console.log(`   paleo: ${JSON.stringify(r.where.paleo)}`);
console.log(`regions: ${r.regions} | domains: ${r.domains} | layers: ${r.layers}`);
console.log('sources:'); for (const s of r.sources || []) console.log(`   ${s.id} [${s.class}${s.opened ? '' : ' NOT OPENED'}] ${s.publisher} — ${s.url}`);
console.log('numbers:'); for (const n of r.numbers || []) console.log(`   ${n.field}: ${n.low}–${n.high} ${n.unit} (${n.source}) ${n.note || ''}`);
console.log('perspectives:'); for (const p of r.perspectives || []) console.log(`   ${p.holder} (${p.sources})`);
console.log('related:'); for (const x of r.related || []) console.log(`   ${x.type} ${x.id}${x.because ? ' — ' + x.because : ''}`);
console.log(`media: ${(r.media || []).map(m => `${m.license} (${m.verified ? 'verified' : 'UNVERIFIED'})`).join(', ')}`);
console.log(`animation: ${r.animation?.template}, ${r.animation?.beats?.length} beats, ${r.animation?.duration_s}s`);
console.log(`reviewer_note: ${r.reviewer_note}`);
console.log(`audience_note: ${r.audience_note}`);
