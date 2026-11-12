// Unit tests for the viewer's data layer (api.mjs) and the plain HTML pages (pages.mjs), run against the small set of
// records in fixtures/records, never the live atlas. Usage: node --test viewer/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'records');
process.env.ATLAS_RECORDS = FIXTURES;   // must be set before api.mjs is loaded
const api = await import('../api.mjs');
const { recordPage } = await import('../pages.mjs');
const pinsFormat = (await import('../pins-format.js')).default;

const rec = id => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${id}.json`), 'utf8'));
const THIS_YEAR = new Date().getUTCFullYear();

test('the records folder can be pointed at fixtures', () => {
  assert.equal(api.RECORDS, FIXTURES);
});

test('published() keeps published records and outlines, not drafts', () => {
  const ids = api.published().map(r => r.id).sort();
  assert.ok(ids.includes('1066-battle-of-hastings'));
  assert.ok(ids.includes('1086-domesday-book'));
  assert.ok(!ids.includes('1300-draft-stub'));
  assert.equal(ids.length, 8);
});

test('pinsPayload counts full records and outlines separately', () => {
  const p = api.pinsPayload();
  assert.equal(p.count, 6);
  assert.equal(p.outlines, 2);
  assert.equal(p.pins.length, 8);
});

test('pinsPayload sends compact pins that expand back to the full pin() shape, without the teaser', () => {
  const p = api.pinsPayload(), recs = api.published();
  for (const r of recs) {
    const compact = p.pins.find(x => x.id === r.id), { summary, ...full } = api.pin(r);
    assert.ok(!('summary' in compact), 'no teaser in pins.json');
    assert.deepEqual(pinsFormat.expand(JSON.parse(JSON.stringify(compact))), JSON.parse(JSON.stringify(full)), r.id);
  }
  const hastings = p.pins.find(x => x.id === '1066-battle-of-hastings');
  assert.equal(hastings.full, true);
  for (const k of ['outline', 'end', 'until', 'confidence', 'geometry', 'global', 'paleo', 'waypoints', 'regions']) assert.ok(!(k in hastings), `${k} is sent`);
  const voyage = p.pins.find(x => x.id === '1500-the-voyage');
  assert.ok(!('full' in voyage));
  assert.equal(voyage.waypoints.length, 2);
});

test('teasersPayload maps each live record to its short summary', () => {
  const t = api.teasersPayload();
  assert.equal(Object.keys(t).length, 8);
  assert.equal(t['1066-battle-of-hastings'], 'Norman forces under William defeated the English army of Harold Godwinson on 14 October 1066.');
});

test('pin() carries the fields the viewer reads', () => {
  const p = api.pin(rec('1066-battle-of-hastings'));
  assert.equal(p.id, '1066-battle-of-hastings');
  assert.equal(p.title, 'Battle of Hastings');
  assert.equal(p.kind, 'event');
  assert.equal(p.importance, 5);
  assert.equal(p.start, 1066);
  assert.equal(p.end, 1066);             // no end year: the start year
  assert.equal(p.until, 1066);
  assert.equal(p.lat, 50.91);
  assert.equal(p.lon, 0.49);
  assert.equal(p.global, false);
  assert.equal(p.outline, false);
  assert.deepEqual(p.aliases, ['Hastings']);
  assert.equal(p.region, 'europe');
  assert.deepEqual(p.domains, ['war_conflict']);
  assert.equal(p.display, '14 October 1066');
  assert.equal(p.md, undefined);          // before 1582: no "on this day"
});

test('pin() keeps route waypoints, with a non-numeric year as null', () => {
  const p = api.pin(rec('1500-the-voyage'));
  assert.equal(p.geometry, 'route');
  assert.deepEqual(p.waypoints, [
    { lat: 10, lon: 10, year: 1500, date: undefined, label: 'Start' },
    { lat: 12, lon: 14, year: null, date: undefined, label: undefined },
  ]);
  assert.equal(p.outline, true);
});

test('pin() cuts a long summary to a short teaser', () => {
  const p = api.pin({ ...rec('1086-domesday-book'), summary: 'word '.repeat(100) });
  assert.ok(p.summary.length <= 181);
  assert.ok(p.summary.endsWith('…'));
});

test('shownUntil: a long-lived standing place shows for 15% of its age, at least 20 years', () => {
  const r = rec('-2560-great-pyramid-of-giza');
  assert.equal(api.shownUntil(r), -2560 + Math.max(20, (THIS_YEAR + 2560) * 0.15));
  const young = { kind: 'place', when: { start: { year: THIS_YEAR - 30 }, end: { year: THIS_YEAR } }, where: {} };
  assert.equal(api.shownUntil(young), THIS_YEAR - 30 + 20);
});

test('shownUntil: a person keeps their whole life', () => {
  assert.equal(api.shownUntil(rec('1819-queen-victoria')), 1901);
  const living = { kind: 'person', when: { start: { year: 1950 }, end: { year: THIS_YEAR } }, where: {} };
  assert.equal(api.shownUntil(living), THIS_YEAR);
});

test('shownUntil: a planet-wide record keeps its full span', () => {
  assert.equal(api.shownUntil(rec('-66000000-chicxulub-impact')), -65990000);
  const global = { kind: 'place', when: { start: { year: -3000 }, end: { year: THIS_YEAR } }, where: { geometry: { type: 'global' } } };
  assert.equal(api.shownUntil(global), THIS_YEAR);
});

test('shownUntil: an ordinary finished event ends at its end', () => {
  assert.equal(api.shownUntil({ kind: 'event', when: { start: { year: 1914 }, end: { year: 1918 } }, where: {} }), 1918);
});

test('monthDay reads ISO dates from 1582 on', () => {
  assert.equal(api.monthDay({ when: { precision: 'day', start: { year: 1969, iso: '1969-07-20' } } }), '07-20');
  assert.equal(api.monthDay({ when: { precision: 'hour', start: { year: 1945, iso: '1945-08-06T08:15' } } }), '08-06');
});

test('monthDay reads "24 May 1819" and "July 4, 1776"', () => {
  assert.equal(api.monthDay(rec('1819-queen-victoria')), '05-24');
  assert.equal(api.monthDay(rec('1776-declaration-of-independence')), '07-04');
});

test('monthDay leaves out dates before 1582 and imprecise dates', () => {
  assert.equal(api.monthDay(rec('1066-battle-of-hastings')), undefined);
  assert.equal(api.monthDay({ when: { precision: 'day', start: { year: 1500 }, display: '3 March 1500' } }), undefined);
  assert.equal(api.monthDay({ when: { precision: 'year', start: { year: 1900, iso: '1900-01-01' } } }), undefined);
  assert.equal(api.monthDay({ when: { precision: 'day', start: { year: 1900 }, display: 'Spring 1900' } }), undefined);
});

test('visitorNote drops process clauses and keeps what is uncertain about the history', () => {
  assert.equal(api.visitorNote(rec('1066-battle-of-hastings')), 'The exact field of battle is debated.');
  assert.equal(api.visitorNote({ reviewer_note: 'Drafted by the pipeline. Link to Wikipedia checked.' }), null);
  assert.equal(api.visitorNote({ reviewer_note: 'I used the 1086 survey; the date is approximate.' }), 'This record uses the 1086 survey; the date is approximate.');
});

test('visitorNote prefers the record\'s own visitor_note, even when empty', () => {
  assert.equal(api.visitorNote(rec('1086-domesday-book')), 'How complete the survey was is debated.');
  assert.equal(api.visitorNote({ visitor_note: '  ', reviewer_note: 'The date is approximate.' }), null);
});

test('linkIndex adds the other side of each link', () => {
  const index = api.linkIndex(api.published());
  assert.deepEqual(index.get('1086-domesday-book').find(x => x.id === '1066-battle-of-hastings'), { id: '1066-battle-of-hastings', type: 'caused_by' });
  assert.ok(!(index.get('1066-battle-of-hastings') || []).some(x => x.id === '1086-domesday-book'), 'a link the record lists itself is not repeated');
});

test('linkIndex links records named word for word in a summary', () => {
  const index = api.linkIndex(api.published());
  assert.ok(index.get('1776-declaration-of-independence').some(x => x.id === '1066-battle-of-hastings' && x.type === 'mentions'));
  assert.ok(index.get('1066-battle-of-hastings').some(x => x.id === '1776-declaration-of-independence' && x.type === 'mentioned_in'));
});

test('linkIndex skips generic titles such as "The voyage"', () => {
  const index = api.linkIndex(api.published());
  for (const [, links] of index) assert.ok(!links.some(x => x.id === '1500-the-voyage'));
  assert.ok(!index.has('1500-the-voyage'));
});

test('recordPayload strips internal fields and adds the visitor note, links and Wikipedia article', () => {
  const recs = api.published(), index = api.linkIndex(recs);
  const pub = api.recordPayload('1066-battle-of-hastings', { '1066-battle-of-hastings': { title: 'Battle of Hastings' } }, index);
  for (const k of ['changelog', 'author', 'parent_reconciliation', 'reviewer_note']) assert.ok(!(k in pub), `${k} is published`);
  assert.equal(pub.visitor_note, 'The exact field of battle is debated.');
  assert.deepEqual(pub.wiki, { title: 'Battle of Hastings' });
  assert.ok(pub.related.some(x => x.id === '1086-domesday-book' && x.type === 'caused'));
  assert.ok(pub.related.some(x => x.id === '1776-declaration-of-independence' && x.type === 'mentioned_in'));
});

test('recordPayload rejects unsafe ids, unknown ids and records that are not live', () => {
  const index = new Map();
  for (const id of ['../x', '..%2Fx', 'a/b', 'A-Upper', '', '1066-battle-of-hastings.json']) assert.equal(api.recordPayload(id, {}, index), null, id);
  assert.equal(api.recordPayload('9999-no-such-record', {}, index), null);
  assert.equal(api.recordPayload('1300-draft-stub', {}, index), null);
  assert.ok(api.recordPayload('-2560-great-pyramid-of-giza', {}, index));
});

test('recordPage escapes record text', () => {
  const pub = api.recordPayload('2000-script-title', {}, new Map());
  const html = recordPage(pub, new Map([[pub.id, pub.title]]));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;'));
});
