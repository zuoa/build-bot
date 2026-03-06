import type { AutoModeSettings, AppStateSnapshot, EnqueueTaskInput, IssueDetail, IssueFilter, RepoSummary, TaskEntity } from './types';
export interface DesktopApi {
    loginWithToken(token: string): Promise<boolean>;
    logout(): Promise<void>;
    getSettings(): Promise<{
        hasAnthropicApiKey: boolean;
        autoMode: AutoModeSettings;
    }>;
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
    openExternal(url: string): Promise<void>;
}
export declare const IPC_CHANNELS: {
    readonly LOGIN_WITH_TOKEN: "auth:login-with-token";
    readonly LOGOUT: "auth:logout";
    readonly GET_SETTINGS: "settings:get";
    readonly SAVE_ANTHROPIC_API_KEY: "settings:save-anthropic-api-key";
    readonly CLEAR_ANTHROPIC_API_KEY: "settings:clear-anthropic-api-key";
    readonly SAVE_AUTO_MODE_SETTINGS: "settings:save-auto-mode-settings";
    readonly GET_STATE: "app:get-state";
    readonly LIST_REPOS: "github:list-repos";
    readonly SELECT_REPO: "github:select-repo";
    readonly LIST_ISSUES: "github:list-issues";
    readonly GET_ISSUE_DETAIL: "github:get-issue-detail";
    readonly ENQUEUE_TASK: "task:enqueue";
    readonly CANCEL_TASK: "task:cancel";
    readonly TASK_UPDATED: "event:task-updated";
    readonly OPEN_EXTERNAL: "app:open-external";
};
