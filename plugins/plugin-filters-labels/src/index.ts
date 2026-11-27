import type { PluginDescriptor } from '@ayatodoist/core-kernel';

export {
  parseFilter,
  evaluateFilter,
  evaluateNode,
  STARTER_FILTERS,
  type FilterNode,
  type Atom,
  type FilterContext,
  type ParseResult,
} from './query';

export const filtersLabelsPlugin: PluginDescriptor = {
  id: 'filters-labels',
  name: 'Filters & labels',
  nameAr: 'الفلاتر والتصنيفات',
  version: '0.1.0',
  description: 'Local filter query engine, starter filters and label management.',
  descriptionAr: 'محرك فلاتر محلي وفلاتر جاهزة وإدارة التصنيفات.',
  capabilities: ['Query filters (& | ! groups)', 'Starter filters', 'Label naming'],
  defaultEnabled: true,
  commands: [],
};
