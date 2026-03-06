import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { marked } from 'marked';
import type { TaskEntity } from '../shared/types';
import AppLogo from './components/AppLogo';
import { useAppStore } from './store/useAppStore';

marked.setOptions({ breaks: true, gfm: true });

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

function markdownHtml(content: string): string {
  try {
    const html = marked.parse(content) as string;
    return html;
  } catch {
    return content;
  }
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
  const [activeTaskId, setActiveTaskId] = useState<string>('');
  const [fileSelection, setFileSelection] = useState<Record<string, Record<string, boolean>>>({});

  useEffect(() => {
    attachTaskListener();
    void init().then(async () => {
      const state = useAppStore.getState().snapshot;
      if (state.account) {
        await loadRepos(1);
        if (useAppStore.getState().snapshot.selectedRepo) {
          await loadIssues();
        }
      }
    });
  }, [attachTaskListener, init, loadIssues, loadRepos]);

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
    await loadIssues();
  }

  async function handleRepoChange(fullName: string): Promise<void> {
    await selectRepo(fullName);
  }

  async function launchTask(mode: 'bugfix' | 'feature'): Promise<void> {
    if (!selectedIssue || !snapshot.selectedRepo) {
      setError('请先选择 Issue');
      return;
    }

    await enqueueTask({
      repoFullName: snapshot.selectedRepo.fullName,
      issueNumber: selectedIssue.number,
      taskType: mode
    });
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
    <div className="shell">
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

          <button onClick={() => void handleFilterRefresh()}>刷新 Issue</button>
          <button className="ghost" onClick={() => void logout()}>
            退出
          </button>
        </div>
      </header>

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

              <div className="log-box">
                {activeTask.logs.map((log) => (
                  <p key={`${log.at}-${log.text}`} className={`log-${log.level}`}>
                    [{new Date(log.at).toLocaleTimeString()}] {log.text}
                  </p>
                ))}
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
