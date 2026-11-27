import { Kernel, MemoryStore, type SnapshotEnvelope } from '@ayatodoist/core-kernel';
import { tasksCorePlugin } from '@ayatodoist/plugin-tasks-core';
import { aiAgentPlugin } from '@ayatodoist/plugin-ai-agent';
import { checklistsPlugin } from '@ayatodoist/plugin-checklists-media';
import { filtersLabelsPlugin } from '@ayatodoist/plugin-filters-labels';
import { quickAddNlpPlugin } from '@ayatodoist/plugin-quick-add-nlp';
import { reportingPlugin } from '@ayatodoist/plugin-reporting';
import { viewsLayoutsPlugin } from '@ayatodoist/plugin-views-layouts';
import { bumpKernelRevision } from '@ayatodoist/plugin-sdk/react';
import { hydrateKernelFromSnapshot } from './server-sync';
import { syncStore } from './sync';

/** The exact plugin set the server runs, so both kernels behave identically. */
export const browserPlugins = [
  tasksCorePlugin,
  viewsLayoutsPlugin,
  filtersLabelsPlugin,
  reportingPlugin,
  aiAgentPlugin,
  checklistsPlugin,
  quickAddNlpPlugin,
];

export function createBrowserKernel(): Kernel {
  const kernel = new Kernel({ store: new MemoryStore() });
  kernel.installAll(browserPlugins as never);
  kernel.start();
  // Quick-add always needs somewhere to land.
  void kernel.execute('project.ensureInbox', {} as never).catch(() => undefined);
  return kernel;
}

export interface BootstrapPayload {
  ok?: boolean;
  snapshot?: SnapshotEnvelope;
  collections?: Record<string, unknown[]>;
}

async function fetchJson(path: string): Promise<BootstrapPayload | null> {
  try {
    const response = await fetch(syncStore.url(path), { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return (await response.json()) as BootstrapPayload;
  } catch {
    return null;
  }
}

/**
 * Pulls the workspace from the local API.
 *
 * `/api/v1/bootstrap` carries the task projection for the first paint; the full
 * snapshot adds projects, labels, filters and settings. A missing server is a
 * normal offline state, not an error.
 */
export async function fetchServerCollections(): Promise<SnapshotEnvelope | null> {
  const bootstrap = await fetchJson('/api/v1/bootstrap');
  const full = await fetchJson('/api/v1/snapshot');
  if (full?.snapshot) {
    const tasks = bootstrap?.snapshot?.collections?.tasks;
    if (tasks && tasks.length > 0 && (!full.snapshot.collections.tasks || full.snapshot.collections.tasks.length === 0)) {
      return { ...full.snapshot, collections: { ...full.snapshot.collections, tasks } };
    }
    return full.snapshot;
  }
  if (bootstrap?.snapshot) return bootstrap.snapshot;
  if (bootstrap?.collections) {
    return { version: 1, savedAt: new Date().toISOString(), collections: bootstrap.collections as SnapshotEnvelope['collections'] };
  }
  return null;
}

/** Hydrates a live kernel from the server and repaints every subscribed view. */
export async function bootstrapSnapshot(kernel: Kernel): Promise<number | null> {
  const snapshot = await fetchServerCollections();
  if (!snapshot) return null;
  const applied = hydrateKernelFromSnapshot(kernel, snapshot);
  if (applied) bumpKernelRevision();
  return applied;
}

/**
 * Exposed for the shell and Aya: any change made elsewhere (agent turn, another
 * tab, the server kernel) can be pulled in without reloading the page.
 */
export async function syncFromServer(kernel: Kernel): Promise<number | null> {
  const applied = await bootstrapSnapshot(kernel);
  if (applied !== null) await syncStore.ping();
  return applied;
}
