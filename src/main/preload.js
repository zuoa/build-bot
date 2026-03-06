import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/api';
const desktopApi = {
    loginWithToken(token) {
        return ipcRenderer.invoke(IPC_CHANNELS.LOGIN_WITH_TOKEN, token);
    },
    logout() {
        return ipcRenderer.invoke(IPC_CHANNELS.LOGOUT);
    },
    getSettings() {
        return ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS);
    },
    saveAnthropicApiKey(key) {
        return ipcRenderer.invoke(IPC_CHANNELS.SAVE_ANTHROPIC_API_KEY, key);
    },
    clearAnthropicApiKey() {
        return ipcRenderer.invoke(IPC_CHANNELS.CLEAR_ANTHROPIC_API_KEY);
    },
    getState() {
        return ipcRenderer.invoke(IPC_CHANNELS.GET_STATE);
    },
    listRepos(page = 1) {
        return ipcRenderer.invoke(IPC_CHANNELS.LIST_REPOS, page);
    },
    selectRepo(fullName) {
        return ipcRenderer.invoke(IPC_CHANNELS.SELECT_REPO, fullName);
    },
    listIssues(filter) {
        return ipcRenderer.invoke(IPC_CHANNELS.LIST_ISSUES, filter);
    },
    getIssueDetail(issueNumber) {
        return ipcRenderer.invoke(IPC_CHANNELS.GET_ISSUE_DETAIL, issueNumber);
    },
    enqueueTask(input) {
        return ipcRenderer.invoke(IPC_CHANNELS.ENQUEUE_TASK, input);
    },
    confirmTaskCommit(input) {
        return ipcRenderer.invoke(IPC_CHANNELS.CONFIRM_TASK_COMMIT, input);
    },
    cancelTask(taskId) {
        return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_TASK, taskId);
    },
    onTaskUpdated(listener) {
        const wrapped = (_event, payload) => {
            listener(payload);
        };
        ipcRenderer.on(IPC_CHANNELS.TASK_UPDATED, wrapped);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.TASK_UPDATED, wrapped);
    }
};
contextBridge.exposeInMainWorld('desktopApi', desktopApi);
