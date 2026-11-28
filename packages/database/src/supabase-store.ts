import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseAyaStore } from './aya-base';
import type { AyaCollection, AyaRow } from './aya-store-types';
import { getSupabaseAdmin } from './supabase-client';

/**
 * Postgres persistence for Aya (Supabase).
 *
 * Every collection maps to one table that stores the row id, its natural JSON
 * payload (`data jsonb`), a sort `seq` and timestamps. Writes go straight to
 * Postgres through the service-role client; reads are served from a per-process
 * mirror of those tables so the synchronous kernel/brain call sites keep working.
 *
 * The mirror is hydrated once per process (`hydrate()`), every write updates it
 * immediately and is then pushed to Postgres through a serialized queue. Call
 * `flush()` before a serverless function returns so a write is never dropped
 * when the isolate freezes.
 */

export const AYA_TABLES: Record<AyaCollection, string> = {
  providers: 'aya_providers',
  models: 'aya_models',
  routing: 'aya_routing',
  conversations: 'aya_conversations',
  messages: 'aya_messages',
  memories: 'aya_memories',
  inbox: 'aya_notifications',
  journal: 'aya_learning_journal',
  channels: 'aya_channels',
  settings: 'aya_settings',
};

interface RemoteRow {
  id: string;
  seq: number | null;
  data: unknown;
  created_at: string | null;
  updated_at: string | null;
}

export class SupabaseAyaStore extends BaseAyaStore {
  private readonly client: SupabaseClient;
  private readonly mirror = new Map<AyaCollection, Map<string, AyaRow>>();
  private queue: Promise<void> = Promise.resolve();
  private hydrated = false;

  constructor(client?: SupabaseClient) {
    super();
    this.client = client ?? getSupabaseAdmin();
  }

  private bucket(collection: AyaCollection): Map<string, AyaRow> {
    let rows = this.mirror.get(collection);
    if (!rows) {
      rows = new Map();
      this.mirror.set(collection, rows);
    }
    return rows;
  }

  /** Loads every collection once. Safe to call repeatedly. */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    const collections = Object.keys(AYA_TABLES) as AyaCollection[];
    await Promise.all(
      collections.map(async (collection) => {
        const table = AYA_TABLES[collection];
        const { data, error } = await this.client
          .from(table)
          .select('id, seq, data, created_at, updated_at')
          .order('seq', { ascending: true })
          .limit(5000);
        if (error) {
          throw new Error(`Supabase hydrate failed for ${table}: ${error.message}. Apply supabase/schema.sql first.`);
        }
        const bucket = this.bucket(collection);
        for (const row of (data ?? []) as RemoteRow[]) {
          bucket.set(row.id, {
            collection,
            id: row.id,
            seq: Number(row.seq ?? 0),
            data: row.data,
            createdAt: row.created_at ?? new Date(0).toISOString(),
            updatedAt: row.updated_at ?? row.created_at ?? new Date(0).toISOString(),
          });
        }
      }),
    );
    this.hydrated = true;
  }

  async ready(): Promise<void> {
    await this.hydrate();
  }

  protected readRows(collection: AyaCollection): AyaRow[] {
    return [...this.bucket(collection).values()].sort((a, b) => a.seq - b.seq);
  }

  protected readRow(collection: AyaCollection, id: string): AyaRow | null {
    return this.bucket(collection).get(id) ?? null;
  }

  protected writeRow(collection: AyaCollection, row: AyaRow): void {
    this.bucket(collection).set(row.id, row);
    const payload = {
      id: row.id,
      seq: row.seq,
      data: row.data,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
    this.enqueue(async () => {
      const { error } = await this.client.from(AYA_TABLES[collection]).upsert(payload, { onConflict: 'id' });
      if (error) throw new Error(`${AYA_TABLES[collection]} upsert failed: ${error.message}`);
    });
  }

  protected removeRow(collection: AyaCollection, id: string): void {
    this.bucket(collection).delete(id);
    this.enqueue(async () => {
      const { error } = await this.client.from(AYA_TABLES[collection]).delete().eq('id', id);
      if (error) throw new Error(`${AYA_TABLES[collection]} delete failed: ${error.message}`);
    });
  }

  private enqueue(job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch((error: unknown) => {
      console.error('[supabase]', error instanceof Error ? error.message : error);
    });
  }

  /** Resolves once every queued write has reached Postgres. */
  async flush(): Promise<void> {
    await this.queue;
  }
}
