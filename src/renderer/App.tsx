import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  FolderOpen,
  GitBranch,
  GitPullRequest,
  LogOut,
  Plus,
  Repeat,
  Settings,
  ShieldCheck,
  User,
  X
} from 'lucide-react';
import { marked } from 'marked';
import { appendAutoModeLabel, normalizeAutoModeLabel } from '../shared/auto-mode-labels';
import { DEFAULT_AUTO_ENQUEUE_LABELS } from '../shared/issue-auto-enqueue';
import type {
  AgentProvider,
  AgentProviderStatus,
  ReviewStrictness,
  SubmissionMode,
  TaskType,
  TaskSource,
  TaskEntity
} from '../shared/types';
import { buildLogDedupKey, normalizeVisibleLogText } from '../shared/log-dedupe';
import AppLogo from './components/AppLogo';
import { useAppStore } from './store/useAppStore';
import { mergeLogs, formatLogsForCopy, logLevelLabel } from './utils/logUtils';

marked.setOptions({ breaks: true, gfm: true });

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
type WorkspaceView = 'tasks' | 'issues';
type SettingsTab = 'agent' | 'auto' | 'account';

function diffLineClass(line: string): string {
  if (
    line.startsWith('diff --git') ||
    line.startsWith('index ') ||
    line.startsWith('new file mode') ||
    line.startsWith('deleted file mode') ||
    line.startsWith('similarity index') ||
    line.startsWith('rename from ') ||
    line.startsWith('rename to ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ')
  ) {
    return 'task-diff-line-meta';
  }
  if (line.startsWith('@@')) {
    return 'task-diff-line-hunk';
  }
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return 'task-diff-line-add';
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return 'task-diff-line-del';
  }
  return 'task-diff-line-context';
}

function agentProviderLabel(provider: AgentProvider): string {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

function agentSettingsSignature(settings: {
  implementationProvider: AgentProvider;
  reviewProvider: AgentProvider;
  reviewStrictness: ReviewStrictness;
  reviewMaxRounds: number;
  submissionMode: SubmissionMode;
  directBranchName: string;
}): string {
  return [
    settings.implementationProvider,
    settings.reviewProvider,
    settings.reviewStrictness,
    String(settings.reviewMaxRounds),
    settings.submissionMode,
    settings.directBranchName
  ].join('::');
}

function formatTime(value?: number | string): string {
  if (!value) return '-';
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

function formatTaskListTime(task: TaskEntity): string {
  if (task.finishedAt) {
    return `完成于 ${formatTime(task.finishedAt)}`;
  }
  if (task.startedAt) {
    return `开始于 ${formatTime(task.startedAt)}`;
  }
  return '尚未开始';
}

function statusLabel(status: TaskEntity['status']): string {
  switch (status) {
    case 'pending':
      return '等待中';
    case 'running':
      return '执行中';
    case 'awaiting_human_confirmation':
      return '待人工确认';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function statusClass(status: TaskEntity['status']): string {
  switch (status) {
    case 'awaiting_human_confirmation':
      return 'status status-warn';
    case 'completed':
      return 'status status-success';
    case 'failed':
    case 'cancelled':
      return 'status status-error';
    case 'running':
      return 'status status-run';
    default:
      return 'status status-pending';
  }
}

type TaskStepTone = 'done' | 'active' | 'error' | 'muted';
type TaskStepItem = { label: string; tone: TaskStepTone };

function buildTaskStepItems(task?: TaskEntity): TaskStepItem[] {
  if (!task) {
    return [];
  }

  const logs = task.logs.map((log) => log.text.trim()).filter(Boolean);
  const hasLogs = logs.length > 0;
  const reviewRounds = new Set<number>();
  const repairRounds = new Set<number>();
  let envStarted = hasLogs || task.status !== 'pending';
  let codingStarted = false;
  let submitStarted = false;
  let humanConfirmation = false;

  logs.forEach((text) => {
    if (
      text.startsWith('开始执行 Issue 安全检查') ||
      text.startsWith('已载入本地录入任务') ||
      text.startsWith('开始检测/创建 Fork 仓库') ||
      text.startsWith('开始准备任务分支') ||
      text.startsWith('开始准备直提分支:') ||
      text.startsWith('已准备分支:') ||
      text.startsWith('开始克隆任务分支到本地工作目录') ||
      text.startsWith('本地工作目录准备完成')
    ) {
      envStarted = true;
    }

    if (text.includes('人工确认')) {
      humanConfirmation = true;
    }

    if (text.includes('开始执行代码实现')) {
      codingStarted = true;
    }

    const reviewMatch = text.match(/^开始第\s+(\d+)(?:\/\d+)?\s+轮 Review Agent 审查$/);
    if (reviewMatch) {
      reviewRounds.add(Number(reviewMatch[1]));
      codingStarted = true;
      return;
    }

    const repairMatch = text.match(/^开始第\s+(\d+)\s+次返工/);
    if (repairMatch) {
      repairRounds.add(Number(repairMatch[1]));
      codingStarted = true;
      return;
    }

    if (
      text.includes('开始自动提交') ||
      text.startsWith('开始提交 ') ||
      text.startsWith('PR 创建成功:') ||
      text.startsWith('检测到已有 PR:') ||
      text.startsWith('分支提交成功:')
    ) {
      submitStarted = true;
      codingStarted = true;
    }
  });

  if (task.status === 'awaiting_human_confirmation') {
    humanConfirmation = true;
  }

  if (task.status === 'completed') {
    submitStarted = true;
    codingStarted = true;
  }

  const realized: string[] = ['开始'];
  const future: string[] = [];

  if (!envStarted) {
    future.push('环境准备', 'Coding', 'Review', '提交', '完成');
  } else {
    realized.push('环境准备');
  }

  if (!envStarted) {
    // 还未进入执行阶段时，仅展示完整的未来流程。
  } else if (humanConfirmation) {
    realized.push('人工确认');
  } else {
    const codingRounds = codingStarted ? Math.max(1, ...Array.from(repairRounds, (round) => round + 1)) : 0;
    const reviewCount = reviewRounds.size > 0 ? Math.max(...reviewRounds) : submitStarted ? 1 : 0;
    const needsRoundLabels = Math.max(codingRounds, reviewCount) > 1;
    const codingLabel = (round: number) => (needsRoundLabels ? `Coding ${round}` : 'Coding');
    const reviewLabel = (round: number) => (needsRoundLabels ? `Review ${round}` : 'Review');

    for (let round = 1; round <= Math.max(codingRounds, reviewCount); round += 1) {
      if (round <= codingRounds) {
        realized.push(codingLabel(round));
      }
      if (round <= reviewCount) {
        realized.push(reviewLabel(round));
      }
    }

    if (!codingStarted) {
      future.push('Coding', 'Review', '提交', '完成');
    } else if (reviewCount < codingRounds) {
      future.push(reviewLabel(codingRounds), '提交', '完成');
    } else if (!submitStarted) {
      future.push('提交', '完成');
    }
  }

  if (task.status === 'completed') {
    realized.push('提交', '完成');
  } else if (task.status === 'failed') {
    realized.push('失败');
  } else if (task.status === 'cancelled') {
    realized.push('已取消');
  } else if (task.status !== 'awaiting_human_confirmation' && submitStarted) {
    realized.push('提交');
    future.push('完成');
  }

  if (
    task.status === 'awaiting_human_confirmation' ||
    task.status === 'completed' ||
    task.status === 'failed' ||
    task.status === 'cancelled'
  ) {
    future.length = 0;
  }

  const items: TaskStepItem[] = realized.map((label, index) => {
    const isLastRealized = index === realized.length - 1;

    if (task.status === 'completed') {
      return { label, tone: 'done' };
    }

    if (task.status === 'failed' && isLastRealized) {
      return { label, tone: 'error' };
    }

    if (task.status === 'cancelled' && isLastRealized) {
      return { label, tone: 'muted' };
    }

    return { label, tone: isLastRealized ? 'active' : 'done' };
  });

  return [...items, ...future.map((label) => ({ label, tone: 'muted' as const }))];
}

function taskSourceLabel(source: TaskSource): string {
  return source === 'local' ? '本地录入' : 'Issue';
}

function formatTaskTitle(task: TaskEntity): string {
  return task.source === 'local' ? task.issueTitle : `#${task.issueNumber} ${task.issueTitle}`;
}

function formatTaskReference(task?: TaskEntity): string {
  if (!task) {
    return '等待任务';
  }
  return task.source === 'local' ? '本地任务' : `#${task.issueNumber}`;
}

function markdownHtml(content: string): string {
  try {
    const html = marked.parse(content) as string;
    return html;
  } catch {
    return content;
  }
}

function parseRepoTarget(
  value: string
): { fullName: string; issueNumber?: number } | undefined {
  const input = value.trim();
  if (!input) {
    return undefined;
  }

  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      if (!/github\.com$/i.test(url.hostname)) {
        return undefined;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length < 2) {
        return undefined;
      }
      const fullName = `${parts[0]}/${parts[1]}`;
      if (parts[2] === 'issues' && parts[3] && /^\d+$/.test(parts[3])) {
        return { fullName, issueNumber: Number(parts[3]) };
      }
      return { fullName };
    } catch {
      return undefined;
    }
  }

  if (/^[^\s/]+\/[^\s/]+$/.test(input)) {
    return { fullName: input };
  }

  return undefined;
}

export default function App(): JSX.Element {
  const {
    snapshot,
    filter,
    loading,
    error,
    initialized,
    init,
    attachTaskListener,
    setFilter,
    setError,
    loginWithToken,
    logout,
    loadRepos,
    selectRepo,
    loadIssues,
    loadIssueDetail,
    enqueueTask,
    cancelTask
  } = useAppStore();

  const [token, setToken] = useState('');
  const [repoJump, setRepoJump] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repoSwitcherOpen, setRepoSwitcherOpen] = useState(false);
  const [issueDetailOpen, setIssueDetailOpen] = useState(false);
  const [localTaskOpen, setLocalTaskOpen] = useState(false);
  const [repoCandidate, setRepoCandidate] = useState('');
  const [localTaskTitle, setLocalTaskTitle] = useState('');
  const [localTaskBody, setLocalTaskBody] = useState('');
  const [localTaskType, setLocalTaskType] = useState<TaskType>('feature');
  const [creatingLocalTask, setCreatingLocalTask] = useState(false);
  const [implementationProvider, setImplementationProvider] = useState<AgentProvider>('claude');
  const [reviewProvider, setReviewProvider] = useState<AgentProvider>('claude');
  const [reviewStrictness, setReviewStrictness] = useState<ReviewStrictness>('normal');
  const [reviewMaxRounds, setReviewMaxRounds] = useState(3);
  const [submissionMode, setSubmissionMode] = useState<SubmissionMode>('branch');
  const [directBranchName, setDirectBranchName] = useState('develop');
  const [providerStatuses, setProviderStatuses] = useState<AgentProviderStatus[]>([]);
  const [autoModeEnabled, setAutoModeEnabled] = useState(false);
  const [autoModePollIntervalSec, setAutoModePollIntervalSec] = useState(180);
  const [autoModeIncludeLabels, setAutoModeIncludeLabels] = useState<string[]>(
    DEFAULT_AUTO_ENQUEUE_LABELS
  );
  const [autoModeLabelDraft, setAutoModeLabelDraft] = useState('');
  const [autoModeCountdown, setAutoModeCountdown] = useState(0);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string>();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('agent');
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('tasks');
  const [timerNow, setTimerNow] = useState<number>(Date.now());
  const [copied, setCopied] = useState(false);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const agentSettingsSaveTimerRef = useRef<number>();
  const latestAgentSettingsSignatureRef = useRef('');
  const lastSavedAgentSettingsRef = useRef('');
  const savedAutoModeIncludeLabelsRef = useRef<string[]>(DEFAULT_AUTO_ENQUEUE_LABELS);

  useEffect(() => {
    attachTaskListener();
    void init()
      .then(async () => {
        const state = useAppStore.getState().snapshot;
        if (state.account) {
          await loadRepos(1);
          if (useAppStore.getState().snapshot.selectedRepo) {
            await loadIssues();
          }
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : '初始化失败';
        setError(message);
      });
  }, [attachTaskListener, init, loadIssues, loadRepos]);

  async function refreshSettingsStatus(): Promise<void> {
    try {
      const settings = await window.desktopApi.getSettings();
      lastSavedAgentSettingsRef.current = agentSettingsSignature(settings.agentSettings);
      setImplementationProvider(settings.agentSettings.implementationProvider);
      setReviewProvider(settings.agentSettings.reviewProvider);
      setReviewStrictness(settings.agentSettings.reviewStrictness);
      setReviewMaxRounds(settings.agentSettings.reviewMaxRounds);
      setSubmissionMode(settings.agentSettings.submissionMode);
      setDirectBranchName(settings.agentSettings.directBranchName);
      setProviderStatuses(settings.providerStatuses);
      setAutoModeEnabled(settings.autoMode.enabled);
      setAutoModePollIntervalSec(settings.autoMode.pollIntervalSec);
      savedAutoModeIncludeLabelsRef.current = settings.autoMode.includeLabels;
      setAutoModeIncludeLabels(settings.autoMode.includeLabels);
      setAutoModeLabelDraft('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '读取设置失败';
      setSettingsMessage(message);
    }
  }

  useEffect(() => {
    if (!initialized || !snapshot.account) {
      return;
    }
    void refreshSettingsStatus();
  }, [initialized, snapshot.account]);

  useEffect(() => {
    if (!activeTaskId && snapshot.tasks.length > 0) {
      setActiveTaskId(snapshot.tasks[0].id);
    }
  }, [activeTaskId, snapshot.tasks]);

  useEffect(() => {
    setWorkspaceView(autoModeEnabled ? 'tasks' : 'issues');
  }, [autoModeEnabled]);

  // 自动模式倒计时
  useEffect(() => {
    if (!autoModeEnabled) {
      setAutoModeCountdown(0);
      return;
    }

    setAutoModeCountdown(autoModePollIntervalSec);

    const interval = setInterval(() => {
      setAutoModeCountdown((prev) => {
        if (prev <= 1) {
          return autoModePollIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [autoModeEnabled, autoModePollIntervalSec]);

  const selectedIssue = snapshot.selectedIssue;
  const activeTask = useMemo(
    () => snapshot.tasks.find((task) => task.id === activeTaskId),
    [activeTaskId, snapshot.tasks]
  );

  // 任务计时器
  useEffect(() => {
    if (!activeTask || activeTask.status !== 'running' || !activeTask.startedAt) {
      return;
    }

    const interval = setInterval(() => {
      setTimerNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTask?.id, activeTask?.status, activeTask?.startedAt]);

  const renderedLogs = useMemo(() => {
    if (!activeTask) {
      return [];
    }
    const merged: Array<
      | {
          at: number;
          level: TaskEntity['logs'][number]['level'];
          kind: 'text';
          text: string;
          dedupKey: string;
        }
      | {
          at: number;
          level: TaskEntity['logs'][number]['level'];
          kind: 'diff';
          text: string;
          filePath?: string;
          diff: string;
          isDiffTruncated?: boolean;
        }
    > = [];
    activeTask.logs.forEach((log) => {
      if (log.kind === 'diff' && log.diff) {
        merged.push({
          at: log.at,
          level: log.level,
          kind: 'diff',
          text: log.text,
          filePath: log.filePath,
          diff: log.diff,
          isDiffTruncated: log.isDiffTruncated
        });
        return;
      }

      const text = normalizeVisibleLogText(log.text);
      if (!text) {
        return;
      }
      const dedupKey = buildLogDedupKey(text);
      const prev = merged[merged.length - 1];
      const isNearDuplicate =
        prev &&
        prev.kind === 'text' &&
        prev.level === log.level &&
        dedupKey.length > 0 &&
        prev.dedupKey === dedupKey &&
        log.at - prev.at <= 20_000;
      if (isNearDuplicate) {
        prev.at = log.at;
        return;
      }
      const canMerge =
        prev &&
        prev.kind === 'text' &&
        prev.level === log.level &&
        log.at - prev.at <= 1200 &&
        prev.text.length < 240 &&
        text.length < 180 &&
        !/\n/.test(prev.text) &&
        !/\n/.test(text);
      if (canMerge) {
        prev.text = `${prev.text} ${text}`.replace(/\s+/g, ' ').trim();
        prev.at = log.at;
        prev.dedupKey = buildLogDedupKey(prev.text);
        return;
      }
      merged.push({ at: log.at, level: log.level, kind: 'text', text, dedupKey });
    });
    return merged.slice(-500).map((log) =>
      log.kind === 'diff'
        ? {
            at: log.at,
            level: log.level,
            kind: 'diff' as const,
            text: log.text,
            filePath: log.filePath,
            diff: log.diff,
            isDiffTruncated: log.isDiffTruncated
          }
        : {
            at: log.at,
            level: log.level,
            kind: 'text' as const,
            text: log.text
          }
    );
  }, [activeTask]);

  const taskSteps = useMemo(() => {
    if (!activeTask) {
      return [];
    }

    return buildTaskStepItems(activeTask);
  }, [activeTask]);

  useEffect(() => {
    const box = logBoxRef.current;
    if (!box) {
      return;
    }
    box.scrollTop = box.scrollHeight;
  }, [activeTask?.id, renderedLogs.length]);

  function copyAllLogs(): void {
    if (!activeTask || activeTask.logs.length === 0) return;
    // 基于原始日志生成完整的复制文本（不裁剪）
    const merged = mergeLogs(activeTask.logs);
    const copyText = formatLogsForCopy(merged);
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const labelOptions = useMemo(() => {
    const set = new Set<string>();
    snapshot.issues.forEach((issue) => {
      issue.labels.forEach((label) => set.add(label.name));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [snapshot.issues]);

  const autoModeLabelSuggestions = useMemo(() => {
    const selected = new Set(autoModeIncludeLabels.map(normalizeAutoModeLabel));
    return labelOptions.filter((label) => !selected.has(normalizeAutoModeLabel(label)));
  }, [autoModeIncludeLabels, labelOptions]);

  const issueTaskMap = useMemo(() => {
    const map = new Map<number, TaskEntity>();
    snapshot.tasks.forEach((task) => {
      if (task.source !== 'issue') {
        return;
      }
      if (!map.has(task.issueNumber)) {
        map.set(task.issueNumber, task);
      }
    });
    return map;
  }, [snapshot.tasks]);

  const taskStats = useMemo(() => {
    const stats = {
      running: 0,
      pending: 0,
      awaiting: 0,
      failed: 0,
      completed: 0
    };
    snapshot.tasks.forEach((task) => {
      switch (task.status) {
        case 'running':
          stats.running += 1;
          break;
        case 'pending':
          stats.pending += 1;
          break;
        case 'awaiting_human_confirmation':
          stats.awaiting += 1;
          break;
        case 'completed':
          stats.completed += 1;
          break;
        case 'failed':
        case 'cancelled':
          stats.failed += 1;
          break;
        default:
          break;
      }
    });
    return stats;
  }, [snapshot.tasks]);

  const openIssueCount = useMemo(
    () => snapshot.issues.filter((issue) => issue.state === 'open').length,
    [snapshot.issues]
  );

  const providerStatusMap = useMemo(() => {
    const map = new Map<AgentProvider, AgentProviderStatus>();
    providerStatuses.forEach((status) => {
      map.set(status.provider, status);
    });
    return map;
  }, [providerStatuses]);

  const visibleProviderStatuses = useMemo(
    () => providerStatuses.filter((status) => status.determined),
    [providerStatuses]
  );

  const settingsTabs = useMemo(
    () => [
      {
        id: 'agent' as const,
        label: 'Agent',
        caption: '执行链路与审查门槛',
        value: `${agentProviderLabel(implementationProvider)} / ${agentProviderLabel(reviewProvider)}`,
        icon: Bot
      },
      {
        id: 'auto' as const,
        label: '自动模式',
        caption: '轮询与自动入队',
        value: autoModeEnabled ? `${autoModePollIntervalSec}s` : '已暂停',
        icon: Repeat
      },
      {
        id: 'account' as const,
        label: '账户',
        caption: '登录态与安全操作',
        value: snapshot.account?.login ?? '未登录',
        icon: User
      }
    ],
    [
      autoModeEnabled,
      autoModePollIntervalSec,
      implementationProvider,
      reviewProvider,
      snapshot.account?.login
    ]
  );

  const activeSettingsTab = settingsTabs.find((item) => item.id === settingsTab) ?? settingsTabs[0];
  const ActiveSettingsIcon = activeSettingsTab.icon;
  const agentSettingsDraft = useMemo(
    () => ({
      implementationProvider,
      reviewProvider,
      reviewStrictness,
      reviewMaxRounds: Number.isFinite(reviewMaxRounds) ? Math.round(reviewMaxRounds) : 3,
      submissionMode,
      directBranchName
    }),
    [
      directBranchName,
      implementationProvider,
      reviewMaxRounds,
      reviewProvider,
      reviewStrictness,
      submissionMode
    ]
  );
  const agentSettingsDraftSignature = useMemo(
    () => agentSettingsSignature(agentSettingsDraft),
    [agentSettingsDraft]
  );
  latestAgentSettingsSignatureRef.current = agentSettingsDraftSignature;
  const settingsMessageTone =
    settingsMessage && (settingsMessage.includes('失败') || settingsMessage.includes('错误'))
      ? 'is-error'
      : 'is-success';
  const readyProviderCount = visibleProviderStatuses.filter((status) => status.available).length;
  const settingsPanelDescription =
    settingsTab === 'agent'
      ? '执行 Provider、审查强度和提交流程。'
      : settingsTab === 'auto'
        ? '自动轮询开关、频率和当前状态。'
        : '当前账户和退出登录。';

  async function handleLogin(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!token.trim()) {
      setError('请输入 GitHub PAT（需要 repo + workflow 权限）');
      return;
    }
    await loginWithToken(token);
    setToken('');
  }

  async function handleFilterRefresh(): Promise<void> {
    setRefreshing(true);
    setError(undefined);
    try {
      await loadIssues();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Issue 刷新失败';
      setError(message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRepoChange(fullName: string): Promise<boolean> {
    if (!fullName) {
      return false;
    }
    setRefreshing(true);
    setError(undefined);
    try {
      await selectRepo(fullName);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '切换仓库失败';
      setError(message);
      return false;
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRepoJump(): Promise<boolean> {
    const target = parseRepoTarget(repoJump);
    if (!target) {
      setError('请输入 owner/repo 或 GitHub Issue URL');
      return false;
    }

    setRefreshing(true);
    setError(undefined);
    try {
      await selectRepo(target.fullName);
      if (target.issueNumber) {
        await loadIssueDetail(target.issueNumber);
      }
      setRepoJump('');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '跳转失败';
      setError(message);
      return false;
    } finally {
      setRefreshing(false);
    }
  }

  function handleOpenRepoSwitcher(): void {
    setRepoCandidate(snapshot.selectedRepo?.fullName ?? '');
    setRepoSwitcherOpen(true);
  }

  function resetLocalTaskDraft(): void {
    setLocalTaskTitle('');
    setLocalTaskBody('');
    setLocalTaskType('feature');
  }

  function handleOpenLocalTask(): void {
    setError(undefined);
    setLocalTaskOpen(true);
  }

  function handleCloseLocalTask(): void {
    setLocalTaskOpen(false);
    setCreatingLocalTask(false);
    resetLocalTaskDraft();
  }

  async function handleConfirmRepoSwitch(): Promise<void> {
    const changed = await handleRepoChange(repoCandidate);
    if (changed) {
      setRepoSwitcherOpen(false);
    }
  }

  async function launchTask(mode: 'bugfix' | 'feature'): Promise<void> {
    if (!selectedIssue || !snapshot.selectedRepo) {
      setError('请先选择 Issue');
      return;
    }

    try {
      const task = await enqueueTask({
        repoFullName: snapshot.selectedRepo.fullName,
        issueNumber: selectedIssue.number,
        taskType: mode
      });
      setActiveTaskId(task.id);
      setWorkspaceView('tasks');
    } catch (err) {
      const message = err instanceof Error ? err.message : '任务创建失败';
      setError(message);
    }
  }

  async function handleCreateLocalTask(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!snapshot.selectedRepo) {
      setError('请先选择仓库');
      return;
    }

    const title = localTaskTitle.trim();
    if (!title) {
      setError('请输入任务标题');
      return;
    }

    setCreatingLocalTask(true);
    setError(undefined);
    try {
      const task = await enqueueTask({
        source: 'local',
        repoFullName: snapshot.selectedRepo.fullName,
        taskType: localTaskType,
        title,
        body: localTaskBody.trim()
      });
      setActiveTaskId(task.id);
      setWorkspaceView('tasks');
      handleCloseLocalTask();
    } catch (err) {
      const message = err instanceof Error ? err.message : '本地任务创建失败';
      setError(message);
    } finally {
      setCreatingLocalTask(false);
    }
  }

  async function handleOpenSettings(): Promise<void> {
    setSettingsOpen(true);
    setSettingsMessage(undefined);
    await refreshSettingsStatus();
  }

  async function persistAgentSettings(
    nextSettings: typeof agentSettingsDraft,
    withSettingsMessage: boolean
  ): Promise<void> {
    const requestSignature = agentSettingsSignature(nextSettings);
    setSavingSettings(true);
    if (withSettingsMessage) {
      setSettingsMessage(undefined);
    }
    try {
      const saved = await window.desktopApi.saveAgentSettings(nextSettings);
      const savedSignature = agentSettingsSignature(saved);
      lastSavedAgentSettingsRef.current = savedSignature;
      if (latestAgentSettingsSignatureRef.current === requestSignature) {
        setImplementationProvider(saved.implementationProvider);
        setReviewProvider(saved.reviewProvider);
        setReviewStrictness(saved.reviewStrictness);
        setReviewMaxRounds(saved.reviewMaxRounds);
        setSubmissionMode(saved.submissionMode);
        setDirectBranchName(saved.directBranchName);
      }
      if (withSettingsMessage) {
        setSettingsMessage('Agent 配置已自动保存');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Agent 配置保存失败';
      setSettingsMessage(message);
    } finally {
      setSavingSettings(false);
    }
  }

  useEffect(() => {
    if (!settingsOpen) {
      window.clearTimeout(agentSettingsSaveTimerRef.current);
      return;
    }
    if (agentSettingsDraftSignature === lastSavedAgentSettingsRef.current) {
      return;
    }
    window.clearTimeout(agentSettingsSaveTimerRef.current);
    agentSettingsSaveTimerRef.current = window.setTimeout(() => {
      void persistAgentSettings(agentSettingsDraft, true);
    }, 300);
    return () => window.clearTimeout(agentSettingsSaveTimerRef.current);
  }, [agentSettingsDraft, agentSettingsDraftSignature, settingsOpen]);

  async function persistAutoModeSettings(
    enabled: boolean,
    pollIntervalSec: number,
    includeLabels: string[],
    withSettingsMessage: boolean
  ): Promise<void> {
    setSavingSettings(true);
    if (withSettingsMessage) {
      setSettingsMessage(undefined);
    }
    try {
      const normalized = Number.isFinite(pollIntervalSec) ? Math.round(pollIntervalSec) : 180;
      const saved = await window.desktopApi.saveAutoModeSettings({
        enabled,
        pollIntervalSec: normalized,
        includeLabels
      });
      savedAutoModeIncludeLabelsRef.current = saved.includeLabels;
      setAutoModeEnabled(saved.enabled);
      setAutoModePollIntervalSec(saved.pollIntervalSec);
      if (withSettingsMessage) {
        setSettingsMessage(
          saved.enabled
            ? `自动模式已开启，标签：${saved.includeLabels.join(', ')}`
            : '自动模式已关闭'
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '自动模式保存失败';
      if (withSettingsMessage) {
        setSettingsMessage(message);
      }
      setError(message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleQuickToggleAutoMode(): Promise<void> {
    setError(undefined);
    await persistAutoModeSettings(
      !autoModeEnabled,
      autoModePollIntervalSec,
      savedAutoModeIncludeLabelsRef.current,
      false
    );
  }

  function addAutoModeLabel(raw: string): void {
    const next = appendAutoModeLabel(autoModeIncludeLabels, raw);
    setAutoModeIncludeLabels(next);
    setAutoModeLabelDraft('');
  }

  function removeAutoModeLabel(label: string): void {
    setAutoModeIncludeLabels((current) =>
      current.filter((item) => normalizeAutoModeLabel(item) !== normalizeAutoModeLabel(label))
    );
  }

  async function saveAutoModeLabelWhitelist(): Promise<void> {
    const next = appendAutoModeLabel(autoModeIncludeLabels, autoModeLabelDraft);
    setAutoModeIncludeLabels(next);
    setAutoModeLabelDraft('');
    await persistAutoModeSettings(autoModeEnabled, autoModePollIntervalSec, next, true);
    setAutoModeIncludeLabels(next);
  }

  if (!initialized) {
    return <div className="loading-screen">正在初始化 BuildBot Desktop...</div>;
  }

  if (!snapshot.account) {
    return (
      <div className="login-wrap">
        <div className="login-shell">
          <div className="login-brand-stage">
            <AppLogo />
            <p className="login-brand-stage-subtitle">Desktop</p>
          </div>

          <section className="login-card">
            <div className="login-headline">
              <h1>Build Tasks Into Code</h1>
              <p className="login-copy">
                Agent 驱动的任务分解、编码实现、审查与交付。
              </p>
            </div>

            <form onSubmit={handleLogin} className="login-form login-form-stack">
              <label className="login-field">
                <span>GitHub PAT</span>
                <input
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="ghp_xxx"
                  autoFocus
                />
              </label>
              <div className="login-actions">
                <button disabled={loading} type="submit">
                  {loading ? '登录中...' : '登录并开始'}
                </button>
                <small>登录后可选择仓库、浏览 Issues，或直接本地录入任务。</small>
              </div>
              {error ? <p className="error-msg">{error}</p> : null}
            </form>

            <p className="login-copy login-copy-secondary login-footer-note">
              使用 GitHub Personal Access Token 登录，建议权限：`repo` + `workflow`。Token
              会写入系统 Keychain。
            </p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className={`shell${IS_MAC ? ' is-mac' : ''}`}>
      <div className="window-drag-strip" aria-hidden="true" />

      <div className="top-brand-strip">
        <AppLogo />
      </div>

      <div className="topbar-right">
        <div className="topbar-stats-compact">
          <span
            className="stat-pill"
            title={`${taskStats.running} 运行中 / ${taskStats.pending} 等待中 / ${taskStats.awaiting} 待人工确认`}
          >
            <span className="stat-dot stat-dot-run" />
            {taskStats.running}/{taskStats.pending}/{taskStats.awaiting}
          </span>
          <span className="stat-pill" title={`${taskStats.failed} 失败`}>
            <span className="stat-dot stat-dot-error" />
            {taskStats.failed}
          </span>
          <span className="stat-pill" title={`${taskStats.completed} 已完成 / 共 ${snapshot.tasks.length} 任务`}>
            <span className="stat-dot stat-dot-success" />
            {taskStats.completed}
          </span>
        </div>

        <button
          className="repo-switcher-btn"
          onClick={handleOpenRepoSwitcher}
          title="切换仓库"
          aria-label="切换仓库"
        >
          <FolderOpen aria-hidden="true" className="repo-icon" />
          <span className="repo-name">{snapshot.selectedRepo?.fullName ?? '未选择'}</span>
        </button>

        <button
          className={`ghost auto-toggle-btn ${autoModeEnabled ? 'is-on' : 'is-off'}`}
          onClick={() => void handleQuickToggleAutoMode()}
          disabled={savingSettings}
          title={autoModeEnabled ? '关闭自动模式' : '开启自动模式'}
          aria-label={autoModeEnabled ? '关闭自动模式' : '开启自动模式'}
        >
          <span className="auto-toggle-dot" aria-hidden="true" />
          自动模式 {autoModeEnabled ? '开' : '关'}
        </button>
        {autoModeEnabled && autoModeCountdown > 0 ? (
          <span className="auto-countdown" title={`下次轮询还有 ${autoModeCountdown} 秒`}>
            {autoModeCountdown}s
          </span>
        ) : null}

        <button
          className="icon-btn icon-plain global-settings-btn"
          onClick={() => void handleOpenSettings()}
          title="设置"
          aria-label="设置"
        >
          <Settings aria-hidden="true" />
        </button>
      </div>

      {repoSwitcherOpen ? (
        <div className="repo-modal-mask" onClick={() => setRepoSwitcherOpen(false)}>
          <div className="repo-modal" onClick={(event) => event.stopPropagation()}>
            <h3>切换仓库</h3>
            <p className="muted">选择仓库，或输入 owner/repo 与 Issue URL 快速跳转</p>
            <select
              value={repoCandidate}
              onChange={(event) => setRepoCandidate(event.target.value)}
            >
              {snapshot.repos.length === 0 ? <option value="">暂无仓库</option> : null}
              {snapshot.repos.map((repo) => (
                <option key={repo.id} value={repo.fullName}>
                  {repo.fullName}
                </option>
              ))}
            </select>

            <div className="repo-modal-actions">
              <button
                disabled={loading || refreshing || !repoCandidate}
                onClick={() => void handleConfirmRepoSwitch()}
              >
                切换
              </button>
              <button className="ghost" onClick={() => setRepoSwitcherOpen(false)}>
                关闭
              </button>
            </div>

            <form
              className="repo-jump-form modal-repo-jump"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  const changed = await handleRepoJump();
                  if (changed) {
                    setRepoSwitcherOpen(false);
                  }
                })();
              }}
            >
              <input
                value={repoJump}
                onChange={(event) => setRepoJump(event.target.value)}
                placeholder="owner/repo 或 Issue URL"
              />
              <button className="ghost" type="submit" disabled={loading || refreshing}>
                跳转
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {localTaskOpen ? (
        <div className="repo-modal-mask">
          <div className="local-task-modal" onClick={(event) => event.stopPropagation()}>
            <div className="local-task-modal-head">
              <div>
                <p className="eyebrow">LOCAL TASK</p>
                <h3>本地录入任务</h3>
                <p className="muted">
                  任务会直接进入当前仓库队列，并沿用现有实现、Review 和提交流程。
                </p>
              </div>
              <button
                className="ghost icon-btn"
                type="button"
                onClick={handleCloseLocalTask}
                aria-label="关闭本地任务录入"
              >
                <X aria-hidden="true" />
              </button>
            </div>

            <div className="local-task-repo-card">
              <span>当前仓库</span>
              <strong>{snapshot.selectedRepo?.fullName ?? '未选择仓库'}</strong>
            </div>

            <form className="local-task-form" onSubmit={(event) => void handleCreateLocalTask(event)}>
              <div className="local-task-type-switch" aria-label="任务类型">
                <button
                  type="button"
                  className={localTaskType === 'feature' ? 'is-active' : ''}
                  onClick={() => setLocalTaskType('feature')}
                >
                  功能开发
                </button>
                <button
                  type="button"
                  className={localTaskType === 'bugfix' ? 'is-active' : ''}
                  onClick={() => setLocalTaskType('bugfix')}
                >
                  问题修复
                </button>
              </div>

              <label className="local-task-field">
                <span>任务标题</span>
                <input
                  value={localTaskTitle}
                  onChange={(event) => setLocalTaskTitle(event.target.value)}
                  placeholder="例如：补一个本地导入入口"
                  autoFocus
                />
              </label>

              <label className="local-task-field">
                <span>任务说明</span>
                <textarea
                  value={localTaskBody}
                  onChange={(event) => setLocalTaskBody(event.target.value)}
                  placeholder="补充背景、目标、验收标准或注意事项。"
                  rows={7}
                />
              </label>

              <div className="local-task-modal-actions">
                <button type="submit" disabled={creatingLocalTask || !snapshot.selectedRepo}>
                  {creatingLocalTask ? '加入中...' : '加入队列'}
                </button>
                <button className="ghost" type="button" onClick={handleCloseLocalTask}>
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="settings-modal-mask" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal settings-modal-layout" onClick={(event) => event.stopPropagation()}>
            <aside className="settings-sidebar">
              <div className="settings-sidebar-head">
                <h3>设置</h3>
                <p className="muted">
                  当前工作区配置
                </p>
              </div>
              <nav className="settings-nav">
                {settingsTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      className={`settings-nav-btn ${settingsTab === tab.id ? 'is-active' : ''}`}
                      onClick={() => setSettingsTab(tab.id)}
                    >
                      <span className="settings-nav-icon" aria-hidden="true">
                        <Icon />
                      </span>
                      <span className="settings-nav-copy">
                        <strong>{tab.label}</strong>
                        <small>{tab.caption}</small>
                      </span>
                      <span className="settings-nav-meta">{tab.value}</span>
                    </button>
                  );
                })}
              </nav>
              <div className="settings-sidebar-card">
                <span className="settings-sidebar-label">当前上下文</span>
                <strong>{snapshot.selectedRepo?.fullName ?? '未选择仓库'}</strong>
                <small>
                  {autoModeEnabled
                    ? `下次轮询 ${autoModeCountdown || autoModePollIntervalSec}s`
                    : '自动模式已关闭'}
                </small>
              </div>
            </aside>
            <main className="settings-content">
              <div className="settings-panel-head">
                <div className="settings-panel-head-copy">
                  <span className="settings-panel-icon" aria-hidden="true">
                    <ActiveSettingsIcon />
                  </span>
                  <div>
                    <h4>{activeSettingsTab.label}</h4>
                    <p className="muted">{settingsPanelDescription}</p>
                  </div>
                </div>
                <button
                  className="ghost icon-btn settings-close-btn"
                  onClick={() => setSettingsOpen(false)}
                  title="关闭设置"
                  aria-label="关闭设置"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
              <div className="settings-scroll-region">
                {settingsTab === 'agent' ? (
                  <section className="settings-section">
                    <div className="settings-card-grid">
                      <section className="settings-card settings-card-accent">
                        <div className="settings-card-head">
                          <span className="settings-card-icon" aria-hidden="true">
                            <Bot />
                          </span>
                          <div>
                            <h5>Provider</h5>
                            <p className="muted">实施与 Review 分开配置。</p>
                          </div>
                        </div>
                        <div className="settings-form-grid">
                          <label className="settings-input-group">
                            实施 Agent
                            <select
                              value={implementationProvider}
                              onChange={(event) => setImplementationProvider(event.target.value as AgentProvider)}
                            >
                              <option value="claude">Claude</option>
                              <option value="codex">Codex</option>
                            </select>
                          </label>
                          <label className="settings-input-group">
                            Review Agent
                            <select
                              value={reviewProvider}
                              onChange={(event) => setReviewProvider(event.target.value as AgentProvider)}
                            >
                              <option value="claude">Claude</option>
                              <option value="codex">Codex</option>
                            </select>
                          </label>
                        </div>
                      </section>

                      <section className="settings-card">
                        <div className="settings-card-head">
                          <span className="settings-card-icon" aria-hidden="true">
                            <ShieldCheck />
                          </span>
                          <div>
                            <h5>Review</h5>
                            <p className="muted">控制审查强度和轮次。</p>
                          </div>
                        </div>
                        <div className="settings-form-grid">
                          <label className="settings-input-group">
                            审查严格度
                            <select
                              value={reviewStrictness}
                              onChange={(event) =>
                                setReviewStrictness(event.target.value as ReviewStrictness)
                              }
                            >
                              <option value="strict">严格</option>
                              <option value="normal">一般</option>
                              <option value="lenient">宽松</option>
                            </select>
                          </label>
                          <label className="settings-input-group">
                            最大 Review 轮次
                            <div className="settings-input-row">
                              <input
                                type="number"
                                min={1}
                                max={8}
                                value={reviewMaxRounds}
                                onChange={(event) => setReviewMaxRounds(Number(event.target.value) || 1)}
                              />
                              <span className="muted">1-8</span>
                            </div>
                          </label>
                        </div>
                      </section>

                      <section className="settings-card">
                        <div className="settings-card-head">
                          <span className="settings-card-icon" aria-hidden="true">
                            {submissionMode === 'pr' ? <GitPullRequest /> : <GitBranch />}
                          </span>
                          <div>
                            <h5>提交</h5>
                            <p className="muted">选择固定分支或 PR 流程。</p>
                          </div>
                        </div>
                        <div className="settings-form-grid">
                          <label className="settings-input-group">
                            提交模式
                            <select
                              value={submissionMode}
                              onChange={(event) => setSubmissionMode(event.target.value as SubmissionMode)}
                            >
                              <option value="branch">分支模式（默认）</option>
                              <option value="pr">PR 模式</option>
                            </select>
                          </label>
                          <label className="settings-input-group">
                            固定分支名称
                            <input
                              value={directBranchName}
                              onChange={(event) => setDirectBranchName(event.target.value)}
                              placeholder="develop"
                              disabled={submissionMode === 'pr'}
                            />
                          </label>
                        </div>
                      </section>
                    </div>

                    {visibleProviderStatuses.length > 0 ? (
                      <section className="settings-card">
                        <div className="settings-card-head">
                          <span className="settings-card-icon" aria-hidden="true">
                            {readyProviderCount === visibleProviderStatuses.length ? (
                              <CheckCircle2 />
                            ) : (
                              <CircleAlert />
                            )}
                          </span>
                          <div>
                            <h5>环境状态</h5>
                            <p className="muted">
                              {readyProviderCount}/{visibleProviderStatuses.length} 可直接执行。
                            </p>
                          </div>
                        </div>
                        <div className="provider-status-list">
                          {(['claude', 'codex'] as AgentProvider[]).map((provider) => {
                            const status = providerStatusMap.get(provider);
                            if (!status?.determined) {
                              return null;
                            }
                            return (
                              <div key={provider} className="provider-status-item">
                                <div className="provider-status-head">
                                  <strong>{agentProviderLabel(provider)}</strong>
                                  <span className={status.available ? 'provider-status-ok' : 'provider-status-bad'}>
                                    {status.available ? '可用' : '未就绪'}
                                  </span>
                                </div>
                                <small>{status.detail}</small>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ) : null}
                  </section>
                ) : null}
                {settingsTab === 'auto' ? (
                  <section className="settings-section">
                    <div className="settings-card-grid settings-card-grid-auto">
                      <section className={`settings-card settings-card-highlight ${autoModeEnabled ? 'is-on' : 'is-off'}`}>
                        <div className="settings-card-head">
                          <span className="settings-card-icon" aria-hidden="true">
                            <Repeat />
                          </span>
                          <div>
                            <h5>自动模式</h5>
                            <p className="muted">开启后自动拉取 Open Issue 并入队。</p>
                          </div>
                        </div>
                        <div className="settings-toggle-row">
                          <label className="toggle-line">
                            <input
                              type="checkbox"
                              checked={autoModeEnabled}
                              onChange={(event) => {
                                setAutoModeEnabled(event.target.checked);
                                void persistAutoModeSettings(
                                  event.target.checked,
                                  autoModePollIntervalSec,
                                  savedAutoModeIncludeLabelsRef.current,
                                  true
                                );
                              }}
                            />
                            启用自动模式
                          </label>
                          <span className={`settings-status-badge ${autoModeEnabled ? 'is-on' : 'is-off'}`}>
                            {autoModeEnabled ? '已开启' : '已关闭'}
                          </span>
                        </div>
                        <div className="settings-metric-row">
                          <div className="settings-metric">
                            <span>调度方式</span>
                            <strong>{autoModeEnabled ? '自动轮询' : '手动触发'}</strong>
                          </div>
                          <div className="settings-metric">
                            <span>下次检查</span>
                            <strong>{autoModeEnabled ? `${autoModeCountdown || autoModePollIntervalSec}s` : '-'}</strong>
                          </div>
                        </div>
                      </section>

                      <section className="settings-card">
                        <div className="settings-card-head">
                          <span className="settings-card-icon" aria-hidden="true">
                            <Clock3 />
                          </span>
                          <div>
                            <h5>轮询间隔</h5>
                            <p className="muted">范围 30-3600 秒。</p>
                          </div>
                        </div>
                        <label className="settings-input-group">
                          轮询间隔（秒）
                          <div className="settings-input-row">
                            <input
                              type="number"
                              min={30}
                              max={3600}
                              step={10}
                              value={autoModePollIntervalSec}
                              onChange={(event) => {
                                const next = event.target.valueAsNumber;
                                const value = Number.isFinite(next) ? next : 180;
                                setAutoModePollIntervalSec(value);
                              }}
                              onBlur={() => {
                                void persistAutoModeSettings(
                                  autoModeEnabled,
                                  autoModePollIntervalSec,
                                  savedAutoModeIncludeLabelsRef.current,
                                  true
                                );
                              }}
                            />
                            <button
                              className="ghost"
                              disabled={savingSettings}
                              onClick={() =>
                                void persistAutoModeSettings(
                                  autoModeEnabled,
                                  autoModePollIntervalSec,
                                  savedAutoModeIncludeLabelsRef.current,
                                  true
                                )
                              }
                            >
                              应用
                            </button>
                          </div>
                        </label>
                      </section>

                      <section className="settings-card">
                        <div className="settings-card-head">
                          <span className="settings-card-icon" aria-hidden="true">
                            <Repeat />
                          </span>
                          <div>
                            <h5>自动入队标签</h5>
                            <p className="muted">只拉取包含这些标签的 Issue，支持回车快速添加。</p>
                          </div>
                        </div>
                        <div className="settings-input-group">
                          标签白名单
                          <div className="settings-tag-editor">
                            <div className="settings-tag-list">
                              {autoModeIncludeLabels.map((label) => (
                                <span key={label} className="settings-tag-chip">
                                  {label}
                                  <button
                                    type="button"
                                    className="settings-tag-remove"
                                    aria-label={`移除标签 ${label}`}
                                    onClick={() => removeAutoModeLabel(label)}
                                  >
                                    <X size={12} />
                                  </button>
                                </span>
                              ))}
                              <input
                                type="text"
                                className="settings-tag-input"
                                value={autoModeLabelDraft}
                                placeholder="输入标签后按回车"
                                onChange={(event) => {
                                  setAutoModeLabelDraft(event.target.value);
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    addAutoModeLabel(autoModeLabelDraft);
                                  } else if (
                                    event.key === 'Backspace' &&
                                    autoModeLabelDraft.length === 0 &&
                                    autoModeIncludeLabels.length > 0
                                  ) {
                                    event.preventDefault();
                                    removeAutoModeLabel(
                                      autoModeIncludeLabels[autoModeIncludeLabels.length - 1]
                                    );
                                  }
                                }}
                                onBlur={() => {
                                  if (autoModeLabelDraft.trim()) {
                                    addAutoModeLabel(autoModeLabelDraft);
                                  }
                                }}
                              />
                            </div>
                          </div>
                          {autoModeLabelSuggestions.length > 0 ? (
                            <div className="settings-tag-suggestions">
                              {autoModeLabelSuggestions.slice(0, 8).map((label) => (
                                <button
                                  key={label}
                                  type="button"
                                  className="settings-tag-suggestion"
                                  onClick={() => addAutoModeLabel(label)}
                                >
                                  + {label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                          <div className="settings-input-row">
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => addAutoModeLabel(autoModeLabelDraft)}
                            >
                              添加标签
                            </button>
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => setAutoModeIncludeLabels(DEFAULT_AUTO_ENQUEUE_LABELS)}
                            >
                              恢复默认
                            </button>
                            <button
                              className="ghost"
                              disabled={savingSettings}
                              onClick={() => void saveAutoModeLabelWhitelist()}
                            >
                              保存
                            </button>
                          </div>
                          <small className="settings-card-note">
                            会自动规范成小写并去重；留空保存时会回退到默认值。
                          </small>
                          <small className="settings-card-note">
                            {autoModeLabelSuggestions.length > 0
                              ? '下方推荐来自当前仓库已拉取到的 Issue 标签。'
                              : '当前仓库暂无可推荐标签。'}
                          </small>
                        </div>
                      </section>
                    </div>
                  </section>
                ) : null}
                {settingsTab === 'account' ? (
                  <section className="settings-section">
                    <div className="settings-card-grid settings-card-grid-account">
                      <section className="settings-card settings-card-accent">
                        <div className="settings-card-head">
                          <span className="settings-card-icon" aria-hidden="true">
                            <User />
                          </span>
                          <div>
                            <h5>当前账户</h5>
                            <p className="muted">用于仓库读取、Issue 拉取和任务提交。</p>
                          </div>
                        </div>
                        <div className="settings-account-block">
                          <strong>{snapshot.account?.login ?? '未知'}</strong>
                          <span className="muted">
                            {snapshot.selectedRepo?.fullName
                              ? `当前仓库：${snapshot.selectedRepo.fullName}`
                              : '尚未选择仓库'}
                          </span>
                        </div>
                      </section>

                      <section className="settings-card settings-card-danger">
                        <div className="settings-card-head">
                          <span className="settings-card-icon" aria-hidden="true">
                            <LogOut />
                          </span>
                          <div>
                            <h5>退出登录</h5>
                            <p className="muted">退出后需要重新输入 GitHub PAT。</p>
                          </div>
                        </div>
                        <div className="settings-section-actions">
                          <button
                            className="ghost settings-logout"
                            onClick={() => {
                              void logout();
                              setSettingsOpen(false);
                            }}
                          >
                            退出登录
                          </button>
                        </div>
                      </section>
                    </div>
                  </section>
                ) : null}
                {settingsMessage ? (
                  <p className={`settings-msg ${settingsMessageTone}`}>
                    {settingsMessage}
                  </p>
                ) : null}
              </div>
            </main>
          </div>
        </div>
      ) : null}

      <div className="content-stack">
        {error ? <div className="global-error">{error}</div> : null}

        <main className="workspace">
          <div className="workspace-stage">
            <div className="task-workspace">
              <section className="task-panel panel task-panel-main">
                <div className="panel-head panel-head-main panel-head-stack">
                  <div className="panel-head-copy">
                    <h3>{workspaceView === 'tasks' ? '任务队列' : 'Issues'}</h3>
                    <p>
                      {workspaceView === 'tasks'
                        ? '左侧切换任务，右侧持续查看执行态。'
                        : '自动模式下可人工查看候选 Issue，或直接本地录入任务。'}
                    </p>
                  </div>
                  <div className="sidebar-switch" aria-label="左侧列表切换">
                    <button
                      type="button"
                      aria-pressed={workspaceView === 'tasks'}
                      className={`sidebar-switch-btn ${workspaceView === 'tasks' ? 'is-active' : ''}`}
                      onClick={() => setWorkspaceView('tasks')}
                    >
                      任务队列
                      <span>{snapshot.tasks.length}</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={workspaceView === 'issues'}
                      className={`sidebar-switch-btn ${workspaceView === 'issues' ? 'is-active' : ''}`}
                      onClick={() => setWorkspaceView('issues')}
                    >
                      Issues
                      <span>{openIssueCount}</span>
                    </button>
                  </div>
                </div>

                <div className="manual-entry-card">
                  <div className="manual-entry-copy">
                    <span className="manual-entry-kicker">Manual</span>
                    <strong>本地录入任务</strong>
                    <small>
                      直接描述要在 {snapshot.selectedRepo?.name ?? '当前仓库'} 完成的事项，不必先建
                      Issue。
                    </small>
                  </div>
                  <button type="button" className="ghost manual-entry-btn" onClick={handleOpenLocalTask}>
                    <Plus aria-hidden="true" />
                    新建
                  </button>
                </div>

                {workspaceView === 'tasks' ? (
                  <div className="task-queue-column">
                    <div className="task-section-label">
                      <span>Queue</span>
                      <small>自动模式下，这里是排队和历史任务的入口。</small>
                    </div>
                    <div className="task-scroll">
                      {snapshot.tasks.map((task) => (
                        <button
                          key={task.id}
                          className={`task-item ${activeTask?.id === task.id ? 'active' : ''}`}
                          onClick={() => setActiveTaskId(task.id)}
                        >
                          <p>{formatTaskTitle(task)}</p>
                          <div>
                            <div className="task-item-badges">
                              <span className={`task-origin-badge task-origin-${task.source}`}>
                                {taskSourceLabel(task.source)}
                              </span>
                              <span className={statusClass(task.status)}>{statusLabel(task.status)}</span>
                            </div>
                            <small>{formatTaskListTime(task)}</small>
                          </div>
                          {task.result?.error ? (
                            <small className="task-error-hint" title={task.result.error}>
                              {task.result.error}
                            </small>
                          ) : null}
                          {task.logs.length > 0 ? (
                            <small className="task-log-hint" title={task.logs[task.logs.length - 1]?.text}>
                              {task.logs[task.logs.length - 1]?.text}
                            </small>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="issue-sidebar">
                    <div className="issue-sidebar-filters">
                      <select
                        value={filter.state}
                        onChange={(event) => setFilter({ state: event.target.value as 'open' | 'closed' | 'all' })}
                      >
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                        <option value="all">All</option>
                      </select>

                      <select
                        value={filter.assignee}
                        onChange={(event) => setFilter({ assignee: event.target.value as 'me' | 'all' })}
                      >
                        <option value="all">全部分配</option>
                        <option value="me">分配给我</option>
                      </select>

                      <input
                        value={filter.keyword}
                        onChange={(event) => setFilter({ keyword: event.target.value })}
                        placeholder="搜索标题"
                      />

                      <select
                        value={filter.labels[0] ?? ''}
                        onChange={(event) =>
                          setFilter({ labels: event.target.value ? [event.target.value] : [] })
                        }
                      >
                        <option value="">全部标签</option>
                        {labelOptions.map((label) => (
                          <option value={label} key={label}>
                            {label}
                          </option>
                        ))}
                      </select>

                      <button disabled={loading || refreshing} onClick={() => void handleFilterRefresh()}>
                        {refreshing ? '刷新中...' : '刷新'}
                      </button>
                    </div>

                    <div className="list-scroll issue-sidebar-list">
                      {snapshot.issues.map((issue) => {
                        const task = issueTaskMap.get(issue.number);
                        return (
                          <button
                            key={issue.id}
                            className={`issue-item ${selectedIssue?.number === issue.number ? 'active' : ''}`}
                            onClick={() => {
                              void loadIssueDetail(issue.number);
                              setIssueDetailOpen(true);
                            }}
                          >
                            <div className="issue-head">
                              <span>#{issue.number}</span>
                              {task ? <span className={statusClass(task.status)}>{statusLabel(task.status)}</span> : null}
                            </div>
                            <p>{issue.title}</p>
                            <div className="labels">
                              {issue.labels.slice(0, 3).map((label) => (
                                <span key={label.id} style={{ borderColor: `#${label.color}` }}>
                                  {label.name}
                                </span>
                              ))}
                            </div>
                            <small>
                              @{issue.author} · {formatTime(issue.updatedAt)}
                            </small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>

              <aside className="task-rail panel">
                <div className="task-rail-shell">
                  <div className="task-rail-header">
                    <div>
                      <p className="eyebrow">Run Console</p>
                      <h4>{formatTaskReference(activeTask)}</h4>
                    </div>
                    <div className="task-rail-header-right">
                      {activeTask ? (
                        <span className={statusClass(activeTask.status)}>{statusLabel(activeTask.status)}</span>
                      ) : null}
                      {activeTask && activeTask.startedAt ? (
                        <span className="task-timer">
                          {formatDuration(
                            activeTask.status === 'running'
                              ? Math.floor((timerNow - activeTask.startedAt) / 1000)
                              : activeTask.finishedAt
                                ? Math.floor((activeTask.finishedAt - activeTask.startedAt) / 1000)
                                : Math.floor((Date.now() - activeTask.startedAt) / 1000)
                          )}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {activeTask ? (
                    <div className="task-detail task-detail-main">
                      <div className="task-meta">
                        <div className="task-meta-copy">
                          <h4>{activeTask.issueTitle}</h4>
                          <p className="task-meta-context">
                            {taskSourceLabel(activeTask.source)} · {activeTask.repoFullName}
                          </p>
                        </div>
                        {activeTask.status === 'pending' || activeTask.status === 'running' ? (
                          <button className="ghost" onClick={() => void cancelTask(activeTask.id)}>
                            取消任务
                          </button>
                        ) : null}
                      </div>

                      {activeTask.result?.error ? (
                        <div className="task-error-banner">{activeTask.result.error}</div>
                      ) : null}

                      {activeTask.source === 'local' && activeTask.taskBody ? (
                        <section className="changes">
                          <h5>任务说明</h5>
                          <label className="task-body-text">{activeTask.taskBody}</label>
                        </section>
                      ) : null}

                      {activeTask.changedFiles.length > 0 ? (
                        <section className="changes">
                          <h5>变更文件</h5>
                          {activeTask.changedFiles.map((file) => (
                            <label key={file.path}>{file.path}</label>
                          ))}
                        </section>
                      ) : null}

                      {activeTask.branchName ? (
                        <section className="changes">
                          <h5>目标分支</h5>
                          <label>{activeTask.branchName}</label>
                        </section>
                      ) : null}

                      {activeTask.result?.prUrl ? (
                        <button
                          className="pr-link"
                          type="button"
                          onClick={() => void window.desktopApi.openExternal(activeTask.result?.prUrl ?? '')}
                        >
                          打开 PR #{activeTask.result.prNumber}
                        </button>
                      ) : null}

                      {!activeTask.result?.prUrl && activeTask.result?.branchUrl ? (
                        <button
                          className="pr-link"
                          type="button"
                          onClick={() => void window.desktopApi.openExternal(activeTask.result?.branchUrl ?? '')}
                        >
                          打开分支 {activeTask.branchName}
                        </button>
                      ) : null}

                      <div className="task-log-section">
                        {taskSteps.length > 0 ? (
                          <section className="task-steps-panel" aria-label="执行步骤">
                            <div className="task-steps-head">
                              <span className="task-steps-title">执行步骤</span>
                              <span className="task-steps-count">共 {taskSteps.length} 步</span>
                            </div>
                            <div className="task-steps-rail">
                              {taskSteps.map((step, index) => (
                                <div
                                  key={`${index + 1}-${step.label}`}
                                  className={`task-step task-step-${step.tone}`}
                                  title={step.label}
                                >
                                  <span className="task-step-index">{index + 1}</span>
                                  <span className="task-step-label">{step.label}</span>
                                </div>
                              ))}
                            </div>
                          </section>
                        ) : null}

                        <div className="log-box" ref={logBoxRef}>
                          {renderedLogs.length === 0 ? (
                            <p className="log-empty">等待日志输出...</p>
                          ) : (
                            <>
                              <button
                                className="log-copy-btn icon-plain"
                                type="button"
                                onClick={copyAllLogs}
                                title="复制全部日志"
                              >
                                {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                              </button>
                              {renderedLogs.map((log) => {
                                if (log.kind === 'diff') {
                                  return (
                                    <div key={`${log.at}-${log.filePath ?? log.text}`} className="log-row log-row-diff">
                                      <div className="log-main log-main-diff">
                                        <span className="log-time">{new Date(log.at).toLocaleTimeString()}</span>
                                        <section className="log-diff-card" aria-label={log.filePath ?? 'Diff 日志'}>
                                          <div className="log-diff-head">
                                            <span className="log-diff-kicker">DIFF</span>
                                            <strong className="log-diff-path">{log.filePath ?? log.text}</strong>
                                            {log.isDiffTruncated ? (
                                              <span className="log-diff-chip">已截断</span>
                                            ) : null}
                                          </div>
                                          <pre className="log-diff-code">
                                            {log.diff.split('\n').map((line, index) => (
                                              <span
                                                key={`${log.at}-${log.filePath ?? 'diff'}-${index}`}
                                                className={`task-diff-line ${diffLineClass(line)}`}
                                              >
                                                {line || ' '}
                                              </span>
                                            ))}
                                          </pre>
                                        </section>
                                      </div>
                                    </div>
                                  );
                                }

                                const label = logLevelLabel(log.level);
                                return (
                                  <div key={`${log.at}-${log.text}`} className={`log-row log-row-${log.level}`}>
                                    {label && <span className={`log-badge log-badge-${log.level}`}>{label}</span>}
                                    <div className="log-main">
                                      <span className="log-time">{new Date(log.at).toLocaleTimeString()}</span>
                                      <p className={`log-text log-${log.level}`}>{log.text}</p>
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state empty-state-rail">
                      <strong>暂无任务</strong>
                      <p className="muted">当前没有排队或执行中的任务。你可以直接本地录入，或者从 Issues 发起。</p>
                      <div className="empty-state-actions">
                        <button className="ghost" type="button" onClick={handleOpenLocalTask}>
                          本地录入
                        </button>
                        <button className="ghost" type="button" onClick={() => setWorkspaceView('issues')}>
                          打开 Issues
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            </div>
          </div>
        </main>
      </div>

      {issueDetailOpen && selectedIssue ? (
        <div className="issue-modal-mask" onClick={() => setIssueDetailOpen(false)}>
          <div className="issue-modal" onClick={(event) => event.stopPropagation()}>
            <div className="issue-modal-head">
              <div>
                <p className="eyebrow">Issue Detail</p>
                <h3>
                  #{selectedIssue.number} {selectedIssue.title}
                </h3>
                <p className="muted detail-meta">
                  @{selectedIssue.author} · 更新时间 {formatTime(selectedIssue.updatedAt)}
                </p>
              </div>
              <button className="ghost icon-btn" onClick={() => setIssueDetailOpen(false)} aria-label="关闭">
                ×
              </button>
            </div>
            <div className="issue-modal-actions">
              <button onClick={() => { void launchTask('bugfix'); setIssueDetailOpen(false); }}>AI 修复</button>
              <button className="ghost" onClick={() => { void launchTask('feature'); setIssueDetailOpen(false); }}>
                AI 开发
              </button>
            </div>
            <article
              className="markdown"
              dangerouslySetInnerHTML={{
                __html: markdownHtml(selectedIssue.body || '_Issue 正文为空_')
              }}
            />
            <section className="comment-block">
              <h4>评论（最多 10 条）</h4>
              {selectedIssue.comments.length === 0 ? (
                <p className="muted">暂无评论</p>
              ) : (
                selectedIssue.comments.map((comment) => (
                  <div key={comment.id} className="comment-item">
                    <div>
                      <strong>{comment.author}</strong>
                      <span>{formatTime(comment.createdAt)}</span>
                    </div>
                    <p>{comment.body}</p>
                  </div>
                ))
              )}
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
