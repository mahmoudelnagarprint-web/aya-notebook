import type { DataStore, CollectionKey } from '@ayatodoist/shared-types';
import type { SyncCommandEnvelope, SyncDelta, SyncPullResponse, SyncPushResponse } from '@ayatodoist/shared-types';
import { createId } from './utils';

export interface SyncTransport {
  push(request: {
    clientId: string;
    cursor: string | null;
    commands: SyncCommandEnvelope[];
  }): Promise<SyncPushResponse>;
  pull(cursor: string | null): Promise<SyncPullResponse>;
}

export interface SyncEngineOptions {
  clientId: string;
  transport: SyncTransport;
  store: DataStore;
  loadQueue: () => SyncCommandEnvelope[];
  saveQueue: (queue: SyncCommandEnvelope[]) => void;
  loadCursor: () => string | null;
  saveCursor: (cursor: string) => void;
  onApplied?: (deltas: SyncDelta[]) => void;
}

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

/**
 * Local-first sync: commands are queued immediately (offline safe) and replayed in
 * order. Deltas received from the server are merged back into the local store.
 */
export class SyncEngine {
  private status: SyncStatus = 'idle';
  private lastError: string | null = null;
  private listeners = new Set<() => void>();
  private flushing = false;

  constructor(private readonly options: SyncEngineOptions) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  getState(): { status: SyncStatus; pending: number; cursor: string | null; lastError: string | null } {
    return {
      status: this.status,
      pending: this.options.loadQueue().length,
      cursor: this.options.loadCursor(),
      lastError: this.lastError,
    };
  }

  enqueue(command: string, input: unknown, actor: 'user' | 'ai' | 'system' = 'user'): void {
    const envelope: SyncCommandEnvelope = {
      id: createId('sync'),
      name: command,
      input,
      actor,
      issuedAt: new Date().toISOString(),
    };
    const queue = this.options.loadQueue();
    queue.push(envelope);
    this.options.saveQueue(queue);
    this.emit();
  }

  async flush(): Promise<SyncPushResponse | null> {
    if (this.flushing) return null;
    const queue = this.options.loadQueue();
    if (queue.length === 0) return null;
    this.flushing = true;
    this.status = 'syncing';
    this.emit();
    try {
      const response = await this.options.transport.push({
        clientId: this.options.clientId,
        cursor: this.options.loadCursor(),
        commands: queue,
      });
      const processed = new Set(response.results.filter((result) => result.ok).map((result) => result.id));
      const remaining = this.options.loadQueue().filter((envelope) => !processed.has(envelope.id));
      this.options.saveQueue(remaining);
      this.options.saveCursor(response.cursor);
      this.applyDeltas(response.deltas);
      this.status = remaining.length > 0 ? 'offline' : 'idle';
      this.lastError = null;
      this.emit();
      return response;
    } catch (error) {
      this.status = 'offline';
      this.lastError = (error as Error).message;
      this.emit();
      return null;
    } finally {
      this.flushing = false;
    }
  }

  async pull(): Promise<boolean> {
    try {
      const response = await this.options.transport.pull(this.options.loadCursor());
      if (!response.ok) return false;
      this.options.store.replaceAll(response.collections as Partial<Record<CollectionKey, unknown[]>>);
      this.options.saveCursor(response.cursor);
      this.status = 'idle';
      this.lastError = null;
      this.emit();
      return true;
    } catch (error) {
      this.status = 'offline';
      this.lastError = (error as Error).message;
      this.emit();
      return false;
    }
  }

  private applyDeltas(deltas: SyncDelta[]): void {
    if (!deltas.length) return;
    for (const delta of deltas) {
      for (const row of delta.rows) {
        this.options.store.upsert(delta.collection, row as never);
      }
      for (const id of delta.removed) this.options.store.remove(delta.collection, id);
    }
    this.options.onApplied?.(deltas);
  }
}
