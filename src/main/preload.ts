import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type DesktopApi } from '../shared/api';
import type {
  ConfirmCommitInput,
  EnqueueTaskInput,
  IssueFilter,
  TaskEntity
} from '../shared/types';

const desktopApi: DesktopApi = {
  loginWithToken(token: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.LOGIN_WITH_TOKEN, token);
  },
  logout() {
    return ipcRenderer.invoke(IPC_CHANNELS.LOGOUT);
  },
  getSettings() {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_SETTINGS);
  },
  saveAnthropicApiKey(key: string) {
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
  selectRepo(fullName: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.SELECT_REPO, fullName);
  },
  listIssues(filter: IssueFilter) {
    return ipcRenderer.invoke(IPC_CHANNELS.LIST_ISSUES, filter);
  },
  getIssueDetail(issueNumber: number) {
    return ipcRenderer.invoke(IPC_CHANNELS.GET_ISSUE_DETAIL, issueNumber);
  },
  enqueueTask(input: EnqueueTaskInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.ENQUEUE_TASK, input);
  },
  confirmTaskCommit(input: ConfirmCommitInput) {
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIRM_TASK_COMMIT, input);
  },
  cancelTask(taskId: string) {
    return ipcRenderer.invoke(IPC_CHANNELS.CANCEL_TASK, taskId);
  },
  onTaskUpdated(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TaskEntity) => {
      listener(payload);
    };
    ipcRenderer.on(IPC_CHANNELS.TASK_UPDATED, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.TASK_UPDATED, wrapped);
  }
};

contextBridge.exposeInMainWorld('desktopApi', desktopApi);
