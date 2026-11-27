/**
 * Offline queue persistence + flush. Lives in the background worker.
 * If the server is unreachable when the user submits a task/note/link, the
 * operation is held in `chrome.storage.local` and replayed on the next
 * successful connection (alarm every ~2 minutes or on health check success).
 */

import { STORAGE_KEYS, nextOperationId } from './core';
import { ayaServer } from './server';
import type { QueuedOperation } from './core';

const QUEUE_KEY = STORAGE_KEYS.QUEUE;

function readQueue(): Promise<{ operations: QueuedOperation[]; lastAttemptAt: string | null }> {
  return new Promise((resolve) => {
    chrome.storage.local.get([QUEUE_KEY], (res: any) => {
      const q = (res && res[QUEUE_KEY]) || { operations: [], lastAttemptAt: null };
      resolve(q as { operations: QueuedOperation[]; lastAttemptAt: string | null });
    });
  });
}

function writeQueue(q: { operations: QueuedOperation[]; lastAttemptAt: string | null }) {
  chrome.storage.local.set({ [QUEUE_KEY]: q });
}

/**
 * Enqueue an operation. Returns the id assigned.
 */
export async function enqueueOperation(op: Omit<QueuedOperation, 'id' | 'createdAt'>): Promise<string> {
  const id = nextOperationId();
  const entry: QueuedOperation = { ...op, id, createdAt: new Date().toISOString() };
  const q = await readQueue();
  q.operations.push(entry);
  await writeQueue(q);
  await chrome.storage.local.set({ [STORAGE_KEYS.UNREAD]: (await chrome.storage.local.get([STORAGE_KEYS.UNREAD]))[STORAGE_KEYS.UNREAD] + 1 });
  return id;
}

/**
 * Attempt to flush the queue to the server. Returns { flushed, failed, total }.
 * Each operation is submitted through the server `/api/v1/sync` endpoint so the
 * server can replay them through the same bus (idempotent-ish via client id).
 */
export async function flushQueue(): Promise<{ flushed: number; failed: number; total: number }> {
  const q = await readQueue();
  if (!q.operations.length) return { flushed: 0, failed: 0, total: 0 };

  const now = new Date().toISOString();
  const ops = q.operations.map((op) => ({
    id: op.id,
    name: op.name,
    input: op.input,
    actor: op.actor,
    confirmed: op.confirmed,
    batchId: op.batchId ?? undefined,
  }));

  let result: { ok: boolean; applied?: Array<{ id?: string; name: string; ok: boolean; error?: string }>; error?: any };
  try {
    result = await ayaServer.sync(q.operations[0].id, ops);
  } catch (err) {
    result = { ok: false, error: err as any };
  }

  const qAfter = await readQueue();
  const applied = (result as any)?.applied ?? [];
  const flushedIds = new Set(applied.filter((a: any) => a.ok).map((a: any) => a.id));
  const remaining = qAfter.operations.filter((op) => !flushedIds.has(op.id));
  const failed = remaining.length;
  await writeQueue({ operations: remaining, lastAttemptAt: now });
  if (!failed) {
    await chrome.storage.local.set({ [STORAGE_KEYS.UNREAD]: 0 });
  }
  return { flushed: qAfter.operations.length - failed, failed, total: qAfter.operations.length };
}

/**
 * Return the current queue count and whether a flush is pending.
 */
export async function queueStatus(): Promise<{ count: number; pending: boolean; lastAttemptAt: string | null }> {
  const q = await readQueue();
  return { count: q.operations.length, pending: q.operations.length > 0, lastAttemptAt: q.lastAttemptAt };
}
