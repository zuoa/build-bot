import keytar from 'keytar';
const SERVICE_NAME = 'buildbot-desktop-mvp';
const AUTO_MODE_ACCOUNT = 'auto-mode-settings';
const AGENT_SETTINGS_ACCOUNT = 'agent-role-settings';
const MIN_AUTO_POLL_INTERVAL_SEC = 30;
const MAX_AUTO_POLL_INTERVAL_SEC = 60 * 60;
let cachedAutoModeSettings;
let cachedAgentSettings;
const DEFAULT_AUTO_MODE_SETTINGS = {
    enabled: false,
    pollIntervalSec: 180
};
const DEFAULT_AGENT_SETTINGS = {
    implementationProvider: 'claude',
    reviewProvider: 'claude'
};
function normalizeAutoPollIntervalSec(value) {
    if (!Number.isFinite(value)) {
        return DEFAULT_AUTO_MODE_SETTINGS.pollIntervalSec;
    }
    const rounded = Math.round(value);
    return Math.min(MAX_AUTO_POLL_INTERVAL_SEC, Math.max(MIN_AUTO_POLL_INTERVAL_SEC, rounded));
}
function normalizeAutoModeSettings(input) {
    return {
        enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_AUTO_MODE_SETTINGS.enabled,
        pollIntervalSec: normalizeAutoPollIntervalSec(input.pollIntervalSec ?? DEFAULT_AUTO_MODE_SETTINGS.pollIntervalSec)
    };
}
function normalizeAgentSettings(input) {
    return {
        implementationProvider: input.implementationProvider === 'codex' ? 'codex' : 'claude',
        reviewProvider: input.reviewProvider === 'codex' ? 'codex' : 'claude'
    };
}
export async function getAutoModeSettings() {
    if (cachedAutoModeSettings) {
        return cachedAutoModeSettings;
    }
    const stored = await keytar.getPassword(SERVICE_NAME, AUTO_MODE_ACCOUNT);
    if (!stored) {
        cachedAutoModeSettings = DEFAULT_AUTO_MODE_SETTINGS;
        return cachedAutoModeSettings;
    }
    try {
        const parsed = JSON.parse(stored);
        cachedAutoModeSettings = normalizeAutoModeSettings(parsed);
    }
    catch {
        cachedAutoModeSettings = DEFAULT_AUTO_MODE_SETTINGS;
    }
    return cachedAutoModeSettings;
}
export async function saveAutoModeSettings(settings) {
    const normalized = normalizeAutoModeSettings(settings);
    cachedAutoModeSettings = normalized;
    await keytar.setPassword(SERVICE_NAME, AUTO_MODE_ACCOUNT, JSON.stringify(normalized));
    return normalized;
}
export async function getAgentSettings() {
    if (cachedAgentSettings) {
        return cachedAgentSettings;
    }
    const stored = await keytar.getPassword(SERVICE_NAME, AGENT_SETTINGS_ACCOUNT);
    if (!stored) {
        cachedAgentSettings = DEFAULT_AGENT_SETTINGS;
        return cachedAgentSettings;
    }
    try {
        const parsed = JSON.parse(stored);
        cachedAgentSettings = normalizeAgentSettings(parsed);
    }
    catch {
        cachedAgentSettings = DEFAULT_AGENT_SETTINGS;
    }
    return cachedAgentSettings;
}
export async function saveAgentSettings(settings) {
    const normalized = normalizeAgentSettings(settings);
    cachedAgentSettings = normalized;
    await keytar.setPassword(SERVICE_NAME, AGENT_SETTINGS_ACCOUNT, JSON.stringify(normalized));
    return normalized;
}
