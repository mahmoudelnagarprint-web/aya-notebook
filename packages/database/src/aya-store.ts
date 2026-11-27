import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * SQLite persistence for Aya (providers, models, routing, conversations,
 * messages, memory, inbox, journal, channels and settings).
 *
 * Every read is synchronous — the kernel and the memory engine want plain
 * arrays — while `await` on those values still works, so the same adapter
 * satisfies both the sync engine and the async `AyaPersistenceAdapter` shape.
 *
 * A single generic `aya_rows` table keeps migrations trivial: a new collection
 * is just a new `collection` value, and every row keeps its natural JSON shape.
 */

type Collection =
  | 'providers'
  | 'models'
  | 'routing'
  | 'conversations'
  | 'messages'
  | 'memories'
  | 'inbox'
  | 'journal'
  | 'channels'
  | 'settings';

interface StoredRow {
  collection: string;
  id: string;
  seq: number;
  data: string;
  created_at: string;
  updated_at: string;
}

function parse<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function sortBy<T>(rows: T[], key: (row: T) => number | string): T[] {
  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left).localeCompare(String(right));
  });
}

export class SqliteAyaStore {
  private readonly db: Database;

  constructor(filename = ':memory:') {
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

  /* ----------------------------------------------------------- primitives */

  private put(collection: Collection, id: string, value: unknown, seq = 0): void {
    const now = new Date().toISOString();
    const existing = this.db.query('SELECT created_at FROM aya_rows WHERE collection = ? AND id = ?').get(collection, id) as
      | { created_at: string }
      | undefined;
    this.db
      .query(
        `INSERT INTO aya_rows (collection, id, seq, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(collection, id) DO UPDATE SET seq = excluded.seq, data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(collection, id, seq, JSON.stringify(value), existing?.created_at ?? now, now);
  }

  private all<T>(collection: Collection): T[] {
    const rows = this.db.query('SELECT data, seq FROM aya_rows WHERE collection = ? ORDER BY seq ASC, rowid ASC').all(collection) as Array<{
      data: string;
      seq: number;
    }>;
    return rows.map((row) => parse<T>(row.data));
  }

  private one<T>(collection: Collection, id: string): T | null {
    const row = this.db.query('SELECT data FROM aya_rows WHERE collection = ? AND id = ?').get(collection, id) as
      | { data: string }
      | undefined;
    return row ? parse<T>(row.data) : null;
  }

  private remove(collection: Collection, id: string): void {
    this.db.query('DELETE FROM aya_rows WHERE collection = ? AND id = ?').run(collection, id);
  }

  /* ------------------------------------------------------------ providers */

  saveProvider(provider: any): any {
    const previous = this.one<any>('providers', provider.id);
    const merged = { ...(previous ?? {}), ...provider };
    this.put('providers', provider.id, merged);
    return merged;
  }

  listProviders(): any[] {
    return this.all<any>('providers');
  }

  deleteProvider(id: string): void {
    this.remove('providers', id);
    for (const row of this.all<any>('models')) {
      if (row.providerId === id) this.remove('models', row.id);
    }
  }

  /* --------------------------------------------------------------- models */

  saveModel(model: any): any {
    const previous = this.one<any>('models', model.id);
    const merged = { ...(previous ?? {}), ...model };
    this.put('models', model.id, merged);
    return merged;
  }

  listModels(providerId?: string): any[] {
    const rows = this.all<any>('models');
    const filtered = providerId ? rows.filter((row) => row.providerId === providerId) : rows;
    return sortBy(filtered, (row) => row.priority ?? 0);
  }

  deleteModel(id: string): void {
    this.remove('models', id);
  }

  /* -------------------------------------------------------------- routing */

  saveRouting(routing: any): any {
    const previous = this.one<any>('routing', 'default') ?? {};
    const merged = { ...previous, ...routing };
    this.put('routing', 'default', merged);
    return merged;
  }

  getRouting(): any {
    return this.one<any>('routing', 'default') ?? { chat_deep: null, background_24_7: null, vision: null, memory_summarizer: null };
  }

  /** The memory engine treats `list()` as the memory table. */
  list(): any[] {
    return this.all<any>('memories');
  }

  /* -------------------------------------------------------- conversations */

  /** Async on purpose: callers commonly chain `.then()` on the saved row. */
  async saveConversation(conversation: any): Promise<any> {
    const previous = this.one<any>('conversations', conversation.id);
    const merged = { ...(previous ?? {}), ...conversation };
    this.put('conversations', conversation.id, merged, Date.parse(merged.createdAt ?? new Date().toISOString()) || 0);
    return merged;
  }

  listConversations(): any[] {
    return sortBy(this.all<any>('conversations'), (row) => Date.parse(row.updatedAt ?? row.createdAt ?? '') || 0).reverse();
  }

  deleteConversation(id: string): void {
    this.remove('conversations', id);
    for (const row of this.all<any>('messages')) {
      if (row.conversationId === id) this.remove('messages', row.id);
    }
  }

  saveMessage(message: any): any {
    const previous = this.one<any>('messages', message.id);
    const merged = { ...(previous ?? {}), ...message };
    this.put('messages', message.id, merged, Number(merged.seq ?? 0));
    return merged;
  }

  updateMessage(message: any): any {
    return this.saveMessage(message);
  }

  listMessages(conversationId: string, limit?: number): any[] {
    const rows = this.all<any>('messages').filter((row) => row.conversationId === conversationId);
    const sorted = sortBy(rows, (row) => Number(row.seq ?? 0));
    return typeof limit === 'number' ? sorted.slice(-limit) : sorted;
  }

  deleteMessage(conversationId: string, id: string): void {
    const row = this.one<any>('messages', id);
    if (row && row.conversationId === conversationId) this.remove('messages', id);
  }

  deleteMessagesAfter(conversationId: string, seq: number): void {
    for (const row of this.all<any>('messages')) {
      if (row.conversationId === conversationId && Number(row.seq ?? 0) > seq) this.remove('messages', row.id);
    }
  }

  nextMessageSeq(conversationId: string): number {
    const rows = this.listMessages(conversationId);
    let max = 0;
    for (const row of rows) max = Math.max(max, Number(row.seq ?? 0));
    return max + 1;
  }

  /* -------------------------------------------------------------- memories */

  saveMemory(memory: any): any {
    const previous = this.one<any>('memories', memory.id);
    const now = new Date().toISOString();
    const merged = {
      source: 'chat',
      importance: 1,
      ...(previous ?? {}),
      ...memory,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.put('memories', memory.id, merged, Date.parse(merged.createdAt) || 0);
    return merged;
  }

  /** Insert once per (category, content) pair — the dedupe layer of Aya memory. */
  remember(entry: { id?: string; category: string; content: string; source?: string; importance?: number }): any {
    const existing = this.all<any>('memories').find(
      (row) => row.category === entry.category && row.content === entry.content,
    );
    if (existing) return existing;
    const id = entry.id ?? `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return this.saveMemory({ ...entry, id });
  }

  listMemories(): any[] {
    return sortBy(this.all<any>('memories'), (row) => Date.parse(row.createdAt ?? '') || 0);
  }

  search(query: string): any[] {
    const needle = String(query ?? '').toLowerCase();
    if (!needle) return [];
    return this.all<any>('memories').filter((row) => String(row.content ?? '').toLowerCase().includes(needle));
  }

  deleteMemory(id: string): void {
    this.remove('memories', id);
  }

  /* ----------------------------------------------------------------- inbox */

  saveInboxItem(item: any): any {
    const previous = this.one<any>('inbox', item.id);
    const now = new Date().toISOString();
    const merged = {
      status: 'unread',
      actions: [],
      ...(previous ?? {}),
      ...item,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.put('inbox', item.id, merged, Date.parse(merged.createdAt) || 0);
    return merged;
  }

  listInbox(status?: string): any[] {
    const rows = sortBy(this.all<any>('inbox'), (row) => Date.parse(row.createdAt ?? '') || 0).reverse();
    return status ? rows.filter((row) => row.status === status) : rows;
  }

  deleteInboxItem(id: string): void {
    this.remove('inbox', id);
  }

  /* --------------------------------------------------------------- journal */

  saveJournal(entry: any): any {
    this.put('journal', entry.id, entry, Date.parse(entry.createdAt ?? '') || 0);
    return entry;
  }

  listJournal(): any[] {
    return this.all<any>('journal');
  }

  deleteJournal(id: string): void {
    this.remove('journal', id);
  }

  /* -------------------------------------------------------------- channels */

  saveChannel(channel: any): any {
    this.put('channels', channel.id, channel);
    return channel;
  }

  listChannels(): any[] {
    return this.all<any>('channels');
  }

  /* -------------------------------------------------------------- settings */

  saveSettings(settings: any): any {
    const previous = this.one<any>('settings', 'aya') ?? {};
    const merged = { ...previous, ...settings, updatedAt: new Date().toISOString() };
    this.put('settings', 'aya', merged);
    return merged;
  }

  getSettings(): any {
    return this.one<any>('settings', 'aya') ?? null;
  }

  /** Alias used by the brain/settings screens. */
  listSettings(): any {
    return this.getSettings() ?? {};
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}
