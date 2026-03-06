import { Octokit } from '@octokit/rest';
import type { AuthSession } from '../../shared/types';
import { clearToken, readToken, saveToken } from './token-store';

let octokit: Octokit | undefined;
let account: AuthSession | undefined;

function createClient(token: string): Octokit {
  return new Octokit({ auth: token });
}

async function resolveAccount(client: Octokit, token: string): Promise<AuthSession> {
  const { data } = await client.rest.users.getAuthenticated();
  return {
    token,
    login: data.login,
    avatarUrl: data.avatar_url,
    name: data.name ?? undefined
  };
}

export async function loginWithToken(token: string): Promise<AuthSession> {
  const client = createClient(token);
  const session = await resolveAccount(client, token);
  octokit = client;
  account = session;
  await saveToken(token);
  return session;
}

export async function bootstrapSessionFromKeychain(): Promise<AuthSession | undefined> {
  const token = await readToken();
  if (!token) {
    return undefined;
  }

  try {
    return await loginWithToken(token);
  } catch (error) {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: number }).status)
        : undefined;

    // 仅在明确 token 无效时清除；网络异常/限流等情况保留 token。
    if (status === 401) {
      await clearToken();
    }
    return undefined;
  }
}

export function getOctokit(): Octokit {
  if (!octokit) {
    throw new Error('请先登录 GitHub');
  }
  return octokit;
}

export function getAccount(): AuthSession {
  if (!account) {
    throw new Error('请先登录 GitHub');
  }
  return account;
}

export async function logoutGithub(): Promise<void> {
  octokit = undefined;
  account = undefined;
  await clearToken();
}
