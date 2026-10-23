// Attribution check (coordinator review, spec 7 step 6): does each cited page actually contain the figures
// credited to it? Fetches every source a record cites for numbers or dates (cached per run) and looks for the
// recorded values in a few written forms. Prints NOT FOUND lines for the reviewer; it cannot prove a fact true.
// Usage: node atlas/tools/verify.mjs <record-id> [...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { load } from './lib.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const cache = new Map();

async function pageText(url) {
  if (cache.has(url)) return cache.get(url);
  let text = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 4).toString() === '%PDF') {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-verify-'));
        fs.writeFileSync(path.join(dir, 'f.pdf'), buf);
        execFileSync('pdftotext', ['-table', path.join(dir, 'f.pdf'), path.join(dir, 'f.txt')]);
        text = fs.readFileSync(path.join(dir, 'f.txt'), 'utf8');
      } else text = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
      text = text.replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/[   ]/g, ' ').replace(/\s+/g, ' ');
    }
  } catch {}
  cache.set(url, text);
  return text;
}

// Written forms of a number: 1234567, 1,234,567, 1 234 567, 1.2 million, 1.23 million, 1234.5
function forms(n) {
  const out = new Set([String(n), n.toLocaleString('en-US'), n.toLocaleString('en-US').replace(/,/g, ' ')]);
  for (const [d, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) if (Math.abs(n) >= d) {
    const v = n / d; for (const p of [0, 1, 2]) { const s = v.toFixed(p); if (Math.abs(+s - v) < 1e-9) out.add(`${s} ${w}`); }
  }
  if (Math.abs(n) < 10000 && !Number.isInteger(n)) out.add(n.toFixed(1));
  const W = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  for (const [d, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [100, 'hundred']])
    if (n % d === 0 && n / d <= 20 && n / d >= 1) { out.add(`${W[n / d]} ${w}`); out.add(`${W[n / d]}-${w}`); }
  if (Number.isInteger(n) && n <= 20 && n >= 2) out.add(W[n]);
  return [...out].map(f => f.toLowerCase());
}
const has = (text, n) => { const t = text.toLowerCase(); return forms(n).some(f => t.includes(f)); };

for (const id of process.argv.slice(2)) {
  const r = load(id); const src = Object.fromEntries((r.sources || []).map(s => [s.id, s]));
  let bad = 0, ok = 0, skip = 0;
  console.log(`== ${id}`);
  for (const n of r.numbers || []) {
    const s = src[n.source]; const text = s && await pageText(s.url);
    if (!text) { console.log(`  ? numbers.${n.field}: ${n.source} unreachable (${s?.url})`); skip++; continue; }
    const missing = [...new Set([n.low, n.high])].filter(v => typeof v === 'number' && !has(text, v));
    if (missing.length) { console.log(`  ✗ numbers.${n.field}: ${missing.join(', ')} ${n.unit} not on ${n.source}`); bad++; } else ok++;
  }
  for (const a of r.when?.as_recorded || []) {
    const s = src[a.source]; const text = s && await pageText(s.url);
    if (!text) { skip++; continue; }
    const nums = (a.value.match(/\d[\d,.]*\d|\d/g) || []).map(x => x.replace(/,/g, '')).filter(x => x.length >= 3);
    const missing = nums.filter(x => !text.includes(x) && !has(text, +x));
    if (missing.length) { console.log(`  ✗ as_recorded "${a.value.slice(0, 70)}": ${missing.join(', ')} not on ${a.source}`); bad++; } else ok++;
  }
  console.log(`  ${ok} confirmed, ${bad} not found, ${skip} unreachable`);
}
