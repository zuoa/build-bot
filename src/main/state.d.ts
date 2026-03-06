import type { AppStateSnapshot, AuthSession, IssueDetail, IssueSummary, RepoSummary, TaskEntity } from '../shared/types';
declare class MainState {
    private account?;
    private repos;
    private selectedRepo?;
    private issues;
    private selectedIssue?;
    private tasks;
    getSnapshot(): AppStateSnapshot;
    setAccount(account?: AuthSession): void;
    setRepos(repos: RepoSummary[]): void;
    setSelectedRepo(repo?: RepoSummary): void;
    setIssues(issues: IssueSummary[]): void;
    setSelectedIssue(issue?: IssueDetail): void;
    upsertTask(nextTask: TaskEntity): TaskEntity;
    patchTask(taskId: string, patch: Partial<TaskEntity>): TaskEntity;
    getTask(taskId: string): TaskEntity | undefined;
    clearOnLogout(): void;
}
export declare const mainState: MainState;
export {};
