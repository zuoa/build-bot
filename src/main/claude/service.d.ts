import type { AgentProviderStatus, TaskType } from '../../shared/types';
export interface ClaudeLog {
    level: 'info' | 'success' | 'error' | 'thinking';
    text: string;
}
export declare function checkClaudeReady(): Promise<void>;
export declare function getClaudeStatus(): Promise<AgentProviderStatus>;
export declare function buildClaudeArgs(params: {
    prompt: string;
    useStreamJson: boolean;
    leanStartup: boolean;
    sessionId: string;
    resumeSession: boolean;
}): string[];
export declare function runClaudeTask(params: {
    cwd: string;
    prompt: string;
    taskType: TaskType;
    onLog: (log: ClaudeLog) => void;
    signal?: AbortSignal;
    sessionId?: string;
}): Promise<{
    output: string;
    sessionId: string;
}>;
