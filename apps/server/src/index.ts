import { Database } from 'bun:sqlite';

declare const Bun: {
  serve: (options: {
    port: number;
    hostname: string;
    idleTimeout?: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }) => unknown;
};
import { join } from 'node:path';
import { isSupabaseConfigured, type AyaStore } from '@ayatodoist/database';
import { createAyaStore } from '@ayatodoist/database/create-store';
import { createServerApp } from './app';
import { createKernel } from './kernel';

export { SqliteAyaStore } from '@ayatodoist/database/sqlite';
export { createKernel } from './kernel';

export const databaseFile = process.env.AYATODOIST_DB ?? join(process.cwd(), 'data', 'ayatodoist.db');

/**
 * Builds the kernel plus its persistence backend: Supabase Postgres when
 * `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are set, local SQLite otherwise.
 */
export async function createServerKernel(): Promise<{ kernel: ReturnType<typeof createKernel>; ayaStore: AyaStore }> {
  const kernel = createKernel();
  const ayaStore = await createAyaStore({ filename: databaseFile });
  // Local SQLite needs the database file to exist up front; Supabase does not.
  if (!isSupabaseConfigured()) {
    void new Database(databaseFile, { create: true }).close();
  }
  return { kernel, ayaStore };
}

const { kernel, ayaStore } = await createServerKernel();
const app = await createServerApp(kernel, ayaStore);

// `PORT=0` (set by some hosts) would bind a random port; the local API is always 8787.
const requested = Number(process.env.PORT);
const port = Number.isInteger(requested) && requested > 0 ? requested : 8787;

if (import.meta.main) {
  // Model probes can legitimately take longer than Bun's 10s default; without
  // this the batched test / health-check POSTs would be aborted mid-probe.
  Bun.serve({ port, hostname: '127.0.0.1', idleTimeout: 120, fetch: app.fetch });
  const backend = isSupabaseConfigured() ? 'Supabase Postgres' : `SQLite (${databaseFile})`;
  console.log(`[server] listening on http://127.0.0.1:${port} — ${backend}`);
}

export { app };
