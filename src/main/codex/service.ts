import { execFile, spawn } from 'node:child_process';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { AgentProviderStatus, TaskType } from '../../shared/types';

const execFileAsync = promisify(execFile);

const BUGFIX_TIMEOUT_MS = 30 * 60 * 1000;
const FEATURE_TIMEOUT_MS = 60 * 60 * 1000;
const HEARTBEAT_MS = 20_000;
const OUTPUT_IDLE_TIMEOUT_MS = 180_000;
const STARTUP_SILENCE_MS = 65_000;

export interface CodexLog {
  level: 'info' | 'success' | 'error' | 'thinking';
  text: string;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function normalizeLine(line: string): string | undefined {
  const normalized = stripAnsi(line).replace(/[\x00-\x1F\x7F]/g, '').trim();
  return normalized.length > 0 ? normalized : undefined;
}

function createLineDecoder(onLine: (line: string) => void): {
  push: (chunk: Buffer) => void;
  flush: () => void;
} {
  let remainder = '';

  return {
    push(chunk: Buffer) {
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

function pickStatusMessage(raw: string): string {
  const text = raw.toLowerCase();
  if (text.includes('logged in')) {
    return raw;
  }
  if (text.includes('not logged in')) {
    return raw;
  }
  return raw || '状态未知';
}

function parseJsonLine(line: string): CodexLog | undefined {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const type = typeof parsed.type === 'string' ? parsed.type : '';

    if (type === 'error' && typeof parsed.message === 'string') {
      return { level: 'error', text: parsed.message };
    }

    if (type === 'item.completed' && parsed.item && typeof parsed.item === 'object') {
      const item = parsed.item as Record<string, unknown>;
      if (typeof item.message === 'string') {
        return { level: item.type === 'error' ? 'error' : 'info', text: item.message };
      }
    }

    if (type === 'agent_message_delta' && typeof parsed.delta === 'string') {
      return { level: 'info', text: parsed.delta };
    }

    if (type === 'turn.started') {
      return { level: 'thinking', text: 'Codex 开始处理当前请求' };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

async function ensureOutputDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), 'buildbot-codex-output');
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function getCodexStatus(): Promise<AgentProviderStatus> {
  if (!(await commandExists('codex'))) {
    return {
      provider: 'codex',
      available: undefined,
      determined: false,
      detail: '无法可靠判断 Codex 状态'
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync('codex', ['login', 'status']);
    const detail = pickStatusMessage((stdout || stderr || '').trim());
    return {
      provider: 'codex',
      available: /logged in/i.test(detail),
      determined: true,
      detail
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      provider: 'codex',
      available: false,
      determined: true,
      detail: message || '未检测到 Codex 认证，请执行 codex login'
    };
  }
}

export async function checkCodexReady(): Promise<void> {
  if (!(await commandExists('codex'))) {
    throw new Error('未检测到 Codex CLI，请先安装');
  }

  try {
    const { stdout, stderr } = await execFileAsync('codex', ['login', 'status']);
    const detail = (stdout || stderr || '').trim();
    if (/logged in/i.test(detail)) {
      return;
    }
  } catch {
    // Fall through to the unified guidance below.
  }

  throw new Error('未检测到 Codex 登录，请先执行 codex login');
}

export async function runCodexTask(params: {
  cwd: string;
  prompt: string;
  taskType: TaskType;
  onLog: (log: CodexLog) => void;
  signal?: AbortSignal;
  readOnly?: boolean;
}): Promise<string> {
  const timeout = params.taskType === 'feature' ? FEATURE_TIMEOUT_MS : BUGFIX_TIMEOUT_MS;
  const outputDir = await ensureOutputDir();
  const outputFile = path.join(outputDir, `${randomUUID()}.txt`);
  const args = [
    'exec',
    '--json',
    '--color',
    'never',
    '--output-last-message',
    outputFile,
    '--sandbox',
    params.readOnly ? 'read-only' : 'workspace-write'
  ];

  if (!params.readOnly) {
    args.push('--full-auto');
  }

  args.push(params.prompt);

  await new Promise<void>((resolve, reject) => {
    const child = spawn('codex', args, {
      cwd: params.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    });

    if (!child.stdout || !child.stderr) {
      reject(new Error('Codex 进程输出通道不可用'));
      return;
    }

    let settled = false;
    let hasOutput = false;
    let lastOutputAt = Date.now();

    const clearAllTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(startupSilenceTimer);
      clearInterval(idleTimer);
      clearInterval(heartbeatTimer);
    };

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearAllTimers();
      params.signal?.removeEventListener('abort', handleAbort);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const touchOutput = () => {
      hasOutput = true;
      lastOutputAt = Date.now();
    };

    const heartbeatTimer = setInterval(() => {
      if (Date.now() - lastOutputAt < HEARTBEAT_MS) {
        return;
      }
      params.onLog({
        level: 'thinking',
        text: 'Codex 执行中，等待新的输出...'
      });
    }, HEARTBEAT_MS);

    const startupSilenceTimer = setTimeout(() => {
      if (hasOutput) {
        return;
      }
      child.kill('SIGKILL');
      finish(new Error('Codex 启动超过 65s 仍无任何输出'));
    }, STARTUP_SILENCE_MS);

    const idleTimer = setInterval(() => {
      if (Date.now() - lastOutputAt < OUTPUT_IDLE_TIMEOUT_MS) {
        return;
      }
      child.kill('SIGKILL');
      finish(new Error('Codex 超过 180s 没有任何新输出'));
    }, HEARTBEAT_MS);

    const timeoutTimer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Codex 执行超时已自动终止，请查看日志'));
    }, timeout);

    const handleAbort = () => {
      child.kill('SIGTERM');
      finish(new Error('任务已取消'));
    };

    params.signal?.addEventListener('abort', handleAbort, { once: true });

    const stdoutDecoder = createLineDecoder((line) => {
      touchOutput();
      const parsed = parseJsonLine(line);
      if (parsed) {
        params.onLog(parsed);
      }
    });

    const stderrDecoder = createLineDecoder((line) => {
      touchOutput();
      params.onLog({ level: 'error', text: line });
    });

    child.stdout.on('data', (chunk: Buffer) => stdoutDecoder.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrDecoder.push(chunk));
    child.on('error', (error) => {
      finish(new Error(`Codex 启动失败：${error.message}`));
    });
    child.on('close', (code) => {
      stdoutDecoder.flush();
      stderrDecoder.flush();
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error('Codex 执行异常，详见日志'));
    });
  });

  try {
    await access(outputFile);
    return (await readFile(outputFile, 'utf8')).trim();
  } finally {
    await rm(outputFile, { force: true });
  }
}
