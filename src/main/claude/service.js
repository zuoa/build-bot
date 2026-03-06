import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const BUGFIX_TIMEOUT_MS = 30 * 60 * 1000;
const FEATURE_TIMEOUT_MS = 60 * 60 * 1000;
const MIN_CLAUDE_VERSION = process.env.CLAUDE_MIN_VERSION ?? '0.2.0';
const HEARTBEAT_MS = 20_000;
const STARTUP_SILENCE_MS = 65_000;
const STARTUP_SILENCE_ERROR = 'CLAUDE_STARTUP_SILENT_TIMEOUT';
const OUTPUT_IDLE_TIMEOUT_MS = 180_000;
const OUTPUT_IDLE_TIMEOUT_ERROR = 'CLAUDE_OUTPUT_IDLE_TIMEOUT';
const REPETITIVE_OUTPUT_LIMIT = 6;
const REPETITIVE_OUTPUT_ERROR = 'CLAUDE_REPETITIVE_OUTPUT_TIMEOUT';
const PTY_UNSUPPORTED_ERROR = 'CLAUDE_PTY_UNSUPPORTED';
let cachedCapabilities;
function compareVersion(a, b) {
    const pa = a.split('.').map((n) => Number(n));
    const pb = b.split('.').map((n) => Number(n));
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
        const va = pa[i] ?? 0;
        const vb = pb[i] ?? 0;
        if (va > vb)
            return 1;
        if (va < vb)
            return -1;
    }
    return 0;
}
export async function checkClaudeReady(apiKey) {
    let stdout;
    try {
        ({ stdout } = await execFileAsync('claude', ['--version']));
    }
    catch {
        throw new Error('未检测到 Claude Code，请先安装');
    }
    const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
    const version = versionMatch?.[1];
    if (!version) {
        throw new Error('无法识别 Claude Code 版本，请检查安装');
    }
    if (compareVersion(version, MIN_CLAUDE_VERSION) < 0) {
        throw new Error(`Claude Code 版本过低，请升级到 ${MIN_CLAUDE_VERSION}+`);
    }
    if (apiKey?.trim()) {
        return;
    }
    try {
        const { stdout: authStatus } = await execFileAsync('claude', ['auth', 'status', '--json']);
        const parsed = JSON.parse(authStatus);
        if (parsed.loggedIn === true) {
            return;
        }
    }
    catch {
        // Ignore parse/command errors and return a unified guidance message below.
    }
    throw new Error('未检测到 Claude 认证，请在设置页配置 API Key 或先执行 claude auth login');
}
async function getClaudeCapabilities() {
    if (cachedCapabilities) {
        return cachedCapabilities;
    }
    try {
        const { stdout } = await execFileAsync('claude', ['--help']);
        cachedCapabilities = {
            streamJsonOutput: stdout.includes('--output-format')
        };
    }
    catch {
        cachedCapabilities = { streamJsonOutput: false };
    }
    return cachedCapabilities;
}
function stripAnsi(text) {
    return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}
function normalizeLine(line) {
    const normalized = stripAnsi(line)
        .replace(/.\x08/g, '')
        .replace(/[\x00-\x1F\x7F]/g, '')
        .trim();
    return normalized.length > 0 ? normalized : undefined;
}
function normalizeProgressText(text) {
    return stripAnsi(text)
        .replace(/[`"'“”‘’]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}
function isSimilarProgressText(a, b) {
    if (!a || !b) {
        return false;
    }
    return a === b || a.includes(b) || b.includes(a);
}
function createLineDecoder(onLine) {
    let remainder = '';
    return {
        push(chunk) {
            remainder += chunk.toString('utf8');
            const segments = remainder.split(/\r?\n|\r/g);
            remainder = segments.pop() ?? '';
            segments.forEach((line) => {
                const normalized = normalizeLine(line);
                if (normalized) {
                    onLine(normalized);
                }
            });
        },
        flush() {
            const normalized = normalizeLine(remainder);
            if (normalized) {
                onLine(normalized);
            }
            remainder = '';
        }
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function pickString(value) {
    return typeof value === 'string' ? value : undefined;
}
function extractJsonCandidate(line) {
    const first = line.indexOf('{');
    const last = line.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
        return undefined;
    }
    return line.slice(first, last + 1);
}
function parseEventObject(line) {
    const candidate = extractJsonCandidate(line);
    if (!candidate) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(candidate);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function extractTextContent(event) {
    const parts = [];
    if (typeof event.text === 'string') {
        parts.push(event.text);
    }
    if (typeof event.result === 'string') {
        parts.push(event.result);
    }
    if (isRecord(event.delta) && typeof event.delta.text === 'string') {
        parts.push(event.delta.text);
    }
    if (isRecord(event.message) && Array.isArray(event.message.content)) {
        event.message.content.forEach((item) => {
            if (!isRecord(item)) {
                return;
            }
            if (typeof item.text === 'string') {
                parts.push(item.text);
            }
            if (typeof item.thinking === 'string') {
                parts.push(item.thinking);
            }
            if (item.type === 'tool_use') {
                const toolName = typeof item.name === 'string' ? item.name : 'unknown';
                parts.push(`调用工具: ${toolName}`);
            }
        });
    }
    const compact = parts.join('\n').trim();
    return compact.length > 0 ? compact : undefined;
}
function parseStreamEvent(line) {
    const parsed = parseEventObject(line);
    if (!parsed) {
        return { recognized: false };
    }
    const type = typeof parsed.type === 'string' ? parsed.type : undefined;
    const subtype = typeof parsed.subtype === 'string' ? parsed.subtype : undefined;
    if (type === 'system' && subtype === 'hook_started') {
        const hookName = pickString(parsed.hook_name) ?? 'startup';
        return {
            recognized: true,
            log: { level: 'thinking', text: `Claude 启动钩子执行中：${hookName}` }
        };
    }
    if (type === 'system' && subtype === 'init') {
        const model = typeof parsed.model === 'string' ? parsed.model : 'unknown';
        const apiKeySource = typeof parsed.apiKeySource === 'string' ? parsed.apiKeySource : 'unknown';
        const mcpServers = Array.isArray(parsed.mcp_servers) ? parsed.mcp_servers : [];
        const failedMcp = mcpServers.filter((item) => isRecord(item) && typeof item.status === 'string' && item.status === 'failed').length;
        return {
            recognized: true,
            log: {
                level: 'info',
                text: `Claude 会话已初始化（model=${model}, apiKeySource=${apiKeySource}, mcp_failed=${failedMcp}）`
            }
        };
    }
    if (type === 'system' && subtype === 'hook_response' && parsed.outcome === 'error') {
        const details = typeof parsed.stderr === 'string'
            ? parsed.stderr
            : typeof parsed.output === 'string'
                ? parsed.output
                : 'Claude 启动钩子执行失败';
        return { recognized: true, log: { level: 'error', text: details } };
    }
    if (type === 'error') {
        const message = typeof parsed.error === 'string'
            ? parsed.error
            : typeof parsed.message === 'string'
                ? parsed.message
                : 'Claude 返回错误';
        return { recognized: true, log: { level: 'error', text: message } };
    }
    const text = extractTextContent(parsed);
    if (!text) {
        // Known stream-json event without user-facing text should not leak raw JSON to UI.
        return { recognized: true };
    }
    return {
        recognized: true,
        log: {
            level: /thinking|analysis/i.test(text) ? 'thinking' : 'info',
            text
        }
    };
}
function buildClaudeArgs(params) {
    const args = ['--dangerously-skip-permissions', '-p'];
    if (params.useStreamJson) {
        args.push('--verbose', '--output-format', 'stream-json');
    }
    if (params.leanStartup) {
        args.push('--disable-slash-commands', '--strict-mcp-config', '--no-session-persistence', '--setting-sources', 'local');
    }
    args.push(params.prompt);
    return args;
}
function buildSpawnPlan(claudeArgs, usePty) {
    const canUseScript = process.platform === 'darwin' || process.platform === 'linux';
    if (!usePty || !canUseScript) {
        return { command: 'claude', args: claudeArgs, viaPty: false };
    }
    // Use a pseudo-tty wrapper to avoid no-TTY hangs in desktop app contexts.
    return {
        command: 'script',
        args: ['-q', '/dev/null', 'claude', ...claudeArgs],
        viaPty: true,
        // `script` fails with tcgetattr/ioctl when stdin is a socket/pipe from Electron.
        stdio: ['ignore', 'pipe', 'pipe']
    };
}
async function runClaudeTaskOnce(params, options) {
    const timeout = params.taskType === 'feature' ? FEATURE_TIMEOUT_MS : BUGFIX_TIMEOUT_MS;
    const claudeArgs = buildClaudeArgs({
        prompt: params.prompt,
        useStreamJson: options.useStreamJson,
        leanStartup: options.leanStartup
    });
    const spawnPlan = buildSpawnPlan(claudeArgs, options.usePty);
    await new Promise((resolve, reject) => {
        const child = spawn(spawnPlan.command, spawnPlan.args, {
            cwd: params.cwd,
            stdio: spawnPlan.stdio,
            env: params.apiKey?.trim()
                ? {
                    ...process.env,
                    ANTHROPIC_API_KEY: params.apiKey
                }
                : process.env
        });
        if (!child.stdout || !child.stderr) {
            reject(new Error('Claude 进程输出通道不可用'));
            return;
        }
        const startedAt = Date.now();
        let lastClaudeOutputAt = Date.now();
        let hasAnyOutput = false;
        let ptyUnsupported = false;
        let repeatedProgressCount = 0;
        let lastProgressText;
        params.onLog({
            level: 'thinking',
            text: options.useStreamJson
                ? options.leanStartup
                    ? `Claude Code 进程已启动（精简模式${spawnPlan.viaPty ? '，PTY' : ''}），等待实时事件...`
                    : `Claude Code 进程已启动（${spawnPlan.viaPty ? 'PTY' : '无 PTY'}），等待实时事件...`
                : `Claude Code 进程已启动（${spawnPlan.viaPty ? 'PTY' : '无 PTY'}），等待输出...`
        });
        const touchOutput = () => {
            hasAnyOutput = true;
            lastClaudeOutputAt = Date.now();
        };
        const detectRepetitiveOutput = (text) => {
            const normalized = normalizeProgressText(text);
            if (!normalized || normalized.length < 8) {
                return false;
            }
            if (lastProgressText && isSimilarProgressText(lastProgressText, normalized)) {
                repeatedProgressCount += 1;
            }
            else {
                lastProgressText = normalized;
                repeatedProgressCount = 1;
            }
            if (repeatedProgressCount < REPETITIVE_OUTPUT_LIMIT) {
                return false;
            }
            params.onLog({
                level: 'error',
                text: 'Claude 连续输出重复内容且没有继续推进，已判定为卡住并终止本次执行'
            });
            child.kill('SIGKILL');
            reject(new Error(REPETITIVE_OUTPUT_ERROR));
            return true;
        };
        const heartbeatTimer = setInterval(() => {
            if (Date.now() - lastClaudeOutputAt < HEARTBEAT_MS) {
                return;
            }
            const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
            params.onLog({
                level: 'thinking',
                text: `Claude Code 执行中（已运行 ${elapsedSec}s），仍在等待新输出...`
            });
        }, HEARTBEAT_MS);
        const startupSilenceTimer = setTimeout(() => {
            if (hasAnyOutput) {
                return;
            }
            params.onLog({
                level: 'error',
                text: 'Claude 启动超过 65s 仍无任何输出，正在终止本次执行'
            });
            child.kill('SIGKILL');
            reject(new Error(STARTUP_SILENCE_ERROR));
        }, STARTUP_SILENCE_MS);
        const idleOutputTimer = setInterval(() => {
            if (Date.now() - lastClaudeOutputAt < OUTPUT_IDLE_TIMEOUT_MS) {
                return;
            }
            params.onLog({
                level: 'error',
                text: 'Claude 超过 180s 没有任何新输出，已判定为卡住并终止本次执行'
            });
            child.kill('SIGKILL');
            reject(new Error(OUTPUT_IDLE_TIMEOUT_ERROR));
        }, HEARTBEAT_MS);
        const timer = setTimeout(() => {
            params.onLog({ level: 'error', text: 'AI 执行超时已自动终止，请查看日志' });
            child.kill('SIGKILL');
            reject(new Error('AI 执行超时已自动终止，请查看日志'));
        }, timeout);
        const clearAllTimers = () => {
            clearTimeout(timer);
            clearTimeout(startupSilenceTimer);
            clearInterval(idleOutputTimer);
            clearInterval(heartbeatTimer);
        };
        const onAbort = () => {
            child.kill('SIGTERM');
            clearAllTimers();
            reject(new Error('任务已取消'));
        };
        params.signal?.addEventListener('abort', onAbort, { once: true });
        const stdoutDecoder = createLineDecoder((line) => {
            if (options.useStreamJson) {
                const parsed = parseStreamEvent(line);
                if (parsed.recognized) {
                    if (parsed.log) {
                        touchOutput();
                        if (detectRepetitiveOutput(parsed.log.text)) {
                            return;
                        }
                        params.onLog(parsed.log);
                    }
                    return;
                }
            }
            touchOutput();
            if (detectRepetitiveOutput(line)) {
                return;
            }
            params.onLog({
                level: /thinking|analysis/i.test(line) ? 'thinking' : 'info',
                text: line
            });
        });
        const stderrDecoder = createLineDecoder((line) => {
            if (spawnPlan.viaPty &&
                /tcgetattr\/ioctl:\s*operation not supported on socket/i.test(line)) {
                ptyUnsupported = true;
                child.kill('SIGKILL');
                return;
            }
            touchOutput();
            if (detectRepetitiveOutput(line)) {
                return;
            }
            params.onLog({ level: 'error', text: line });
        });
        child.stdout.on('data', (buffer) => {
            stdoutDecoder.push(buffer);
        });
        child.stderr.on('data', (buffer) => {
            stderrDecoder.push(buffer);
        });
        child.on('error', (error) => {
            clearAllTimers();
            reject(error);
        });
        child.on('close', (code) => {
            stdoutDecoder.flush();
            stderrDecoder.flush();
            clearAllTimers();
            if (ptyUnsupported) {
                reject(new Error(PTY_UNSUPPORTED_ERROR));
                return;
            }
            if (code === 0) {
                params.onLog({ level: 'success', text: 'Claude Code 执行完成' });
                resolve();
                return;
            }
            reject(new Error('Claude Code 执行异常，详见日志'));
        });
    });
}
export async function runClaudeTask(params) {
    const capabilities = await getClaudeCapabilities();
    const useStreamJson = capabilities.streamJsonOutput;
    const forcePty = process.env.BUILDBOT_CLAUDE_FORCE_PTY === '1';
    const disablePty = process.env.BUILDBOT_CLAUDE_DISABLE_PTY === '1';
    const defaultUsePty = forcePty || !disablePty;
    const runWithPtyFallback = async (leanStartup) => {
        try {
            await runClaudeTaskOnce(params, { useStreamJson, leanStartup, usePty: defaultUsePty });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message !== PTY_UNSUPPORTED_ERROR) {
                throw error;
            }
            params.onLog({
                level: 'thinking',
                text: '检测到当前环境不支持 PTY，自动切换为普通模式重试...'
            });
            await runClaudeTaskOnce(params, {
                useStreamJson,
                leanStartup,
                usePty: false
            });
        }
    };
    try {
        await runWithPtyFallback(false);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== STARTUP_SILENCE_ERROR &&
            message !== OUTPUT_IDLE_TIMEOUT_ERROR &&
            message !== REPETITIVE_OUTPUT_ERROR) {
            throw error;
        }
        params.onLog({
            level: 'thinking',
            text: message === STARTUP_SILENCE_ERROR
                ? 'Claude 启动超过 65s 无输出，正在切换精简模式并重试...'
                : message === OUTPUT_IDLE_TIMEOUT_ERROR
                    ? 'Claude 长时间无新输出，正在切换精简模式并重试...'
                    : 'Claude 陷入重复输出循环，正在切换精简模式并重试...'
        });
        try {
            await runWithPtyFallback(true);
            return;
        }
        catch (retryError) {
            const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
            if (retryMessage === STARTUP_SILENCE_ERROR ||
                retryMessage === OUTPUT_IDLE_TIMEOUT_ERROR ||
                retryMessage === REPETITIVE_OUTPUT_ERROR) {
                throw new Error('Claude 执行卡住且重试后仍未恢复，请检查 Claude CLI 配置/网络，或在设置页改用 API Key 后重试');
            }
            throw retryError;
        }
    }
}
