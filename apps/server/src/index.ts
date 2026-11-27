import { Database } from 'bun:sqlite';

declare const Bun: { serve: (options: { port: number; hostname: string; fetch: (request: Request) => Response | Promise<Response> }) => unknown };
import { join } from 'node:path';
import { Kernel, MemoryStore } from '@ayatodoist/core-kernel';
import { tasksCorePlugin } from '@ayatodoist/plugin-tasks-core';
import { SqliteAyaStore } from '@ayatodoist/database';
import { createServerApp } from './app';
import {
  aiAgentPlugin,
  checklistsPlugin,
  filtersLabelsPlugin,
  quickAddNlpPlugin,
  reportingPlugin,
  viewsLayoutsPlugin,
} from './plugins';

export { SqliteAyaStore } from '@ayatodoist/database';

export const databaseFile = process.env.AYATODOIST_DB ?? join(process.cwd(), 'data', 'ayatodoist.db');

/** One kernel per process: the same plugin set the browser runs. */
export function createServerKernel(): { kernel: Kernel; ayaStore: SqliteAyaStore } {
  const kernel = new Kernel({ store: new MemoryStore() });
  kernel.installAll([
    tasksCorePlugin,
    viewsLayoutsPlugin,
    filtersLabelsPlugin,
    reportingPlugin,
    aiAgentPlugin,
    checklistsPlugin,
    quickAddNlpPlugin,
  ] as never);
  kernel.start();

  const ayaStore = new SqliteAyaStore(databaseFile);
  void new Database(databaseFile, { create: true }).close();
  return { kernel, ayaStore };
}

const { kernel, ayaStore } = createServerKernel();
const app = createServerApp(kernel, ayaStore);

// `PORT=0` (set by some hosts) would bind a random port; the local API is always 8787.
const requested = Number(process.env.PORT);
const port = Number.isInteger(requested) && requested > 0 ? requested : 8787;

if (import.meta.main) {
  Bun.serve({ port, hostname: '127.0.0.1', fetch: app.fetch });
  console.log(`[server] listening on http://127.0.0.1:${port}`);
}

export { app };
