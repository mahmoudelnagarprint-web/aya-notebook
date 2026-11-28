import type { AyaCollection, AyaMemoryEntry, AyaRow, AyaStore } from './aya-store-types';

/**
 * All Aya business logic lives here, on top of four storage primitives. Each
 * adapter (SQLite, memory, Supabase) only implements row reads/writes, so the
 * merge/sort/derive rules can never drift between backends.
 */

export function sortBy<T>(rows: T[], key: (row: T) => number | string): T[] {
  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (typeof left === 'number' && typeof right === 'number') return left - right;
    return String(left).localeCompare(String(right));
  });
}

export abstract class BaseAyaStore implements AyaStore {
  /* ----------------------------------------------------------- primitives */

  protected abstract readRows(collection: AyaCollection): AyaRow[];
  protected abstract readRow(collection: AyaCollection, id: string): AyaRow | null;
  protected abstract writeRow(collection: AyaCollection, row: AyaRow): void;
  protected abstract removeRow(collection: AyaCollection, id: string): void;

  protected all<T>(collection: AyaCollection): T[] {
    return this.readRows(collection).map((row) => row.data as T);
  }

  protected one<T>(collection: AyaCollection, id: string): T | null {
    const row = this.readRow(collection, id);
    return row ? (row.data as T) : null;
  }

  protected put(collection: AyaCollection, id: string, value: unknown, seq = 0): void {
    const now = new Date().toISOString();
    const existing = this.readRow(collection, id);
    this.writeRow(collection, {
      collection,
      id,
      seq,
      data: value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  protected remove(collection: AyaCollection, id: string): void {
    this.removeRow(collection, id);
  }

  protected findConversationWithMessage(messageId: string): string | null {
    for (const conversation of this.listConversations() as any[]) {
      const found = (this.listMessages(conversation.id) as any[]).some((message) => message.id === messageId);
      if (found) return String(conversation.id);
    }
    return null;
  }

  close(): void {
    /* adapters that hold a handle override this */
  }

  async ready(): Promise<void> {
    /* adapters that hydrate asynchronously override this */
  }

  async flush(): Promise<void> {
    /* adapters with write-behind queues override this */
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
  remember(entry: AyaMemoryEntry): any {
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
}
