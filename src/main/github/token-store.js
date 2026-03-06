import keytar from 'keytar';
const SERVICE_NAME = 'gitagent-desktop-mvp';
const ACCOUNT_NAME = 'github-access-token';
let memoryToken;
export async function saveToken(token) {
    memoryToken = token;
    await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
}
export async function readToken() {
    if (memoryToken) {
        return memoryToken;
    }
    const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
    memoryToken = stored ?? undefined;
    return memoryToken;
}
export async function clearToken() {
    memoryToken = undefined;
    await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
}
