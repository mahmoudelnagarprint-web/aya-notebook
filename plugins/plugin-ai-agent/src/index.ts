import type { PluginDescriptor } from '@ayatodoist/core-kernel';

export { runAgent, buildToolSpecs, providerPresets, type AgentConfig } from './engine';
export { commandsForAgent } from './commands-for-agent';
export { AyaBrain, buildHistoryMessages, selectAyaToolSpecs } from './aya/brain';
export { AyaModelRouter, sanitizeToolHistory } from './aya/router';
export { AyaMemoryEngine } from './aya/memory';
export { AyaProactiveEngine, executeInboxActions } from './aya/proactive';
export { buildAyaSystemPrompt } from './aya/persona';
export { suggestRouting, describeRouting } from './aya/routing';

export const aiAgentPlugin: PluginDescriptor = {
  id: 'ai-agent',
  name: 'Aya — AI agent',
  nameAr: 'آية — الوكيلة الذكية',
  version: '2.0.0',
  description: 'Aya: provider routing with failover, memory, proactive inbox and the agent tool loop.',
  descriptionAr: 'آية: توجيه المزودين مع التبديل التلقائي، ذاكرة، صندوق مقترحات، وحلقة أدوات.',
  capabilities: ['Multi-provider failover', 'Tool loop over every kernel command', '4-layer memory', 'Proactive inbox'],
  defaultEnabled: true,
  commands: [],
};

export const aiAgentUi = aiAgentPlugin;
export function tokenFn(_token: any): void {}
export function totalFn(_total: any): void {}
