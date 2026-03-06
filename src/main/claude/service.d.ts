import type { AgentProviderStatus, TaskType } from '../../shared/types';
export interface ClaudeLog {
    level: 'info' | 'success' | 'error' | 'thinking';
    text: string;
}
export declare function checkClaudeReady(): Promise<void>;
export declare function getClaudeStatus(): Promise<AgentProviderStatus>;
export declare function runClaudeTask(params: {
    cwd: string;
    prompt: string;
    taskType: TaskType;
    onLog: (log: ClaudeLog) => void;
    signal?: AbortSignal;
}): Promise<void>;
