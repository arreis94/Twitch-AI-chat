export interface Account {
  userId: string;
  userName: string;
  personaId?: string;
  addedAt: string;
  connected: boolean;
  queueDepth: number;
}

export interface Persona {
  id: string;
  name: string;
  personality: string;
  interests: string[];
  favoriteEmotes: string[];
  chattiness: number;
  verbosity: 'short' | 'medium';
  language: string;
}

export interface Scenario {
  name: string;
  mode: 'ai' | 'pool';
  accountIds: string[];
  streamContext: string;
  rateMultiplier: number;
  reactivity: number;
  messagesPerMinute: number;
  jitter: number;
  accountSelection: 'roundRobin' | 'random';
  messagePool: string[];
  durationSec?: number;
}

export interface EmoteSpan {
  id: string;
  code: string;
  start: number;
  end: number;
}

export interface FeedMessage {
  id: string;
  channel: string;
  userId: string;
  userName: string;
  displayName: string;
  color?: string;
  text: string;
  isTestAccount: boolean;
  badges: Record<string, string>;
  emotes: EmoteSpan[];
  ts: number;
}

export interface ScenarioStatus {
  running: boolean;
  name?: string;
  mode?: 'ai' | 'pool';
  sentCount: number;
}

export interface AppStatus extends ScenarioStatus {
  channel: string;
  aiConfigured: boolean;
}

export type ServerEvent =
  | { type: 'chat'; msg: FeedMessage }
  | { type: 'account_status'; userId: string; connected: boolean; queueDepth: number }
  | ({ type: 'scenario_status' } & ScenarioStatus)
  | { type: 'generation'; accountId: string; personaName: string; text: string; latencyMs: number }
  | { type: 'error'; message: string };
