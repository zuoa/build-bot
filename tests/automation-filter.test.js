import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AUTO_ENQUEUE_LABELS,
  hasAutoEnqueueLabel,
  inferTaskType
} from '../src/shared/issue-auto-enqueue.js';

function createIssue(labels, title = 'Issue title') {
  return {
    id: 1,
    number: 1,
    title,
    state: 'open',
    updatedAt: '2026-03-07T00:00:00.000Z',
    labels: labels.map((name, index) => ({
      id: index + 1,
      name,
      color: 'ededed'
    })),
    author: 'tester'
  };
}

test('hasAutoEnqueueLabel accepts the default auto-enqueue labels', () => {
  assert.deepEqual(DEFAULT_AUTO_ENQUEUE_LABELS, ['bug', 'enhancement', 'documentation']);
  assert.equal(hasAutoEnqueueLabel(createIssue(['bug'])), true);
  assert.equal(hasAutoEnqueueLabel(createIssue(['enhancement'])), true);
  assert.equal(hasAutoEnqueueLabel(createIssue(['documentation'])), true);
  assert.equal(hasAutoEnqueueLabel(createIssue(['Bug'])), true);
  assert.equal(hasAutoEnqueueLabel(createIssue(['question'])), false);
  assert.equal(hasAutoEnqueueLabel(createIssue(['documentation', 'help wanted'])), true);
});

test('hasAutoEnqueueLabel respects custom configured labels', () => {
  assert.equal(hasAutoEnqueueLabel(createIssue(['question']), ['question', 'help wanted']), true);
  assert.equal(hasAutoEnqueueLabel(createIssue(['enhancement']), ['question']), false);
  assert.equal(hasAutoEnqueueLabel(createIssue(['Help Wanted']), ['help wanted']), true);
});

test('inferTaskType still distinguishes bugfix from feature', () => {
  assert.equal(inferTaskType(createIssue(['enhancement'], 'Add dark mode')), 'feature');
  assert.equal(inferTaskType(createIssue(['bug'], 'Fix crash on startup')), 'bugfix');
});
