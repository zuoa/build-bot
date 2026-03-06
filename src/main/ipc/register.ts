import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/api';
import type { ConfirmCommitInput, EnqueueTaskInput, IssueFilter } from '../../shared/types';
import { bootstrapSessionFromKeychain, loginWithToken, logoutGithub } from '../github/client';
import { getIssueDetail, getRepo, listIssues, listRepos } from '../github/service';
import { initTaskManager } from '../queue/task-manager';
import { mainState } from '../state';

export async function bootstrapAuthFromKeychain(): Promise<void> {
  const account = await bootstrapSessionFromKeychain();
  if (account) {
    mainState.setAccount(account);
  }
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const taskManager = initTaskManager((task) => {
    mainWindow.webContents.send(IPC_CHANNELS.TASK_UPDATED, task);
  });

  ipcMain.handle(IPC_CHANNELS.LOGIN_WITH_TOKEN, async (_, token: string) => {
    const account = await loginWithToken(token);
    mainState.setAccount(account);
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.LOGOUT, async () => {
    await logoutGithub();
    mainState.clearOnLogout();
  });

  ipcMain.handle(IPC_CHANNELS.GET_STATE, () => {
    return mainState.getSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.LIST_REPOS, async (_, page = 1) => {
    console.info(`[BuildBot][IPC] listRepos page=${page}`);
    const repos = await listRepos(page);
    if (page === 1) {
      mainState.setRepos(repos);
      if (repos.length > 0 && !mainState.getSnapshot().selectedRepo) {
        mainState.setSelectedRepo(repos[0]);
      }
    } else {
      const merged = [...mainState.getSnapshot().repos, ...repos];
      mainState.setRepos(merged);
    }
    return repos;
  });

  ipcMain.handle(IPC_CHANNELS.SELECT_REPO, async (_, fullName: string) => {
    console.info(`[BuildBot][IPC] selectRepo fullName=${fullName}`);
    const repo = await getRepo(fullName);
    mainState.setSelectedRepo(repo);
  });

  ipcMain.handle(IPC_CHANNELS.LIST_ISSUES, async (_, filter: IssueFilter) => {
    const selected = mainState.getSnapshot().selectedRepo;
    if (!selected) {
      throw new Error('请先选择仓库');
    }
    console.info(
      `[BuildBot][IPC] listIssues repo=${selected.fullName} state=${filter.state} labels=${filter.labels.join(
        ','
      )} assignee=${filter.assignee} keyword=${filter.keyword}`
    );
    const issues = await listIssues(selected.fullName, filter);
    mainState.setIssues(issues);
    console.info(`[BuildBot][IPC] listIssues done count=${issues.length}`);
  });

  ipcMain.handle(IPC_CHANNELS.GET_ISSUE_DETAIL, async (_, issueNumber: number) => {
    const selected = mainState.getSnapshot().selectedRepo;
    if (!selected) {
      throw new Error('请先选择仓库');
    }
    const detail = await getIssueDetail(selected.fullName, issueNumber);
    mainState.setSelectedIssue(detail);
    return detail;
  });

  ipcMain.handle(IPC_CHANNELS.ENQUEUE_TASK, async (_, input: EnqueueTaskInput) => {
    const issue = await getIssueDetail(input.repoFullName, input.issueNumber);
    mainState.setSelectedIssue(issue);
    return taskManager.enqueue(input, issue);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIRM_TASK_COMMIT, async (_, input: ConfirmCommitInput) => {
    return taskManager.confirmCommit(input);
  });

  ipcMain.handle(IPC_CHANNELS.CANCEL_TASK, async (_, taskId: string) => {
    await taskManager.cancelTask(taskId);
  });
}
