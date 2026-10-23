// The viewer's data, shared by the live server (server.mjs) and the static build (build-static.mjs), so a local run
// and the published site serve exactly the same JSON: the pin list, and one full record per id.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RECORDS = path.resolve(HERE, '..', 'atlas', 'records');
const WIKI_LINKS = path.resolve(HERE, '..', 'atlas', 'wiki_links.json');

// Only the fields the engine needs for pins; the full record is fetched on click. The summary is only the hover
// tooltip's teaser, so it is cut to about two lines (it was most of the pin list's size).
const teaser = s => { s = String(s || ''); return s.length <= 180 ? s : s.slice(0, 180).replace(/\s+\S*$/, '') + '…'; };
function pin(r) {
  return {
    id: r.id, title: r.title, summary: teaser(r.summary), kind: r.kind, scale: r.scale, importance: r.importance?.score ?? 1,
    confidence: r.confidence, domains: r.domains, start: r.when?.start?.year, end: r.when?.end?.year ?? r.when?.start?.year,
    display: r.when?.display, lat: r.where?.lat, lon: r.where?.lon, global: (r.where?.uncertainty_km ?? 0) >= 5000 || r.where?.geometry?.type === 'global', paleo: r.where?.paleo?.lat != null ? r.where.paleo : null,
    geometry: r.where?.geometry?.type, waypoints: (r.where?.geometry?.waypoints || []).map(w => ({ lat: w.lat, lon: w.lon, year: typeof w.year === 'number' ? w.year : null, date: w.date, label: w.label })),
    regions: (r.where?.geometry?.regions || []).map(g => ({ lat: g.lat, lon: g.lon, name: g.name })),
    outline: r.status === 'outline', hasModel: !!r.model, updated: r.updated, aliases: (r.aliases || []).map(a => a.name),
  };
}

// published records plus outlines (amendment A1); stubs and drafts stay out
export function published() {
  const out = [];
  for (const f of fs.readdirSync(RECORDS)) {
    if (!f.endsWith('.json')) continue;
    try { const r = JSON.parse(fs.readFileSync(path.join(RECORDS, f), 'utf8')); if (r.status === 'published' || r.status === 'outline') out.push(r); } catch {}
  }
  return out;
}

export function pinsPayload(recs = published()) {
  return { generated: new Date().toISOString(), count: recs.filter(r => r.status === 'published').length, outlines: recs.filter(r => r.status === 'outline').length, pins: recs.map(pin) };
}

const readLinks = () => { try { return JSON.parse(fs.readFileSync(WIKI_LINKS, 'utf8')); } catch { return {}; } };

// One record, with its English Wikipedia article attached (atlas/tools/wiki.mjs link): further reading, never one of
// its sources. Returns null for an unknown id or a record that is not published.
export function recordPayload(id, links = readLinks()) {
  if (!/^-?[a-z0-9-]+$/.test(id)) return null;
  const p = path.join(RECORDS, `${id}.json`);
  if (!fs.existsSync(p)) return null;
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (r.status !== 'published' && r.status !== 'outline') return null;
  if (links[id]) r.wiki = links[id];
  return r;
}
export { readLinks };
