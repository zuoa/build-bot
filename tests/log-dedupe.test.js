import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogDedupKey, normalizeVisibleLogText } from '../src/shared/log-dedupe.js';

test('normalizeVisibleLogText removes zero-width and control noise from agent logs', () => {
  const noisy = '  [Claude 实施]\u200B 让我修改代码。\x00首先添加 Copy 图标导入。  ';

  assert.equal(
    normalizeVisibleLogText(noisy),
    '[Claude 实施] 让我修改代码。首先添加 Copy 图标导入。'
  );
});

test('buildLogDedupKey collapses cosmetic quote differences for duplicate detection', () => {
  const first = '[Claude 实施] 让我修改代码。首先添加 "Copy" 图标导入。 [Claude 实施] 调用工具: Read';
  const second = '[Claude 实施] 让我修改代码。首先添加 Copy 图标导入。 [Claude 实施] 调用工具: Read';

  assert.equal(buildLogDedupKey(first), buildLogDedupKey(second));
});
