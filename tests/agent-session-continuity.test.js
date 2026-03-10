import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodexExecArgs,
  extractCodexSessionIdFromEvent
} from '../src/main/codex/service.js';
import { buildClaudeArgs } from '../src/main/claude/service.js';

test('buildCodexExecArgs creates a new read-only session when no session id exists', () => {
  const args = buildCodexExecArgs({
    outputFile: '/tmp/codex-output.txt',
    prompt: 'review this diff',
    readOnly: true
  });

  assert.deepEqual(args, [
    'exec',
    '--json',
    '--color',
    'never',
    '--output-last-message',
    '/tmp/codex-output.txt',
    '--sandbox',
    'read-only',
    'review this diff'
  ]);
});

test('buildCodexExecArgs resumes an existing writable session', () => {
  const args = buildCodexExecArgs({
    outputFile: '/tmp/codex-output.txt',
    prompt: 'continue implementing',
    sessionId: '123e4567-e89b-12d3-a456-426614174000'
  });

  assert.deepEqual(args, [
    'exec',
    'resume',
    '--json',
    '--color',
    'never',
    '--output-last-message',
    '/tmp/codex-output.txt',
    '--full-auto',
    '123e4567-e89b-12d3-a456-426614174000',
    'continue implementing'
  ]);
});

test('extractCodexSessionIdFromEvent supports direct and nested thread ids', () => {
  assert.equal(
    extractCodexSessionIdFromEvent({
      type: 'thread.started',
      thread_id: '11111111-1111-1111-1111-111111111111'
    }),
    '11111111-1111-1111-1111-111111111111'
  );

  assert.equal(
    extractCodexSessionIdFromEvent({
      type: 'turn.started',
      thread: { id: '22222222-2222-2222-2222-222222222222' }
    }),
    '22222222-2222-2222-2222-222222222222'
  );
});

test('buildClaudeArgs creates a persistent new session id', () => {
  const args = buildClaudeArgs({
    prompt: 'implement fix',
    useStreamJson: true,
    leanStartup: true,
    sessionId: '33333333-3333-3333-3333-333333333333',
    resumeSession: false
  });

  assert.ok(args.includes('--session-id'));
  assert.ok(args.includes('33333333-3333-3333-3333-333333333333'));
  assert.ok(!args.includes('--resume'));
  assert.ok(!args.includes('--no-session-persistence'));
});

test('buildClaudeArgs resumes an existing session id', () => {
  const args = buildClaudeArgs({
    prompt: 'review current changes',
    useStreamJson: false,
    leanStartup: false,
    sessionId: '44444444-4444-4444-4444-444444444444',
    resumeSession: true
  });

  assert.ok(args.includes('--resume'));
  assert.ok(args.includes('44444444-4444-4444-4444-444444444444'));
  assert.ok(!args.includes('--session-id'));
});
