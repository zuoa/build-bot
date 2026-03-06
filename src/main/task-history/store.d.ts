import type { TaskEntity } from '../../shared/types';
export declare function scheduleTaskHistoryPersist(tasks: TaskEntity[]): void;
export declare function loadTaskHistory(): Promise<TaskEntity[]>;
export declare function flushTaskHistorySync(): void;
