import { randomUUID } from 'node:crypto';
import type {
  AgentProvider,
  EnqueueTaskInput,
  IssueDetail,
  ReviewStrictness,
  SubmissionMode,
  TaskEntity,
  TaskFileChange,
  TaskLog
} from '../../shared/types';
import { buildLogDedupKey, normalizeVisibleLogText } from '../../shared/log-dedupe';
import { buildTaskProcessComment } from '../../shared/task-process-comment';
import { agentProviderLabel, checkAgentReady, runAgentTask } from '../agent/service';
import { cleanupWorkspace, cloneBranchWorkspace, commitAndPush, listChangedFiles, getFileDiffSummary } from '../git/service';
import {
  addLabelToIssue,
  buildBranchUrl,
  createIssueComment,
  createBranchForIssue,
  createPullRequest,
  ensureDirectBranch,
  ensureFork,
  fetchReadmeHead,
  getIssueDetail,
  splitRepoFullName,
  type ForkContext
} from '../github/service';
import {
  assessIssueRisk,
  buildHumanConfirmationComment,
  HUMAN_CONFIRMATION_LABEL
} from '../security/issue-guard';
import { getAgentSettings } from '../settings/service';
import { mainState } from '../state';

interface RuntimeContext {
  abortController?: AbortController;
}

type TaskListener = (task: TaskEntity) => void;

const LOG_DUPLICATE_WINDOW_MS = 15_000;
const LOG_STREAM_UPDATE_WINDOW_MS = 15_000;

interface ReviewDecision {
  approved: boolean;
  summary: string;
  feedback: string[];
  raw: string;
}

interface AgentRunParams {
  taskId: string;
  cwd: string;
  prompt: string;
  taskType: 'bugfix' | 'feature';
  provider: AgentProvider;
  signal?: AbortSignal;
  logPrefix?: string;
  readOnly?: boolean;
}

function normalizeLogText(text: string): string {
  return normalizeVisibleLogText(text);
}

function shouldSkipDuplicateLog(taskLogs: TaskLog[], next: Omit<TaskLog, 'at'>, now: number): boolean {
  const nextKey = buildLogDedupKey(next.text);
  if (!nextKey) {
    return false;
  }

  for (let index = taskLogs.length - 1; index >= 0; index -= 1) {
    const candidate = taskLogs[index];
    if (now - candidate.at > LOG_DUPLICATE_WINDOW_MS) {
      break;
    }
    if (candidate.level !== next.level) {
      continue;
    }
    if (buildLogDedupKey(candidate.text) === nextKey) {
      return true;
    }
  }

  return false;
}

function shouldReplaceStreamingLog(previous: TaskLog, next: Omit<TaskLog, 'at'>, now: number): boolean {
  if (now - previous.at > LOG_STREAM_UPDATE_WINDOW_MS) {
    return false;
  }

  if (previous.level !== next.level) {
    return false;
  }

  const previousText = normalizeLogText(previous.text);
  const nextText = normalizeLogText(next.text);

  if (!previousText || !nextText || previousText === nextText) {
    return false;
  }

  if (/\n/.test(previousText) || /\n/.test(nextText)) {
    return false;
  }

  return previousText.includes(nextText) || nextText.includes(previousText);
}

export class TaskManager {
  private queue: string[] = [];
  private processing = false;
  private runtime = new Map<string, RuntimeContext>();

  constructor(private readonly onTaskUpdate: TaskListener) {}

  enqueue(input: EnqueueTaskInput, issueTitle: string): TaskEntity {
    if (this.queue.length >= 20) {
      throw new Error('队列最多支持 20 个任务');
    }

    const task: TaskEntity = {
      id: randomUUID(),
      repoFullName: input.repoFullName,
      issueNumber: input.issueNumber,
      issueTitle: issueTitle || `Issue #${input.issueNumber}`,
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

  private async commitTaskChanges(
    taskId: string,
    selectedFiles: string[],
    submissionMode: SubmissionMode,
    forkContext?: ForkContext
  ): Promise<TaskEntity> {
    const task = mainState.getTask(taskId);
    if (!task) {
      throw new Error('任务不存在');
    }
    if (!task.workspacePath || !task.branchName) {
      throw new Error('任务缺少工作目录或分支信息');
    }

    mainState.patchTask(task.id, { status: 'running' });
    this.emitTask(task.id);
    this.appendLog(task.id, {
      level: 'info',
      text: `开始提交 ${selectedFiles.length} 个文件`
    });

    const diffSummary = await getFileDiffSummary(task.workspacePath, selectedFiles);
    const commit = await commitAndPush({
      workspacePath: task.workspacePath,
      branchName: task.branchName,
      selectedFiles,
      taskType: task.taskType,
      issueTitle: task.issueTitle,
      issueNumber: task.issueNumber
    });

    let next: TaskEntity;
    if (submissionMode === 'pr') {
      const summary = `AI 已根据 Issue 描述与评论完成代码改动。\n\n**变更统计：**\n${diffSummary}`;
      const context = forkContext ?? (await ensureFork(task.repoFullName));
      const pr = await createPullRequest({
        context,
        branchName: task.branchName,
        issueNumber: task.issueNumber,
        issueTitle: task.issueTitle,
        taskType: task.taskType,
        changedFiles: selectedFiles,
        summary
      });

      next = mainState.patchTask(task.id, {
        status: 'completed',
        finishedAt: Date.now(),
        result: {
          submissionMode,
          prUrl: pr.url,
          prNumber: pr.number,
          commitSha: commit.commitSha
        }
      });

      this.appendLog(task.id, {
        level: 'success',
        text: pr.existed ? `检测到已有 PR: #${pr.number}` : `PR 创建成功: #${pr.number}`
      });
    } else {
      next = mainState.patchTask(task.id, {
        status: 'completed',
        finishedAt: Date.now(),
        result: {
          submissionMode,
          branchUrl: buildBranchUrl(task.repoFullName, task.branchName),
          commitSha: commit.commitSha
        }
      });

      this.appendLog(task.id, {
        level: 'success',
        text: `分支提交成功: ${task.branchName}`
      });
    }

    await this.publishTaskProcessComment(task.id, selectedFiles, diffSummary);
    this.emitTask(next.id);
    this.scheduleWorkspaceCleanup(task.id, task.workspacePath);
    return mainState.getTask(task.id)!;
  }

  private async publishTaskProcessComment(
    taskId: string,
    changedFiles: string[],
    diffSummary: string
  ): Promise<void> {
    const task = mainState.getTask(taskId);
    if (!task) {
      return;
    }

    try {
      await createIssueComment(
        task.repoFullName,
        task.issueNumber,
        buildTaskProcessComment({
          task,
          changedFiles,
          diffSummary
        })
      );
      this.appendLog(taskId, {
        level: 'success',
        text: '已在 Issue 中写入任务修改过程评论'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendLog(taskId, {
        level: 'error',
        text: `写入任务修改过程评论失败：${message}`
      });
    }
  }

  private isAgentRuntimeLog(text: string): boolean {
    const normalized = normalizeLogText(text);
    return (
      normalized.startsWith('Claude Code 进程已启动') ||
      normalized === 'Claude Code 执行完成' ||
      normalized.startsWith('Claude Code 执行中（已运行') ||
      normalized.startsWith('Claude 启动超过 65s 无输出') ||
      normalized.startsWith('Claude 长时间无新输出') ||
      normalized.startsWith('Claude 陷入重复输出循环') ||
      normalized.startsWith('检测到当前环境不支持 PTY') ||
      normalized === 'Codex 开始处理当前请求' ||
      normalized === 'Codex 执行中，等待新的输出...'
    );
  }

  private async runAgent(params: AgentRunParams): Promise<string> {
    const output: string[] = [];

    const result = await runAgentTask({
      provider: params.provider,
      cwd: params.cwd,
      prompt: params.prompt,
      taskType: params.taskType,
      signal: params.signal,
      readOnly: params.readOnly,
      onLog: (log) => {
        if (!this.isAgentRuntimeLog(log.text)) {
          output.push(log.text);
        }
        this.appendLog(params.taskId, {
          level: log.level,
          text: params.logPrefix ? `[${params.logPrefix}] ${log.text}` : log.text
        });
      }
    });

    if (result.trim()) {
      output.push(result.trim());
    }

    return output.join('\n');
  }

  private parseReviewDecision(output: string): ReviewDecision {
    const decisionMatch = Array.from(output.matchAll(/REVIEW_DECISION:\s*(PASS|FAIL)/gi)).at(-1);
    const summaryMatch = Array.from(output.matchAll(/REVIEW_SUMMARY:\s*([^\n\r]+)/gi)).at(-1);
    const feedbackIndex = output.toUpperCase().lastIndexOf('REVIEW_FEEDBACK:');

    if (!decisionMatch) {
      throw new Error('Review Agent 未返回 REVIEW_DECISION，无法判断是否通过');
    }

    const feedbackSource =
      feedbackIndex >= 0
        ? output.slice(feedbackIndex + 'REVIEW_FEEDBACK:'.length)
        : summaryMatch?.[1] ?? '';

    const feedback = feedbackSource
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !this.isAgentRuntimeLog(line))
      .filter((line) => !/^REVIEW_(DECISION|SUMMARY|FEEDBACK):/i.test(line))
      .map((line) => line.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
      .filter((line) => !/^none$/i.test(line));

    return {
      approved: decisionMatch[1].toUpperCase() === 'PASS',
      summary: summaryMatch?.[1]?.trim() || 'Review Agent 未提供摘要',
      feedback,
      raw: output.trim()
    };
  }

  private async runReviewLoop(params: {
    taskId: string;
    workspacePath: string;
    issue: IssueDetail;
    readmeHead: string;
    taskType: 'bugfix' | 'feature';
    reviewProvider: AgentProvider;
    implementationProvider: AgentProvider;
    reviewStrictness: ReviewStrictness;
    reviewMaxRounds: number;
    signal?: AbortSignal;
    changedFiles: string[];
  }): Promise<string[]> {
    const maxRounds = params.reviewMaxRounds;
    let changedFiles = params.changedFiles;

    for (let round = 1; round <= maxRounds; round += 1) {
      const diffSummary = await getFileDiffSummary(params.workspacePath, changedFiles);
      this.appendLog(params.taskId, {
        level: 'info',
        text: `开始第 ${round}/${maxRounds} 轮 Review Agent 审查`
      });

      const reviewOutput = await this.runAgent({
        taskId: params.taskId,
        cwd: params.workspacePath,
        prompt: this.buildReviewPrompt(
          params.issue,
          params.readmeHead,
          params.taskType,
          changedFiles,
          diffSummary,
          round,
          params.reviewStrictness
        ),
        taskType: params.taskType,
        provider: params.reviewProvider,
        signal: params.signal,
        readOnly: params.reviewProvider === 'codex',
        logPrefix: `${agentProviderLabel(params.reviewProvider)} Review R${round}`
      });

      const decision = this.parseReviewDecision(reviewOutput);
      this.appendLog(params.taskId, {
        level: decision.approved ? 'success' : 'error',
        text: `Review Agent 结论：${decision.approved ? '通过' : '不通过'}；${decision.summary}`
      });

      if (decision.approved) {
        return changedFiles;
      }

      const feedbackText =
        decision.feedback.length > 0
          ? decision.feedback.map((item) => `- ${item}`).join('\n')
          : `- ${decision.summary}`;
      this.appendLog(params.taskId, {
        level: 'error',
        text: `Review Agent 要求返工：\n${feedbackText}`
      });

      if (round >= maxRounds) {
        throw new Error(`Review Agent 连续 ${maxRounds} 轮未通过，任务已终止`);
      }

      this.appendLog(params.taskId, {
        level: 'info',
        text: `开始第 ${round} 次返工，由 Code Agent 修复 Review Agent 提出的必须修改项`
      });

      await this.runAgent({
        taskId: params.taskId,
        cwd: params.workspacePath,
        prompt: this.buildRevisionPrompt(
          params.issue,
          params.readmeHead,
          params.taskType,
          changedFiles,
          diffSummary,
          decision,
          round
        ),
        taskType: params.taskType,
        provider: params.implementationProvider,
        signal: params.signal,
        logPrefix: `${agentProviderLabel(params.implementationProvider)} 修复 R${round}`
      });

      changedFiles = await listChangedFiles(params.workspacePath);
      if (changedFiles.length === 0) {
        throw new Error('返工后工作区没有可提交变更，无法继续创建 PR');
      }

      mainState.patchTask(params.taskId, {
        changedFiles: changedFiles.map((file) => ({ path: file, selected: true }))
      });
      this.emitTask(params.taskId);
    }

    throw new Error('Review Agent 审查流程异常结束');
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

  private async cleanupTaskWorkspace(taskId: string, workspacePath?: string): Promise<void> {
    try {
      await cleanupWorkspace(workspacePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendLog(taskId, {
        level: 'error',
        text: `工作目录清理失败：${message}`
      });
    }
  }

  private scheduleWorkspaceCleanup(taskId: string, workspacePath?: string): void {
    void this.cleanupTaskWorkspace(taskId, workspacePath);
  }

  private async moveTaskToHumanConfirmation(
    taskId: string,
    issue: IssueDetail,
    reasons: string[]
  ): Promise<void> {
    const task = mainState.getTask(taskId);
    if (!task) {
      return;
    }
    const summary = reasons.join('；') || '该 Issue 已被标记为需要人工确认';
    const hasSecurityComment = issue.comments.some((comment) =>
      comment.body.includes('<!-- buildbot-security-review -->')
    );

    try {
      if (!issue.labels.some((label) => label.name === HUMAN_CONFIRMATION_LABEL)) {
        await addLabelToIssue(task.repoFullName, task.issueNumber, HUMAN_CONFIRMATION_LABEL);
      }
      if (!hasSecurityComment) {
        await createIssueComment(
          task.repoFullName,
          task.issueNumber,
          buildHumanConfirmationComment(reasons)
        );
      }
      this.appendLog(taskId, {
        level: 'info',
        text: hasSecurityComment
          ? `Issue 已存在人工确认评论，已补充标签 ${HUMAN_CONFIRMATION_LABEL}`
          : `已在 Issue 中写入人工确认说明，并添加标签 ${HUMAN_CONFIRMATION_LABEL}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendLog(taskId, {
        level: 'error',
        text: `写入人工确认评论或标签失败：${message}`
      });
    }

    const next = mainState.patchTask(taskId, {
      status: 'awaiting_human_confirmation',
      finishedAt: Date.now(),
      result: { error: `安全检查已拦截任务：${summary}` }
    });
    this.emitTask(next.id);
  }

  private appendLog(taskId: string, log: Omit<TaskLog, 'at'>): void {
    const task = mainState.getTask(taskId);
    if (!task) {
      return;
    }
    const now = Date.now();
    const last = task.logs[task.logs.length - 1];
    if (shouldSkipDuplicateLog(task.logs, log, now)) {
      return;
    }

    if (last && shouldReplaceStreamingLog(last, log, now)) {
      const merged = {
        ...last,
        at: now,
        text:
          normalizeLogText(log.text).length >= normalizeLogText(last.text).length
            ? log.text
            : last.text
      };
      const logs = [...task.logs.slice(0, -1), merged].slice(-800);
      mainState.patchTask(taskId, { logs });
      this.emitTask(taskId);
      return;
    }

    if (process.env.BUILDBOT_DEBUG_TASK_LOGS === '1') {
      console.info(`[BuildBot][TaskLog][${taskId}] ${log.level}: ${log.text}`);
    }

    const logs = [...task.logs, { ...log, at: now }].slice(-800);
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
      const agentSettings = await getAgentSettings();
      await checkAgentReady(agentSettings.implementationProvider);
      if (agentSettings.reviewProvider !== agentSettings.implementationProvider) {
        await checkAgentReady(agentSettings.reviewProvider);
      }
      const issue = await getIssueDetail(task.repoFullName, task.issueNumber);

      this.appendLog(taskId, { level: 'info', text: '开始执行 Issue 安全检查' });
      const risk = assessIssueRisk(issue);
      if (risk.blocked) {
        this.appendLog(taskId, {
          level: 'error',
          text: `安全检查命中，任务已转人工确认：${risk.reasons.join('；')}`
        });
        await this.moveTaskToHumanConfirmation(taskId, issue, risk.reasons);
        return;
      }

      const submissionMode = agentSettings.submissionMode;
      let branchName: string;
      let cloneContext: ForkContext | Awaited<ReturnType<typeof ensureDirectBranch>>;
      let forkContext: ForkContext | undefined;

      if (submissionMode === 'pr') {
        this.appendLog(taskId, { level: 'info', text: '开始检测/创建 Fork 仓库' });
        forkContext = await ensureFork(task.repoFullName);
        cloneContext = forkContext;

        this.appendLog(taskId, { level: 'info', text: '开始准备任务分支' });
        branchName = await createBranchForIssue(forkContext, task.issueNumber, task.issueTitle);
      } else {
        this.appendLog(taskId, {
          level: 'info',
          text: `开始准备直提分支: ${agentSettings.directBranchName}`
        });
        cloneContext = await ensureDirectBranch(task.repoFullName, agentSettings.directBranchName);
        branchName = agentSettings.directBranchName;
      }

      this.appendLog(taskId, { level: 'info', text: `已准备分支: ${branchName}` });
      mainState.patchTask(taskId, { branchName });
      this.emitTask(taskId);

      this.appendLog(taskId, { level: 'info', text: '开始克隆任务分支到本地工作目录' });
      const workspacePath = await cloneBranchWorkspace({
        context: cloneContext,
        branchName,
        issueNumber: task.issueNumber,
        taskId,
        signal: abortController.signal,
        onProgress: (message) =>
          this.appendLog(taskId, {
            level: 'thinking',
            text: `Git clone: ${message}`
          })
      });
      this.appendLog(taskId, { level: 'success', text: '本地工作目录准备完成' });

      mainState.patchTask(taskId, { branchName, workspacePath });
      this.emitTask(taskId);

      const readmeHead = await fetchReadmeHead(task.repoFullName);
      const prompt = this.buildImplementationPrompt(issue, readmeHead, task.taskType);

      this.appendLog(taskId, {
        level: 'info',
        text: `${agentProviderLabel(agentSettings.implementationProvider)} 开始执行代码实现`
      });
      await this.runAgent({
        taskId,
        cwd: workspacePath,
        prompt,
        taskType: task.taskType,
        provider: agentSettings.implementationProvider,
        signal: abortController.signal,
        logPrefix: `${agentProviderLabel(agentSettings.implementationProvider)} 实施`
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
        this.scheduleWorkspaceCleanup(taskId, workspacePath);
        this.onTaskUpdate(failed);
        return;
      }

      const files: TaskFileChange[] = changedFiles.map((file) => ({
        path: file,
        selected: true
      }));

      mainState.patchTask(taskId, {
        changedFiles: files
      });
      this.emitTask(taskId);

      const approvedFiles = await this.runReviewLoop({
        taskId,
        workspacePath,
        issue,
        readmeHead,
        taskType: task.taskType,
        reviewProvider: agentSettings.reviewProvider,
        implementationProvider: agentSettings.implementationProvider,
        reviewStrictness: agentSettings.reviewStrictness,
        reviewMaxRounds: agentSettings.reviewMaxRounds,
        signal: abortController.signal,
        changedFiles
      });

      this.appendLog(taskId, {
        level: 'info',
        text:
          submissionMode === 'pr'
            ? `Review Agent 已通过，检测到 ${approvedFiles.length} 个变更文件，开始自动提交并创建 PR`
            : `Review Agent 已通过，检测到 ${approvedFiles.length} 个变更文件，开始自动提交到分支 ${branchName}`
      });

      await this.commitTaskChanges(taskId, approvedFiles, submissionMode, forkContext);
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
        this.scheduleWorkspaceCleanup(taskId, mainState.getTask(taskId)?.workspacePath);
        this.onTaskUpdate(cancelled);
      } else {
        const failed = mainState.patchTask(taskId, {
          status: 'failed',
          finishedAt: Date.now(),
          result: { error: message }
        });
        this.appendLog(taskId, { level: 'error', text: message });
        this.scheduleWorkspaceCleanup(taskId, mainState.getTask(taskId)?.workspacePath);
        this.onTaskUpdate(failed);
      }
    } finally {
      this.runtime.delete(taskId);
    }
  }

  private buildImplementationPrompt(
    issue: IssueDetail,
    readmeHead: string,
    taskType: 'bugfix' | 'feature'
  ): string {
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

  private buildReviewPrompt(
    issue: IssueDetail,
    readmeHead: string,
    taskType: 'bugfix' | 'feature',
    changedFiles: string[],
    diffSummary: string,
    round: number,
    strictness: ReviewStrictness
  ): string {
    const modeInstruction =
      taskType === 'feature'
        ? '这是一个 Feature 任务，请重点检查需求覆盖、边界条件和必要测试。'
        : '这是一个 Bug Fix 任务，请重点检查根因是否真正解决、是否有回归风险和缺失测试。';
    const strictnessInstruction = this.buildReviewStrictnessInstruction(strictness, taskType);

    const comments = issue.comments
      .map((comment) => `- [${comment.author}] ${comment.body}`)
      .join('\n');

    return [
      '你是 BuildBot 的 Review Agent。',
      '当前仓库已经存在未提交代码改动。你的职责是只做代码审查，不要修改任何文件，不要执行 git commit/push。',
      modeInstruction,
      strictnessInstruction,
      '',
      `当前是第 ${round} 轮审查。`,
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
      '当前改动文件：',
      changedFiles.map((file) => `- ${file}`).join('\n') || '(no changed files)',
      '',
      '当前变更摘要：',
      diffSummary || '(diff summary unavailable)',
      '',
      '审查要求：',
      '1) 你可以自行查看代码、git diff、测试文件，判断这些改动是否已经达到可提交 PR 的质量。',
      '2) 只列出必须修改的问题；可选建议不要写进反馈。',
      '3) 结合当前严格度配置判断哪些问题属于必须修改项。',
      '4) 只要存在任何必须修改的问题，就必须判定 FAIL。',
      '5) 只有你愿意批准现在这版代码直接提交 PR，才能判定 PASS。',
      '6) 不要因为措辞风格、个人偏好或非关键性重构建议而判定 FAIL。',
      '7) 最终输出必须严格包含以下三段，方便程序解析：',
      'REVIEW_DECISION: PASS 或 FAIL',
      'REVIEW_SUMMARY: 一句话中文总结',
      'REVIEW_FEEDBACK:',
      '- 如果 PASS，写 `- none`',
      '- 如果 FAIL，逐条列出必须修改的问题'
    ].join('\n');
  }

  private buildRevisionPrompt(
    issue: IssueDetail,
    readmeHead: string,
    taskType: 'bugfix' | 'feature',
    changedFiles: string[],
    diffSummary: string,
    decision: ReviewDecision,
    round: number
  ): string {
    const modeInstruction =
      taskType === 'feature'
        ? '你现在在 Feature 返工模式：在保留已有有效实现的前提下，修复 Review Agent 指出的必须修改项，并补充必要测试。'
        : '你现在在 Bug Fix 返工模式：针对 Review Agent 指出的根因、回归和测试问题继续修改，保持改动尽量收敛。';

    const comments = issue.comments
      .map((comment) => `- [${comment.author}] ${comment.body}`)
      .join('\n');

    const feedbackText =
      decision.feedback.length > 0
        ? decision.feedback.map((item) => `- ${item}`).join('\n')
        : `- ${decision.summary}`;

    return [
      '你是 BuildBot 的修复 Agent，请直接修改当前仓库，修复 Review Agent 未通过的原因。',
      modeInstruction,
      '',
      `当前是第 ${round} 次返工。`,
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
      '当前改动文件：',
      changedFiles.map((file) => `- ${file}`).join('\n') || '(no changed files)',
      '',
      '当前变更摘要：',
      diffSummary || '(diff summary unavailable)',
      '',
      'Review Agent 结论：',
      `摘要：${decision.summary}`,
      '必须修改项：',
      feedbackText,
      '',
      '完成后要求：',
      '1) 基于当前工作区继续修改，不要新建提交，不要 push',
      '2) 必须解决上面所有必须修改项，避免只做表面修补',
      '3) 如有必要，补充或更新测试',
      '4) 保留与当前 Issue 相关的有效改动，不要无意义回滚',
      '5) 结束时给出简要变更说明'
    ].join('\n');
  }

  private buildReviewStrictnessInstruction(
    strictness: ReviewStrictness,
    taskType: 'bugfix' | 'feature'
  ): string {
    const taskSpecificRule =
      taskType === 'feature'
        ? 'Feature 额外规则：需求主路径未闭环、关键交互/边界条件遗漏，或新增能力缺少必要验证时，应倾向判定 FAIL。'
        : 'Bug Fix 额外规则：如果改动没有真正覆盖根因、只是掩盖现象，或存在明显回归窗口，应倾向判定 FAIL。';

    switch (strictness) {
      case 'strict':
        return [
          '当前审查严格度：严格。',
          '标准：对正确性、边界条件、回归风险、测试充分性和实现稳健性保持保守判断。',
          taskSpecificRule,
          '必须 FAIL 的典型情形：存在较明显的潜在缺陷；需求覆盖不完整；关键路径或关键边界缺少测试/验证；实现虽然可运行但你对直接合入仍有实质疑虑。'
        ].join('\n');
      case 'lenient':
        return [
          '当前审查严格度：宽松。',
          '标准：只拦截明确会影响合入质量的问题。',
          taskSpecificRule,
          '必须 FAIL 的典型情形：需求明显未完成；存在实际 bug、安全问题、明显回归风险；缺少不可或缺的验证以致结果不可信。',
          '默认不要 FAIL 的情形：可接受的实现取舍、轻微测试欠缺、局部可优化项、风格或重构层面的建议。'
        ].join('\n');
      default:
        return [
          '当前审查严格度：一般。',
          '标准：拦截会影响正确性、需求完成度、回归风险和必要测试的问题。',
          taskSpecificRule,
          '必须 FAIL 的典型情形：主需求未完成；关键路径有明显漏洞；中高风险改动缺少必要测试；实现会让后续维护或合入风险显著增加。',
          '默认不要 FAIL 的情形：非关键优化项、主观风格问题、可后续迭代的小改进。'
        ].join('\n');
    }
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
