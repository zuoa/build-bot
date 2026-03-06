import type { AutoModeSettings, IssueSummary, TaskType } from '../../shared/types';
import { listIssues } from '../github/service';
import { getAutoModeSettings, saveAutoModeSettings } from '../settings/service';
import { mainState } from '../state';
import type { TaskManager } from '../queue/task-manager';

const DEFAULT_AUTO_MODE_SETTINGS: AutoModeSettings = {
  enabled: false,
  pollIntervalSec: 180
};

const AUTO_ENQUEUE_LIMIT_PER_TICK = 5;

function inferTaskType(issue: IssueSummary): TaskType {
  const labelText = issue.labels.map((item) => item.name).join(' ');
  const source = `${issue.title} ${labelText}`.toLowerCase();
  const bugHint = /(bug|fix|error|defect|crash|regression|故障|报错|修复|异常|崩溃)/;
  return bugHint.test(source) ? 'bugfix' : 'feature';
}

export class AutoModeService {
  private settings: AutoModeSettings = DEFAULT_AUTO_MODE_SETTINGS;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly taskManager: TaskManager) {}

  async init(): Promise<void> {
    this.settings = await getAutoModeSettings();
    this.resetTimer();
    if (this.settings.enabled) {
      void this.runTick('init');
    }
  }

  getSettings(): AutoModeSettings {
    return { ...this.settings };
  }

  async saveSettings(next: AutoModeSettings): Promise<AutoModeSettings> {
    const saved = await saveAutoModeSettings(next);
    this.settings = saved;
    this.resetTimer();
    if (saved.enabled) {
      void this.runTick('settings-updated');
    }
    return { ...saved };
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runTick(trigger: 'interval' | 'init' | 'settings-updated' | 'manual'): Promise<number> {
    if (!this.settings.enabled && trigger !== 'manual') {
      return 0;
    }
    if (this.running) {
      return 0;
    }

    const snapshot = mainState.getSnapshot();
    const repo = snapshot.selectedRepo;
    if (!snapshot.account || !repo) {
      return 0;
    }

    this.running = true;
    try {
      const issues = await listIssues(repo.fullName, {
        state: 'open',
        labels: [],
        assignee: 'all',
        keyword: ''
      });
      mainState.setIssues(issues);

      const existingIssueNumbers = new Set(
        mainState
          .getSnapshot()
          .tasks.filter((task) => task.repoFullName === repo.fullName)
          .map((task) => task.issueNumber)
      );

      let enqueued = 0;
      for (const issue of issues) {
        if (enqueued >= AUTO_ENQUEUE_LIMIT_PER_TICK) {
          break;
        }
        if (existingIssueNumbers.has(issue.number)) {
          continue;
        }

        const taskType = inferTaskType(issue);
        this.taskManager.enqueue(
          {
            repoFullName: repo.fullName,
            issueNumber: issue.number,
            taskType
          },
          issue.title
        );
        existingIssueNumbers.add(issue.number);
        enqueued += 1;
      }

      if (enqueued > 0) {
        console.info(
          `[BuildBot][AutoMode] repo=${repo.fullName} enqueued=${enqueued} trigger=${trigger}`
        );
      }
      return enqueued;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[BuildBot][AutoMode] tick failed (${trigger}): ${message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private resetTimer(): void {
    this.stop();
    if (!this.settings.enabled) {
      return;
    }

    const intervalMs = this.settings.pollIntervalSec * 1000;
    this.timer = setInterval(() => {
      void this.runTick('interval');
    }, intervalMs);
  }
}
