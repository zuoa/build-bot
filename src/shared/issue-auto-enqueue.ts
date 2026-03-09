import type { IssueSummary, TaskType } from './types';

export const DEFAULT_AUTO_ENQUEUE_LABELS = ['bug', 'enhancement', 'documentation'];

export function inferTaskType(issue: IssueSummary): TaskType {
  const labelText = issue.labels.map((item) => item.name).join(' ');
  const source = `${issue.title} ${labelText}`.toLowerCase();
  const bugHint = /(bug|fix|error|defect|crash|regression|故障|报错|修复|异常|崩溃)/;
  return bugHint.test(source) ? 'bugfix' : 'feature';
}

export function hasAutoEnqueueLabel(
  issue: IssueSummary,
  includeLabels: string[] = DEFAULT_AUTO_ENQUEUE_LABELS
): boolean {
  const allowed = new Set(includeLabels.map((label) => label.trim().toLowerCase()).filter(Boolean));
  return issue.labels.some((label) => allowed.has(label.name.trim().toLowerCase()));
}
