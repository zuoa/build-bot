import keytar from 'keytar';
import type { AutoModeSettings } from '../../shared/types';

const SERVICE_NAME = 'buildbot-desktop-mvp';
const ANTHROPIC_KEY_ACCOUNT = 'anthropic-api-key';
const AUTO_MODE_ACCOUNT = 'auto-mode-settings';
const MIN_AUTO_POLL_INTERVAL_SEC = 30;
const MAX_AUTO_POLL_INTERVAL_SEC = 60 * 60;

let cachedAnthropicKey: string | undefined;
let cachedAutoModeSettings: AutoModeSettings | undefined;

const DEFAULT_AUTO_MODE_SETTINGS: AutoModeSettings = {
  enabled: false,
  pollIntervalSec: 180
};

export async function getAnthropicApiKey(): Promise<string | undefined> {
  if (cachedAnthropicKey && cachedAnthropicKey.trim()) {
    return cachedAnthropicKey;
  }

  const stored = await keytar.getPassword(SERVICE_NAME, ANTHROPIC_KEY_ACCOUNT);
  cachedAnthropicKey = stored?.trim() || undefined;
  return cachedAnthropicKey;
}

export async function saveAnthropicApiKey(key: string): Promise<void> {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error('API Key 不能为空');
  }

  cachedAnthropicKey = normalized;
  await keytar.setPassword(SERVICE_NAME, ANTHROPIC_KEY_ACCOUNT, normalized);
}

export async function clearAnthropicApiKey(): Promise<void> {
  cachedAnthropicKey = undefined;
  await keytar.deletePassword(SERVICE_NAME, ANTHROPIC_KEY_ACCOUNT);
}

export async function hasAnthropicApiKey(): Promise<boolean> {
  const key = await getAnthropicApiKey();
  return Boolean(key && key.trim().length > 0);
}

export async function resolveAnthropicApiKey(): Promise<string | undefined> {
  const stored = await getAnthropicApiKey();
  if (stored) {
    return stored;
  }

  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  return fromEnv || undefined;
}

function normalizeAutoPollIntervalSec(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AUTO_MODE_SETTINGS.pollIntervalSec;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_AUTO_POLL_INTERVAL_SEC, Math.max(MIN_AUTO_POLL_INTERVAL_SEC, rounded));
}

function normalizeAutoModeSettings(input: Partial<AutoModeSettings>): AutoModeSettings {
  return {
    enabled:
      typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_AUTO_MODE_SETTINGS.enabled,
    pollIntervalSec: normalizeAutoPollIntervalSec(
      input.pollIntervalSec ?? DEFAULT_AUTO_MODE_SETTINGS.pollIntervalSec
    )
  };
}

export async function getAutoModeSettings(): Promise<AutoModeSettings> {
  if (cachedAutoModeSettings) {
    return cachedAutoModeSettings;
  }

  const stored = await keytar.getPassword(SERVICE_NAME, AUTO_MODE_ACCOUNT);
  if (!stored) {
    cachedAutoModeSettings = DEFAULT_AUTO_MODE_SETTINGS;
    return cachedAutoModeSettings;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<AutoModeSettings>;
    cachedAutoModeSettings = normalizeAutoModeSettings(parsed);
  } catch {
    cachedAutoModeSettings = DEFAULT_AUTO_MODE_SETTINGS;
  }
  return cachedAutoModeSettings;
}

export async function saveAutoModeSettings(settings: AutoModeSettings): Promise<AutoModeSettings> {
  const normalized = normalizeAutoModeSettings(settings);
  cachedAutoModeSettings = normalized;
  await keytar.setPassword(SERVICE_NAME, AUTO_MODE_ACCOUNT, JSON.stringify(normalized));
  return normalized;
}
