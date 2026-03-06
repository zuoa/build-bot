import type { AgentRoleSettings, AutoModeSettings } from '../../shared/types';
export declare function getAutoModeSettings(): Promise<AutoModeSettings>;
export declare function saveAutoModeSettings(settings: AutoModeSettings): Promise<AutoModeSettings>;
export declare function getAgentSettings(): Promise<AgentRoleSettings>;
export declare function saveAgentSettings(settings: AgentRoleSettings): Promise<AgentRoleSettings>;
