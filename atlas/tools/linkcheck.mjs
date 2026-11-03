// Tests every source URL in the live records and writes a report. Reports only; it changes nothing. A page that refuses
// automated requests (403, 429) is listed apart from one that is gone (404, 410, no such host), since many
// institutions block scripts while the page itself is fine. Requests to one host are spaced out so no site is hammered.
// Usage: node atlas/tools/linkcheck.mjs [--out report.json] [--limit N] [--concurrency N]
import fs from 'node:fs';
import path from 'node:path';
import { RECORDS } from './lib.mjs';

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', 'linkcheck.json'), LIMIT = +arg('--limit', Infinity), CONC = +arg('--concurrency', 12), GAP_MS = 1500, TIMEOUT_MS = 25000;
const UA = 'Mozilla/5.0 (compatible; LivingAtlasLinkCheck/1.0; +https://github.com/ACosmicCake/Global-History-Visualization-Project)';

const used = new Map();
for (const f of fs.readdirSync(RECORDS).filter(x => x.endsWith('.json'))) {
  const r = JSON.parse(fs.readFileSync(path.join(RECORDS, f), 'utf8'));
  if (r.status !== 'published' && r.status !== 'outline') continue;
  for (const s of r.sources || []) if (s.url) (used.get(s.url) || used.set(s.url, []).get(s.url)).push(r.id);
}
const urls = [...used.keys()].slice(0, LIMIT), hostNext = new Map();
const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function check(url) {
  const host = hostOf(url), now = Date.now(), at = Math.max(now, hostNext.get(host) || 0);
  hostNext.set(host, at + GAP_MS);
  await sleep(at - now);
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/json,*/*' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.body?.cancel();
    return { status: res.status };
  } catch (e) { return { status: 0, error: e.cause?.code || e.name }; }
}
const results = new Map();
let next = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next < urls.length) { const u = urls[next++]; results.set(u, await check(u)); if (results.size % 500 === 0) console.log(`${results.size}/${urls.length}`); }
}));

const bucket = r => (r.status >= 200 && r.status < 400 ? 'ok' : r.status === 404 || r.status === 410 || r.error === 'ENOTFOUND' ? 'gone' : r.status === 401 || r.status === 403 || r.status === 429 || r.status === 503 ? 'refused' : 'error');
const report = { checked_at: new Date().toISOString(), total: urls.length, counts: { ok: 0, gone: 0, refused: 0, error: 0 }, problems: [] };
for (const [url, r] of results) {
  const b = bucket(r); report.counts[b]++;
  if (b !== 'ok') report.problems.push({ url, kind: b, status: r.status, error: r.error, records: used.get(url) });
}
report.problems.sort((a, b) => a.kind.localeCompare(b.kind) || b.records.length - a.records.length);
fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.counts), `-> ${OUT}`);
