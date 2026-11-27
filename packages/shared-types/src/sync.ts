import type { CollectionKey } from './collections';

/** Wire protocol between the web/desktop client and the self-hosted server. */
export interface SyncCommandEnvelope {
  id: string;
  name: string;
  input: unknown;
  actor: 'user' | 'ai' | 'system';
  issuedAt: string;
}

export interface SyncPushRequest {
  clientId: string;
  cursor: string | null;
  commands: SyncCommandEnvelope[];
  /** Client snapshot used by the server the very first time a device connects. */
  bootstrap?: Record<CollectionKey, unknown[]>;
}

export interface SyncDelta {
  collection: CollectionKey;
  rows: unknown[];
  removed: string[];
}

export interface SyncPushResponse {
  ok: boolean;
  cursor: string;
  serverTime: string;
  deltas: SyncDelta[];
  results: Array<{ id: string; ok: boolean; error?: string; result?: unknown }>;
  activity: unknown[];
}

export interface SyncPullResponse {
  ok: boolean;
  cursor: string;
  serverTime: string;
  full: boolean;
  collections: Record<string, unknown[]>;
}

export interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  kind: 'query' | 'mutation';
  destructive: boolean;
  category: string;
  inputSchema: unknown;
}

export const APP_PROTOCOL_VERSION = 1;
