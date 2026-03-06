export type TaskType = 'bugfix' | 'feature';

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
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'awaiting_commit'
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
  prUrl?: string;
  prNumber?: number;
  commitSha?: string;
  error?: string;
}

export interface TaskEntity {
  id: string;
  repoFullName: string;
  issueNumber: number;
  issueTitle: string;
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

export interface EnqueueTaskInput {
  repoFullName: string;
  issueNumber: number;
  taskType: TaskType;
  customGuidelines?: string;
}

export interface ConfirmCommitInput {
  taskId: string;
  selectedFiles: string[];
}

export interface AppStateSnapshot {
  account?: AuthSession;
  repos: RepoSummary[];
  selectedRepo?: RepoSummary;
  issues: IssueSummary[];
  selectedIssue?: IssueDetail;
  tasks: TaskEntity[];
}
