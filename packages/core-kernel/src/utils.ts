import type { AppSettings, IdGenerator } from '@ayatodoist/shared-types';
import { AppSettingsSchema } from '@ayatodoist/shared-types';

export function createId(prefix?: string): string {
  const raw =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${raw}` : raw;
}

export const defaultIdGenerator: IdGenerator = (prefix?: string) => createId(prefix);

export function toDay(clock: Date): string {
  const y = clock.getFullYear();
  const m = `${clock.getMonth() + 1}`.padStart(2, '0');
  const d = `${clock.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toLocalIso(clock: Date): string {
  return clock.toISOString();
}

export function createDefaultSettings(language: 'ar' | 'en' = 'ar'): AppSettings {
  return AppSettingsSchema.parse({
    id: 'app',
    theme: 'dark',
    language,
    sidebarCollapsed: false,
    weekStart: 6,
    timeFormat: '24h',
    shortcutsEnabled: true,
    agent: {},
    display: {},
    enabledPlugins: {},
    updatedAt: new Date().toISOString(),
  });
}

/** Replaces `{token}` placeholders in command summaries. */
export function fillSummary(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key] ?? '') : match,
  );
}

export function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}
