// Other names for search: the labels and English aliases Wikidata holds for each record's linked item (wiki_links.json),
// written to atlas/wiki_aliases.json. These only help a visitor find a record ("Chinggis", "Bombay", "WW2"). They are never
// shown as facts and never count as sources, and no record file is touched. Free; about 40 requests, 0.7 s apart.
// Usage: node atlas/tools/aliases.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const LINKS = path.join(ROOT, 'wiki_links.json'), OUT = path.join(ROOT, 'wiki_aliases.json');
const LANGS = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko', 'ar', 'hi', 'tr', 'fa', 'vi'];
const UA = 'LivingAtlas/1.0 (https://github.com/ACosmicCake/Global-History-Visualization-Project)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const links = JSON.parse(fs.readFileSync(LINKS, 'utf8'));
const byQid = new Map();
for (const [id, l] of Object.entries(links)) if (l.qid) (byQid.get(l.qid) || byQid.set(l.qid, []).get(l.qid)).push(id);
const qids = [...byQid.keys()], out = {};
for (let i = 0; i < qids.length; i += 50) {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels|aliases&languages=${LANGS.join('|')}&ids=${qids.slice(i, i + 50).join('|')}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
  const { entities } = await res.json();
  for (const [q, e] of Object.entries(entities || {})) {
    const names = new Set([...Object.values(e.labels || {}).map(x => x.value), ...(e.aliases?.en || []).map(x => x.value)]);
    for (const id of byQid.get(q) || []) out[id] = [...names];
  }
  await sleep(700);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');
console.log(`names for ${Object.keys(out).length} records -> ${path.relative(process.cwd(), OUT)}`);
