// The shared definitions (shared/labels.mjs) agree with what the viewer and the pages use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELATION_LABELS, SCALE_START, REPO } from '../shared/labels.mjs';
import { LEVELS } from '../app/time.js';
import * as pages from '../pages.mjs';

test('every link type a record can carry has a label', () => {
  for (const t of ['caused', 'caused_by', 'part_of', 'has_part', 'related', 'same_place', 'same_person', 'contemporary', 'mentions', 'mentioned_in']) assert.ok(RELATION_LABELS[t], t);
});

test('the scales start where the shared table says, oldest first', () => {
  for (const [k, from] of Object.entries(SCALE_START)) assert.equal(LEVELS.find(l => l.key === k).from, from, k);
  const starts = LEVELS.slice(0, 6).map(l => l.from);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test('the pages use the shared repo name and capitalised link labels', () => {
  assert.equal(pages.REPO, REPO);
  const html = pages.recordPage({ id: 'x', title: 'X', when: {}, where: {}, related: [{ id: 'y', type: 'caused_by' }], sources: [] }, new Map([['y', 'Y']]));
  assert.ok(html.includes('<span>Caused by</span>'));
});
