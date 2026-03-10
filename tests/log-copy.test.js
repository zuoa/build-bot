import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLogs, formatLogsForCopy } from '../src/renderer/utils/logUtils.ts';

/**
 * 模拟日志数据生成器
 */
function createLog(at, level, text) {
  return { at, level, text };
}

function createDiffLog(at, filePath, diff) {
  return { at, level: 'info', kind: 'diff', text: `文件 Diff: ${filePath}`, filePath, diff };
}

test('mergeLogs returns empty array for empty input', () => {
  assert.deepEqual(mergeLogs([]), []);
});

test('mergeLogs merges adjacent logs with same level and close timestamp', () => {
  const baseTime = Date.now();
  const logs = [
    createLog(baseTime, 'info', 'Line 1'),
    createLog(baseTime + 100, 'info', 'Line 2'),
    createLog(baseTime + 200, 'info', 'Line 3')
  ];

  const merged = mergeLogs(logs);

  // 三条日志应该被合并成一条
  assert.equal(merged.length, 1);
  assert.match(merged[0].text, /Line 1/);
  assert.match(merged[0].text, /Line 2/);
  assert.match(merged[0].text, /Line 3/);
});

test('mergeLogs does not merge logs with different levels', () => {
  const baseTime = Date.now();
  const logs = [
    createLog(baseTime, 'info', 'Info log'),
    createLog(baseTime + 100, 'error', 'Error log')
  ];

  const merged = mergeLogs(logs);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, 'Info log');
  assert.equal(merged[1].text, 'Error log');
});

test('mergeLogs does not merge logs with timestamps too far apart', () => {
  const baseTime = Date.now();
  const logs = [
    createLog(baseTime, 'info', 'Log 1'),
    createLog(baseTime + 2000, 'info', 'Log 2') // 2秒间隔，超过1200ms
  ];

  const merged = mergeLogs(logs);

  assert.equal(merged.length, 2);
});

test('mergeLogs preserves all logs without truncation', () => {
  // 创建 600 条日志（超过展示裁剪的 500 条）
  const baseTime = Date.now();
  const logs = [];
  for (let i = 0; i < 600; i++) {
    // 每条日志间隔足够大以防止合并
    logs.push(createLog(baseTime + i * 2000, 'info', `Log entry ${i}`));
  }

  const merged = mergeLogs(logs);

  // 确保所有 600 条日志都被保留（未裁剪）
  assert.equal(merged.length, 600);
  assert.equal(merged[0].text, 'Log entry 0');
  assert.equal(merged[599].text, 'Log entry 599');
});

test('mergeLogs handles multiline logs without merging', () => {
  const baseTime = Date.now();
  const logs = [
    createLog(baseTime, 'info', 'Single line'),
    createLog(baseTime + 100, 'info', 'Line 1\nLine 2') // 包含换行符
  ];

  const merged = mergeLogs(logs);

  // 包含换行符的日志不应该被合并
  assert.equal(merged.length, 2);
});

test('mergeLogs keeps diff logs as standalone entries', () => {
  const baseTime = Date.now();
  const logs = [
    createLog(baseTime, 'info', 'Start'),
    createDiffLog(baseTime + 100, 'src/app.ts', '@@ -1 +1 @@\n-old\n+new'),
    createLog(baseTime + 200, 'info', 'Done')
  ];

  const merged = mergeLogs(logs);

  assert.equal(merged.length, 3);
  assert.equal(merged[1].kind, 'diff');
  assert.equal(merged[1].filePath, 'src/app.ts');
});

test('formatLogsForCopy formats logs with timestamps', () => {
  const baseTime = new Date('2024-01-15T10:30:00').getTime();
  const merged = [
    { at: baseTime, level: 'info', text: 'Processing started' }
  ];

  const result = formatLogsForCopy(merged);

  assert.match(result, /10:30:00/);
  assert.match(result, /Processing started/);
  // info 级别不应该有标签
  assert.ok(!result.includes('[思考]'));
  assert.ok(!result.includes('[完成]'));
  assert.ok(!result.includes('[错误]'));
});

test('formatLogsForCopy includes level labels for non-info logs', () => {
  const baseTime = Date.now();
  const merged = [
    { at: baseTime, level: 'thinking', text: 'Analyzing code...' },
    { at: baseTime + 1000, level: 'success', text: 'Task completed' },
    { at: baseTime + 2000, level: 'error', text: 'Failed to process' }
  ];

  const result = formatLogsForCopy(merged);

  assert.ok(result.includes('[思考]'));
  assert.ok(result.includes('[完成]'));
  assert.ok(result.includes('[错误]'));
});

test('formatLogsForCopy separates logs with newlines', () => {
  const baseTime = Date.now();
  const merged = [
    { at: baseTime, level: 'info', text: 'First log' },
    { at: baseTime + 1000, level: 'info', text: 'Second log' }
  ];

  const result = formatLogsForCopy(merged);

  const lines = result.split('\n');
  assert.equal(lines.length, 2);
});

test('copy function output includes all logs (not truncated to 500)', () => {
  // 模拟展示层会裁剪到 500 条，但复制应该包含所有日志
  const baseTime = Date.now();
  const logs = [];
  for (let i = 0; i < 600; i++) {
    logs.push(createLog(baseTime + i * 2000, 'info', `Entry ${i}`));
  }

  const merged = mergeLogs(logs);
  const copyText = formatLogsForCopy(merged);

  // 验证复制文本包含所有 600 条日志
  const lines = copyText.split('\n');
  assert.equal(lines.length, 600);

  // 验证第一条和最后一条都存在
  assert.ok(copyText.includes('Entry 0'));
  assert.ok(copyText.includes('Entry 599'));
});

test('formatLogsForCopy includes diff payloads', () => {
  const baseTime = Date.now();
  const result = formatLogsForCopy([
    {
      at: baseTime,
      level: 'info',
      kind: 'diff',
      text: '文件 Diff: src/app.ts',
      filePath: 'src/app.ts',
      diff: '@@ -1 +1 @@\n-old\n+new'
    }
  ]);

  assert.ok(result.includes('[Diff] src/app.ts'));
  assert.ok(result.includes('+new'));
});
