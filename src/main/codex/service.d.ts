import type { AgentProviderStatus, TaskType } from '../../shared/types';
export interface CodexLog {
    level: 'info' | 'success' | 'error' | 'thinking';
    text: string;
}
export declare function extractCodexSessionIdFromEvent(event: Record<string, unknown>): string | undefined;
export declare function buildCodexExecArgs(params: {
    outputFile: string;
    prompt: string;
    readOnly?: boolean;
    sessionId?: string;
}): string[];
export declare function getCodexStatus(): Promise<AgentProviderStatus>;
export declare function checkCodexReady(): Promise<void>;
export declare function runCodexTask(params: {
    cwd: string;
    prompt: string;
    taskType: TaskType;
    onLog: (log: CodexLog) => void;
    signal?: AbortSignal;
    readOnly?: boolean;
    sessionId?: string;
}): Promise<{
    output: string;
    sessionId?: string;
}>;
