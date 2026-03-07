import { DEFAULT_AUTO_ENQUEUE_LABELS, hasAutoEnqueueLabel, inferTaskType } from '../../shared/issue-auto-enqueue';
import { listIssues } from '../github/service';
import { getAutoModeSettings, saveAutoModeSettings } from '../settings/service';
import { mainState } from '../state';
import { HUMAN_CONFIRMATION_LABEL } from '../security/issue-guard';
const DEFAULT_AUTO_MODE_SETTINGS = {
    enabled: false,
    pollIntervalSec: 180,
    includeLabels: DEFAULT_AUTO_ENQUEUE_LABELS
};
const AUTO_ENQUEUE_LIMIT_PER_TICK = 5;
export class AutoModeService {
    taskManager;
    settings = DEFAULT_AUTO_MODE_SETTINGS;
    timer;
    running = false;
    constructor(taskManager) {
        this.taskManager = taskManager;
    }
    async init() {
        this.settings = await getAutoModeSettings();
        this.resetTimer();
        if (this.settings.enabled) {
            void this.runTick('init');
        }
    }
    getSettings() {
        return { ...this.settings };
    }
    async saveSettings(next) {
        const saved = await saveAutoModeSettings(next);
        this.settings = saved;
        this.resetTimer();
        if (saved.enabled) {
            void this.runTick('settings-updated');
        }
        return { ...saved };
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    async runTick(trigger) {
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
            const existingIssueNumbers = new Set(mainState
                .getSnapshot()
                .tasks.filter((task) => task.repoFullName === repo.fullName)
                .map((task) => task.issueNumber));
            let enqueued = 0;
            for (const issue of issues) {
                if (enqueued >= AUTO_ENQUEUE_LIMIT_PER_TICK) {
                    break;
                }
                if (existingIssueNumbers.has(issue.number)) {
                    continue;
                }
                if (issue.labels.some((label) => label.name === HUMAN_CONFIRMATION_LABEL)) {
                    continue;
                }
                if (!hasAutoEnqueueLabel(issue, this.settings.includeLabels)) {
                    continue;
                }
                const taskType = inferTaskType(issue);
                this.taskManager.enqueue({
                    repoFullName: repo.fullName,
                    issueNumber: issue.number,
                    taskType
                }, issue.title);
                existingIssueNumbers.add(issue.number);
                enqueued += 1;
            }
            if (enqueued > 0) {
                console.info(`[BuildBot][AutoMode] repo=${repo.fullName} enqueued=${enqueued} trigger=${trigger}`);
            }
            return enqueued;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[BuildBot][AutoMode] tick failed (${trigger}): ${message}`);
            return 0;
        }
        finally {
            this.running = false;
        }
    }
    resetTimer() {
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
