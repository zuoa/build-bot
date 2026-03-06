import type { ConfirmCommitInput, EnqueueTaskInput, IssueDetail, TaskEntity } from '../../shared/types';
type TaskListener = (task: TaskEntity) => void;
export declare class TaskManager {
    private readonly onTaskUpdate;
    private queue;
    private processing;
    private runtime;
    constructor(onTaskUpdate: TaskListener);
    enqueue(input: EnqueueTaskInput, issue: IssueDetail): TaskEntity;
    confirmCommit(input: ConfirmCommitInput): Promise<TaskEntity>;
    cancelTask(taskId: string): Promise<void>;
    private kick;
    private processLoop;
    private emitTask;
    private appendLog;
    private executeTask;
    private buildPrompt;
}
export declare function initTaskManager(onTaskUpdate: TaskListener): TaskManager;
export declare function getTaskManager(): TaskManager;
export declare function assertRepoMatch(repoFullName: string): void;
export {};
