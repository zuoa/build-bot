import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAutoModeLabel, normalizeAutoModeLabel } from '../src/shared/auto-mode-labels.js';

test('appendAutoModeLabel preserves labels containing commas', () => {
  assert.deepEqual(appendAutoModeLabel([], 'priority: p1, backend'), ['priority: p1, backend']);
});

test('appendAutoModeLabel deduplicates normalized labels', () => {
  assert.deepEqual(appendAutoModeLabel(['Bug'], ' bug '), ['Bug']);
});

test('normalizeAutoModeLabel trims and lowercases labels', () => {
  assert.equal(normalizeAutoModeLabel(' Help Wanted '), 'help wanted');
});
