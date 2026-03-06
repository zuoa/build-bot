import { Octokit } from '@octokit/rest';
import type { AuthSession } from '../../shared/types';
export declare function loginWithToken(token: string): Promise<AuthSession>;
export declare function bootstrapSessionFromKeychain(): Promise<AuthSession | undefined>;
export declare function getOctokit(): Octokit;
export declare function getAccount(): AuthSession;
export declare function logoutGithub(): Promise<void>;
