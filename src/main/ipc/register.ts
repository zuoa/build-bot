import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/api';
import type {
  AutoModeSettings,
  ConfirmCommitInput,
  EnqueueTaskInput,
  IssueFilter
} from '../../shared/types';
import { AutoModeService } from '../automation/service';
import { bootstrapSessionFromKeychain, loginWithToken, logoutGithub } from '../github/client';
import { getIssueDetail, getRepo, listIssues, listRepos } from '../github/service';
import { initTaskManager } from '../queue/task-manager';
import {
  clearAnthropicApiKey,
  hasAnthropicApiKey,
  saveAnthropicApiKey
} from '../settings/service';
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
  const autoModeService = new AutoModeService(taskManager);
  const autoModeReady = autoModeService.init().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[BuildBot][AutoMode] init failed: ${message}`);
  });

  ipcMain.handle(IPC_CHANNELS.LOGIN_WITH_TOKEN, async (_, token: string) => {
    const account = await loginWithToken(token);
    mainState.setAccount(account);
    await autoModeReady;
    if (autoModeService.getSettings().enabled) {
      void autoModeService.runTick('manual');
    }
    return true;
  });

  ipcMain.handle(IPC_CHANNELS.LOGOUT, async () => {
    await logoutGithub();
    mainState.clearOnLogout();
  });

  ipcMain.handle(IPC_CHANNELS.GET_SETTINGS, async () => {
    await autoModeReady;
    return {
      hasAnthropicApiKey: await hasAnthropicApiKey(),
      autoMode: autoModeService.getSettings()
    };
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_ANTHROPIC_API_KEY, async (_, key: string) => {
    await saveAnthropicApiKey(key);
  });

  ipcMain.handle(IPC_CHANNELS.CLEAR_ANTHROPIC_API_KEY, async () => {
    await clearAnthropicApiKey();
  });

  ipcMain.handle(IPC_CHANNELS.SAVE_AUTO_MODE_SETTINGS, async (_, settings?: AutoModeSettings) => {
    await autoModeReady;
    return autoModeService.saveSettings({
      enabled: Boolean(settings?.enabled),
      pollIntervalSec:
        typeof settings?.pollIntervalSec === 'number' && Number.isFinite(settings.pollIntervalSec)
          ? settings.pollIntervalSec
          : 180
    });
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
    await autoModeReady;
    if (autoModeService.getSettings().enabled) {
      void autoModeService.runTick('manual');
    }
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
    return taskManager.enqueue(input, issue.title);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIRM_TASK_COMMIT, async (_, input: ConfirmCommitInput) => {
    return taskManager.confirmCommit(input);
  });

  ipcMain.handle(IPC_CHANNELS.CANCEL_TASK, async (_, taskId: string) => {
    await taskManager.cancelTask(taskId);
  });
}
