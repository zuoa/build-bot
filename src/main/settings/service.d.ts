import type { AutoModeSettings } from '../../shared/types';
export declare function getAnthropicApiKey(): Promise<string | undefined>;
export declare function saveAnthropicApiKey(key: string): Promise<void>;
export declare function clearAnthropicApiKey(): Promise<void>;
export declare function hasAnthropicApiKey(): Promise<boolean>;
export declare function resolveAnthropicApiKey(): Promise<string | undefined>;
export declare function getAutoModeSettings(): Promise<AutoModeSettings>;
export declare function saveAutoModeSettings(settings: AutoModeSettings): Promise<AutoModeSettings>;
