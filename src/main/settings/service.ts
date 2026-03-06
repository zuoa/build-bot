import keytar from 'keytar';
import type {
  AgentRoleSettings,
  AutoModeSettings,
  ReviewStrictness,
  SubmissionMode
} from '../../shared/types';

const SERVICE_NAME = 'buildbot-desktop-mvp';
const AUTO_MODE_ACCOUNT = 'auto-mode-settings';
const AGENT_SETTINGS_ACCOUNT = 'agent-role-settings';
const MIN_AUTO_POLL_INTERVAL_SEC = 30;
const MAX_AUTO_POLL_INTERVAL_SEC = 60 * 60;
const MIN_REVIEW_MAX_ROUNDS = 1;
const MAX_REVIEW_MAX_ROUNDS = 8;
const DEFAULT_DIRECT_BRANCH_NAME = 'develop';

let cachedAutoModeSettings: AutoModeSettings | undefined;
let cachedAgentSettings: AgentRoleSettings | undefined;

const DEFAULT_AUTO_MODE_SETTINGS: AutoModeSettings = {
  enabled: false,
  pollIntervalSec: 180
};
const DEFAULT_AGENT_SETTINGS: AgentRoleSettings = {
  implementationProvider: 'claude',
  reviewProvider: 'claude',
  reviewStrictness: 'normal',
  reviewMaxRounds: 3,
  submissionMode: 'branch',
  directBranchName: DEFAULT_DIRECT_BRANCH_NAME
};

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

function normalizeReviewStrictness(value?: ReviewStrictness): ReviewStrictness {
  if (value === 'strict' || value === 'lenient') {
    return value;
  }
  return 'normal';
}

function normalizeReviewMaxRounds(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_AGENT_SETTINGS.reviewMaxRounds;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_REVIEW_MAX_ROUNDS, Math.max(MIN_REVIEW_MAX_ROUNDS, rounded));
}

function normalizeSubmissionMode(value?: SubmissionMode): SubmissionMode {
  return value === 'pr' ? 'pr' : 'branch';
}

function normalizeDirectBranchName(value?: string): string {
  const normalized = value?.trim().replace(/^refs\/heads\//, '') ?? '';
  if (!normalized) {
    return DEFAULT_DIRECT_BRANCH_NAME;
  }

  const invalid =
    normalized.startsWith('.') ||
    normalized.endsWith('.') ||
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('..') ||
    normalized.includes('//') ||
    normalized.includes('@{') ||
    normalized.endsWith('.lock') ||
    /[\s~^:?*\\[\]]/.test(normalized);

  if (invalid) {
    throw new Error('直提分支名称不合法，请输入有效的 Git 分支名');
  }

  return normalized;
}

function normalizeAgentSettings(input: Partial<AgentRoleSettings>): AgentRoleSettings {
  return {
    implementationProvider: input.implementationProvider === 'codex' ? 'codex' : 'claude',
    reviewProvider: input.reviewProvider === 'codex' ? 'codex' : 'claude',
    reviewStrictness: normalizeReviewStrictness(input.reviewStrictness),
    reviewMaxRounds: normalizeReviewMaxRounds(
      input.reviewMaxRounds ?? DEFAULT_AGENT_SETTINGS.reviewMaxRounds
    ),
    submissionMode: normalizeSubmissionMode(input.submissionMode),
    directBranchName: normalizeDirectBranchName(input.directBranchName)
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

export async function getAgentSettings(): Promise<AgentRoleSettings> {
  if (cachedAgentSettings) {
    return cachedAgentSettings;
  }

  const stored = await keytar.getPassword(SERVICE_NAME, AGENT_SETTINGS_ACCOUNT);
  if (!stored) {
    cachedAgentSettings = DEFAULT_AGENT_SETTINGS;
    return cachedAgentSettings;
  }

  try {
    const parsed = JSON.parse(stored) as Partial<AgentRoleSettings>;
    cachedAgentSettings = normalizeAgentSettings(parsed);
  } catch {
    cachedAgentSettings = DEFAULT_AGENT_SETTINGS;
  }

  return cachedAgentSettings;
}

export async function saveAgentSettings(settings: AgentRoleSettings): Promise<AgentRoleSettings> {
  const normalized = normalizeAgentSettings(settings);
  cachedAgentSettings = normalized;
  await keytar.setPassword(SERVICE_NAME, AGENT_SETTINGS_ACCOUNT, JSON.stringify(normalized));
  return normalized;
}
