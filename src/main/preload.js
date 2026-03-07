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
    saveAutoModeSettings(settings) {
        const normalized = {
            enabled: Boolean(settings?.enabled),
            pollIntervalSec: typeof settings?.pollIntervalSec === 'number' && Number.isFinite(settings.pollIntervalSec)
                ? settings.pollIntervalSec
                : 180,
            includeLabels: Array.isArray(settings?.includeLabels)
                ? settings.includeLabels.filter((item) => typeof item === 'string')
                : ['bug', 'enhancement']
        };
        return ipcRenderer.invoke(IPC_CHANNELS.SAVE_AUTO_MODE_SETTINGS, normalized);
    },
    saveAgentSettings(settings) {
        return ipcRenderer.invoke(IPC_CHANNELS.SAVE_AGENT_SETTINGS, settings);
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
    cancelTask(taskId) {
        return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_TASK, taskId);
    },
    onTaskUpdated(listener) {
        const wrapped = (_event, payload) => {
            listener(payload);
        };
        ipcRenderer.on(IPC_CHANNELS.TASK_UPDATED, wrapped);
        return () => ipcRenderer.removeListener(IPC_CHANNELS.TASK_UPDATED, wrapped);
    },
    openExternal(url) {
        return ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url);
    }
};
contextBridge.exposeInMainWorld('desktopApi', desktopApi);
