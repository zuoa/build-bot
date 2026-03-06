import { create } from 'zustand';
import type {
  AppStateSnapshot,
  ConfirmCommitInput,
  EnqueueTaskInput,
  IssueDetail,
  IssueFilter,
  TaskEntity
} from '../../shared/types';

interface AppStore {
  snapshot: AppStateSnapshot;
  filter: IssueFilter;
  loading: boolean;
  error?: string;
  initialized: boolean;
  listenerAttached: boolean;
  init: () => Promise<void>;
  attachTaskListener: () => void;
  setError: (message?: string) => void;
  setFilter: (patch: Partial<IssueFilter>) => void;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  loadRepos: (page?: number) => Promise<void>;
  selectRepo: (fullName: string) => Promise<void>;
  loadIssues: () => Promise<void>;
  loadIssueDetail: (issueNumber: number) => Promise<IssueDetail>;
  enqueueTask: (input: EnqueueTaskInput) => Promise<void>;
  confirmTaskCommit: (input: ConfirmCommitInput) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
}

const defaultSnapshot: AppStateSnapshot = {
  repos: [],
  issues: [],
  tasks: []
};

const defaultFilter: IssueFilter = {
  state: 'open',
  labels: [],
  assignee: 'all',
  keyword: ''
};

function upsertTask(tasks: TaskEntity[], nextTask: TaskEntity): TaskEntity[] {
  const index = tasks.findIndex((task) => task.id === nextTask.id);
  if (index === -1) {
    return [nextTask, ...tasks];
  }
  const copied = [...tasks];
  copied[index] = nextTask;
  return copied;
}

function getApi() {
  const api = (window as Window & { desktopApi?: typeof window.desktopApi }).desktopApi;
  if (!api) {
    throw new Error('桌面桥接初始化失败：preload 未注入 desktopApi');
  }
  return api;
}

export const useAppStore = create<AppStore>((set, get) => ({
  snapshot: defaultSnapshot,
  filter: defaultFilter,
  loading: false,
  initialized: false,
  listenerAttached: false,

  async init() {
    set({ loading: true, error: undefined });
    try {
      const snapshot = await getApi().getState();
      set({ snapshot, initialized: true });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : '初始化失败',
        initialized: true
      });
    } finally {
      set({ loading: false });
    }
  },

  attachTaskListener() {
    if (get().listenerAttached) {
      return;
    }

    getApi().onTaskUpdated((task) => {
      set((state) => ({
        snapshot: {
          ...state.snapshot,
          tasks: upsertTask(state.snapshot.tasks, task)
        }
      }));
    });

    set({ listenerAttached: true });
  },

  setError(message) {
    set({ error: message });
  },

  setFilter(patch) {
    set((state) => ({ filter: { ...state.filter, ...patch } }));
  },

  async loginWithToken(token) {
    set({ loading: true, error: undefined });
    try {
      await getApi().loginWithToken(token.trim());
      const snapshot = await getApi().getState();
      set({ snapshot });
      await get().loadRepos(1);
      await get().loadIssues();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '登录失败' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  async logout() {
    set({ loading: true, error: undefined });
    try {
      await getApi().logout();
      set({ snapshot: defaultSnapshot, filter: defaultFilter });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '退出失败' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  async loadRepos(page = 1) {
    try {
      if (page !== 1) {
        const loaded = await getApi().listRepos(page);
        set((state) => ({
          snapshot: {
            ...state.snapshot,
            repos: [
              ...state.snapshot.repos.filter((repo) => !loaded.some((item) => item.id === repo.id)),
              ...loaded
            ],
            selectedRepo: state.snapshot.selectedRepo ?? loaded[0]
          }
        }));
        return;
      }

      const allRepos: AppStateSnapshot['repos'] = [];
      const seen = new Set<number>();
      const maxPages = 10;
      for (let currentPage = 1; currentPage <= maxPages; currentPage += 1) {
        const pageRepos = await getApi().listRepos(currentPage);
        pageRepos.forEach((repo) => {
          if (!seen.has(repo.id)) {
            seen.add(repo.id);
            allRepos.push(repo);
          }
        });
        if (pageRepos.length < 20) {
          break;
        }
      }

      set((state) => {
        const hasSelected =
          state.snapshot.selectedRepo &&
          allRepos.some((repo) => repo.fullName === state.snapshot.selectedRepo?.fullName);

        return {
          snapshot: {
            ...state.snapshot,
            repos: allRepos,
            selectedRepo: hasSelected ? state.snapshot.selectedRepo : allRepos[0]
          }
        };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '仓库加载失败' });
      throw error;
    }
  },

  async selectRepo(fullName) {
    set({ loading: true, error: undefined });
    try {
      await getApi().selectRepo(fullName);
      const snapshot = await getApi().getState();
      // Repo 切换后清空标签筛选，避免旧仓库标签导致结果全空。
      set({
        snapshot,
        filter: {
          ...get().filter,
          labels: []
        }
      });
      await get().loadIssues();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '切换仓库失败' });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  async loadIssues() {
    const state = get();
    let { snapshot } = state;
    const filter = state.filter;
    try {
      if (!snapshot.selectedRepo) {
        const repos = await getApi().listRepos(1);
        if (repos.length === 0) {
          set({
            snapshot: { ...snapshot, repos: [], issues: [], selectedRepo: undefined },
            error: '当前账号下没有可访问仓库'
          });
          return;
        }
        snapshot = { ...snapshot, repos, selectedRepo: repos[0] };
        set({ snapshot });
      }

      await getApi().listIssues(filter);
      const nextSnapshot = await getApi().getState();
      set({ snapshot: nextSnapshot });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Issue 加载失败' });
      throw error;
    }
  },

  async loadIssueDetail(issueNumber) {
    try {
      const detail = await getApi().getIssueDetail(issueNumber);
      set((state) => ({
        snapshot: { ...state.snapshot, selectedIssue: detail }
      }));
      return detail;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Issue 详情加载失败' });
      throw error;
    }
  },

  async enqueueTask(input) {
    try {
      const task = await getApi().enqueueTask(input);
      set((state) => ({
        snapshot: {
          ...state.snapshot,
          tasks: upsertTask(state.snapshot.tasks, task)
        }
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '任务创建失败' });
      throw error;
    }
  },

  async confirmTaskCommit(input) {
    try {
      const task = await getApi().confirmTaskCommit(input);
      set((state) => ({
        snapshot: {
          ...state.snapshot,
          tasks: upsertTask(state.snapshot.tasks, task)
        }
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '提交失败' });
      throw error;
    }
  },

  async cancelTask(taskId) {
    try {
      await getApi().cancelTask(taskId);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : '取消失败' });
      throw error;
    }
  }
}));
