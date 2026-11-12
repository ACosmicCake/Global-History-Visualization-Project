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
// served under a made-up host name, not localhost, so the viewer behaves as on the published site (no live refresh)
const BASE = `http://atlas.test:${server.address().port}/`;

const BUDGET = JSON.parse(fs.readFileSync(new URL('./budget.json', import.meta.url), 'utf8'));
const MB = n => `${(n / 1e6).toFixed(2)} MB`;
const fails = [];
const check = (ok, what) => { console.log(`${ok ? '  ok ' : '  FAIL'} ${what}`); if (!ok) fails.push(what); };
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP atlas.test 127.0.0.1', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function run(name, opts, budget) {
  console.log(name);
  const ctx = await browser.newContext(opts);
  await ctx.route(u => !u.href.startsWith(BASE), r => r.abort());
  const page = await ctx.newPage(), pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e.stack || e).slice(0, 400)));
  const loaded = [];   // [path, bytes] of every response from the site
  page.on('response', r => r.body().then(b => loaded.push([r.url().slice(BASE.length - 1), b.length]), () => {}));
  const ready = () => page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gone') && window.atlas?.state.pins.length, null, { timeout: 90000 });
  const soon = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 30000 }).then(() => true, () => false);

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  check(await ready().then(() => true, () => false), 'the loading screen clears');
  const pins = await page.evaluate(() => window.atlas?.state.pins.length || 0);
  check(pins > 2000, `more than 2,000 pins load (${pins})`);
  const first = await page.evaluate(() => document.querySelector('#now').firstChild?.textContent);
  check(first === '500 BCE', `a first visit opens at 500 BCE (${first})`);
  if (budget) {   // what a first visit downloads with no interaction, including the loads the page starts once idle
    await page.waitForTimeout(15000);
    const total = loaded.reduce((a, [, n]) => a + n, 0);
    console.log(`       first load: ${loaded.length} requests, ${MB(total)}; largest: ${[...loaded].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u, n]) => `${u} ${MB(n)}`).join(', ')}`);
    check(total <= budget, `first load within budget (${MB(total)} of ${MB(budget)}, viewer/test/budget.json)`);
    check(!loaded.some(([u]) => u.includes('paleo/morph.json')), 'the plate model is not loaded until deep time is asked for');
  }
  // a first visit gets the welcome as a modal dialog that fits the screen and keeps the keyboard inside
  await soon(() => document.querySelector('#welcome').open);
  const fits = await page.evaluate(() => { const d = document.querySelector('#welcome'); return d.open && d.scrollHeight <= d.clientHeight + 1; });
  check(fits, 'the welcome dialog opens and fits the screen without scrolling');
  const recent = await page.evaluate(() => document.querySelectorAll('#welcome .w-recent button[data-id]').length);
  check(recent > 0, `the welcome names recently added records (${recent})`);
  let inside = true;
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); inside &&= await page.evaluate(() => !!document.activeElement?.closest('#welcome')); }
  check(inside, 'Tab never leaves the open welcome dialog');
  await page.keyboard.press('Escape');
  check(await soon(() => !document.querySelector('#welcome').open), 'Escape closes the welcome dialog');
  // vital signs: on and closed to one line on a desktop, off on a phone; no row that means nothing at 500 BCE
  await soon(() => document.querySelectorAll('#v-rows .v-row').length > 0);
  const vit = await page.evaluate(() => ({ on: window.atlas.state.vitals, rows: [...document.querySelectorAll('#v-rows .v-row')].filter(b => b.offsetParent).map(b => b.textContent) }));
  check(await page.evaluate(() => document.querySelector('#legend').classList.contains('collapsed')), 'the legend is closed on a first visit');
  if (budget) check(!vit.on, 'vital signs are off on a phone');
  else check(vit.on && vit.rows.length === 1 && !vit.rows.some(t => /genera/i.test(t)), `vital signs show one line, with no known genera, at 500 BCE (${vit.rows.join(' | ')})`);
  await page.mouse.move(200, 300);
  check(await soon(() => window.atlas.state.pins.filter(p => p.summary).length > 2000), 'tooltip teasers arrive at the first pointer move');

  // a full record with sources: chosen from the data, so the test does not depend on one record's id
  const id = await page.evaluate(() => window.atlas.state.pins.find(p => !p.outline && p.importance === 5 && p.lat != null && !p.global)?.id);
  check(!!id, `a full importance-5 record exists (${id})`);
  await page.evaluate(id => window.atlas.goTo(id), id);
  check(await soon(() => { const p = document.querySelector('#panel'); return p && !p.hidden && p.querySelector('h2')?.textContent.trim() && p.querySelectorAll('.srcs li').length > 0; }),
    'goTo opens a panel with a title and sources');
  const shown = await page.evaluate(() => {
    const h = document.querySelector('#panel h2').getBoundingClientRect();
    return { title: h.top >= 0 && h.bottom <= innerHeight };
  });
  check(shown.title, 'the record title is on screen when the record opens');
  check(await soon(() => { const fig = document.querySelector('#panel .p-fig'), img = fig?.querySelector('img');
    return !fig || fig.hidden || !img || img.hidden || (img.complete && img.naturalWidth > 0); }), 'a picture that cannot load leaves no empty box');
  await page.waitForFunction(id => location.hash.includes(`r=${id}`), id, { timeout: 5000 }).catch(() => {});
  await page.goBack();
  check(await soon(() => document.querySelector('#panel').hidden && !window.atlas.state.selected), 'Back closes the record');

  const phone = await page.isVisible('#search-open');
  if (phone) {   // the one-row phone header, with the legend as a sheet from the bottom
    const row = await page.evaluate(() => document.querySelector('.brand').getBoundingClientRect().height);
    check(row <= 48, `the phone header is one row (${row}px tall)`);
    await page.click('#layers-btn');
    check(await soon(() => { const l = document.querySelector('#legend'); return !l.classList.contains('collapsed') && Math.abs(l.getBoundingClientRect().bottom - innerHeight) < 2; }),
      'Layers opens the legend as a bottom sheet');
    await page.keyboard.press('Escape');
    const under = await page.evaluate(async () => {
      const { labelBoxes } = await import('./app/pins.js'), h = document.querySelector('#masthead > div:first-child').getBoundingClientRect();
      return labelBoxes.filter(([a, b, c, d]) => a < h.right && c > h.left && b < h.bottom && d > h.top).length;
    });
    check(under === 0, `no pin name draws beneath the phone header (${under})`);
    const console_ = await page.evaluate(() => document.querySelector('#time').getBoundingClientRect().height);
    check(console_ <= 120, `the phone time console is no taller than 120 px (${console_}px)`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button, [role=tab]')].filter(b => {
      const r = b.getBoundingClientRect();
      return r.width && r.height && r.bottom > 0 && r.top < innerHeight && getComputedStyle(b).visibility !== 'hidden' && !b.classList.contains('mark') && !b.classList.contains('lm') && (r.width < 40 || r.height < 40);
    }).map(b => `${b.id || b.className || b.textContent.trim().slice(0, 16)} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`));
    check(small.length === 0, `no visible button on the phone is under 40 px${small.length ? ': ' + small.join(', ') : ''}`);
    check(await page.evaluate(() => [...document.querySelectorAll('#levels button')].every(b => b.scrollWidth <= b.clientWidth + 1)), 'every scale tab is wide enough for its name');
  }
  // named landmarks on the time bar, none overlapping
  const lms = await page.evaluate(() => [...document.querySelectorAll('#landmarks .lm')].map(b => { const r = b.getBoundingClientRect(); return [r.left, r.right, b.textContent]; }));
  check(lms.length >= (phone ? 2 : 4) && lms.every((a, i) => lms.every((b, j) => i === j || a[1] <= b[0] || b[1] <= a[0])),
    `the time bar names landmarks that don't overlap (${lms.map(l => l[2]).join(', ')})`);
  // the time window on the track matches the "within N years" text
  const win = await page.evaluate(async () => {
    const { band } = await import('./app/timebar.js'), { range } = await import('./app/time.js'), { from, to } = range();
    const text = document.querySelector('#now small').textContent, n = +(text.match(/within ([\d,]+) years/)?.[1] || '0').replace(/,/g, '');
    return { text, ok: !!band && n > 0 && Math.abs((band.z - band.a) - (2 * n / (to - from)) * band.w) <= Math.max(2, 0.03 * (band.z - band.a)) };
  });
  check(win.ok, `the band on the track matches the time window (${win.text})`);
  // at 1944, seen from the Americas, a cue points to where most records are, and one click turns the globe there
  await page.evaluate(() => { window.atlas.state.t = 1944; document.querySelectorAll('#levels button')[5].click(); window.atlas.globe.pointOfView({ lat: 10, lng: -100, altitude: 2.4 }, 0); });
  const cued = await soon(() => !document.querySelector('#cue').hidden);
  check(cued, `a cue points to history out of view (${await page.evaluate(() => document.querySelector('#cue').textContent)})`);
  if (cued) {
    await page.click('#cue');
    await page.waitForTimeout(2500);
    const seen = await page.evaluate(async () => { const { pinsSeen } = await import('./app/pins.js'); return [pinsSeen.facing, pinsSeen.shown]; });
    check(seen[0] >= seen[1] / 4, `one click brings the pins into view (${seen[0]} of ${seen[1]} face the camera)`);
  }
  await page.evaluate(() => { window.atlas.state.t = -499; document.querySelectorAll('#levels button')[4].click(); });
  // region and kind filters: Oceania and person leave only matching pins
  const only = await page.evaluate(async () => {
    const s = window.atlas.state, { pinSprites } = await import('./app/pins.js'), { domainOn } = await import('./app/time.js');
    document.querySelector('#f-regions [data-k="oceania"]').click();
    document.querySelector('#f-kinds [data-k="person"]').click();
    const matching = s.pins.filter(domainOn), bad = matching.filter(p => p.region !== 'oceania' || p.kind !== 'person').length;
    const one = matching.find(p => p.lat != null && p.start > 1500);   // go to one of them, so the globe has some to show
    if (one) { s.t = one.start; document.querySelectorAll('#levels button')[5].click(); }
    await new Promise(r => setTimeout(r, 800));
    const recs = [...pinSprites.values()].flatMap(e => e.p.cluster || [e.p]), wrong = recs.filter(p => p.region !== 'oceania' || p.kind !== 'person').length;
    document.querySelector('#f-regions [data-k="oceania"]').click(); document.querySelector('#f-kinds [data-k="person"]').click();
    s.t = -499; document.querySelectorAll('#levels button')[4].click();
    return { matching: matching.length, bad, shown: recs.length, wrong };
  });
  check(only.matching > 0 && only.bad === 0 && only.shown > 0 && only.wrong === 0, `choosing Oceania and person leaves only matching pins (${only.matching} records; ${only.shown} on the globe, ${only.wrong} not matching)`);
  // the scale tabs move with the arrow keys
  await page.focus('#levels .on');
  await page.keyboard.press('ArrowRight');
  check(await page.evaluate(() => window.atlas.state.level === 5 && document.activeElement === document.querySelector('#levels .on')), 'the arrow keys move between the scale tabs');
  await page.keyboard.press('ArrowLeft');
  // speed is chosen from a menu (on a phone, the "more" menu)
  await page.click(phone ? '#more-btn' : '#speed');
  await page.click('#speeds button[data-s="2"]');
  check(await page.evaluate(() => document.querySelector('#time-menu').hidden && document.querySelector('#speed').textContent === '2×'), 'a speed can be chosen from the menu');
  // Around the world: at 1500, the top records of at least six regions
  await page.evaluate(() => { const b = document.querySelectorAll('#levels button')[5]; b.click(); window.atlas.state.t = 1500; b.click(); });
  if (phone) { await page.click('#more-btn'); await page.click('#m-world'); } else await page.click('#world-btn');
  const world = await page.evaluate(() => ({ title: document.querySelector('#pinlist h2')?.textContent, regions: document.querySelectorAll('#pinlist h3').length, rows: document.querySelectorAll('#pinlist button[data-id]').length }));
  check(world.title?.startsWith('Around the world in 1500') && world.regions >= 6 && world.rows <= world.regions * 2, `around the world at 1500 lists records from ${world.regions} regions`);
  await page.click('#pinlist h2 button');
  // a tour plays itself: each stop opens with its tour note, its sequence plays, then the next stop, with no click
  // (here the holds are shortened and each sequence is skipped to its last beat)
  await page.evaluate(() => { window.atlas.state.tourPace = 0.05; window.atlas.startTour('space', 0, true); });
  check(await soon(() => /^Tour note/.test(document.querySelector('#panel .tour-line')?.textContent || '')), 'a tour stop shows its editorial line, marked as a tour note');
  const toured = await page.waitForFunction(() => {
    const s = window.atlas.state;
    if (window.Sequence.playing && window.__skipped !== window.Sequence.recordId) { window.__skipped = window.Sequence.recordId; window.Sequence.goTo(999); }   // once per sequence
    return s.tour && s.tour.i === s.tour.stops.length - 1 && !window.atlas.tourPlaying() && s.openRec?.id === s.tour.stops.at(-1);
  }, null, { timeout: 180000, polling: 500 }).then(() => true, () => false);
  check(toured, `a played tour reaches its last stop on its own (${await page.evaluate(() => `${window.atlas.state.tour?.i + 1} of ${window.atlas.state.tour?.stops.length}`)})`);
  await page.evaluate(() => { delete window.atlas.state.tourPace; });
  if (await page.isVisible('#seq-stop')) await page.click('#seq-stop');
  if (await page.isVisible('#panel .p-close')) await page.click('#panel .p-close');
  if (phone) await page.click('#search-open');
  await page.fill('#q', 'world war 2');
  check(await soon(() => !document.querySelector('#results').hidden && document.querySelectorAll('#results button[data-id]').length > 0), 'searching "world war 2" returns a result');
  await page.keyboard.press('Escape');

  await page.goto(`${BASE}#t=1945&l=modern&r=${id}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready().catch(() => {});
  check(await soon(id => { const s = window.atlas.state; return s.t === 1945 && s.level === 5 && s.selected === id && !document.querySelector('#panel').hidden; }, id),
    'a #t=1945&l=modern&r=… link restores date, scale and record');

  // a new visit with no link returns to where the visitor left
  await page.evaluate(() => { const b = document.querySelectorAll('#levels button')[4]; b.click(); window.atlas.state.t = 1066; b.click(); });
  await page.waitForTimeout(800);
  const again = await ctx.newPage();
  again.on('pageerror', e => pageErrors.push(String(e.stack || e).slice(0, 400)));
  await again.goto(BASE, { waitUntil: 'domcontentloaded' });
  await again.waitForFunction(() => document.querySelector('#loading')?.classList.contains('gone') && window.atlas?.state.pins.length, null, { timeout: 90000 }).catch(() => {});
  const back = await again.waitForFunction(() => { const s = window.atlas.state; return Math.abs(s.t - 1066) < 1 && s.level === 4; }, null, { timeout: 15000 }).then(() => true, () => false);
  check(back, `a new visit with no link returns to the last date and scale (${await again.evaluate(() => `${window.atlas.state.t}, scale ${window.atlas.state.level}`)})`);
  await again.close();

  const errs = [...pageErrors, ...await page.evaluate(() => window.__errs || [])];
  check(errs.length === 0, `no page errors${errs.length ? ':\n      ' + errs.join('\n      ') : ''}`);
  await ctx.close();
}

try {
  await run('desktop 1440×900', { viewport: { width: 1440, height: 900 } });
  await run('phone (iPhone 13)', { ...devices['iPhone 13'] }, BUDGET.firstLoadPhone);
} finally { await browser.close(); server.close(); }
if (fails.length) { console.error(`\n${fails.length} smoke check(s) failed`); process.exit(1); }
console.log('\nsmoke test passed');
