/**
 * Shared extension state types.
 * Everything persisted to `chrome.storage.local` so settings, queue and positions
 * survive reloads, and the background worker can restore context menus and alarms.
 */

export interface Settings {
  serverBaseUrl: string;     // http://127.0.0.1:8787
  bearerToken: string;      // optional
  handleSide: 'right' | 'left' | 'hidden';
  handleY: number;          // vertical pixel offset from top
  handleVisible: boolean;
  selectionPillEnabled: boolean;
  pageContextEnabled: boolean;
  pageContextTrim: number;  // chars
  disableSites: string;     // JSON array of origin strings, e.g. "[\"https://example.com\"]"
  quickAddDefaultPriority: 0 | 1 | 2 | 3;
}

export interface QueuedOperation {
  /** Stable client-generated stable id so the server sync response can acknowledge it. */
  id: string;
  name: string;
  input: unknown;
  actor: 'user' | 'ai' | 'system';
  confirmed: boolean;
  batchId?: string;
  createdAt: string;
}

export interface OfflineQueue {
  operations: QueuedOperation[];
  lastAttemptAt: string | null;
}

export interface Storage {
  settings: Settings;
  queue: OfflineQueue;
  unreadCount: number;
  lastConnectedAt: string | null;
  handleY: number;
}

export function nextOperationId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_SETTINGS: Settings = {
  serverBaseUrl: 'http://127.0.0.1:8787',
  bearerToken: '',
  handleSide: 'right',
  handleY: 120,
  handleVisible: true,
  selectionPillEnabled: true,
  pageContextEnabled: true,
  pageContextTrim: 4000,
  disableSites: '[]',
  quickAddDefaultPriority: 3 as const,
};

export function toggleQuickAdd(): void {
  // exported for content/messages wiring
}

export const STORAGE_KEYS = {
  SETTINGS: 'aya:settings',
  QUEUE: 'aya:queue',
  UNREAD: 'aya:unread',
  LAST_CONNECTED: 'aya:lastConnected',
  HANDLE_Y: 'aya:handleY',
} as const;

/** Idempotent initial storage seeding. */
export async function ensureStorage() {
  const present = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const keys = present as Record<string, unknown>;
  if (!keys[STORAGE_KEYS.SETTINGS]) await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  if (!keys[STORAGE_KEYS.QUEUE]) await chrome.storage.local.set({ [STORAGE_KEYS.QUEUE]: { operations: [], lastAttemptAt: null } });
  if (!keys[STORAGE_KEYS.UNREAD]) await chrome.storage.local.set({ [STORAGE_KEYS.UNREAD]: 0 });
  if (!keys[STORAGE_KEYS.LAST_CONNECTED]) await chrome.storage.local.set({ [STORAGE_KEYS.LAST_CONNECTED]: null });
  if (!keys[STORAGE_KEYS.HANDLE_Y]) await chrome.storage.local.set({ [STORAGE_KEYS.HANDLE_Y]: DEFAULT_SETTINGS.handleY });
}
