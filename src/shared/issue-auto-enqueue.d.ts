import type { IssueSummary, TaskType } from './types';
export declare const DEFAULT_AUTO_ENQUEUE_LABELS: string[];
export declare function inferTaskType(issue: IssueSummary): TaskType;
export declare function hasAutoEnqueueLabel(issue: IssueSummary, includeLabels?: string[]): boolean;
