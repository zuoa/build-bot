export const IPC_CHANNELS = {
    LOGIN_WITH_TOKEN: 'auth:login-with-token',
    LOGOUT: 'auth:logout',
    GET_SETTINGS: 'settings:get',
    SAVE_AUTO_MODE_SETTINGS: 'settings:save-auto-mode-settings',
    SAVE_AGENT_SETTINGS: 'settings:save-agent-settings',
    GET_STATE: 'app:get-state',
    LIST_REPOS: 'github:list-repos',
    SELECT_REPO: 'github:select-repo',
    LIST_ISSUES: 'github:list-issues',
    GET_ISSUE_DETAIL: 'github:get-issue-detail',
    ENQUEUE_TASK: 'task:enqueue',
    CANCEL_TASK: 'task:cancel',
    TASK_UPDATED: 'event:task-updated',
    OPEN_EXTERNAL: 'app:open-external'
};
