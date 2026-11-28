/**
 * Shared contract for the Aya persistence adapters.
 *
 * Three implementations satisfy it:
 *  - `SqliteAyaStore`    — local-first SQLite file (default when Supabase is unset)
 *  - `MemoryAyaStore`    — pure in-memory store for serverless/edge bootstraps
 *  - `SupabaseAyaStore`  — Postgres-backed store used when SUPABASE_URL is set
 *
 * Every method is synchronous so the kernel, the brain and the memory engine can
 * read plain arrays. `await` on a plain value still works, so the same adapter
 * also satisfies the async persistence shapes the Aya engine expects.
 */

export type AyaCollection =
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

export interface AyaRow {
  collection: AyaCollection;
  id: string;
  seq: number;
  data: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AyaMemoryEntry {
  id?: string;
  category: string;
  content: string;
  source?: string;
  importance?: number;
}

export interface AyaStore {
  /* providers */
  saveProvider(provider: any): any;
  listProviders(): any[];
  deleteProvider(id: string): void;

  /* models */
  saveModel(model: any): any;
  listModels(providerId?: string): any[];
  deleteModel(id: string): void;

  /* routing + memories alias */
  saveRouting(routing: any): any;
  getRouting(): any;
  list(): any[];

  /* conversations + messages */
  saveConversation(conversation: any): Promise<any> | any;
  listConversations(): any[];
  deleteConversation(id: string): void;
  saveMessage(message: any): any;
  updateMessage(message: any): any;
  listMessages(conversationId: string, limit?: number): any[];
  deleteMessage(conversationId: string, id: string): void;
  deleteMessagesAfter(conversationId: string, seq: number): void;
  nextMessageSeq(conversationId: string): number;

  /* memories */
  saveMemory(memory: any): any;
  remember(entry: AyaMemoryEntry): any;
  listMemories(): any[];
  search(query: string): any[];
  deleteMemory(id: string): void;

  /* proactive inbox */
  saveInboxItem(item: any): any;
  listInbox(status?: string): any[];
  deleteInboxItem(id: string): void;

  /* learning journal */
  saveJournal(entry: any): any;
  listJournal(): any[];
  deleteJournal(id: string): void;

  /* channels */
  saveChannel(channel: any): any;
  listChannels(): any[];

  /* settings */
  saveSettings(settings: any): any;
  getSettings(): any;
  listSettings(): any;

  /* lifecycle */
  close(): void;
  ready?(): Promise<void>;
  flush?(): Promise<void>;
}
