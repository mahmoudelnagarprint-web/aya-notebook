import type { DataStore, CollectionKey, RowOf } from '@ayatodoist/shared-types';
import { COLLECTION_KEYS } from '@ayatodoist/shared-types';

/** Task fields that must always be arrays, even when a row came back from SQLite with `null`. */
const TASK_ARRAY_FIELDS = ['labels', 'checklist', 'attachments'] as const;

/**
 * Normalises a row before it enters memory. Hydrated rows (SQLite/Prisma/JSON backups) may
 * carry `null` for JSON columns, which made task rows crash on `undefined.length`.
 */
export function normalizeRow<K extends CollectionKey>(collection: K, row: RowOf<K>): RowOf<K> {
  if (collection !== 'tasks' || !row) return row;
  const source = row as unknown as Record<string, unknown>;
  let changed = false;
  const normalized: Record<string, unknown> = { ...source };
  for (const field of TASK_ARRAY_FIELDS) {
    if (!Array.isArray(normalized[field])) {
      normalized[field] = [];
      changed = true;
    }
  }
  return changed ? (normalized as unknown as RowOf<K>) : row;
}

/** In-memory store — the canonical local-first state on client and the server fallback. */
export class MemoryStore implements DataStore {
  private collections = new Map<CollectionKey, Map<string, unknown>>();

  constructor() {
    for (const key of COLLECTION_KEYS) this.collections.set(key, new Map());
  }

  list<K extends CollectionKey>(collection: K): RowOf<K>[] {
    return [...(this.collections.get(collection)?.values() ?? [])] as RowOf<K>[];
  }

  get<K extends CollectionKey>(collection: K, id: string): RowOf<K> | null {
    const row = this.collections.get(collection)?.get(id);
    return (row as RowOf<K>) ?? null;
  }

  upsert<K extends CollectionKey>(collection: K, row: RowOf<K>): void {
    const bucket = this.collections.get(collection);
    if (!bucket) throw new Error(`Unknown collection: ${collection}`);
    const normalized = normalizeRow(collection, row);
    bucket.set((normalized as { id: string }).id, normalized);
  }

  remove<K extends CollectionKey>(collection: K, id: string): void {
    this.collections.get(collection)?.delete(id);
  }

  replaceAll(snapshot: Partial<Record<CollectionKey, unknown[]>>): void {
    for (const key of COLLECTION_KEYS) {
      const rows = snapshot[key];
      if (!rows) continue;
      const bucket = new Map<string, unknown>();
      for (const row of rows) {
        const normalized = normalizeRow(key, row as RowOf<typeof key>);
        bucket.set((normalized as { id: string }).id, normalized);
      }
      this.collections.set(key, bucket);
    }
  }

  snapshot(): Record<CollectionKey, unknown[]> {
    const result = {} as Record<CollectionKey, unknown[]>;
    for (const key of COLLECTION_KEYS) result[key] = [...(this.collections.get(key)?.values() ?? [])];
    return result;
  }

  clear(): void {
    for (const key of COLLECTION_KEYS) this.collections.get(key)?.clear();
  }
}

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Wraps a store and records every touched row (before/after) so the kernel can
 * build a complete, reversible patch list for undo/redo and the activity log.
 */
export class TracingStore implements DataStore {
  readonly patches: Array<{
    collection: CollectionKey;
    id: string;
    op: 'upsert' | 'remove';
    before: unknown | null;
    after: unknown | null;
  }> = [];

  private touched = new Map<string, { before: unknown | null; after: unknown | null; op: 'upsert' | 'remove' }>();

  constructor(private readonly inner: DataStore, private readonly ignore: CollectionKey[] = ['activity']) {}

  private record<K extends CollectionKey>(collection: K, id: string, op: 'upsert' | 'remove'): void {
    if (this.ignore.includes(collection)) return;
    const key = `${collection}:${id}`;
    const existing = this.touched.get(key);
    const before = existing ? existing.before : deepClone(this.inner.get(collection, id));
    this.touched.set(key, { before, after: null, op });
  }

  list<K extends CollectionKey>(collection: K): RowOf<K>[] {
    return this.inner.list(collection);
  }

  get<K extends CollectionKey>(collection: K, id: string): RowOf<K> | null {
    return this.inner.get(collection, id);
  }

  upsert<K extends CollectionKey>(collection: K, row: RowOf<K>): void {
    this.record(collection, (row as { id: string }).id, 'upsert');
    this.inner.upsert(collection, row);
  }

  remove<K extends CollectionKey>(collection: K, id: string): void {
    this.record(collection, id, 'remove');
    this.inner.remove(collection, id);
  }

  replaceAll(snapshot: Partial<Record<CollectionKey, unknown[]>>): void {
    this.inner.replaceAll(snapshot);
  }

  snapshot(): Record<CollectionKey, unknown[]> {
    return this.inner.snapshot();
  }

  flush(): Array<{ collection: CollectionKey; id: string; op: 'upsert' | 'remove'; before: unknown | null; after: unknown | null }> {
    const result: Array<{ collection: CollectionKey; id: string; op: 'upsert' | 'remove'; before: unknown | null; after: unknown | null }> = [];
    for (const [key, entry] of this.touched) {
      const separator = key.indexOf(':');
      const collection = key.slice(0, separator) as CollectionKey;
      const id = key.slice(separator + 1);
      const current = this.inner.get(collection, id);
      const after = deepClone(current);
      if (entry.op === 'remove' && current === null) {
        result.push({ collection, id, op: 'remove', before: entry.before, after: null });
        continue;
      }
      if (entry.op === 'remove') {
        // Removed then re-created inside one command — treat as an upsert of the final state.
        result.push({ collection, id, op: 'upsert', before: entry.before, after });
        continue;
      }
      if (entry.before === null && after === null) continue;
      result.push({ collection, id, op: 'upsert', before: entry.before, after });
    }
    return result;
  }

  /** Applies patches in reverse (undo) or forward (redo). */
  static apply(store: DataStore, patches: Array<{ collection: string; id: string; op: 'upsert' | 'remove'; before: unknown | null; after: unknown | null }>, direction: 'undo' | 'redo'): void {
    const ordered = direction === 'undo' ? [...patches].reverse() : patches;
    for (const patch of ordered) {
      const collection = patch.collection as CollectionKey;
      const value = direction === 'undo' ? patch.before : patch.after;
      if (value === null || value === undefined) {
        store.remove(collection, patch.id);
      } else {
        store.upsert(collection, value as RowOf<CollectionKey>);
      }
    }
  }
}
