import type { TaskEntity } from '../../shared/types';

export type MergedLog = { at: number; level: TaskEntity['logs'][number]['level']; text: string };

export function logLevelLabel(level: TaskEntity['logs'][number]['level']): string {
  switch (level) {
    case 'thinking':
      return '思考';
    case 'success':
      return '完成';
    case 'error':
      return '错误';
    default:
      return '';
  }
}

/**
 * 合并相邻的日志条目以减少输出体积
 * - 相同 level
 * - 时间间隔 <= 1200ms
 * - 文本长度适中
 * - 无换行符
 */
export function mergeLogs(logs: TaskEntity['logs']): MergedLog[] {
  const merged: MergedLog[] = [];
  logs.forEach((log) => {
    const text = log.text.trim();
    if (!text) return;
    const prev = merged[merged.length - 1];
    const canMerge =
      prev &&
      prev.level === log.level &&
      log.at - prev.at <= 1200 &&
      prev.text.length < 240 &&
      text.length < 180 &&
      !/\n/.test(prev.text) &&
      !/\n/.test(text);
    if (canMerge) {
      prev.text = `${prev.text} ${text}`.replace(/\s+/g, ' ').trim();
      prev.at = log.at;
      return;
    }
    merged.push({ at: log.at, level: log.level, text });
  });
  return merged;
}

/**
 * 将合并后的日志格式化为可复制的文本
 */
export function formatLogsForCopy(mergedLogs: MergedLog[]): string {
  return mergedLogs
    .map((log) => {
      const time = new Date(log.at).toLocaleTimeString();
      const level = log.level === 'info' ? '' : `[${logLevelLabel(log.level)}] `;
      return `${time} ${level}${log.text}`;
    })
    .join('\n');
}
