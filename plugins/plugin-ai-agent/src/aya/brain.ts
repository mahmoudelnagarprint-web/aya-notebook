import { AyaModelRouter, sanitizeToolHistory } from './router';
import { buildAyaSystemPrompt } from './persona';
import type { AyaMessage } from '@ayatodoist/shared-types';
import { DEFAULT_AYA_SETTINGS } from '@ayatodoist/shared-types';

/**
 * The Aya turn machine.
 *
 * one user message → routed model → zero or more kernel tool calls (all under a
 * single batch id) → narration → persisted conversation rows. If narration is
 * rejected by the provider (the classic Gemini `thought_signature` 400) it is
 * retried once with a clean plain-text transcript, and only then does the
 * deterministic Egyptian-Arabic confirmation take over.
 */

const CORE_TOOL_NAMES = [
  'task.create',
  'task.update',
  'task.complete',
  'task.delete',
  'task.move',
  'task.reschedule',
  'checklist.setItems',
  'aya.remember',
  'aya.searchWorkspace',
  'project.list',
  'label.list',
  'task.counts',
];

const SPECIALISED: Array<{ pattern: RegExp; tools: string[] }> = [
  { pattern: /تقرير|إحصائ|إحصاء|report|stats|summary of the week/i, tools: ['report.stats'] },
  { pattern: /فلتر|فلاتر|filter/i, tools: ['filter.create'] },
  { pattern: /تخطيط|عرض|layout|view|theme|ثيم|مظهر/i, tools: ['view.setLayout', 'core.settings.update'] },
  { pattern: /إضافة|إضافات|plugin|addon/i, tools: ['core.plugins.setEnabled', 'core.plugins.list'] },
  { pattern: /مهمة فرعية|subtask/i, tools: ['subtask.create'] },
  { pattern: /تعليق|كومنت|comment/i, tools: ['comment.create'] },
  { pattern: /صورة|صور|attachment|image/i, tools: ['attachment.list'] },
];

/** Compact tool selection: a small always-on core plus keyword-activated tools. */
export function selectAyaToolSpecs(catalogue: any[], query: string, history?: any[]): any[] {
  const lower = String(query ?? '').toLowerCase();
  const wanted = new Set<string>(CORE_TOOL_NAMES);
  for (const entry of SPECIALISED) {
    if (entry.pattern.test(lower)) for (const tool of entry.tools) wanted.add(tool);
  }
  for (const message of history ?? []) {
    for (const call of message?.toolCalls ?? []) {
      if (call?.name) wanted.add(String(call.name));
    }
  }

  return catalogue
    .filter((tool) => wanted.has(tool.originalName ?? tool.name))
    .map((tool) => ({
      ...tool,
      description: String(tool.description ?? '').slice(0, 160),
    }));
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class AyaBrain {
  private readonly kernel: any;
  private readonly adapter: any;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: { kernel: any; adapter: any; fetchImpl?: typeof fetch }) {
    this.kernel = opts.kernel;
    this.adapter = opts.adapter;
    this.fetchImpl = opts.fetchImpl;
  }

  async settings(): Promise<any> {
    return this.adapter.getSettings?.() ?? this.adapter.listSettings?.() ?? { ...DEFAULT_AYA_SETTINGS };
  }

  private routing(): any {
    return (
      this.adapter.getRouting?.() ?? { chat_deep: null, background_24_7: null, vision: null, memory_summarizer: null }
    );
  }

  private async conversation(conversationId: string | undefined, text: string): Promise<any> {
    const existing = conversationId
      ? (this.adapter.listConversations() as any[]).find((row) => row.id === conversationId)
      : null;
    if (existing) return existing;
    const at = nowIso();
    return await this.adapter.saveConversation({
      id: conversationId ?? newId('conv'),
      title: text.slice(0, 60) || 'محادثة جديدة',
      channel: 'web',
      summary: '',
      createdAt: at,
      updatedAt: at,
    });
  }

  private async chat(opts: {
    routing: any;
    messages: any[];
    system: string;
    tools?: any[];
    preferred?: string;
    role?: string;
  }): Promise<any> {
    const models = this.adapter.listModels() as any[];
    const providers = this.adapter.listProviders() as any[];
    const router = new AyaModelRouter({ models, providers, fetchImpl: this.fetchImpl });
    return router.chat({
      role: opts.role ?? 'chat_deep',
      routing: opts.routing,
      models,
      providers,
      messages: opts.messages,
      system: opts.system,
      tools: opts.tools,
      preferred: opts.preferred,
    });
  }

  async handleMessage(opts: {
    text: string;
    language?: string;
    conversationId?: string;
    modelId?: string;
    tools?: any[];
    onEvent?: (event: any) => void;
    userMessageId?: string;
  }): Promise<any> {
    const { text, language = 'ar', modelId, tools, onEvent, userMessageId } = opts;
    const settings = await this.settings();
    const conversation = await this.conversation(opts.conversationId, text);
    const conversationId = conversation.id as string;

    const priorMessages = (this.adapter.listMessages(conversationId) as AyaMessage[]).filter(
      (message) => message.id !== userMessageId,
    );

    const userMessage: AyaMessage =
      userMessageId
        ? {
            ...((this.adapter.listMessages(conversationId) as AyaMessage[]).find((message) => message.id === userMessageId) as AyaMessage),
            content: text,
          }
        : {
            id: newId('msg'),
            conversationId,
            role: 'user',
            content: text,
            attachments: [],
            toolCalls: [],
            model: null,
            failover: false,
            batchId: null,
            seq: this.adapter.nextMessageSeq(conversationId) as number,
            createdAt: nowIso(),
          };
    const savedUser = this.adapter.saveMessage(userMessage) ?? userMessage;

    const llmHistory = buildHistoryMessages(priorMessages);
    const baseMessages = [...llmHistory, { role: 'user', content: text }];

    const catalogue = this.kernel.toolCatalogue() as any[];
    const selectedTools = tools ?? selectAyaToolSpecs(catalogue, text, priorMessages);
    const routing = this.routing();
    const system = buildAyaSystemPrompt({
      kernel: this.kernel,
      settings,
      language,
      memories: this.adapter.listMemories() as any[],
      summary: conversation.summary ?? '',
      toolCount: catalogue.length,
      pendingInbox: (this.adapter.listInbox?.('unread') ?? []).length,
    });

    const first = await this.chat({ routing, messages: baseMessages, system, tools: selectedTools, preferred: modelId });

    let batchId: string | null = null;
    let assistantText = first.text;
    let failover = Boolean(first.failover);
    let model = first.model;
    let modelRowId = first.modelRowId;
    const toolCalls: any[] = first.toolCalls ?? [];
    const executed: Array<{ name: string; ok: boolean; result?: unknown; error?: string }> = [];

    if (toolCalls.length) {
      batchId = newId('batch');
      const toolRows: any[] = [];
      for (const call of toolCalls) {
        onEvent?.({ type: 'tool_start', name: call.name, toolCallId: call.id, batchId });
        try {
          const result = await this.kernel.execute(call.name, call.args ?? {}, { actor: 'ai', batchId });
          executed.push({ name: call.name, ok: true, result });
          toolRows.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: JSON.stringify(result) });
          onEvent?.({ type: 'tool_result', toolCallId: call.id, name: call.name, ok: true, batchId });
        } catch (error) {
          const message = (error as Error).message;
          executed.push({ name: call.name, ok: false, error: message });
          toolRows.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: `Error: ${message}` });
          onEvent?.({ type: 'tool_result', toolCallId: call.id, name: call.name, ok: false, error: message, batchId });
        }
      }

      const liveHistory = sanitizeToolHistory([
        ...baseMessages,
        { role: 'assistant', content: first.text, toolCalls },
        ...toolRows,
      ]);

      try {
        const narrated = await this.chat({ routing, messages: liveHistory, system, tools: selectedTools, preferred: modelId });
        assistantText = narrated.text;
        failover = failover || Boolean(narrated.failover);
        model = narrated.model ?? model;
        modelRowId = narrated.modelRowId ?? modelRowId;
      } catch {
        // Second attempt: a clean, tool-free transcript. This is what survives
        // providers that reject raw tool_calls history.
        const plain = [
          { role: 'user', content: text },
          {
            role: 'assistant',
            content: `(تم تنفيذ الأدوات: ${executed.map((entry) => entry.name).join('، ')})`,
          },
          { role: 'user', content: 'اكتبي تأكيدًا عربيًا قصيرًا لما تم تنفيذه فقط.' },
        ];
        try {
          const narrated = await this.chat({ routing, messages: plain, system, preferred: modelId });
          assistantText = narrated.text;
          failover = failover || Boolean(narrated.failover);
        } catch {
          const lines = executed.map(
            (entry) => `- ${entry.name}${entry.ok ? ' ✅' : ` ❌ (${entry.error ?? 'فشل'})`}`,
          );
          assistantText = `تم تنفيذ الإجراءات بنجاح:\n${lines.join('\n')}`;
        }
      }
    }

    if (!assistantText) assistantText = 'تم.';

    onEvent?.({ type: 'delta', content: assistantText });

    const assistantMessage: AyaMessage = {
      id: newId('msg'),
      conversationId,
      role: 'assistant',
      content: assistantText,
      attachments: [],
      toolCalls: toolCalls.map((call) => ({ name: call.name, input: call.args ?? {} })),
      model: model ?? null,
      failover,
      batchId,
      seq: this.adapter.nextMessageSeq(conversationId) as number,
      createdAt: nowIso(),
    };
    const savedAssistant = this.adapter.saveMessage(assistantMessage) ?? assistantMessage;
    this.adapter.saveConversation({ ...conversation, updatedAt: nowIso() });
    onEvent?.({ type: 'done' });

    return {
      conversationId,
      text: assistantText,
      model: model ?? null,
      modelRowId,
      failover,
      messages: [savedUser, savedAssistant],
      toolCalls,
      batchId,
      pending: [],
    };
  }

  async editMessage(opts: { conversationId: string; messageId: string; text: string; language?: string }): Promise<any> {
    const messages = this.adapter.listMessages(opts.conversationId) as AyaMessage[];
    const target = messages.find((message) => message.id === opts.messageId);
    if (!target) throw new Error(`Message not found: ${opts.messageId}`);

    this.adapter.saveMessage({ ...target, content: opts.text });
    this.adapter.deleteMessagesAfter(opts.conversationId, Number(target.seq ?? 0));

    await this.handleMessage({
      text: opts.text,
      language: opts.language ?? 'ar',
      conversationId: opts.conversationId,
      userMessageId: target.id,
    });

    return { conversationMessages: this.adapter.listMessages(opts.conversationId) };
  }

  async undoBatch(batchId: string): Promise<{ undone: number }> {
    let undone = 0;
    const activities = (this.kernel.store.list('activity') as any[]).filter((entry) => entry.batchId === batchId);
    for (const activity of activities) {
      if (this.kernel.bus.undoActivity(activity.id)) undone += 1;
    }
    return { undone };
  }
}

/** Hydrates stored turns as clean plain text — no raw tool_calls ever reach a provider. */
export function buildHistoryMessages(history: AyaMessage[]): any[] {
  const result: any[] = [];
  for (const message of history) {
    if ((message.role as string) === 'tool') continue;
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const names = message.toolCalls.map((call) => call.name).join('، ');
      const note = `[الأدوات المنفذة سابقاً: ${names}]`;
      result.push({
        role: 'assistant',
        content: message.content ? `${message.content}\n\n${note}` : note,
      });
      continue;
    }
    result.push({ role: message.role, content: message.content });
  }
  return result;
}

export function brainKind(_kind: any): void {}
export function brainTracingStore(): void {}
