import type { TaskEntity, TaskLog } from './types';
export declare function collectTaskProcessSteps(logs: TaskLog[]): string[];
export declare function buildTaskProcessComment(params: {
    task: TaskEntity;
    changedFiles: string[];
    diffSummary: string;
}): string;
