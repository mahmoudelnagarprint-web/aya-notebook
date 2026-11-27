/**
 * Plugin SDK — the small, stable surface every UI plugin builds against.
 *
 * Ordering helpers live here (rather than in each plugin) because quick-add,
 * drag & drop and the sidebar all need the same key arithmetic.
 */
import type { ComponentType } from 'react';

export const ORDER_GAP = 1_000_000_000_000_000;

/** Ascending compare for `orderKey` strings; missing keys sort last. */
export function sortByOrderKey<T extends { orderKey?: string | null }>(a: T, b: T): number {
  const left = a.orderKey ?? '~';
  const right = b.orderKey ?? '~';
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Evenly re-spaced keys, used after a reorder so future inserts always fit. */
export function rebalanceOrderKeys(items: Array<{ id: string; orderKey?: string | null }>): Array<{ id: string; orderKey: string }> {
  return items.map((item, index) => ({ id: item.id, orderKey: String(index + 1).padStart(16, '0') }));
}

/** Every UI plugin exports one of these; the registry merges their routes. */
export interface PluginUiModule {
  id: string;
  routes?: Record<string, ComponentType<any>>;
  slots?: Record<string, ComponentType<any>>;
}

export type { ComponentType };
