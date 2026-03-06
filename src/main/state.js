import { scheduleTaskHistoryPersist } from './task-history/store';
class MainState {
    account;
    repos = [];
    selectedRepo;
    issues = [];
    selectedIssue;
    tasks = [];
    getSnapshot() {
        return {
            account: this.account,
            repos: this.repos,
            selectedRepo: this.selectedRepo,
            issues: this.issues,
            selectedIssue: this.selectedIssue,
            tasks: this.tasks
        };
    }
    setAccount(account) {
        this.account = account;
    }
    setRepos(repos) {
        this.repos = repos;
    }
    setSelectedRepo(repo) {
        this.selectedRepo = repo;
    }
    setIssues(issues) {
        this.issues = issues;
    }
    setSelectedIssue(issue) {
        this.selectedIssue = issue;
    }
    setTasks(tasks) {
        this.tasks = [...tasks];
        this.persistTasks();
    }
    upsertTask(nextTask) {
        const index = this.tasks.findIndex((task) => task.id === nextTask.id);
        if (index === -1) {
            this.tasks = [nextTask, ...this.tasks];
            this.persistTasks();
            return nextTask;
        }
        const cloned = [...this.tasks];
        cloned[index] = nextTask;
        this.tasks = cloned;
        this.persistTasks();
        return nextTask;
    }
    patchTask(taskId, patch) {
        const current = this.tasks.find((task) => task.id === taskId);
        if (!current) {
            throw new Error(`Task ${taskId} not found`);
        }
        return this.upsertTask({ ...current, ...patch });
    }
    getTask(taskId) {
        return this.tasks.find((task) => task.id === taskId);
    }
    clearOnLogout() {
        this.account = undefined;
        this.repos = [];
        this.selectedRepo = undefined;
        this.issues = [];
        this.selectedIssue = undefined;
    }
    persistTasks() {
        scheduleTaskHistoryPersist(this.tasks);
    }
}
export const mainState = new MainState();
