/**
 * Fractional ordering keys ("orderKey").
 *
 * Keys are zero-padded decimal strings so plain lexicographic comparison matches
 * numeric order. New rows are placed at the end with a wide gap; inserting between
 * two siblings uses the midpoint. When a gap is exhausted the owning command calls
 * `rebalance`, which redistributes siblings while preserving their relative order.
 */
export const ORDER_KEY_LENGTH = 15;
export const ORDER_GAP = 1024;

export class OrderKeyExhausted extends Error {
  constructor() {
    super('orderKey space exhausted between neighbours; rebalance the sibling list');
    this.name = 'OrderKeyExhausted';
  }
}

export function padOrderKey(value: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(ORDER_KEY_LENGTH, '0');
}

export function orderKeyValue(key: string | null | undefined): number {
  if (!key) return 0;
  const value = Number.parseInt(key, 10);
  return Number.isFinite(value) ? value : 0;
}

export function orderKeyAfter(last?: string | null): string {
  return padOrderKey(orderKeyValue(last) + ORDER_GAP);
}

export function orderKeyBefore(first?: string | null): string {
  const current = orderKeyValue(first);
  if (current <= 1) return padOrderKey(0);
  return padOrderKey(Math.floor(current / 2));
}

export function orderKeyBetween(previous?: string | null, next?: string | null): string {
  if (!previous && !next) return padOrderKey(ORDER_GAP);
  if (!previous) return orderKeyBefore(next);
  if (!next) return orderKeyAfter(previous);
  const low = orderKeyValue(previous);
  const high = orderKeyValue(next);
  if (high - low <= 1) throw new OrderKeyExhausted();
  return padOrderKey(low + Math.floor((high - low) / 2));
}

/** Assigns evenly spaced keys following the array order. Returns the new keys by id. */
export function rebalanceOrderKeys(ids: string[]): Map<string, string> {
  const result = new Map<string, string>();
  ids.forEach((id, index) => result.set(id, padOrderKey((index + 1) * ORDER_GAP)));
  return result;
}

export function sortByOrderKey<T extends { orderKey: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}
