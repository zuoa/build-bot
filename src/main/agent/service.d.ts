import type { AgentProvider, AgentProviderStatus, TaskType } from '../../shared/types';
import type { ClaudeLog } from '../claude/service';
import type { CodexLog } from '../codex/service';
export type AgentLog = ClaudeLog | CodexLog;
export interface AgentTaskResult {
    output: string;
    sessionId?: string;
}
export declare function listAgentProviderStatuses(): Promise<AgentProviderStatus[]>;
export declare function checkAgentReady(provider: AgentProvider): Promise<void>;
export declare function runAgentTask(params: {
    provider: AgentProvider;
    cwd: string;
    prompt: string;
    taskType: TaskType;
    onLog: (log: AgentLog) => void;
    signal?: AbortSignal;
    readOnly?: boolean;
    sessionId?: string;
}): Promise<AgentTaskResult>;
export declare function agentProviderLabel(provider: AgentProvider): string;
