import type {
  AppStateSnapshot,
  AuthSession,
  IssueDetail,
  IssueSummary,
  RepoSummary,
  TaskEntity
} from '../shared/types';
import { scheduleTaskHistoryPersist } from './task-history/store';

class MainState {
  private account?: AuthSession;
  private repos: RepoSummary[] = [];
  private selectedRepo?: RepoSummary;
  private issues: IssueSummary[] = [];
  private selectedIssue?: IssueDetail;
  private tasks: TaskEntity[] = [];

  getSnapshot(): AppStateSnapshot {
    return {
      account: this.account,
      repos: this.repos,
      selectedRepo: this.selectedRepo,
      issues: this.issues,
      selectedIssue: this.selectedIssue,
      tasks: this.tasks
    };
  }

  setAccount(account?: AuthSession): void {
    this.account = account;
  }

  setRepos(repos: RepoSummary[]): void {
    this.repos = repos;
  }

  setSelectedRepo(repo?: RepoSummary): void {
    this.selectedRepo = repo;
  }

  setIssues(issues: IssueSummary[]): void {
    this.issues = issues;
  }

  setSelectedIssue(issue?: IssueDetail): void {
    this.selectedIssue = issue;
  }

  setTasks(tasks: TaskEntity[]): void {
    this.tasks = [...tasks];
    this.persistTasks();
  }

  upsertTask(nextTask: TaskEntity): TaskEntity {
    const index = this.tasks.findIndex((task) => task.id === nextTask.id);
    if (index === -1) {
      this.tasks = [nextTask, ...this.tasks];
      this.persistTasks();
      return nextTask;
    }
    const cloned = [...this.tasks];
    cloned[index] = nextTask;
    this.tasks = cloned;
    this.persistTasks();
    return nextTask;
  }

  patchTask(taskId: string, patch: Partial<TaskEntity>): TaskEntity {
    const current = this.tasks.find((task) => task.id === taskId);
    if (!current) {
      throw new Error(`Task ${taskId} not found`);
    }
    return this.upsertTask({ ...current, ...patch });
  }

  getTask(taskId: string): TaskEntity | undefined {
    return this.tasks.find((task) => task.id === taskId);
  }

  clearOnLogout(): void {
    this.account = undefined;
    this.repos = [];
    this.selectedRepo = undefined;
    this.issues = [];
    this.selectedIssue = undefined;
  }

  private persistTasks(): void {
    scheduleTaskHistoryPersist(this.tasks);
  }
}

export const mainState = new MainState();
