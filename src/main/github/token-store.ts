import keytar from 'keytar';

const SERVICE_NAME = 'buildbot-desktop';
const ACCOUNT_NAME = 'github-access-token';

let memoryToken: string | undefined;

export async function saveToken(token: string): Promise<void> {
  memoryToken = token;
  await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, token);
}

export async function readToken(): Promise<string | undefined> {
  if (memoryToken) {
    return memoryToken;
  }
  const stored = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
  memoryToken = stored ?? undefined;
  return memoryToken;
}

export async function clearToken(): Promise<void> {
  memoryToken = undefined;
  await keytar.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
}
