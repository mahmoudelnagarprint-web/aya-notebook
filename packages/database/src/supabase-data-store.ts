import type { SupabaseClient } from '@supabase/supabase-js';
import type { CollectionKey, DataStore, RowOf } from '@ayatodoist/shared-types';
import { COLLECTION_KEYS } from '@ayatodoist/shared-types';
import { getSupabaseAdmin } from './supabase-client';

/**
 * Postgres persistence for the task domain (projects, tasks, sections, labels,
 * filters, comments, reminders, activity, goals, plugins, settings).
 *
 * The kernel's `DataStore` contract is synchronous, so this adapter keeps a
 * per-isolate mirror in memory and writes through to Supabase on a serialized
 * queue. `hydrate()` must run before the kernel starts; `flush()` must run
 * before a serverless function returns so a frozen isolate never drops a write.
 *
 * The task domain uses the relational tables from `supabase/schema.sql`
 * (`projects`, `sections`, `tasks`, `labels`) with explicit snake_case column
 * mappings. Collections without a dedicated table (filters, activity, settings,
 * …) share the generic `kernel_rows` table.
 */

type AnyRow = Record<string, unknown> & { id: string };
type Mapper = (row: Record<string, unknown>) => AnyRow;

const RELATIONAL: Partial<Record<CollectionKey, { table: string; order: string; map: Mapper }>> = {
  projects: { table: 'projects', order: 'order_key', map: fromProjectRow },
  sections: { table: 'sections', order: 'order_key', map: fromSectionRow },
  tasks: { table: 'tasks', order: 'order_key', map: fromTaskRow },
  labels: { table: 'labels', order: 'order_key', map: fromLabelRow },
};

const GENERIC_TABLE = 'kernel_rows';
const MAX_ROWS = 20_000;

function cloneRow<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value);
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

function asInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isoOrNow(value: unknown): string {
  const text = asString(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : new Date().toISOString();
}

function dayOrNull(value: unknown): string | null {
  const text = asNullableString(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function timeOrNull(value: unknown): string | null {
  const text = asNullableString(value);
  return text && /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
}

function priorityOr(value: unknown): number {
  const parsed = asInteger(value, 4);
  return parsed >= 1 && parsed <= 4 ? parsed : 4;
}

function recurrenceToColumn(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function recurrenceFromColumn(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  const text = String(value);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- mappers */

function fromProjectRow(row: Record<string, unknown>): AnyRow {
  return {
    id: asString(row.id),
    name: asString(row.name),
    color: asString(row.color, '#dc4c3e'),
    parentId: asNullableString(row.parent_id),
    orderKey: asString(row.order_key),
    isFavorite: asBoolean(row.is_favorite),
    isArchived: asBoolean(row.is_archived),
    isInbox: asBoolean(row.is_inbox),
    layout: asString(row.layout, 'list'),
    createdAt: isoOrNow(row.created_at),
    updatedAt: isoOrNow(row.updated_at ?? row.created_at),
  };
}

function fromSectionRow(row: Record<string, unknown>): AnyRow {
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    name: asString(row.name),
    orderKey: asString(row.order_key),
    isCollapsed: asBoolean(row.is_collapsed),
    createdAt: isoOrNow(row.created_at),
    updatedAt: isoOrNow(row.updated_at ?? row.created_at),
  };
}

function fromTaskRow(row: Record<string, unknown>): AnyRow {
  return {
    id: asString(row.id),
    projectId: asString(row.project_id, '__inbox'),
    sectionId: asNullableString(row.section_id),
    parentId: asNullableString(row.parent_id),
    content: asString(row.content),
    description: asString(row.description),
    priority: priorityOr(row.priority),
    orderKey: asString(row.order_key),
    dueDate: dayOrNull(row.due_date),
    dueTime: timeOrNull(row.due_time),
    deadline: dayOrNull(row.deadline),
    durationMinutes: row.duration_minutes === null || row.duration_minutes === undefined ? null : asInteger(row.duration_minutes, 0),
    recurrence: recurrenceFromColumn(row.recurrence),
    labels: asArray(row.labels),
    checklist: asArray(row.checklist),
    attachments: asArray(row.attachments),
    isCompleted: asBoolean(row.is_completed),
    completedAt: asNullableString(row.completed_at),
    createdAt: isoOrNow(row.created_at),
    updatedAt: isoOrNow(row.updated_at ?? row.created_at),
    completedCount: asInteger(row.completed_count, 0),
    postponedCount: asInteger(row.postponed_count, 0),
    deletedAt: asNullableString(row.deleted_at),
  };
}

function fromLabelRow(row: Record<string, unknown>): AnyRow {
  return {
    id: asString(row.id),
    name: asString(row.name),
    color: asString(row.color, '#246fe0'),
    orderKey: asString(row.order_key),
    isFavorite: asBoolean(row.is_favorite),
    createdAt: isoOrNow(row.created_at),
    updatedAt: isoOrNow(row.updated_at ?? row.created_at),
  };
}

/* ----------------------------------------------------------------- store */

export class SupabaseDataStore implements DataStore {
  private readonly client: SupabaseClient;
  private readonly mirror = new Map<CollectionKey, Map<string, AnyRow>>();
  private readonly seqCounters = new Map<CollectionKey, number>();
  private queue: Promise<void> = Promise.resolve();
  private writeError: Error | null = null;
  private hydrated = false;

  constructor(client?: SupabaseClient) {
    this.client = client ?? getSupabaseAdmin();
  }

  private bucket(collection: CollectionKey): Map<string, AnyRow> {
    let rows = this.mirror.get(collection);
    if (!rows) {
      rows = new Map();
      this.mirror.set(collection, rows);
    }
    return rows;
  }

  private nextSeq(collection: CollectionKey): number {
    const next = (this.seqCounters.get(collection) ?? 0) + 1;
    this.seqCounters.set(collection, next);
    return next;
  }

  /** Loads every collection once. Safe to call repeatedly. */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;

    for (const collection of ['projects', 'sections', 'labels', 'tasks'] as CollectionKey[]) {
      const spec = RELATIONAL[collection];
      if (!spec) continue;
      const { data, error } = await this.client
        .from(spec.table)
        .select('*')
        .order(spec.order, { ascending: true })
        .limit(MAX_ROWS);
      if (error) {
        throw new Error(
          `Supabase hydrate failed for ${spec.table}: ${error.message}. Apply supabase/schema.sql first.`,
        );
      }
      const bucket = this.bucket(collection);
      for (const raw of (data ?? []) as Record<string, unknown>[]) {
        const row = spec.map(raw);
        if (!row.id) continue;
        bucket.set(row.id, row);
        this.nextSeq(collection);
      }
    }

    const generic = await this.client
      .from(GENERIC_TABLE)
      .select('collection, id, seq, data, created_at, updated_at')
      .order('seq', { ascending: true })
      .limit(MAX_ROWS);
    if (generic.error) {
      throw new Error(
        `Supabase hydrate failed for ${GENERIC_TABLE}: ${generic.error.message}. Apply supabase/schema.sql first.`,
      );
    }
    for (const raw of (generic.data ?? []) as Record<string, unknown>[]) {
      const collection = asString(raw.collection) as CollectionKey;
      if (!COLLECTION_KEYS.includes(collection)) continue;
      const id = asString(raw.id);
      if (!id) continue;
      const payload = raw.data && typeof raw.data === 'object' ? (raw.data as Record<string, unknown>) : {};
      const row: AnyRow = {
        ...payload,
        id,
        createdAt: payload.createdAt ?? isoOrNow(raw.created_at),
        updatedAt: payload.updatedAt ?? isoOrNow(raw.updated_at ?? raw.created_at),
      };
      this.bucket(collection).set(id, row);
      const seq = asInteger(raw.seq, 0);
      if (seq > (this.seqCounters.get(collection) ?? 0)) this.seqCounters.set(collection, seq);
    }

    this.hydrated = true;
  }

  async ready(): Promise<void> {
    await this.hydrate();
  }

  list<K extends CollectionKey>(collection: K): RowOf<K>[] {
    return [...this.bucket(collection).values()] as unknown as RowOf<K>[];
  }

  get<K extends CollectionKey>(collection: K, id: string): RowOf<K> | null {
    return (this.bucket(collection).get(id) as unknown as RowOf<K>) ?? null;
  }

  upsert<K extends CollectionKey>(collection: K, row: RowOf<K>): void {
    const entity = row as unknown as AnyRow;
    if (!entity || typeof entity.id !== 'string' || !entity.id) {
      throw new Error(`Cannot persist a ${collection} row without an id`);
    }
    // The kernel mutates rows in place (e.g. task.complete). Snapshot the value
    // now so a later mutation cannot change the payload of an already queued
    // write.
    const snapshot = cloneRow(entity);
    this.bucket(collection).set(snapshot.id, snapshot);
    this.enqueue(() => this.persist(collection, snapshot));
  }

  remove<K extends CollectionKey>(collection: K, id: string): void {
    this.bucket(collection).delete(id);
    this.enqueue(() => this.delete(collection, id));
  }

  replaceAll(snapshot: Partial<Record<CollectionKey, unknown[]>>): void {
    for (const collection of COLLECTION_KEYS) {
      const rows = snapshot[collection];
      if (!rows) continue;
      const incoming = new Map<string, AnyRow>();
      for (const row of rows) {
        const entity = row as AnyRow;
        if (entity && typeof entity.id === 'string' && entity.id) incoming.set(entity.id, entity);
      }
      for (const existingId of [...this.bucket(collection).keys()]) {
        if (!incoming.has(existingId)) this.remove(collection, existingId);
      }
      for (const entity of incoming.values()) this.upsert(collection, entity as never);
    }
  }

  snapshot(): Record<CollectionKey, unknown[]> {
    const result = {} as Record<CollectionKey, unknown[]>;
    for (const collection of COLLECTION_KEYS) result[collection] = [...this.bucket(collection).values()];
    return result;
  }

  close(): void {
    /* no persistent handle to close */
  }

  /* ------------------------------------------------------------ write path */

  private enqueue(job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch((error: unknown) => {
      const typed = error instanceof Error ? error : new Error(String(error));
      this.writeError ??= typed;
      console.error('[supabase-data]', typed.message);
    });
  }

  /** Resolves once every queued write reached Postgres; rejects if one failed. */
  async flush(): Promise<void> {
    await this.queue;
    const error = this.writeError;
    this.writeError = null;
    if (error) throw error;
  }

  private async persist(collection: CollectionKey, row: AnyRow): Promise<void> {
    switch (collection) {
      case 'projects':
        return this.persistProject(row);
      case 'sections':
        return this.persistSection(row);
      case 'tasks':
        return this.persistTask(row);
      case 'labels':
        return this.persistLabel(row);
      default:
        return this.persistGeneric(collection, row);
    }
  }

  private async delete(collection: CollectionKey, id: string): Promise<void> {
    if (RELATIONAL[collection]) {
      const { error } = await this.client.from(RELATIONAL[collection]!.table).delete().eq('id', id);
      if (error) throw new Error(`${RELATIONAL[collection]!.table} delete failed: ${error.message}`);
      return;
    }
    const { error } = await this.client.from(GENERIC_TABLE).delete().eq('collection', collection).eq('id', id);
    if (error) throw new Error(`${GENERIC_TABLE} delete failed: ${error.message}`);
  }

  private async persistProject(row: AnyRow): Promise<void> {
    const name = asString(row.name ?? row.title).trim();
    if (!name) throw new Error('project.name is required');
    const parentId = asNullableString(row.parentId ?? row.parent_id);
    const payload = {
      id: row.id,
      name,
      color: asString(row.color, '#dc4c3e'),
      // A dangling parent would violate the self-referencing foreign key.
      parent_id: parentId && this.bucket('projects').has(parentId) ? parentId : null,
      order_key: asString(row.orderKey ?? row.order_key),
      is_favorite: asBoolean(row.isFavorite ?? row.is_favorite),
      is_archived: asBoolean(row.isArchived ?? row.is_archived),
      is_inbox: asBoolean(row.isInbox ?? row.is_inbox),
      layout: asString(row.layout, 'list'),
      created_at: isoOrNow(row.createdAt ?? row.created_at),
      updated_at: isoOrNow(row.updatedAt ?? row.updated_at),
    };
    const { error } = await this.client.from('projects').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(`projects upsert failed: ${error.message}`);
  }

  private async persistSection(row: AnyRow): Promise<void> {
    const projectId = asNullableString(row.projectId ?? row.project_id);
    if (!projectId || !this.bucket('projects').has(projectId)) {
      throw new Error('section.project_id must reference an existing project');
    }
    const payload = {
      id: row.id,
      project_id: projectId,
      name: asString(row.name),
      order_key: asString(row.orderKey ?? row.order_key),
      is_collapsed: asBoolean(row.isCollapsed ?? row.is_collapsed),
      created_at: isoOrNow(row.createdAt ?? row.created_at),
      updated_at: isoOrNow(row.updatedAt ?? row.updated_at),
    };
    const { error } = await this.client.from('sections').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(`sections upsert failed: ${error.message}`);
  }

  private async persistTask(row: AnyRow): Promise<void> {
    const projectId = asNullableString(row.projectId ?? row.project_id);
    const sectionId = asNullableString(row.sectionId ?? row.section_id);
    const parentId = asNullableString(row.parentId ?? row.parent_id);
    const payload = {
      id: row.id,
      // Foreign keys are validated against the hydrated mirror: a stale client
      // id must not turn a task write into a Postgres FK error (HTTP 500).
      project_id: projectId && this.bucket('projects').has(projectId) ? projectId : null,
      section_id: sectionId && this.bucket('sections').has(sectionId) ? sectionId : null,
      parent_id: parentId && this.bucket('tasks').has(parentId) ? parentId : null,
      content: asString(row.content ?? row.title),
      description: asString(row.description),
      priority: priorityOr(row.priority),
      order_key: asString(row.orderKey ?? row.order_key),
      due_date: dayOrNull(row.dueDate ?? row.due_date),
      due_time: timeOrNull(row.dueTime ?? row.due_time),
      deadline: dayOrNull(row.deadline),
      duration_minutes:
        row.durationMinutes === null || row.durationMinutes === undefined
          ? null
          : asInteger(row.durationMinutes, 0),
      recurrence: recurrenceToColumn(row.recurrence),
      labels: asArray(row.labels),
      checklist: asArray(row.checklist),
      attachments: asArray(row.attachments),
      is_completed: asBoolean(row.isCompleted ?? row.is_completed),
      completed_at: asNullableString(row.completedAt ?? row.completed_at),
      completed_count: asInteger(row.completedCount ?? row.completed_count, 0),
      postponed_count: asInteger(row.postponedCount ?? row.postponed_count, 0),
      deleted_at: asNullableString(row.deletedAt ?? row.deleted_at),
      created_at: isoOrNow(row.createdAt ?? row.created_at),
      updated_at: isoOrNow(row.updatedAt ?? row.updated_at),
    };
    const { error } = await this.client.from('tasks').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(`tasks upsert failed: ${error.message}`);
  }

  private async persistLabel(row: AnyRow): Promise<void> {
    const name = asString(row.name).trim();
    if (!name) throw new Error('label.name is required');
    const payload = {
      id: row.id,
      name,
      color: asString(row.color, '#246fe0'),
      order_key: asString(row.orderKey ?? row.order_key),
      is_favorite: asBoolean(row.isFavorite ?? row.is_favorite),
      created_at: isoOrNow(row.createdAt ?? row.created_at),
      updated_at: isoOrNow(row.updatedAt ?? row.updated_at),
    };
    const { error } = await this.client.from('labels').upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(`labels upsert failed: ${error.message}`);
  }

  private async persistGeneric(collection: CollectionKey, row: AnyRow): Promise<void> {
    const payload = {
      collection,
      id: row.id,
      seq: this.nextSeq(collection),
      data: row,
      created_at: isoOrNow(row.createdAt ?? row.created_at),
      updated_at: isoOrNow(row.updatedAt ?? row.updated_at),
    };
    const { error } = await this.client
      .from(GENERIC_TABLE)
      .upsert(payload, { onConflict: 'collection,id' });
    if (error) throw new Error(`${GENERIC_TABLE} upsert failed: ${error.message}`);
  }
}
