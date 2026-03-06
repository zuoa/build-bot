import { app, BrowserWindow, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapAuthFromKeychain, registerIpcHandlers } from './ipc/register';
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const APP_BG_COLOR = '#ECE7DE';
const APP_TITLE_SYMBOL_COLOR = '#1A2027';
const SHOULD_OPEN_DEVTOOLS = process.env.BUILDBOT_OPEN_DEVTOOLS === '1';
function resolvePreloadPath() {
    const mjsPath = path.join(currentDir, 'preload.mjs');
    if (existsSync(mjsPath)) {
        return mjsPath;
    }
    return path.join(currentDir, 'preload.js');
}
function resolveAppIconPath() {
    const candidates = [
        path.join(app.getAppPath(), 'assets/buildbot-dock.png'),
        path.join(currentDir, '../assets/buildbot-dock.png'),
        path.join(process.cwd(), 'assets/buildbot-dock.png')
    ];
    return candidates.find((candidate) => existsSync(candidate));
}
function applyDockIcon(iconPath) {
    if (process.platform !== 'darwin' || !iconPath) {
        return;
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
        return;
    }
    app.dock?.setIcon(icon);
}
async function createMainWindow() {
    const iconPath = resolveAppIconPath();
    const windowOptions = {
        width: 1460,
        height: 920,
        minWidth: 1100,
        minHeight: 760,
        title: 'BuildBot Desktop MVP',
        backgroundColor: APP_BG_COLOR,
        webPreferences: {
            preload: resolvePreloadPath(),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false
        }
    };
    if (process.platform === 'darwin') {
        windowOptions.titleBarStyle = 'hiddenInset';
    }
    else {
        if (iconPath) {
            windowOptions.icon = iconPath;
        }
        windowOptions.titleBarStyle = 'hidden';
        windowOptions.titleBarOverlay = {
            color: APP_BG_COLOR,
            symbolColor: APP_TITLE_SYMBOL_COLOR,
            height: 40
        };
    }
    const window = new BrowserWindow(windowOptions);
    registerIpcHandlers(window);
    applyDockIcon(iconPath);
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    const distHtmlPath = path.join(app.getAppPath(), 'dist/index.html');
    if (devServerUrl) {
        try {
            await window.loadURL(devServerUrl);
            if (SHOULD_OPEN_DEVTOOLS) {
                window.webContents.openDevTools({ mode: 'detach' });
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[BuildBot] failed to load dev server URL, fallback to dist:', message);
            await window.loadFile(distHtmlPath);
        }
    }
    else {
        await window.loadFile(distHtmlPath);
    }
    return window;
}
app
    .whenReady()
    .then(async () => {
    await bootstrapAuthFromKeychain();
    await createMainWindow();
    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await createMainWindow();
        }
    });
})
    .catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error('[BuildBot] app bootstrap failed:', message);
    app.quit();
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
