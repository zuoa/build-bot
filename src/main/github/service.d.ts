import type { IssueDetail, IssueFilter, IssueSummary, RepoSummary, TaskSource, TaskType } from '../../shared/types';
interface RepoRef {
    owner: string;
    repo: string;
}
export interface RepoBranchContext extends RepoRef {
    defaultBranch: string;
    token: string;
}
export interface ForkContext {
    upstream: RepoRef;
    fork: RepoRef;
    defaultBranch: string;
    token: string;
}
export interface PullRequestResult {
    number: number;
    url: string;
    existed: boolean;
}
export declare function splitRepoFullName(fullName: string): RepoRef;
export declare function listRepos(page?: number): Promise<RepoSummary[]>;
export declare function getRepo(fullName: string): Promise<RepoSummary>;
export declare function listIssues(repoFullName: string, filter: IssueFilter): Promise<IssueSummary[]>;
export declare function getIssueDetail(repoFullName: string, issueNumber: number): Promise<IssueDetail>;
export declare function addLabelToIssue(repoFullName: string, issueNumber: number, label: string): Promise<void>;
export declare function createIssueComment(repoFullName: string, issueNumber: number, body: string): Promise<void>;
export declare function ensureFork(repoFullName: string): Promise<ForkContext>;
export declare function buildBranchName(issueNumber: number, issueTitle: string): string;
export declare function createBranchForIssue(context: ForkContext, issueNumber: number, issueTitle: string): Promise<string>;
export declare function buildTaskBranchName(params: {
    source: TaskSource;
    issueNumber?: number;
    issueTitle: string;
}): string;
export declare function createBranchForTask(context: ForkContext, params: {
    source: TaskSource;
    issueNumber?: number;
    issueTitle: string;
}): Promise<string>;
export declare function ensureDirectBranch(repoFullName: string, branchName: string): Promise<RepoBranchContext>;
export declare function buildBranchUrl(repoFullName: string, branchName: string): string;
export declare function fetchReadmeHead(repoFullName: string): Promise<string>;
export declare function createPullRequest(params: {
    context: ForkContext;
    branchName: string;
    issueNumber?: number;
    issueTitle: string;
    taskType: TaskType;
    source?: TaskSource;
    changedFiles: string[];
    summary: string;
}): Promise<PullRequestResult>;
export {};
