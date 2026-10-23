// Backfill a template animation (spec 6.2) for outline records that have none, using only what the record
// already states and sources: a pulse at its place, a traced route if it has waypoints, and the summary's last
// sentence as the consequence beat. Adds no facts. Usage: node atlas/tools/animate.mjs [--dry]
import { allRecords, save, today, acquireLock } from './lib.mjs';

const dry = process.argv.includes('--dry'), redo = process.argv.includes('--redo-generated');
// a sentence that states a result, not just more description
const CONSEQ = /(led to|leading to|resulted|result|became|become|founded|established|helped|enabled|ended|end of|paved|shaped|influenc|legacy|still|today|remains|first|transform|caused|spread|laid the|gave rise|opened|began|building|made|created|forced|killed|destroyed|displaced|freed|united|divided|fell|collapsed)/i;
const sentences = s => String(s || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(\s|$)/g)?.map(x => x.trim()) || [String(s || '')];
const clip = (s, n = 28) => { const w = s.split(' '); return w.length <= n ? s : w.slice(0, n).join(' ').replace(/[,;:]$/, '') + '…'; };
const yearSpan = r => {
  const y = r.when?.start?.year; if (y == null) return '';
  return r.when.start.iso || (Math.abs(y) >= 1e5 ? String(y) : String(y));
};

if (!dry) acquireLock();
let n = 0;
for (const r of allRecords()) {
  if (r.tier !== 'outline' || (r.animation && !(redo && r.animation.generated))) continue;
  // only where a sequence adds meaning: a route, or an event-like record with a consequence (user, 2026-10-22)
  const hasRoute = (r.where?.geometry?.waypoints || []).length >= 2;
  if (!hasRoute && !['event', 'process', 'movement', 'period'].includes(r.kind)) continue;
  const src = (r.sources || []).find(s => (s.supports || []).some(x => /summary|when|what/.test(x))) || r.sources?.[0];
  if (!src) continue;
  const sent = sentences(r.summary), wp = r.where?.geometry?.waypoints || [];
  const km = Math.min(400, Math.max(30, r.where?.uncertainty_km || 40));
  const beats = [{ span: yearSpan(r), action: `pulse { radius_km: ${km} }`, caption: clip(sent[0]), source: src.id }];
  if (wp.length >= 2) beats.push({ span: yearSpan(r), action: 'path.trace {}', caption: clip(`The route runs ${wp.map(w => String(w.label || '').split(/[,:(]/)[0].trim()).filter(Boolean).slice(0, 4).join(' to ')}.`), source: src.id });
  const ci = sent.findIndex((x, i) => i > 0 && CONSEQ.test(x));
  if (ci > 0) beats.push({ span: String(r.when?.end?.year ?? yearSpan(r)), action: `pulse { radius_km: ${Math.round(km * 1.6)} }`, caption: clip(sent[ci]), source: src.id, consequence: true });
  else if (sent.length > 1) beats.push({ span: String(r.when?.end?.year ?? yearSpan(r)), action: `pulse { radius_km: ${Math.round(km * 1.6)} }`, caption: clip(sent[sent.length - 1]), source: src.id });
  else if (CONSEQ.test(sent[0])) beats[0].consequence = true;
  if (!hasRoute && !beats.some(b => b.consequence)) continue;
  r.animation = { template: wp.length >= 2 ? 'path' : 'point', spec_version: 1, duration_s: 10 + beats.length * 7, beats, generated: 'template from summary (atlas/tools/animate.mjs)' };
  r.updated = today();
  if (!dry) save(r);
  n++;
}
console.log(`${dry ? 'would add' : 'added'} template animations to ${n} outlines`);
