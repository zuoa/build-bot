import keytar from 'keytar';
const SERVICE_NAME = 'buildbot-desktop-mvp';
const ANTHROPIC_KEY_ACCOUNT = 'anthropic-api-key';
let cachedAnthropicKey;
export async function getAnthropicApiKey() {
    if (cachedAnthropicKey && cachedAnthropicKey.trim()) {
        return cachedAnthropicKey;
    }
    const stored = await keytar.getPassword(SERVICE_NAME, ANTHROPIC_KEY_ACCOUNT);
    cachedAnthropicKey = stored?.trim() || undefined;
    return cachedAnthropicKey;
}
export async function saveAnthropicApiKey(key) {
    const normalized = key.trim();
    if (!normalized) {
        throw new Error('API Key 不能为空');
    }
    cachedAnthropicKey = normalized;
    await keytar.setPassword(SERVICE_NAME, ANTHROPIC_KEY_ACCOUNT, normalized);
}
export async function clearAnthropicApiKey() {
    cachedAnthropicKey = undefined;
    await keytar.deletePassword(SERVICE_NAME, ANTHROPIC_KEY_ACCOUNT);
}
export async function hasAnthropicApiKey() {
    const key = await getAnthropicApiKey();
    return Boolean(key && key.trim().length > 0);
}
export async function resolveAnthropicApiKey() {
    const stored = await getAnthropicApiKey();
    if (stored) {
        return stored;
    }
    const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
    return fromEnv || undefined;
}
