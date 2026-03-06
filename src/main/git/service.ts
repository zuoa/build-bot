import { spawn } from 'node:child_process';
import { mkdir, rm, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { TaskType } from '../../shared/types';
import type { ForkContext, RepoBranchContext } from '../github/service';

const BASE_WORKSPACE = path.join(os.homedir(), 'gitagent-workspace');
const MIN_REQUIRED_BYTES = 200 * 1024 * 1024;
const WORKSPACE_RM_RETRIES = 8;
const WORKSPACE_RM_RETRY_DELAY_MS = 250;
const CLONE_TIMEOUT_MS = Number(process.env.GIT_CLONE_TIMEOUT_MS ?? 10 * 60 * 1000);

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function sanitizeGitMessage(text: string): string {
  return text.replace(/https:\/\/x-access-token:[^@\s]+@github\.com\//gi, 'https://github.com/');
}

function sanitizeFolderName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function assertDiskAvailable(): Promise<void> {
  await mkdir(BASE_WORKSPACE, { recursive: true });
  const fsStats = await statfs(BASE_WORKSPACE);
  const freeBytes = fsStats.bavail * fsStats.bsize;
  if (freeBytes < MIN_REQUIRED_BYTES) {
    throw new Error('磁盘空间不足，已自动清理旧任务文件');
  }
}

function buildAuthedCloneUrl(context: ForkContext): string {
  const encodedToken = encodeURIComponent(context.token);
  return `https://x-access-token:${encodedToken}@github.com/${context.fork.owner}/${context.fork.repo}.git`;
}

function buildAuthedRepoCloneUrl(context: RepoBranchContext): string {
  const encodedToken = encodeURIComponent(context.token);
  return `https://x-access-token:${encodedToken}@github.com/${context.owner}/${context.repo}.git`;
}

async function removeWorkspaceDir(workspacePath: string): Promise<void> {
  await rm(workspacePath, {
    recursive: true,
    force: true,
    maxRetries: WORKSPACE_RM_RETRIES,
    retryDelay: WORKSPACE_RM_RETRY_DELAY_MS
  });
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
        const normalized = sanitizeGitMessage(stripAnsi(line)).trim();
        if (normalized) {
          onLine(normalized);
        }
      });
    },
    flush() {
      const normalized = sanitizeGitMessage(stripAnsi(remainder)).trim();
      if (normalized) {
        onLine(normalized);
      }
      remainder = '';
    }
  };
}

function summarizeCloneFailure(output: string[]): string {
  const combined = output.join('\n').toLowerCase();
  if (
    combined.includes('authentication failed') ||
    combined.includes('could not read username') ||
    combined.includes('fatal: repository') ||
    combined.includes('permission denied')
  ) {
    return '克隆仓库失败：GitHub Token 无效、权限不足，或 Fork 仓库尚未就绪';
  }

  if (combined.includes("remote branch") && combined.includes('not found')) {
    return '克隆仓库失败：远端分支尚未同步完成，请稍后重试';
  }

  const lastLine = output[output.length - 1];
  if (lastLine) {
    return `克隆仓库失败：${lastLine}`;
  }

  return '克隆仓库失败，请检查网络、Git 配置或仓库访问权限';
}

async function runGitClone(params: {
  cloneUrl: string;
  workspacePath: string;
  branchName: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<void> {
  const args = [
    'clone',
    '--branch',
    params.branchName,
    '--single-branch',
    '--depth',
    '1',
    '--progress',
    params.cloneUrl,
    params.workspacePath
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, {
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const output: string[] = [];
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      params.signal?.removeEventListener('abort', handleAbort);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const handleAbort = () => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 2_000);
      finish(new Error('任务已取消'));
    };

    const decoder = createLineDecoder((line) => {
      output.push(line);
      params.onProgress?.(line);
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, 2_000);
      finish(new Error('克隆仓库超时，请检查网络、仓库大小或 GitHub 访问权限'));
    }, CLONE_TIMEOUT_MS);

    params.signal?.addEventListener('abort', handleAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      decoder.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      decoder.push(chunk);
    });
    child.on('error', (error) => {
      finish(new Error(`执行 git clone 失败：${sanitizeGitMessage(error.message)}`));
    });
    child.on('close', (code) => {
      decoder.flush();
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(summarizeCloneFailure(output)));
    });
  });
}

export async function cloneBranchWorkspace(params: {
  context: ForkContext | RepoBranchContext;
  branchName: string;
  issueNumber: number;
  taskId: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<string> {
  await assertDiskAvailable();

  const taskSuffix = sanitizeFolderName(params.taskId).slice(0, 8) || `${Date.now()}`;
  const repoName = 'fork' in params.context ? params.context.fork.repo : params.context.repo;
  const workspaceName = `${sanitizeFolderName(repoName)}-${params.issueNumber}-${taskSuffix}`;
  const workspacePath = path.join(BASE_WORKSPACE, workspaceName);

  await removeWorkspaceDir(workspacePath);
  await runGitClone({
    cloneUrl:
      'fork' in params.context
        ? buildAuthedCloneUrl(params.context)
        : buildAuthedRepoCloneUrl(params.context),
    workspacePath,
    branchName: params.branchName,
    signal: params.signal,
    onProgress: params.onProgress
  });

  return workspacePath;
}

export async function listChangedFiles(workspacePath: string): Promise<string[]> {
  const git = simpleGit(workspacePath);
  const status = await git.status();

  const files = new Set<string>([
    ...status.not_added,
    ...status.created,
    ...status.deleted,
    ...status.modified,
    ...status.staged,
    ...status.renamed.map((item) => item.to)
  ]);

  return Array.from(files).sort((a, b) => a.localeCompare(b));
}

export async function getFileDiffSummary(
  workspacePath: string,
  files: string[]
): Promise<string> {
  if (files.length === 0) {
    return '无文件变更';
  }

  const git = simpleGit(workspacePath);
  const summaries: string[] = [];

  for (const file of files) {
    try {
      const status = await git.status([file]);
      const isDeleted = status.deleted.includes(file);
      const isNew = status.not_added.includes(file) || status.created.includes(file);

      if (isDeleted) {
        summaries.push(`- \`${file}\`: 删除文件`);
        continue;
      }

      if (isNew) {
        summaries.push(`- \`${file}\`: 新增文件`);
        continue;
      }

      const diff = await git.diff(['--stat', file]);
      const lines = diff.trim().split('\n');
      const statLine = lines[lines.length - 1];

      if (statLine) {
        const insertMatch = statLine.match(/(\d+)\s+insertion/);
        const deleteMatch = statLine.match(/(\d+)\s+deletion/);
        const insertions = insertMatch ? insertMatch[1] : '0';
        const deletions = deleteMatch ? deleteMatch[1] : '0';
        summaries.push(`- \`${file}\`: +${insertions}/-${deletions} 行`);
      } else {
        summaries.push(`- \`${file}\`: 已修改`);
      }
    } catch {
      summaries.push(`- \`${file}\`: 变更详情获取失败`);
    }
  }

  return summaries.join('\n');
}

function buildCommitMessage(taskType: TaskType, issueTitle: string, issueNumber: number): string {
  const prefix = taskType === 'feature' ? 'feat' : 'fix';
  const normalized = issueTitle
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fa5 -]/gi, '')
    .trim();

  const base = `${prefix}: ${normalized}`.slice(0, 56).trim();
  const suffix = ` (closes #${issueNumber})`;
  return `${base}${suffix}`.slice(0, 72);
}

export async function commitAndPush(params: {
  workspacePath: string;
  branchName: string;
  selectedFiles: string[];
  taskType: TaskType;
  issueTitle: string;
  issueNumber: number;
}): Promise<{ commitSha: string }> {
  if (params.selectedFiles.length === 0) {
    throw new Error('没有检测到代码变更，无需提交');
  }

  const git = simpleGit(params.workspacePath);

  await git.add(params.selectedFiles);
  const commitMessage = buildCommitMessage(
    params.taskType,
    params.issueTitle,
    params.issueNumber
  );
  await git.commit(commitMessage);
  await git.push('origin', params.branchName);

  const commitSha = (await git.revparse(['HEAD'])).trim();
  return { commitSha };
}

export async function cleanupWorkspace(workspacePath?: string): Promise<void> {
  if (!workspacePath) {
    return;
  }
  if (!workspacePath.startsWith(BASE_WORKSPACE)) {
    return;
  }
  await removeWorkspaceDir(workspacePath);
}
