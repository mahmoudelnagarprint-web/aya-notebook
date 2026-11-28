import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BaseAyaStore } from './aya-base';
import type { AyaCollection, AyaRow } from './aya-store-types';

/**
 * SQLite persistence for Aya — the local-first fallback used whenever
 * `SUPABASE_URL` is unset.
 *
 * A single generic `aya_rows` table keeps migrations trivial: a new collection
 * is just a new `collection` value, and every row keeps its natural JSON shape.
 *
 * This file imports `bun:sqlite`, so it is exported from the
 * `@ayatodoist/database/sqlite` subpath only — never from the package barrel,
 * which must stay bundleable for Node/Netlify Functions.
 */

interface SqliteRow {
  id: string;
  seq: number;
  data: string;
  created_at: string;
  updated_at: string;
}

function toRow(collection: AyaCollection, row: SqliteRow): AyaRow {
  return {
    collection,
    id: row.id,
    seq: Number(row.seq ?? 0),
    data: JSON.parse(row.data) as unknown,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteAyaStore extends BaseAyaStore {
  private readonly db: Database;

  constructor(filename = ':memory:') {
    super();
    if (filename !== ':memory:') {
      try {
        mkdirSync(dirname(filename), { recursive: true });
      } catch {
        /* directory already exists */
      }
    }
    this.db = new Database(filename, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS aya_rows (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        seq INTEGER NOT NULL DEFAULT 0,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS aya_rows_collection ON aya_rows (collection, seq);
    `);
  }

  protected readRows(collection: AyaCollection): AyaRow[] {
    const rows = this.db
      .query('SELECT id, seq, data, created_at, updated_at FROM aya_rows WHERE collection = ? ORDER BY seq ASC, rowid ASC')
      .all(collection) as SqliteRow[];
    return rows.map((row) => toRow(collection, row));
  }

  protected readRow(collection: AyaCollection, id: string): AyaRow | null {
    const row = this.db
      .query('SELECT id, seq, data, created_at, updated_at FROM aya_rows WHERE collection = ? AND id = ?')
      .get(collection, id) as SqliteRow | undefined;
    return row ? toRow(collection, row) : null;
  }

  protected writeRow(collection: AyaCollection, row: AyaRow): void {
    this.db
      .query(
        `INSERT INTO aya_rows (collection, id, seq, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET seq = excluded.seq, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(collection, row.id, row.seq, JSON.stringify(row.data), row.createdAt, row.updatedAt);
  }

  protected removeRow(collection: AyaCollection, id: string): void {
    this.db.query('DELETE FROM aya_rows WHERE collection = ? AND id = ?').run(collection, id);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}
