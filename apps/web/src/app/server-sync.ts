import type { Kernel } from '@ayatodoist/core-kernel';

type Row = Record<string, unknown> & { id?: string };

/**
 * Hydrates a browser kernel from a server snapshot.
 *
 * Accepts either the full envelope (`{ collections: { tasks: [...] } }`) or the
 * bare collections map that older `/api/v1/bootstrap` payloads sent. An empty or
 * missing payload returns `null` and leaves the live kernel untouched — a network
 * hiccup must never clear local work.
 */
export function hydrateKernelFromSnapshot(
  kernel: Kernel,
  snapshot: { collections?: Record<string, unknown[]> } | Record<string, unknown[]> | null | undefined,
): number | null {
  if (!snapshot) return null;

  const envelope = snapshot as { collections?: Record<string, unknown[]> };
  const collections = envelope.collections ?? (snapshot as Record<string, unknown[]>);
  if (!collections || typeof collections !== 'object' || Array.isArray(collections)) return null;
  if (Object.keys(collections).length === 0) return null;

  let applied = 0;
  for (const [collection, rows] of Object.entries(collections)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Row[]) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string') continue;
      kernel.store.upsert(collection as never, row as never);
      applied += 1;
    }
  }

  return applied;
}
