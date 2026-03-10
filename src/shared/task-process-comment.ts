import type { TaskEntity, TaskLog } from './types';

const RUNTIME_NOISE_PATTERNS = [
  /^Claude Code 进程已启动/,
  /^Claude Code 执行完成$/,
  /^Claude Code 执行中（已运行/,
  /^Claude 启动超过 65s 无输出/,
  /^Claude 长时间无新输出/,
  /^Claude 陷入重复输出循环/,
  /^检测到当前环境不支持 PTY/,
  /^Codex 开始处理当前请求$/,
  /^Codex 执行中，等待新的输出\.\.\.$/
];

const AGENT_DETAIL_PREFIX = /^\[(?:Claude|Codex)\s+(?:实施|Review|修复)(?:\s+R\d+)?\]/;
const MAX_VISIBLE_STEPS = 12;

function isRuntimeNoise(text: string): boolean {
  return RUNTIME_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function normalizeStepText(log: TaskLog): string | undefined {
  if (log.kind === 'diff') {
    return undefined;
  }

  if (log.level === 'thinking') {
    return undefined;
  }

  const normalized = log.text.trim();
  if (!normalized || isRuntimeNoise(normalized)) {
    return undefined;
  }

  if (
    normalized.startsWith('Git clone:') ||
    normalized.startsWith('写入任务修改过程评论') ||
    AGENT_DETAIL_PREFIX.test(normalized)
  ) {
    return undefined;
  }

  if (normalized.startsWith('Review Agent 要求返工：')) {
    return 'Review Agent 给出返工意见，已进入修复';
  }

  if (/\r?\n/.test(normalized)) {
    return normalized.split(/\r?\n/, 1)[0]?.trim() || undefined;
  }

  return normalized;
}

function compactSteps(steps: string[]): string[] {
  if (steps.length <= MAX_VISIBLE_STEPS) {
    return steps;
  }

  return [
    ...steps.slice(0, 4),
    '中间若干重复执行日志已省略',
    ...steps.slice(-(MAX_VISIBLE_STEPS - 5))
  ];
}

function buildResultLines(task: TaskEntity): string[] {
  const lines: string[] = [];

  if (task.result?.commitSha) {
    lines.push(`- Commit: \`${task.result.commitSha.slice(0, 7)}\``);
  }

  if (task.result?.prUrl && task.result.prNumber) {
    lines.push(`- PR: [#${task.result.prNumber}](${task.result.prUrl})`);
  } else if (task.result?.branchUrl && task.branchName) {
    lines.push(`- 分支: [\`${task.branchName}\`](${task.result.branchUrl})`);
  }

  return lines;
}

export function collectTaskProcessSteps(logs: TaskLog[]): string[] {
  const steps: string[] = [];
  const seen = new Set<string>();

  for (const log of logs) {
    const step = normalizeStepText(log);
    if (!step || seen.has(step)) {
      continue;
    }
    seen.add(step);
    steps.push(step);
  }

  return compactSteps(steps);
}

export function buildTaskProcessComment(params: {
  task: TaskEntity;
  changedFiles: string[];
  diffSummary: string;
}): string {
  const steps = collectTaskProcessSteps(params.task.logs);
  const resultLines = buildResultLines(params.task);

  return [
    '<!-- buildbot-task-process -->',
    'BuildBot 已完成本次 Issue 任务，修改过程如下：',
    '',
    ...(steps.length > 0
      ? steps.map((step, index) => `${index + 1}. ${step}`)
      : ['1. 已完成代码修改与提交流程']),
    '',
    '**变更文件**',
    ...(params.changedFiles.length > 0
      ? params.changedFiles.map((file) => `- \`${file}\``)
      : ['- 无']),
    '',
    '**变更统计**',
    params.diffSummary || '- 变更统计不可用',
    '',
    '**交付结果**',
    ...(resultLines.length > 0 ? resultLines : ['- 已完成提交'])
  ].join('\n');
}
