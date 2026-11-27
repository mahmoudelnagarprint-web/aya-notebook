import type { AyaMemory } from '@ayatodoist/shared-types';

/**
 * Four-layer memory: durable facts (dedupe on category + content), keyword
 * search, conversation transcripts and a rolling summary persisted on the
 * conversation row so a later turn — or a restart — keeps the context.
 */
export class AyaMemoryEngine {
  constructor(private readonly store: any) {}

  async remember(entry: { category: string; content: string; source?: string; importance?: number }): Promise<AyaMemory> {
    const content = String(entry.content ?? '').trim();
    const category = (entry.category || 'ideas') as AyaMemory['category'];
    const existing = (this.store.list() as AyaMemory[]).find(
      (memory) => memory.category === category && memory.content === content,
    );
    if (existing) return existing;
    return this.store.remember({ ...entry, category, content, source: entry.source ?? 'chat', importance: entry.importance ?? 1 });
  }

  async search(query: string): Promise<AyaMemory[]> {
    return this.store.search(query);
  }

  async list(): Promise<AyaMemory[]> {
    return this.store.listMemories();
  }

  async summarize(): Promise<string> {
    const entries = (this.store.listMemories() as AyaMemory[]).slice(-40);
    if (entries.length === 0) return '';
    return entries.map((entry) => `[${entry.category}] ${entry.content}`).join('\n');
  }

  async rollingSummary(conversationId: string, limit = 6): Promise<string> {
    const messages = this.store.listMessages(conversationId) as any[];
    const recent = messages.slice(-limit * 2);
    const user = recent.filter((message) => message.role === 'user').map((message) => message.content);
    const assistant = recent.filter((message) => message.role === 'assistant').map((message) => message.content);
    const summary = [
      `المستخدم: ${user.join(' | ')}`,
      `آية: ${assistant.join(' | ')}`,
    ].join('\n').slice(0, 1200);

    const conversation = (this.store.listConversations() as any[]).find((entry) => entry.id === conversationId);
    if (conversation) {
      this.store.saveConversation({ ...conversation, summary, updatedAt: new Date().toISOString() });
    }
    return summary;
  }
}

export function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function memoryTotal(memories: AyaMemory[]): number {
  return memories.length;
}

export function memoryToken(memory: AyaMemory): string {
  return memory.content;
}
