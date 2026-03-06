import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { marked } from 'marked';
import type { TaskEntity } from '../shared/types';
import AppLogo from './components/AppLogo';
import { useAppStore } from './store/useAppStore';

marked.setOptions({ breaks: true, gfm: true });

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

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
    case 'awaiting_commit':
      return '待提交';
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
    case 'awaiting_commit':
      return 'status status-warn';
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
    confirmTaskCommit,
    cancelTask
  } = useAppStore();

  const [token, setToken] = useState('');
  const [repoJump, setRepoJump] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<string>('');
  const [fileSelection, setFileSelection] = useState<Record<string, Record<string, boolean>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [hasAnthropicApiKey, setHasAnthropicApiKey] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string>();
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

  async function handleRepoChange(fullName: string): Promise<void> {
    setRefreshing(true);
    setError(undefined);
    try {
      await selectRepo(fullName);
    } catch (err) {
      const message = err instanceof Error ? err.message : '切换仓库失败';
      setError(message);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRepoJump(): Promise<void> {
    const target = parseRepoTarget(repoJump);
    if (!target) {
      setError('请输入 owner/repo 或 GitHub Issue URL');
      return;
    }

    setRefreshing(true);
    setError(undefined);
    try {
      await selectRepo(target.fullName);
      if (target.issueNumber) {
        await loadIssueDetail(target.issueNumber);
      }
      setRepoJump('');
    } catch (err) {
      const message = err instanceof Error ? err.message : '跳转失败';
      setError(message);
    } finally {
      setRefreshing(false);
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

  async function handleConfirmCommit(task: TaskEntity): Promise<void> {
    const selected = task.changedFiles
      .filter((file) => fileSelection[task.id]?.[file.path] ?? true)
      .map((file) => file.path);

    await confirmTaskCommit({ taskId: task.id, selectedFiles: selected });
  }

  function toggleFile(taskId: string, filePath: string): void {
    setFileSelection((prev) => {
      const row = prev[taskId] ?? {};
      const next = !(row[filePath] ?? true);
      return {
        ...prev,
        [taskId]: {
          ...row,
          [filePath]: next
        }
      };
    });
  }

  if (!initialized) {
    return <div className="loading-screen">正在初始化 BuildBot Desktop MVP...</div>;
  }

  if (!snapshot.account) {
    return (
      <div className="login-wrap">
        <section className="login-card">
          <div className="brand-lockup login-brand">
            <AppLogo />
            <div>
              <p className="eyebrow">BUILDBOT DESKTOP · MVP</p>
              <h1>Issue to PR in Minutes</h1>
            </div>
          </div>
          <p>
            MVP 登录方式：GitHub Personal Access Token
            （建议权限：`repo`、`workflow`）。Token 会写入系统 Keychain。
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
      <header className="topbar">
        <div className="brand">
          <div className="brand-lockup">
            <AppLogo compact />
            <div>
              <p className="eyebrow">BuildBot Desktop MVP</p>
              <h2>{snapshot.account.login}</h2>
            </div>
          </div>
        </div>

        <div className="toolbar">
          <select
            value={snapshot.selectedRepo?.fullName ?? ''}
            onChange={(event) => void handleRepoChange(event.target.value)}
          >
            {snapshot.repos.map((repo) => (
              <option key={repo.id} value={repo.fullName}>
                {repo.fullName}
              </option>
            ))}
          </select>

          <input
            value={repoJump}
            onChange={(event) => setRepoJump(event.target.value)}
            placeholder="owner/repo 或 Issue URL"
          />
          <button className="ghost" disabled={loading || refreshing} onClick={() => void handleRepoJump()}>
            跳转
          </button>

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
            placeholder="搜索 Issue 标题"
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
            {refreshing ? '刷新中...' : '刷新 Issue'}
          </button>
          <button className="ghost" onClick={() => void handleOpenSettings()}>
            设置
          </button>
          <button className="ghost" onClick={() => void logout()}>
            退出
          </button>
        </div>
      </header>

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
            {settingsMessage ? <p className="settings-msg">{settingsMessage}</p> : null}
            <div className="settings-actions">
              <button disabled={savingSettings} onClick={() => void handleSaveAnthropicKey()}>
                {savingSettings ? '保存中...' : '保存 API Key'}
              </button>
              <button className="ghost" disabled={savingSettings} onClick={() => void handleClearAnthropicKey()}>
                清除
              </button>
              <button className="ghost" onClick={() => setSettingsOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="global-error">{error}</div> : null}

      <main className="workspace">
        <aside className="issue-list panel">
          <div className="panel-title">Issues ({snapshot.issues.length})</div>
          <div className="list-scroll">
            {snapshot.issues.map((issue) => {
              const task = issueTaskMap.get(issue.number);
              return (
                <button
                  key={issue.id}
                  className={`issue-item ${selectedIssue?.number === issue.number ? 'active' : ''}`}
                  onClick={() => void loadIssueDetail(issue.number)}
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
                  <small>{formatTime(issue.updatedAt)}</small>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="issue-detail panel">
          {selectedIssue ? (
            <>
              <div className="detail-head">
                <div>
                  <p className="eyebrow">Issue Detail</p>
                  <h3>
                    #{selectedIssue.number} {selectedIssue.title}
                  </h3>
                </div>
                <div className="detail-actions">
                  <button onClick={() => void launchTask('bugfix')}>AI 修复</button>
                  <button className="ghost" onClick={() => void launchTask('feature')}>
                    AI 开发
                  </button>
                </div>
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
            </>
          ) : (
            <div className="empty">从左侧选择一个 Issue 以查看详情</div>
          )}
        </section>

        <aside className="task-panel panel">
          <div className="panel-title">任务队列 ({snapshot.tasks.length})</div>
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
                  <small>{formatTime(task.startedAt ?? Date.now())}</small>
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

          {activeTask ? (
            <div className="task-detail">
              <div className="task-meta">
                <h4>
                  #{activeTask.issueNumber} · {statusLabel(activeTask.status)}
                </h4>
                <button className="ghost" onClick={() => void cancelTask(activeTask.id)}>
                  取消任务
                </button>
              </div>

              {activeTask.result?.error ? (
                <div className="task-error-banner">{activeTask.result.error}</div>
              ) : null}

              {activeTask.status === 'awaiting_commit' ? (
                <section className="changes">
                  <h5>待提交文件</h5>
                  {activeTask.changedFiles.map((file) => {
                    const selected = fileSelection[activeTask.id]?.[file.path] ?? true;
                    return (
                      <label key={file.path}>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleFile(activeTask.id, file.path)}
                        />
                        {file.path}
                      </label>
                    );
                  })}
                  <button onClick={() => void handleConfirmCommit(activeTask)}>确认提交并创建 PR</button>
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
            <div className="empty">暂无任务</div>
          )}
        </aside>
      </main>
    </div>
  );
}
