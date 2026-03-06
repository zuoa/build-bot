import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FolderOpen, Settings } from 'lucide-react';
import { marked } from 'marked';
import type { TaskEntity } from '../shared/types';
import AppLogo from './components/AppLogo';
import { useAppStore } from './store/useAppStore';

marked.setOptions({ breaks: true, gfm: true });

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
type WorkspaceView = 'tasks' | 'issues';

function formatTime(value?: number | string): string {
  if (!value) return '-';
  const date = new Date(value);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function statusLabel(status: TaskEntity['status']): string {
  switch (status) {
    case 'pending':
      return '等待中';
    case 'running':
      return '执行中';
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

function logLevelLabel(level: TaskEntity['logs'][number]['level']): string {
  switch (level) {
    case 'thinking':
      return '思考';
    case 'success':
      return '完成';
    case 'error':
      return '错误';
    default:
      return '日志';
  }
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
  const [repoCandidate, setRepoCandidate] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [hasAnthropicApiKey, setHasAnthropicApiKey] = useState(false);
  const [autoModeEnabled, setAutoModeEnabled] = useState(false);
  const [autoModePollIntervalSec, setAutoModePollIntervalSec] = useState(180);
  const [autoModeCountdown, setAutoModeCountdown] = useState(0);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string>();
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('tasks');
  const logBoxRef = useRef<HTMLDivElement | null>(null);

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
      setHasAnthropicApiKey(settings.hasAnthropicApiKey);
      setAutoModeEnabled(settings.autoMode.enabled);
      setAutoModePollIntervalSec(settings.autoMode.pollIntervalSec);
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

  const renderedLogs = useMemo(() => {
    if (!activeTask) {
      return [];
    }
    const merged: Array<{ at: number; level: TaskEntity['logs'][number]['level']; text: string }> = [];
    activeTask.logs.forEach((log) => {
      const text = log.text.trim();
      if (!text) {
        return;
      }
      const prev = merged[merged.length - 1];
      const canMerge =
        prev &&
        prev.level === log.level &&
        log.at - prev.at <= 1200 &&
        prev.text.length < 240 &&
        text.length < 180 &&
        !/\n/.test(prev.text) &&
        !/\n/.test(text);
      if (canMerge) {
        prev.text = `${prev.text} ${text}`.replace(/\s+/g, ' ').trim();
        prev.at = log.at;
        return;
      }
      merged.push({ at: log.at, level: log.level, text });
    });
    return merged.slice(-500);
  }, [activeTask]);

  useEffect(() => {
    const box = logBoxRef.current;
    if (!box) {
      return;
    }
    box.scrollTop = box.scrollHeight;
  }, [activeTask?.id, renderedLogs.length]);

  const labelOptions = useMemo(() => {
    const set = new Set<string>();
    snapshot.issues.forEach((issue) => {
      issue.labels.forEach((label) => set.add(label.name));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [snapshot.issues]);

  const issueTaskMap = useMemo(() => {
    const map = new Map<number, TaskEntity>();
    snapshot.tasks.forEach((task) => {
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

  async function handleOpenSettings(): Promise<void> {
    setSettingsOpen(true);
    setAnthropicKey('');
    setSettingsMessage(undefined);
    await refreshSettingsStatus();
  }

  async function handleSaveAnthropicKey(): Promise<void> {
    if (!anthropicKey.trim()) {
      setSettingsMessage('API Key 不能为空');
      return;
    }
    setSavingSettings(true);
    setSettingsMessage(undefined);
    try {
      await window.desktopApi.saveAnthropicApiKey(anthropicKey);
      setHasAnthropicApiKey(true);
      setAnthropicKey('');
      setSettingsMessage('保存成功');
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      setSettingsMessage(message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleClearAnthropicKey(): Promise<void> {
    setSavingSettings(true);
    setSettingsMessage(undefined);
    try {
      await window.desktopApi.clearAnthropicApiKey();
      setHasAnthropicApiKey(false);
      setAnthropicKey('');
      setSettingsMessage('已清除');
    } catch (err) {
      const message = err instanceof Error ? err.message : '清除失败';
      setSettingsMessage(message);
    } finally {
      setSavingSettings(false);
    }
  }

  async function persistAutoModeSettings(
    enabled: boolean,
    pollIntervalSec: number,
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
        pollIntervalSec: normalized
      });
      setAutoModeEnabled(saved.enabled);
      setAutoModePollIntervalSec(saved.pollIntervalSec);
      if (withSettingsMessage) {
        setSettingsMessage(saved.enabled ? '自动模式已开启' : '自动模式已关闭');
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

  async function handleSaveAutoModeSettings(): Promise<void> {
    await persistAutoModeSettings(autoModeEnabled, autoModePollIntervalSec, true);
  }

  async function handleQuickToggleAutoMode(): Promise<void> {
    setError(undefined);
    await persistAutoModeSettings(!autoModeEnabled, autoModePollIntervalSec, false);
  }

  if (!initialized) {
    return <div className="loading-screen">正在初始化 BuildBot Desktop...</div>;
  }

  if (!snapshot.account) {
    return (
      <div className="login-wrap">
        <section className="login-card">
          <div className="brand-lockup login-brand">
            <AppLogo />
            <div>
              <p className="eyebrow">BUILDBOT DESKTOP</p>
              <h1>Issue to PR</h1>
            </div>
          </div>
          <p className="login-copy">
            使用 GitHub Personal Access Token 登录（建议权限：`repo` + `workflow`）。
            Token 会写入系统 Keychain。
          </p>
          <form onSubmit={handleLogin} className="login-form">
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="ghp_xxx"
              autoFocus
            />
            <button disabled={loading} type="submit">
              {loading ? '登录中...' : '登录并开始'}
            </button>
          </form>
          {error ? <p className="error-msg">{error}</p> : null}
        </section>
      </div>
    );
  }

  return (
    <div className={`shell${IS_MAC ? ' is-mac' : ''}`}>
      <div className="window-drag-strip" aria-hidden="true" />

      <div className="top-brand-strip">
        <AppLogo />
      </div>

      <header className="topbar">
        <div className="topbar-main">
          <div className="header-actions header-actions-left">
            <span className="repo-label">{snapshot.selectedRepo?.fullName ?? '未选择仓库'}</span>
            <span className="user-label">@{snapshot.account.login}</span>
          </div>

          <div className="header-actions">
            <button
              className="ghost icon-btn"
              onClick={handleOpenRepoSwitcher}
              title="切换仓库"
              aria-label="切换仓库"
            >
              <FolderOpen aria-hidden="true" />
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
          </div>
        </div>

        <div className="topbar-stats">
          <div className="stat-card">
            <span>Issues</span>
            <strong>{snapshot.issues.length}</strong>
            <small>{openIssueCount} Open</small>
          </div>
          <div className="stat-card">
            <span>运行中</span>
            <strong>{taskStats.running}</strong>
            <small>{taskStats.pending} 等待中</small>
          </div>
          <div className="stat-card">
            <span>失败</span>
            <strong>{taskStats.failed}</strong>
            <small>含取消任务</small>
          </div>
          <div className="stat-card">
            <span>已完成</span>
            <strong>{taskStats.completed}</strong>
            <small>总任务 {snapshot.tasks.length}</small>
          </div>
        </div>
      </header>

      <button
        className="icon-btn icon-plain global-settings-btn"
        onClick={() => void handleOpenSettings()}
        title="设置"
        aria-label="设置"
      >
        <Settings aria-hidden="true" />
      </button>

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

      {settingsOpen ? (
        <div className="settings-modal-mask" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <h3>设置</h3>
            <p className="muted">Anthropic API Key 状态：{hasAnthropicApiKey ? '已配置' : '未配置'}</p>
            <input
              type="password"
              value={anthropicKey}
              onChange={(event) => setAnthropicKey(event.target.value)}
              placeholder="sk-ant-..."
            />
            <section className="auto-mode-section">
              <div className="auto-mode-head">
                <strong>自动模式</strong>
                <label className="toggle-line">
                  <input
                    type="checkbox"
                    checked={autoModeEnabled}
                    onChange={(event) => setAutoModeEnabled(event.target.checked)}
                  />
                  启用
                </label>
              </div>
              <p className="muted">
                开启后会定时拉取当前仓库 Open Issue，自动触发开发任务，并进入右侧任务队列串行执行。
              </p>
              <label className="auto-mode-interval">
                轮询间隔（秒）
                <input
                  type="number"
                  min={30}
                  max={3600}
                  step={10}
                  value={autoModePollIntervalSec}
                  onChange={(event) => {
                    const next = event.target.valueAsNumber;
                    setAutoModePollIntervalSec(Number.isFinite(next) ? next : 180);
                  }}
                />
              </label>
              <button
                className="ghost"
                disabled={savingSettings}
                onClick={() => void handleSaveAutoModeSettings()}
              >
                {savingSettings ? '保存中...' : '保存自动模式'}
              </button>
            </section>
            {settingsMessage ? <p className="settings-msg">{settingsMessage}</p> : null}
            <div className="settings-actions">
              <button disabled={savingSettings} onClick={() => void handleSaveAnthropicKey()}>
                {savingSettings ? '保存中...' : '保存 API Key'}
              </button>
              <button className="ghost" disabled={savingSettings} onClick={() => void handleClearAnthropicKey()}>
                清除
              </button>
              <button className="ghost settings-logout" onClick={() => void logout()}>
                退出登录
              </button>
              <button className="ghost" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="content-stack">
        {error ? <div className="global-error">{error}</div> : null}

        <main className="workspace">
          <div className="task-workspace">
          <section className="task-panel panel task-panel-main">
            <div className="panel-head panel-head-main panel-head-stack">
              <div className="panel-head-copy">
                <h3>{workspaceView === 'tasks' ? '任务队列' : 'Issues'}</h3>
                <p>
                  {workspaceView === 'tasks'
                    ? '左侧切换任务，右侧持续查看执行态。'
                    : '自动模式下可人工查看候选 Issue，必要时手动发起任务。'}
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
                      <p>
                        #{task.issueNumber} {task.issueTitle}
                      </p>
                      <div>
                        <span className={statusClass(task.status)}>{statusLabel(task.status)}</span>
                        <small>{formatTime(task.startedAt)}</small>
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
                  <h4>{activeTask ? `#${activeTask.issueNumber}` : '等待任务'}</h4>
                </div>
                {activeTask ? (
                  <span className={statusClass(activeTask.status)}>{statusLabel(activeTask.status)}</span>
                ) : null}
              </div>

              {activeTask ? (
                <div className="task-detail task-detail-main">
                  <div className="task-meta">
                    <h4>{activeTask.issueTitle}</h4>
                    <button className="ghost" onClick={() => void cancelTask(activeTask.id)}>
                      取消任务
                    </button>
                  </div>

                  {activeTask.result?.error ? (
                    <div className="task-error-banner">{activeTask.result.error}</div>
                  ) : null}

                  {activeTask.changedFiles.length > 0 ? (
                    <section className="changes">
                      <h5>变更文件</h5>
                      {activeTask.changedFiles.map((file) => (
                        <label key={file.path}>{file.path}</label>
                      ))}
                    </section>
                  ) : null}

                  {activeTask.result?.prUrl ? (
                    <a className="pr-link" href={activeTask.result.prUrl} target="_blank" rel="noreferrer">
                      打开 PR #{activeTask.result.prNumber}
                    </a>
                  ) : null}

                  <div className="log-box" ref={logBoxRef}>
                    {renderedLogs.length === 0 ? (
                      <p className="log-empty">等待日志输出...</p>
                    ) : (
                      renderedLogs.map((log) => (
                        <div key={`${log.at}-${log.text}`} className={`log-row log-row-${log.level}`}>
                          <span className={`log-badge log-badge-${log.level}`}>{logLevelLabel(log.level)}</span>
                          <div className="log-main">
                            <span className="log-time">{new Date(log.at).toLocaleTimeString()}</span>
                            <p className={`log-text log-${log.level}`}>{log.text}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <div className="empty-state empty-state-rail">
                  <strong>暂无任务</strong>
                  <p className="muted">当前没有排队或执行中的任务。需要人工介入时，可切到 Issues 发起任务。</p>
                  <button className="ghost" type="button" onClick={() => setWorkspaceView('issues')}>
                    打开 Issues
                  </button>
                </div>
              )}
            </div>
          </aside>
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
