import { Kernel, MemoryStore, type DataStore } from '@ayatodoist/core-kernel';
import { tasksCorePlugin } from '@ayatodoist/plugin-tasks-core';
import {
  aiAgentPlugin,
  checklistsPlugin,
  filtersLabelsPlugin,
  quickAddNlpPlugin,
  reportingPlugin,
  viewsLayoutsPlugin,
} from './plugins';

/**
 * One kernel per process: the same plugin set the browser runs.
 *
 * Kept separate from `index.ts` so serverless handlers (Netlify Functions) can
 * build the kernel without pulling in the Bun HTTP server or `bun:sqlite`.
 */
export function createKernel(store?: DataStore): Kernel {
  const kernel = new Kernel({ store: store ?? new MemoryStore() });
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
  return kernel;
}
