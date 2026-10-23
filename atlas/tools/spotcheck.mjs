// Orchestrator verification (spec 7, step 6): fetch a record's cited source and grep it for a claimed fact.
// Usage: node atlas/tools/spotcheck.mjs <record-id> <source-id> "<regex>" ["<regex>" ...]
// Prints up to 4 matching snippets per pattern, or NOT FOUND. PDFs are converted with pdftotext.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { load } from './lib.mjs';

const [id, srcId, ...patterns] = process.argv.slice(2);
const src = (load(id).sources || []).find(s => s.id === srcId);
if (!src) { console.log(`no source ${srcId} in ${id}`); process.exit(1); }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
let text = '';
try {
  const res = await fetch(src.url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/pdf,*/*' }, redirect: 'follow' });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) { console.log(`HTTP ${res.status} for ${src.url}`); process.exit(2); }
  if (buf.subarray(0, 4).toString() === '%PDF') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-spot-'));
    fs.writeFileSync(path.join(dir, 'f.pdf'), buf);
    try {
      execFileSync('pdftotext', ['-layout', path.join(dir, 'f.pdf'), path.join(dir, 'f.txt')]);
    } catch {
      execFileSync('pdftotext', [path.join(dir, 'f.pdf'), path.join(dir, 'f.txt')]);
    }
    text = fs.readFileSync(path.join(dir, 'f.txt'), 'utf8');
  } else {
    text = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ');
  }
} catch (e) { console.log(`fetch failed: ${e.message}`); process.exit(2); }
text = text.replace(/\s+/g, ' ');
console.log(`${srcId}: ${src.url} (${text.length} chars)`);
for (const p of patterns) {
  const re = new RegExp(p, 'gi'); const hits = [];
  for (const m of text.matchAll(re)) { hits.push(text.slice(Math.max(0, m.index - 90), m.index + m[0].length + 90)); if (hits.length >= 4) break; }
  console.log(hits.length ? `✓ /${p}/\n   …${hits.join('…\n   …')}…` : `✗ /${p}/ NOT FOUND`);
}
