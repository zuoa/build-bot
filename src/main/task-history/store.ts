import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  TaskAgentSession,
  TaskAgentSessions,
  TaskEntity,
  TaskFileChange,
  TaskLog,
  TaskSource,
  TaskStatus
} from '../../shared/types';

const TASK_HISTORY_FILE = 'task-history.json';
const TASK_HISTORY_LIMIT = 200;
const TASK_LOG_LIMIT = 800;
const STORE_VERSION = 1;
const PERSIST_DEBOUNCE_MS = 300;

interface PersistedTaskHistory {
  version: number;
  tasks: TaskEntity[];
}

let pendingTasks: TaskEntity[] | undefined;
let latestTasks: TaskEntity[] | undefined;
let persistTimer: NodeJS.Timeout | undefined;
let activeWrite: Promise<void> | undefined;

function getTaskHistoryPath(): string {
  return path.join(app.getPath('userData'), TASK_HISTORY_FILE);
}

function taskSortValue(task: TaskEntity): number {
  return Math.max(
    task.finishedAt ?? 0,
    task.startedAt ?? 0,
    task.logs[task.logs.length - 1]?.at ?? 0
  );
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return (
    value === 'pending' ||
    value === 'running' ||
    value === 'awaiting_human_confirmation' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

function normalizeTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeLogs(value: unknown): TaskLog[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return undefined;
      }
      const log = entry as Partial<TaskLog>;
      if (
        typeof log.at !== 'number' ||
        !Number.isFinite(log.at) ||
        typeof log.text !== 'string' ||
        !log.text.trim()
      ) {
        return undefined;
      }
      const level = log.level;
      if (level !== 'info' && level !== 'success' && level !== 'error' && level !== 'thinking') {
        return undefined;
      }
      const normalized: TaskLog = {
        at: log.at,
        level,
        text: log.text
      };
      if (log.kind === 'diff') {
        normalized.kind = 'diff';
      }
      if (typeof log.filePath === 'string') {
        normalized.filePath = log.filePath;
      }
      if (typeof log.diff === 'string') {
        normalized.diff = log.diff;
      }
      if (log.isDiffTruncated === true) {
        normalized.isDiffTruncated = true;
      }
      return normalized;
    })
    .filter((entry): entry is TaskLog => Boolean(entry))
    .slice(-TASK_LOG_LIMIT);
}

function normalizeChangedFiles(value: unknown): TaskFileChange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return undefined;
      }
      const file = entry as Partial<TaskFileChange>;
      if (typeof file.path !== 'string' || !file.path.trim()) {
        return undefined;
      }
      const normalized: TaskFileChange = {
        path: file.path,
        selected: file.selected !== false
      };
      if (typeof file.diff === 'string') {
        normalized.diff = file.diff;
      }
      if (file.isDiffTruncated === true) {
        normalized.isDiffTruncated = true;
      }
      return normalized;
    })
    .filter((entry): entry is TaskFileChange => Boolean(entry));
}

function normalizeTaskSource(value: unknown): TaskSource {
  return value === 'local' ? 'local' : 'issue';
}

function normalizeAgentSession(value: unknown): TaskAgentSession | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const session = value as Partial<TaskAgentSession>;
  if (
    (session.provider !== 'claude' && session.provider !== 'codex') ||
    typeof session.sessionId !== 'string' ||
    !session.sessionId.trim() ||
    typeof session.updatedAt !== 'number' ||
    !Number.isFinite(session.updatedAt)
  ) {
    return undefined;
  }

  return {
    provider: session.provider,
    sessionId: session.sessionId,
    updatedAt: session.updatedAt
  };
}

function normalizeAgentSessions(value: unknown): TaskAgentSessions | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const sessions = value as Partial<TaskAgentSessions>;
  const implementation = normalizeAgentSession(sessions.implementation);
  const review = normalizeAgentSession(sessions.review);

  if (!implementation && !review) {
    return undefined;
  }

  return {
    implementation,
    review
  };
}

function normalizeTask(value: unknown): TaskEntity | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const task = value as Partial<TaskEntity>;
  if (
    typeof task.id !== 'string' ||
    typeof task.repoFullName !== 'string' ||
    typeof task.issueTitle !== 'string' ||
    typeof task.issueNumber !== 'number' ||
    !Number.isFinite(task.issueNumber) ||
    (task.taskType !== 'bugfix' && task.taskType !== 'feature') ||
    !isTaskStatus(task.status)
  ) {
    return undefined;
  }

  return {
    id: task.id,
    source: normalizeTaskSource(task.source),
    repoFullName: task.repoFullName,
    issueNumber: task.issueNumber,
    issueTitle: task.issueTitle,
    taskBody: typeof task.taskBody === 'string' ? task.taskBody : undefined,
    taskType: task.taskType,
    status: task.status,
    startedAt: normalizeTimestamp(task.startedAt),
    finishedAt: normalizeTimestamp(task.finishedAt),
    logs: normalizeLogs(task.logs),
    changedFiles: normalizeChangedFiles(task.changedFiles),
    branchName: typeof task.branchName === 'string' ? task.branchName : undefined,
    workspacePath: typeof task.workspacePath === 'string' ? task.workspacePath : undefined,
    agentSessions: normalizeAgentSessions(task.agentSessions),
    result:
      task.result && typeof task.result === 'object'
        ? {
            submissionMode: task.result.submissionMode === 'pr' ? 'pr' : task.result.submissionMode === 'branch' ? 'branch' : undefined,
            prUrl: typeof task.result.prUrl === 'string' ? task.result.prUrl : undefined,
            prNumber:
              typeof task.result.prNumber === 'number' && Number.isFinite(task.result.prNumber)
                ? task.result.prNumber
                : undefined,
            branchUrl: typeof task.result.branchUrl === 'string' ? task.result.branchUrl : undefined,
            commitSha: typeof task.result.commitSha === 'string' ? task.result.commitSha : undefined,
            error: typeof task.result.error === 'string' ? task.result.error : undefined
          }
        : undefined
  };
}

function markRestoredTask(task: TaskEntity, now: number): TaskEntity {
  if (task.status === 'running') {
    return {
      ...task,
      status: 'failed',
      finishedAt: task.finishedAt ?? now,
      result: {
        ...task.result,
        error: task.result?.error ?? '应用重启后，执行中的任务已中断'
      },
      logs: [
        ...task.logs,
        {
          at: now,
          level: 'error' as const,
          text: '应用重启后，该任务未继续执行，已标记为失败'
        }
      ].slice(-TASK_LOG_LIMIT)
    };
  }

  if (task.status === 'pending') {
    return {
      ...task,
      status: 'cancelled',
      finishedAt: task.finishedAt ?? now,
      result: {
        ...task.result,
        error: task.result?.error ?? '应用重启后，排队中的任务未继续执行'
      },
      logs: [
        ...task.logs,
        {
          at: now,
          level: 'error' as const,
          text: '应用重启后，该任务未重新排队，已标记为取消'
        }
      ].slice(-TASK_LOG_LIMIT)
    };
  }

  return task;
}

function limitAndSortTasks(tasks: TaskEntity[]): TaskEntity[] {
  return [...tasks]
    .sort((left, right) => taskSortValue(right) - taskSortValue(left))
    .slice(0, TASK_HISTORY_LIMIT);
}

function prepareTasksForPersist(tasks: TaskEntity[]): TaskEntity[] {
  return limitAndSortTasks(tasks);
}

function restoreTasks(tasks: TaskEntity[]): TaskEntity[] {
  const now = Date.now();
  return limitAndSortTasks(tasks.map((task) => markRestoredTask(task, now)));
}

async function persistTasks(tasks: TaskEntity[]): Promise<void> {
  const filePath = getTaskHistoryPath();
  const directory = path.dirname(filePath);
  const payload: PersistedTaskHistory = {
    version: STORE_VERSION,
    tasks: prepareTasksForPersist(tasks)
  };
  const serialized = JSON.stringify(payload, null, 2);
  const tempPath = `${filePath}.tmp`;

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, serialized, 'utf8');
  await rename(tempPath, filePath);
}

function queuePersist(): void {
  if (activeWrite || !pendingTasks) {
    return;
  }

  const nextTasks = pendingTasks;
  pendingTasks = undefined;
  activeWrite = persistTasks(nextTasks)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[BuildBot][TaskHistory] persist failed: ${message}`);
    })
    .finally(() => {
      activeWrite = undefined;
      if (pendingTasks) {
        queuePersist();
      }
    });
}

export function scheduleTaskHistoryPersist(tasks: TaskEntity[]): void {
  latestTasks = tasks;
  pendingTasks = tasks;
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    queuePersist();
  }, PERSIST_DEBOUNCE_MS);
}

export async function loadTaskHistory(): Promise<TaskEntity[]> {
  const filePath = getTaskHistoryPath();

  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as Partial<PersistedTaskHistory>;
    if (!Array.isArray(parsed.tasks)) {
      return [];
    }
    return restoreTasks(
      parsed.tasks.map((task) => normalizeTask(task)).filter((task): task is TaskEntity => Boolean(task))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      return [];
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[BuildBot][TaskHistory] load failed: ${message}`);
    return [];
  }
}

export function flushTaskHistorySync(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }

  const tasksToFlush = pendingTasks ?? latestTasks;
  if (!tasksToFlush) {
    return;
  }

  try {
    const filePath = getTaskHistoryPath();
    const payload: PersistedTaskHistory = {
      version: STORE_VERSION,
      tasks: prepareTasksForPersist(tasksToFlush)
    };
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    pendingTasks = undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[BuildBot][TaskHistory] flush failed: ${message}`);
  }
}
