import { BrowserWindow } from 'electron';
export declare function bootstrapAuthFromKeychain(): Promise<void>;
export declare function registerIpcHandlers(mainWindow: BrowserWindow): void;
