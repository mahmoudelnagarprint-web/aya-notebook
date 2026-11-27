import type { PluginUiModule } from '@ayatodoist/plugin-sdk';
import type { Route } from '@ayatodoist/core-kernel';
import { AyaChatDrawer } from './aya-ui/chat';
import { AyaInboxView } from './aya-ui/inbox';
import { AyaSettingsPanel } from './aya-ui/settings';

export { AyaChatDrawer } from './aya-ui/chat';
export { AyaInboxView } from './aya-ui/inbox';
export { AyaSettingsPanel } from './aya-ui/settings';
export { useLanguage, useSettings } from '@ayatodoist/plugin-sdk/react';

/** Named slots the shell fills: the drawer and the settings panel. */
export const SLOT = {
  chatDrawer: 'aya.chat',
  settingsPanel: 'aya.settings',
} as const;

export const ayaUi: PluginUiModule = {
  id: 'ai-agent',
  routes: { aya: AyaInboxView },
  slots: { [SLOT.chatDrawer]: AyaChatDrawer, [SLOT.settingsPanel]: AyaSettingsPanel },
};

/** Kept for compatibility with the plugin registry: every Aya route lives under #/aya. */
export function aiAgentRoute(route: Route): boolean {
  return route.kind === 'aya';
}

