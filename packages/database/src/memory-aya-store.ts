import { BaseAyaStore } from './aya-base';
import type { AyaCollection, AyaRow } from './aya-store-types';

/**
 * Pure in-memory Aya store. No native driver and no I/O, so it bundles cleanly
 * for serverless runtimes (Netlify Functions) and tests.
 */
export class MemoryAyaStore extends BaseAyaStore {
  private readonly collections = new Map<AyaCollection, Map<string, AyaRow>>();

  private bucket(collection: AyaCollection): Map<string, AyaRow> {
    let rows = this.collections.get(collection);
    if (!rows) {
      rows = new Map();
      this.collections.set(collection, rows);
    }
    return rows;
  }

  protected readRows(collection: AyaCollection): AyaRow[] {
    return [...this.bucket(collection).values()].sort((a, b) => a.seq - b.seq);
  }

  protected readRow(collection: AyaCollection, id: string): AyaRow | null {
    return this.bucket(collection).get(id) ?? null;
  }

  protected writeRow(collection: AyaCollection, row: AyaRow): void {
    this.bucket(collection).set(row.id, row);
  }

  protected removeRow(collection: AyaCollection, id: string): void {
    this.bucket(collection).delete(id);
  }
}
