import type {
  AutoModeSettings,
  AppStateSnapshot,
  EnqueueTaskInput,
  IssueDetail,
  IssueFilter,
  RepoSummary,
  TaskEntity
} from './types';

export interface DesktopApi {
  loginWithToken(token: string): Promise<boolean>;
  logout(): Promise<void>;
  getSettings(): Promise<{ hasAnthropicApiKey: boolean; autoMode: AutoModeSettings }>;
  saveAnthropicApiKey(key: string): Promise<void>;
  clearAnthropicApiKey(): Promise<void>;
  saveAutoModeSettings(settings: AutoModeSettings): Promise<AutoModeSettings>;
  getState(): Promise<AppStateSnapshot>;
  listRepos(page?: number): Promise<RepoSummary[]>;
  selectRepo(fullName: string): Promise<void>;
  listIssues(filter: IssueFilter): Promise<void>;
  getIssueDetail(issueNumber: number): Promise<IssueDetail>;
  enqueueTask(input: EnqueueTaskInput): Promise<TaskEntity>;
  cancelTask(taskId: string): Promise<void>;
  onTaskUpdated(listener: (task: TaskEntity) => void): () => void;
}

export const IPC_CHANNELS = {
  LOGIN_WITH_TOKEN: 'auth:login-with-token',
  LOGOUT: 'auth:logout',
  GET_SETTINGS: 'settings:get',
  SAVE_ANTHROPIC_API_KEY: 'settings:save-anthropic-api-key',
  CLEAR_ANTHROPIC_API_KEY: 'settings:clear-anthropic-api-key',
  SAVE_AUTO_MODE_SETTINGS: 'settings:save-auto-mode-settings',
  GET_STATE: 'app:get-state',
  LIST_REPOS: 'github:list-repos',
  SELECT_REPO: 'github:select-repo',
  LIST_ISSUES: 'github:list-issues',
  GET_ISSUE_DETAIL: 'github:get-issue-detail',
  ENQUEUE_TASK: 'task:enqueue',
  CANCEL_TASK: 'task:cancel',
  TASK_UPDATED: 'event:task-updated'
} as const;
