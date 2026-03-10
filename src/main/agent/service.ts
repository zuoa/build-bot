import type {
  AgentProvider,
  AgentProviderStatus,
  TaskType
} from '../../shared/types';
import type { ClaudeLog } from '../claude/service';
import { checkClaudeReady, getClaudeStatus, runClaudeTask } from '../claude/service';
import type { CodexLog } from '../codex/service';
import { checkCodexReady, getCodexStatus, runCodexTask } from '../codex/service';

export type AgentLog = ClaudeLog | CodexLog;

export interface AgentTaskResult {
  output: string;
  sessionId?: string;
}

export async function listAgentProviderStatuses(): Promise<AgentProviderStatus[]> {
  const codexStatus = await getCodexStatus();
  const claudeStatus = await getClaudeStatus();
  return [claudeStatus, codexStatus];
}

export async function checkAgentReady(provider: AgentProvider): Promise<void> {
  if (provider === 'codex') {
    await checkCodexReady();
    return;
  }

  await checkClaudeReady();
}

export async function runAgentTask(params: {
  provider: AgentProvider;
  cwd: string;
  prompt: string;
  taskType: TaskType;
  onLog: (log: AgentLog) => void;
  signal?: AbortSignal;
  readOnly?: boolean;
  sessionId?: string;
}): Promise<AgentTaskResult> {
  if (params.provider === 'codex') {
    return runCodexTask({
      cwd: params.cwd,
      prompt: params.prompt,
      taskType: params.taskType,
      onLog: params.onLog,
      signal: params.signal,
      readOnly: params.readOnly,
      sessionId: params.sessionId
    });
  }

  return runClaudeTask({
    cwd: params.cwd,
    prompt: params.prompt,
    taskType: params.taskType,
    signal: params.signal,
    onLog: params.onLog,
    sessionId: params.sessionId
  });
}

export function agentProviderLabel(provider: AgentProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude';
}
