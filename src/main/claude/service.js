import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const BUGFIX_TIMEOUT_MS = 30 * 60 * 1000;
const FEATURE_TIMEOUT_MS = 60 * 60 * 1000;
const MIN_CLAUDE_VERSION = process.env.CLAUDE_MIN_VERSION ?? '0.2.0';
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
export async function checkClaudeReady() {
    try {
        const { stdout } = await execFileAsync('claude', ['--version']);
        const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
        const version = versionMatch?.[1];
        if (!version) {
            throw new Error('无法识别 Claude Code 版本，请检查安装');
        }
        if (compareVersion(version, MIN_CLAUDE_VERSION) < 0) {
            throw new Error(`Claude Code 版本过低，请升级到 ${MIN_CLAUDE_VERSION}+`);
        }
    }
    catch {
        throw new Error('未检测到 Claude Code，请先安装');
    }
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('API Key 无效，请在设置页重新配置');
    }
}
function splitLines(chunk) {
    return chunk
        .split(/\r?\n/g)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);
}
export async function runClaudeTask(params) {
    const timeout = params.taskType === 'feature' ? FEATURE_TIMEOUT_MS : BUGFIX_TIMEOUT_MS;
    await new Promise((resolve, reject) => {
        const child = spawn('claude', ['--dangerously-skip-permissions', '-p', params.prompt], {
            cwd: params.cwd,
            env: process.env
        });
        const timer = setTimeout(() => {
            params.onLog({ level: 'error', text: 'AI 执行超时已自动终止，请查看日志' });
            child.kill('SIGKILL');
            reject(new Error('AI 执行超时已自动终止，请查看日志'));
        }, timeout);
        const onAbort = () => {
            child.kill('SIGTERM');
            clearTimeout(timer);
            reject(new Error('任务已取消'));
        };
        params.signal?.addEventListener('abort', onAbort, { once: true });
        child.stdout.on('data', (buffer) => {
            splitLines(buffer.toString('utf8')).forEach((line) => {
                params.onLog({
                    level: /thinking|analysis/i.test(line) ? 'thinking' : 'info',
                    text: line
                });
            });
        });
        child.stderr.on('data', (buffer) => {
            splitLines(buffer.toString('utf8')).forEach((line) => {
                params.onLog({ level: 'error', text: line });
            });
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                params.onLog({ level: 'success', text: 'Claude Code 执行完成' });
                resolve();
                return;
            }
            reject(new Error('Claude Code 执行异常，详见日志'));
        });
    });
}
