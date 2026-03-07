import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskProcessComment,
  collectTaskProcessSteps
} from '../src/shared/task-process-comment.js';

test('collectTaskProcessSteps filters agent noise and keeps review milestones', () => {
  const steps = collectTaskProcessSteps([
    { at: 1, level: 'info', text: '开始执行 Issue 安全检查' },
    { at: 2, level: 'thinking', text: 'Git clone: receiving objects 10%' },
    { at: 3, level: 'info', text: '[Claude 实施] 已读取 README' },
    { at: 4, level: 'error', text: 'Review Agent 要求返工：\n- 缺少测试' },
    { at: 5, level: 'info', text: '开始第 1 次返工，由 Code Agent 修复 Review Agent 提出的必须修改项' },
    { at: 6, level: 'success', text: 'PR 创建成功: #12' }
  ]);

  assert.deepEqual(steps, [
    '开始执行 Issue 安全检查',
    'Review Agent 给出返工意见，已进入修复',
    '开始第 1 次返工，由 Code Agent 修复 Review Agent 提出的必须修改项',
    'PR 创建成功: #12'
  ]);
});

test('buildTaskProcessComment includes files, diff summary and delivery result', () => {
  const comment = buildTaskProcessComment({
    task: {
      id: 'task-1',
      repoFullName: 'acme/demo',
      issueNumber: 23,
      issueTitle: '修复任务',
      taskType: 'bugfix',
      status: 'completed',
      branchName: 'buildbot/issue-23',
      logs: [
        { at: 1, level: 'info', text: '开始执行 Issue 安全检查' },
        { at: 2, level: 'info', text: '开始准备任务分支' },
        { at: 3, level: 'success', text: 'PR 创建成功: #88' }
      ],
      changedFiles: [],
      result: {
        submissionMode: 'pr',
        prUrl: 'https://github.com/acme/demo/pull/88',
        prNumber: 88,
        commitSha: 'abcdef1234567890'
      }
    },
    changedFiles: ['src/main/queue/task-manager.ts', 'tests/task-process-comment.test.js'],
    diffSummary:
      '- `src/main/queue/task-manager.ts`: +28/-1 行\n- `tests/task-process-comment.test.js`: 新增文件'
  });

  assert.match(comment, /BuildBot 已完成本次 Issue 任务/);
  assert.match(comment, /1\. 开始执行 Issue 安全检查/);
  assert.match(comment, /2\. 开始准备任务分支/);
  assert.match(comment, /3\. PR 创建成功: #88/);
  assert.match(comment, /- `src\/main\/queue\/task-manager\.ts`/);
  assert.match(comment, /\*\*变更统计\*\*/);
  assert.match(comment, /Commit: `abcdef1`/);
  assert.match(comment, /PR: \[#88\]\(https:\/\/github\.com\/acme\/demo\/pull\/88\)/);
});
