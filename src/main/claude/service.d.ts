import type { TaskType } from '../../shared/types';
export interface ClaudeLog {
    level: 'info' | 'success' | 'error' | 'thinking';
    text: string;
}
export declare function checkClaudeReady(apiKey?: string): Promise<void>;
export declare function runClaudeTask(params: {
    cwd: string;
    prompt: string;
    taskType: TaskType;
    apiKey?: string;
    onLog: (log: ClaudeLog) => void;
    signal?: AbortSignal;
}): Promise<void>;
