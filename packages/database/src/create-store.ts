import type { AyaStore } from './aya-store-types';
import { isSupabaseConfigured } from './supabase-client';
import { SupabaseAyaStore } from './supabase-store';

/**
 * Picks the persistence backend for this process:
 *   `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set → Supabase Postgres
 *   otherwise                                       → local SQLite file
 *
 * The SQLite adapter is imported lazily so a serverless runtime (which has no
 * `bun:sqlite`) never evaluates it when Supabase is configured.
 */
export async function createAyaStore(opts: { filename?: string } = {}): Promise<AyaStore> {
  if (isSupabaseConfigured()) {
    const store = new SupabaseAyaStore();
    await store.hydrate();
    return store;
  }
  const { SqliteAyaStore } = await import('./aya-store');
  return new SqliteAyaStore(opts.filename);
}
