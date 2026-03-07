export type TaskType = 'bugfix' | 'feature';
export type AgentProvider = 'claude' | 'codex';
export type ReviewStrictness = 'strict' | 'normal' | 'lenient';
export type SubmissionMode = 'branch' | 'pr';
export type TaskSource = 'issue' | 'local';

export interface AgentRoleSettings {
  implementationProvider: AgentProvider;
  reviewProvider: AgentProvider;
  reviewStrictness: ReviewStrictness;
  reviewMaxRounds: number;
  submissionMode: SubmissionMode;
  directBranchName: string;
}

export interface AgentProviderStatus {
  provider: AgentProvider;
  available?: boolean;
  detail: string;
  determined: boolean;
}

export interface AuthSession {
  token: string;
  login: string;
  avatarUrl?: string;
  name?: string;
}

export interface RepoSummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  updatedAt: string;
}

export interface IssueLabel {
  id: number;
  name: string;
  color: string;
}

export interface IssueSummary {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  updatedAt: string;
  labels: IssueLabel[];
  author: string;
}

export interface IssueComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
}

export interface IssueDetail extends IssueSummary {
  body: string;
  createdAt: string;
  comments: IssueComment[];
}

export interface IssueFilter {
  state: 'open' | 'closed' | 'all';
  labels: string[];
  assignee: 'me' | 'all';
  keyword: string;
}

export interface AutoModeSettings {
  enabled: boolean;
  pollIntervalSec: number;
  includeLabels: string[];
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'awaiting_human_confirmation'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskLog {
  at: number;
  level: 'info' | 'success' | 'error' | 'thinking';
  text: string;
}

export interface TaskFileChange {
  path: string;
  selected: boolean;
}

export interface TaskResult {
  submissionMode?: SubmissionMode;
  prUrl?: string;
  prNumber?: number;
  branchUrl?: string;
  commitSha?: string;
  error?: string;
}

export interface TaskEntity {
  id: string;
  source: TaskSource;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
  taskBody?: string;
  taskType: TaskType;
  status: TaskStatus;
  startedAt?: number;
  finishedAt?: number;
  logs: TaskLog[];
  changedFiles: TaskFileChange[];
  branchName?: string;
  workspacePath?: string;
  result?: TaskResult;
}

export interface IssueTaskInput {
  repoFullName: string;
  issueNumber: number;
  taskType: TaskType;
  source?: 'issue';
  customGuidelines?: string;
}

export interface LocalTaskInput {
  repoFullName: string;
  taskType: TaskType;
  source: 'local';
  title: string;
  body?: string;
}

export type EnqueueTaskInput = IssueTaskInput | LocalTaskInput;

export interface AppStateSnapshot {
  account?: AuthSession;
  repos: RepoSummary[];
  selectedRepo?: RepoSummary;
  issues: IssueSummary[];
  selectedIssue?: IssueDetail;
  tasks: TaskEntity[];
}
