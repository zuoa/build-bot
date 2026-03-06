import { Octokit } from '@octokit/rest';
import { clearToken, readToken, saveToken } from './token-store';
let octokit;
let account;
function createClient(token) {
    return new Octokit({ auth: token });
}
async function resolveAccount(client, token) {
    const { data } = await client.rest.users.getAuthenticated();
    return {
        token,
        login: data.login,
        avatarUrl: data.avatar_url,
        name: data.name ?? undefined
    };
}
export async function loginWithToken(token) {
    const client = createClient(token);
    const session = await resolveAccount(client, token);
    octokit = client;
    account = session;
    await saveToken(token);
    return session;
}
export async function bootstrapSessionFromKeychain() {
    const token = await readToken();
    if (!token) {
        return undefined;
    }
    try {
        return await loginWithToken(token);
    }
    catch {
        await clearToken();
        return undefined;
    }
}
export function getOctokit() {
    if (!octokit) {
        throw new Error('请先登录 GitHub');
    }
    return octokit;
}
export function getAccount() {
    if (!account) {
        throw new Error('请先登录 GitHub');
    }
    return account;
}
export async function logoutGithub() {
    octokit = undefined;
    account = undefined;
    await clearToken();
}
