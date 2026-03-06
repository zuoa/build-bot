import type { AgentProviderStatus, TaskType } from '../../shared/types';
export interface CodexLog {
    level: 'info' | 'success' | 'error' | 'thinking';
    text: string;
}
export declare function getCodexStatus(): Promise<AgentProviderStatus>;
export declare function checkCodexReady(): Promise<void>;
export declare function runCodexTask(params: {
    cwd: string;
    prompt: string;
    taskType: TaskType;
    onLog: (log: CodexLog) => void;
    signal?: AbortSignal;
    readOnly?: boolean;
}): Promise<string>;
