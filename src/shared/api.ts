import type {
  AppStateSnapshot,
  ConfirmCommitInput,
  EnqueueTaskInput,
  IssueDetail,
  IssueFilter,
  RepoSummary,
  TaskEntity
} from './types';

export interface DesktopApi {
  loginWithToken(token: string): Promise<boolean>;
  logout(): Promise<void>;
  getState(): Promise<AppStateSnapshot>;
  listRepos(page?: number): Promise<RepoSummary[]>;
  selectRepo(fullName: string): Promise<void>;
  listIssues(filter: IssueFilter): Promise<void>;
  getIssueDetail(issueNumber: number): Promise<IssueDetail>;
  enqueueTask(input: EnqueueTaskInput): Promise<TaskEntity>;
  confirmTaskCommit(input: ConfirmCommitInput): Promise<TaskEntity>;
  cancelTask(taskId: string): Promise<void>;
  onTaskUpdated(listener: (task: TaskEntity) => void): () => void;
}

export const IPC_CHANNELS = {
  LOGIN_WITH_TOKEN: 'auth:login-with-token',
  LOGOUT: 'auth:logout',
  GET_STATE: 'app:get-state',
  LIST_REPOS: 'github:list-repos',
  SELECT_REPO: 'github:select-repo',
  LIST_ISSUES: 'github:list-issues',
  GET_ISSUE_DETAIL: 'github:get-issue-detail',
  ENQUEUE_TASK: 'task:enqueue',
  CONFIRM_TASK_COMMIT: 'task:confirm-commit',
  CANCEL_TASK: 'task:cancel',
  TASK_UPDATED: 'event:task-updated'
} as const;
