import { mkdir, rm, statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import type { TaskType } from '../../shared/types';
import type { ForkContext } from '../github/service';

const BASE_WORKSPACE = path.join(os.homedir(), 'gitagent-workspace');
const MIN_REQUIRED_BYTES = 200 * 1024 * 1024;
const WORKSPACE_RM_RETRIES = 8;
const WORKSPACE_RM_RETRY_DELAY_MS = 250;

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

export async function cloneBranchWorkspace(params: {
  context: ForkContext;
  branchName: string;
  issueNumber: number;
}): Promise<string> {
  await assertDiskAvailable();

  const workspaceName = `${sanitizeFolderName(params.context.fork.repo)}-${params.issueNumber}`;
  const workspacePath = path.join(BASE_WORKSPACE, workspaceName);

  await rm(workspacePath, { recursive: true, force: true });

  const git = simpleGit();
  await git.clone(buildAuthedCloneUrl(params.context), workspacePath, [
    '--branch',
    params.branchName,
    '--single-branch'
  ]);

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
  await rm(workspacePath, {
    recursive: true,
    force: true,
    maxRetries: WORKSPACE_RM_RETRIES,
    retryDelay: WORKSPACE_RM_RETRY_DELAY_MS
  });
}
