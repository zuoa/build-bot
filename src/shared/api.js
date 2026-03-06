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
    CONFIRM_TASK_COMMIT: 'task:confirm-commit',
    CANCEL_TASK: 'task:cancel',
    TASK_UPDATED: 'event:task-updated'
};
