import { checkClaudeReady, getClaudeStatus, runClaudeTask } from '../claude/service';
import { checkCodexReady, getCodexStatus, runCodexTask } from '../codex/service';
export async function listAgentProviderStatuses() {
    const codexStatus = await getCodexStatus();
    const claudeStatus = await getClaudeStatus();
    return [claudeStatus, codexStatus];
}
export async function checkAgentReady(provider) {
    if (provider === 'codex') {
        await checkCodexReady();
        return;
    }
    await checkClaudeReady();
}
export async function runAgentTask(params) {
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
export function agentProviderLabel(provider) {
    return provider === 'codex' ? 'Codex' : 'Claude';
}
