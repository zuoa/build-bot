import type { AutoModeSettings } from '../../shared/types';
import type { TaskManager } from '../queue/task-manager';
export declare class AutoModeService {
    private readonly taskManager;
    private settings;
    private timer?;
    private running;
    constructor(taskManager: TaskManager);
    init(): Promise<void>;
    getSettings(): AutoModeSettings;
    saveSettings(next: AutoModeSettings): Promise<AutoModeSettings>;
    stop(): void;
    runTick(trigger: 'interval' | 'init' | 'settings-updated' | 'manual'): Promise<number>;
    private resetTimer;
}
