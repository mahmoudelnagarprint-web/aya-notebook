import { useSyncExternalStore } from 'react';
import { idbGet, idbSet } from '../lib/idb';

export interface SyncOperation {
  id: string;
  name: string;
  input: unknown;
  actor: 'user' | 'ai' | 'system';
  batchId?: string | null;
  at: string;
}

export interface SyncState {
  online: boolean;
  pending: number;
  lastSync: string | null;
  server: string;
  error: string | null;
}

const QUEUE_KEY = 'sync-queue';
const SERVER_KEY = 'ayatodoist.server';

function readServer(): string {
  try {
    return localStorage.getItem(SERVER_KEY) ?? '';
  } catch {
    return '';
  }
}

class SyncStore {
  private listeners = new Set<() => void>();
  private queue: SyncOperation[] = [];
  private flushing = false;
  state: SyncState = { online: false, pending: 0, lastSync: null, server: readServer(), error: null };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SyncState => this.state;

  private emit(): void {
    this.state = { ...this.state };
    for (const listener of this.listeners) listener();
  }

  private update(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  setServer(value: string): void {
    const trimmed = value.trim().replace(/\/$/, '');
    try {
      localStorage.setItem(SERVER_KEY, trimmed);
    } catch {
      /* ignore */
    }
    this.update({ server: trimmed });
  }

  url(path: string): string {
    const base = this.state.server;
    return base ? `${base}${path}` : path;
  }

  async load(): Promise<void> {
    const saved = await idbGet<SyncOperation[]>(QUEUE_KEY);
    this.queue = saved ?? [];
    this.update({ pending: this.queue.length });
    void this.ping();
  }

  async enqueue(operation: Omit<SyncOperation, 'id' | 'at'>): Promise<void> {
    this.queue.push({ ...operation, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString() });
    await idbSet(QUEUE_KEY, this.queue);
    this.update({ pending: this.queue.length });
    window.setTimeout(() => void this.flush(), 1200);
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(this.url('/api/v1/health'), { method: 'GET' });
      const online = response.ok;
      this.update({ online });
      if (online) void this.flush();
      return online;
    } catch {
      this.update({ online: false });
      return false;
    }
  }

  async flush(force = false): Promise<boolean> {
    if (this.flushing || (this.queue.length === 0 && !force)) return false;
    this.flushing = true;
    try {
      const operations = [...this.queue];
      const response = await fetch(this.url('/api/v1/sync'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId: this.clientId(), operations }),
      });
      if (!response.ok) throw new Error(`Sync failed (${response.status})`);
      await response.json().catch(() => undefined);
      this.queue = this.queue.filter((queued) => !operations.some((sent) => sent.id === queued.id));
      await idbSet(QUEUE_KEY, this.queue);
      this.update({ online: true, pending: this.queue.length, lastSync: new Date().toISOString(), error: null });
      return true;
    } catch (error) {
      this.update({ online: false, error: (error as Error).message });
      return false;
    } finally {
      this.flushing = false;
    }
  }

  private clientId(): string {
    let id = '';
    try {
      id = localStorage.getItem('ayatodoist.client') ?? '';
      if (!id) {
        id = `web-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem('ayatodoist.client', id);
      }
    } catch {
      id = 'web-anonymous';
    }
    return id;
  }
}

export const syncStore = new SyncStore();

export function useSyncState(): SyncState {
  return useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot, syncStore.getSnapshot);
}
