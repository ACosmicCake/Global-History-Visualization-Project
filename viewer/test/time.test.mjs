// Unit tests for the viewer's time model (app/time.js): year formatting, scales, the time window and the filters.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../app/state.js';
import * as time from '../app/time.js';

const fresh = { level: 4, t: -500, whole: false, autoWhole: false, alt: 2.4, pins: [], off: new Set(), impOff: new Set(), paleoMa: null };
beforeEach(() => Object.assign(state, structuredClone({ ...fresh, off: [], impOff: [] }), { off: new Set(), impOff: new Set() }));

test('fmtYear: deep time in Ga, Ma and ka', () => {
  assert.equal(time.fmtYear(-4.54e9), '4.54 billion years ago');
  assert.equal(time.fmtYear(-4.54e9, true), '4.54 Ga');
  assert.equal(time.fmtYear(-6.6e7), '66.0 million years ago');
  assert.equal(time.fmtYear(-2.5e8, true), '250 Ma');
  assert.equal(time.fmtYear(-70000, true), '70 ka');
  assert.equal(time.fmtYear(-70000), '70,000 years ago');
});

test('fmtYear: astronomical years become BCE, one off (year 0 is 1 BCE)', () => {
  assert.equal(time.fmtYear(0), '1 BCE');
  assert.equal(time.fmtYear(-499), '500 BCE');
  assert.equal(time.fmtYear(-500), '501 BCE');
  assert.equal(time.fmtYear(-324), '325 BCE');
  assert.equal(time.fmtYear(-324.7), '326 BCE');   // inside astronomical year -325
  assert.equal(time.fmtYear(1945.5), '1945 CE');
  assert.equal(time.fmtYear(null), '');
});

test('fmtYear: the One year scale shows a day', () => {
  state.level = 6;
  assert.equal(time.fmtYear(1945.5), '2 July 1945');
  assert.equal(time.fmtYear(1945.5, true), '1945 CE');
});

test('fmtSpan', () => {
  assert.equal(time.fmtSpan(19e6), '19 million years');
  assert.equal(time.fmtSpan(303), '303 years');
  assert.equal(time.fmtSpan(1234), '1,200 years');
});

test('range: each scale runs to today; One year is the year of the date', () => {
  assert.deepEqual(time.range(0), { from: -4.54e9, to: time.NOW });
  assert.deepEqual(time.range(5), { from: 1500, to: time.NOW });
  state.t = 1945.4;
  assert.deepEqual(time.range(6), { from: 1945, to: 1946 });
});

test('windowNow: narrows toward the present, never past 3.5% of the scale', () => {
  state.level = 4; state.t = -500;
  const w = time.windowNow(), half = (w.to - w.from) / 2;
  assert.ok(Math.abs(half - (time.NOW + 500) * 0.12) < 1e-9);
  state.t = 1945;
  assert.ok(Math.abs((time.windowNow().to - time.windowNow().from) / 2 - Math.max(8, (time.NOW - 1945) * 0.12)) < 1e-9);
  state.level = 0; state.t = -2.5e9;
  const deep = time.windowNow();
  assert.ok(Math.abs((deep.to - deep.from) / 2 - (time.NOW + 4.54e9) * 0.035) < 1);
});

test('windowNow: Whole period opens the window to the scale', () => {
  state.whole = true; state.level = 5;
  assert.deepEqual(time.windowNow(), { from: 1500, to: time.NOW });
});

test('scaleIndex: modern records of note also show on Civilization; nothing is kept to One year', () => {
  assert.equal(time.scaleIndex({ scale: 'modern', importance: 3, until: 1900 }), 5);
  assert.equal(time.scaleIndex({ scale: 'modern', importance: 4, until: 1900 }), 4);
  assert.equal(time.scaleIndex({ scale: 'event', importance: 1, until: 1900 }), 5);
  assert.equal(time.scaleIndex({ scale: 'modern', importance: 1, until: 1400 }), 4);   // before 1500: not on Modern
  assert.equal(time.scaleIndex({ scale: 'civilization', importance: 1, until: -2e5 }), 3);
});

test('domainOn: off when every domain is off, or its importance level is', () => {
  const p = { domains: ['wars_conflict', 'people'], importance: 3 };
  assert.equal(time.domainOn(p), true);
  state.off.add('wars_conflict');
  assert.equal(time.domainOn(p), true);
  state.off.add('people');
  assert.equal(time.domainOn(p), false);
  state.off.clear(); state.impOff.add(3);
  assert.equal(time.domainOn(p), false);
});

test('minImportance thins a whole period from afar, never past the filters', () => {
  assert.equal(time.minImportance(), 1);
  state.whole = true; state.alt = 2.4;
  assert.equal(time.minImportance(), 4);
  state.alt = 0.5;
  assert.equal(time.minImportance(), 1);
  state.alt = 2.4; state.impOff.add(5); state.impOff.add(4);
  assert.equal(time.minImportance(), 3);
});

test('checkToday opens a thin present out to the whole period', () => {
  state.t = time.NOW; state.level = 5;
  time.checkToday();
  assert.equal(state.autoWhole, true);
  state.t = 1900;
  time.checkToday();
  assert.equal(state.autoWhole, false);
});
