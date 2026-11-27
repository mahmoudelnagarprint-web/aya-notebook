import type { ComponentType } from 'react';
import type { PluginUiModule } from '@ayatodoist/plugin-sdk';
import { tasksCoreUi } from '@ayatodoist/plugin-tasks-core';
import { reportingUi } from '@ayatodoist/plugin-reporting/ui';
import { ayaUi } from '@ayatodoist/plugin-ai-agent/ui';
import { quickAddUi } from '@ayatodoist/plugin-quick-add-nlp/ui';
import { checklistsUi } from '@ayatodoist/plugin-checklists-media/ui';
import { filtersLabelsUi } from '@ayatodoist/plugin-filters-labels/ui';
import { viewsLayoutsUi } from '@ayatodoist/plugin-views-layouts/ui';

export { aiAgentPlugin } from '@ayatodoist/plugin-ai-agent';
export { aiAgentUi } from '@ayatodoist/plugin-ai-agent';

/** Every UI contribution, in render priority order. */
export const uiModules: PluginUiModule[] = [
  tasksCoreUi,
  viewsLayoutsUi,
  filtersLabelsUi,
  reportingUi,
  ayaUi,
  checklistsUi,
  quickAddUi,
];

/** Plugin id → UI module, used by the shell to resolve slots. */
export const map: Record<string, PluginUiModule> = Object.fromEntries(
  uiModules.map((module) => [module.id, module]),
);

/** Merged route table from every plugin. Later modules win on collisions. */
export const routes: Record<string, ComponentType<any>> = {};
for (const module of uiModules) {
  for (const [kind, component] of Object.entries(module.routes ?? {})) {
    routes[kind] = component as ComponentType<any>;
  }
}

export function registryMap(contribution: PluginUiModule): void {
  map[contribution.id] = contribution;
  uiModules.push(contribution);
}
