// Browser smoke test of the built site: loads it in headless Chromium at 1440×900 and as a phone, and fails on any
// page error or a broken core path (pins load, a record opens, search finds, a link restores its place, Back closes).
// Every request to another host is blocked, so the site must run on its own files (fonts fall back, images go blank).
// Usage: node viewer/build-static.mjs dist && node viewer/test/smoke.mjs dist
// Needs Playwright (viewer/test/package.json pins it): cd viewer/test && npm ci && npx playwright install chromium
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.resolve(process.argv[2] || 'dist');
if (!fs.existsSync(path.join(ROOT, 'index.html'))) { console.error(`no built site in ${ROOT}: run node viewer/build-static.mjs first`); process.exit(2); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, p.endsWith('/') ? p + 'index.html' : p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const fails = [];
const check = (ok, what) => { console.log(`${ok ? '  ok ' : '  FAIL'} ${what}`); if (!ok) fails.push(what); };
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function run(name, opts) {
  console.log(name);
  const ctx = await browser.newContext(opts);
  await ctx.route(u => !u.href.startsWith(BASE), r => r.abort());
  const page = await ctx.newPage(), pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.stack || e).slice(0, 400)));
  const ready = () => page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gone') && window.atlas?.state.pins.length, null, { timeout: 90000 });
  const soon = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30000 }).then(() => true, () => false);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  check(await ready().then(() => true, () => false), 'the loading screen clears');
  const pins = await page.evaluate(() => window.atlas?.state.pins.length || 0);
  check(pins > 2000, `more than 2,000 pins load (${pins})`);
  await page.evaluate(() => document.querySelector('#welcome-close')?.click());

  // a full record with sources: chosen from the data, so the test does not depend on one record's id
  const id = await page.evaluate(() => window.atlas.state.pins.find(p => !p.outline && p.importance === 5 && p.lat != null && !p.global)?.id);
  check(!!id, `a full importance-5 record exists (${id})`);
  await page.evaluate(id => window.atlas.goTo(id), id);
  check(await soon(() => { const p = document.querySelector('#panel'); return p && !p.hidden && p.querySelector('h2')?.textContent.trim() && p.querySelectorAll('.srcs li').length > 0; }),
    'goTo opens a panel with a title and sources');
  await page.waitForFunction(id => location.hash.includes(`r=${id}`), id, { timeout: 5000 }).catch(() => {});
  await page.goBack();
  check(await soon(() => document.querySelector('#panel').hidden && !window.atlas.state.selected), 'Back closes the record');

  await page.fill('#q', 'world war 2');
  check(await soon(() => !document.querySelector('#results').hidden && document.querySelectorAll('#results button[data-id]').length > 0), 'searching "world war 2" returns a result');
  await page.keyboard.press('Escape');

  await page.goto(`${BASE}#t=1945&l=modern&r=${id}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready().catch(() => {});
  check(await soon(id => { const s = window.atlas.state; return s.t === 1945 && s.level === 5 && s.selected === id && !document.querySelector('#panel').hidden; }, id),
    'a #t=1945&l=modern&r=… link restores date, scale and record');

  const errs = [...pageErrors, ...await page.evaluate(() => window.__errs || [])];
  check(errs.length === 0, `no page errors${errs.length ? ':\n      ' + errs.join('\n      ') : ''}`);
  await ctx.close();
}

try {
  await run('desktop 1440×900', { viewport: { width: 1440, height: 900 } });
  await run('phone (iPhone 13)', { ...devices['iPhone 13'] });
} finally { await browser.close(); server.close(); }
if (fails.length) { console.error(`\n${fails.length} smoke check(s) failed`); process.exit(1); }
console.log('\nsmoke test passed');
