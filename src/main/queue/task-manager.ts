import { randomUUID } from 'node:crypto';
import type {
  ConfirmCommitInput,
  EnqueueTaskInput,
  IssueDetail,
  TaskEntity,
  TaskFileChange,
  TaskLog
} from '../../shared/types';
import { checkClaudeReady, runClaudeTask } from '../claude/service';
import { cleanupWorkspace, cloneBranchWorkspace, commitAndPush, listChangedFiles } from '../git/service';
import {
  createBranchForIssue,
  createPullRequest,
  ensureFork,
  fetchReadmeHead,
  getIssueDetail,
  splitRepoFullName
} from '../github/service';
import { mainState } from '../state';

interface RuntimeContext {
  abortController?: AbortController;
}

type TaskListener = (task: TaskEntity) => void;

export class TaskManager {
  private queue: string[] = [];
  private processing = false;
  private runtime = new Map<string, RuntimeContext>();

  constructor(private readonly onTaskUpdate: TaskListener) {}

  enqueue(input: EnqueueTaskInput, issue: IssueDetail): TaskEntity {
    if (this.queue.length >= 20) {
      throw new Error('队列最多支持 20 个任务');
    }

    const task: TaskEntity = {
      id: randomUUID(),
      repoFullName: input.repoFullName,
      issueNumber: input.issueNumber,
      issueTitle: issue.title,
      taskType: input.taskType,
      status: 'pending',
      logs: [],
      changedFiles: []
    };

    mainState.upsertTask(task);
    this.queue.push(task.id);
    this.onTaskUpdate(task);
    this.kick();
    return task;
  }

  async confirmCommit(input: ConfirmCommitInput): Promise<TaskEntity> {
    const task = mainState.getTask(input.taskId);
    if (!task) {
      throw new Error('任务不存在');
    }
    if (task.status !== 'awaiting_commit') {
      throw new Error('当前任务不在待提交状态');
    }
    if (!task.workspacePath || !task.branchName) {
      throw new Error('任务缺少工作目录或分支信息');
    }

    const selectedFiles = task.changedFiles
      .filter((file) => input.selectedFiles.includes(file.path))
      .map((file) => file.path);

    mainState.patchTask(task.id, { status: 'running' });
    this.emitTask(task.id);
    this.appendLog(task.id, {
      level: 'info',
      text: `开始提交 ${selectedFiles.length} 个文件`
    });

    const commit = await commitAndPush({
      workspacePath: task.workspacePath,
      branchName: task.branchName,
      selectedFiles,
      taskType: task.taskType,
      issueTitle: task.issueTitle,
      issueNumber: task.issueNumber
    });

    const forkContext = await ensureFork(task.repoFullName);
    const pr = await createPullRequest({
      context: forkContext,
      branchName: task.branchName,
      issueNumber: task.issueNumber,
      issueTitle: task.issueTitle,
      taskType: task.taskType,
      changedFiles: selectedFiles,
      summary: 'AI 已根据 Issue 描述与评论完成代码改动，并通过 GitAgent 自动提交。'
    });

    const next = mainState.patchTask(task.id, {
      status: 'completed',
      finishedAt: Date.now(),
      result: {
        prUrl: pr.url,
        prNumber: pr.number,
        commitSha: commit.commitSha
      }
    });

    this.appendLog(task.id, {
      level: 'success',
      text: pr.existed ? `检测到已有 PR: #${pr.number}` : `PR 创建成功: #${pr.number}`
    });

    await cleanupWorkspace(task.workspacePath);
    this.emitTask(next.id);
    return mainState.getTask(task.id)!;
  }

  async cancelTask(taskId: string): Promise<void> {
    const task = mainState.getTask(taskId);
    if (!task) {
      return;
    }

    if (task.status === 'pending') {
      this.queue = this.queue.filter((id) => id !== taskId);
      const cancelled = mainState.patchTask(taskId, {
        status: 'cancelled',
        finishedAt: Date.now(),
        result: { error: '任务已取消' }
      });
      this.onTaskUpdate(cancelled);
      return;
    }

    if (task.status === 'running') {
      this.runtime.get(taskId)?.abortController?.abort();
    }
  }

  private kick(): void {
    if (this.processing) {
      return;
    }
    this.processing = true;
    void this.processLoop();
  }

  private async processLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const taskId = this.queue.shift();
      if (!taskId) {
        continue;
      }
      await this.executeTask(taskId);
    }
    this.processing = false;
  }

  private emitTask(taskId: string): void {
    const task = mainState.getTask(taskId);
    if (task) {
      this.onTaskUpdate(task);
    }
  }

  private appendLog(taskId: string, log: Omit<TaskLog, 'at'>): void {
    const task = mainState.getTask(taskId);
    if (!task) {
      return;
    }

    const logs = [...task.logs, { ...log, at: Date.now() }].slice(-800);
    mainState.patchTask(taskId, { logs });
    this.emitTask(taskId);
  }

  private async executeTask(taskId: string): Promise<void> {
    const task = mainState.getTask(taskId);
    if (!task) {
      return;
    }

    const abortController = new AbortController();
    this.runtime.set(taskId, { abortController });

    mainState.patchTask(taskId, { status: 'running', startedAt: Date.now() });
    this.emitTask(taskId);

    try {
      await checkClaudeReady();
      const issue = await getIssueDetail(task.repoFullName, task.issueNumber);

      this.appendLog(taskId, { level: 'info', text: '开始检测/创建 Fork 仓库' });
      const forkContext = await ensureFork(task.repoFullName);

      this.appendLog(taskId, { level: 'info', text: '开始创建任务分支' });
      const branchName = await createBranchForIssue(
        forkContext,
        task.issueNumber,
        task.issueTitle
      );

      this.appendLog(taskId, { level: 'info', text: `已创建分支: ${branchName}` });
      const workspacePath = await cloneBranchWorkspace({
        context: forkContext,
        branchName,
        issueNumber: task.issueNumber
      });

      mainState.patchTask(taskId, { branchName, workspacePath });
      this.emitTask(taskId);

      const readmeHead = await fetchReadmeHead(task.repoFullName);
      const prompt = this.buildPrompt(issue, readmeHead, task.taskType);

      this.appendLog(taskId, { level: 'info', text: 'Claude Code 开始执行' });
      await runClaudeTask({
        cwd: workspacePath,
        prompt,
        taskType: task.taskType,
        signal: abortController.signal,
        onLog: (log) => this.appendLog(taskId, log)
      });

      const changedFiles = await listChangedFiles(workspacePath);
      if (changedFiles.length === 0) {
        const failed = mainState.patchTask(taskId, {
          status: 'failed',
          finishedAt: Date.now(),
          result: { error: 'AI 未生成代码变更，请查看执行日志' }
        });
        this.appendLog(taskId, {
          level: 'error',
          text: 'AI 未生成代码变更，请查看执行日志'
        });
        await cleanupWorkspace(workspacePath);
        this.onTaskUpdate(failed);
        return;
      }

      const files: TaskFileChange[] = changedFiles.map((file) => ({
        path: file,
        selected: true
      }));

      const awaiting = mainState.patchTask(taskId, {
        status: 'awaiting_commit',
        changedFiles: files
      });

      this.appendLog(taskId, {
        level: 'success',
        text: `检测到 ${changedFiles.length} 个变更文件，等待确认提交`
      });

      this.onTaskUpdate(awaiting);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '任务执行失败，请查看日志和配置';

      if (message.includes('取消')) {
        const cancelled = mainState.patchTask(taskId, {
          status: 'cancelled',
          finishedAt: Date.now(),
          result: { error: message }
        });
        this.appendLog(taskId, { level: 'error', text: '任务已取消' });
        await cleanupWorkspace(mainState.getTask(taskId)?.workspacePath);
        this.onTaskUpdate(cancelled);
      } else {
        const failed = mainState.patchTask(taskId, {
          status: 'failed',
          finishedAt: Date.now(),
          result: { error: message }
        });
        this.appendLog(taskId, { level: 'error', text: message });
        await cleanupWorkspace(mainState.getTask(taskId)?.workspacePath);
        this.onTaskUpdate(failed);
      }
    } finally {
      this.runtime.delete(taskId);
    }
  }

  private buildPrompt(issue: IssueDetail, readmeHead: string, taskType: 'bugfix' | 'feature'): string {
    const modeInstruction =
      taskType === 'feature'
        ? '你现在在 Feature 开发模式：实现功能并补充必要测试。'
        : '你现在在 Bug Fix 模式：定位根因，最小化改动并确保回归风险可控。';

    const comments = issue.comments
      .map((comment) => `- [${comment.author}] ${comment.body}`)
      .join('\n');

    return [
      '你是 GitAgent Desktop 的代码执行代理，请直接修改当前仓库。',
      modeInstruction,
      '',
      `Issue #${issue.number}: ${issue.title}`,
      'Issue 正文：',
      issue.body || '(empty)',
      '',
      'Issue 评论：',
      comments || '(no comments)',
      '',
      'README 前 500 行：',
      readmeHead || '(readme unavailable)',
      '',
      '完成后要求：',
      '1) 修改代码解决问题',
      '2) 若仓库已有测试框架，补充或更新必要测试',
      '3) 不要执行破坏性命令',
      '4) 结束时给出简要变更说明'
    ].join('\n');
  }
}

let manager: TaskManager | undefined;

export function initTaskManager(onTaskUpdate: TaskListener): TaskManager {
  manager = new TaskManager(onTaskUpdate);
  return manager;
}

export function getTaskManager(): TaskManager {
  if (!manager) {
    throw new Error('Task manager 尚未初始化');
  }
  return manager;
}

export function assertRepoMatch(repoFullName: string): void {
  const selected = mainState.getSnapshot().selectedRepo;
  if (!selected || selected.fullName !== repoFullName) {
    const { owner, repo } = splitRepoFullName(repoFullName);
    mainState.setSelectedRepo({
      id: 0,
      owner,
      name: repo,
      fullName: repoFullName,
      private: false,
      defaultBranch: 'main',
      updatedAt: new Date().toISOString()
    });
  }
}
