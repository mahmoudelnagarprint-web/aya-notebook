/**
 * Offline queue persistence + replay.
 *
 * When the server is unreachable the operation is kept in `chrome.storage.local`
 * and replayed through the same `/api/v1/command/:name` endpoint later. The
 * background worker flushes on a 2-minute alarm and when health recovers.
 */

import { STORAGE_KEYS, nextOperationId } from './core';
import { ayaServer } from './server';
import type { QueuedOperation } from './core';

const QUEUE_KEY = STORAGE_KEYS.QUEUE;

export interface QueueState {
  operations: QueuedOperation[];
  lastAttemptAt: string | null;
}

export async function readQueue(): Promise<QueueState> {
  const res = (await chrome.storage.local.get([QUEUE_KEY])) as Record<string, any>;
  const stored = res?.[QUEUE_KEY];
  return {
    operations: Array.isArray(stored?.operations) ? stored.operations : [],
    lastAttemptAt: stored?.lastAttemptAt ?? null,
  };
}

async function writeQueue(state: QueueState): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: state });
}

export async function enqueueOperation(
  op: Omit<QueuedOperation, 'id' | 'createdAt'>,
): Promise<string> {
  const id = nextOperationId();
  const entry: QueuedOperation = { ...op, id, createdAt: new Date().toISOString() };
  const queue = await readQueue();
  queue.operations.push(entry);
  await writeQueue(queue);
  return id;
}

/** Replays every pending operation. Returns counts for the UI. */
export async function flushQueue(): Promise<{ flushed: number; failed: number; total: number }> {
  const queue = await readQueue();
  const total = queue.operations.length;
  if (!total) return { flushed: 0, failed: 0, total: 0 };

  const remaining: QueuedOperation[] = [];
  let flushed = 0;
  for (const op of queue.operations) {
    try {
      await ayaServer.command(op.name, op.input);
      flushed += 1;
    } catch {
      remaining.push(op);
    }
  }

  await writeQueue({ operations: remaining, lastAttemptAt: new Date().toISOString() });
  return { flushed, failed: remaining.length, total };
}

export async function queueStatus(): Promise<{ count: number; pending: boolean; lastAttemptAt: string | null }> {
  const queue = await readQueue();
  return { count: queue.operations.length, pending: queue.operations.length > 0, lastAttemptAt: queue.lastAttemptAt };
}

export async function clearQueue(): Promise<void> {
  await writeQueue({ operations: [], lastAttemptAt: new Date().toISOString() });
}
