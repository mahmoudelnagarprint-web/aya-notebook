import { AyaModelRouter } from './router';
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

const BARE_ACK = /^(?:تم|حاضر|تمام|أوكي|اوكي|done|ok)\s*[.!]?$/i;

/** True for the empty confirmations that made Aya look like a dumb bot. */
export function isBareAck(text: string): boolean {
  return BARE_ACK.test(String(text ?? '').replace(/[\u200f\u200e\s]+/g, ' ').trim());
}

interface ExecutedTool {
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

function itemTitle(item: any): string | null {
  if (item === null || typeof item !== 'object') return typeof item === 'string' ? item : null;
  for (const key of ['content', 'title', 'name', 'text', 'label']) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Human-readable one-liner for a tool result, used when narration is unavailable. */
export function describeToolResult(result: unknown): string {
  if (result === null || result === undefined) return 'بدون نتيجة';
  if (typeof result === 'string') return result.replace(/\s+/g, ' ').trim().slice(0, 400) || 'بدون نتيجة';
  if (typeof result === 'number' || typeof result === 'boolean') return String(result);
  if (Array.isArray(result)) {
    if (!result.length) return 'مفيش نتائج';
    const titles = result.slice(0, 6).map(itemTitle).filter((value): value is string => Boolean(value));
    return `${result.length} عنصر${titles.length ? `: ${titles.join(' · ')}` : ''}`;
  }
  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;
    for (const key of ['tasks', 'items', 'results', 'data', 'models', 'projects', 'memories']) {
      const value = record[key];
      if (Array.isArray(value)) return `${value.length} في ${key} — ${describeToolResult(value)}`;
    }
    return JSON.stringify(result).slice(0, 400);
  }
  return String(result);
}

/** Deterministic, readable summary of everything the tools returned. */
export function fallbackNarration(executed: ExecutedTool[]): string {
  if (!executed.length) return 'محتاجة توضيح أكتر عشان أقدر أساعدك صح.';
  const lines = executed.map((entry) =>
    entry.ok
      ? `- ${entry.name}: ${describeToolResult(entry.result)}`
      : `- ${entry.name}: فشل — ${entry.error ?? 'خطأ غير معروف'}`,
  );
  const failed = executed.some((entry) => !entry.ok);
  return `${failed ? 'في خطوة محصلتش:' : 'اللي نفذته:'}\n${lines.join('\n')}`;
}

/** The exact JSON payload of this turn's tool results, given to the narrator. */
export function toolResultsNotice(executed: ExecutedTool[]): string {
  const payload = executed.map((entry) => ({
    tool: entry.name,
    ok: entry.ok,
    ...(entry.ok ? { result: entry.result } : { error: entry.error ?? 'فشل' }),
  }));
  return `نتائج الأدوات المنفذة الآن (JSON):\n${JSON.stringify(payload, null, 2)}`;
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
    const executed: ExecutedTool[] = [];

    if (toolCalls.length) {
      batchId = newId('batch');
      for (const call of toolCalls) {
        onEvent?.({ type: 'tool_start', name: call.name, toolCallId: call.id, batchId });
        try {
          const result = await this.kernel.execute(call.name, call.args ?? {}, { actor: 'ai', batchId });
          executed.push({ name: call.name, ok: true, result });
          onEvent?.({ type: 'tool_result', toolCallId: call.id, name: call.name, ok: true, batchId });
        } catch (error) {
          const message = (error as Error).message;
          executed.push({ name: call.name, ok: false, error: message });
          onEvent?.({ type: 'tool_result', toolCallId: call.id, name: call.name, ok: false, error: message, batchId });
        }
      }

      // Always narrate through a clean, tool-free completion: the executed
      // results are handed back as data, so the model reads them instead of
      // echoing a bare confirmation.
      const narrationMessages = [
        ...baseMessages,
        {
          role: 'user',
          content: [
            toolResultsNotice(executed),
            '',
            'اقرئي النتائج دي كويس وردّي على آخر طلب للمستخدم من واقعها: لو سأل «فين؟» أو «إيه اللي تم؟» اشرحي المحتوى الفعلي (أسماء المهام، العدد، الحالة)، وممنوع تردّي بـ«تم.» لوحدها.',
          ].join('\n'),
        },
      ];

      try {
        const narrated = await this.chat({ routing, messages: narrationMessages, system, preferred: modelId });
        const narratedText = String(narrated.text ?? '').trim();
        if (narratedText && !isBareAck(narratedText)) {
          assistantText = narratedText;
        } else {
          assistantText = fallbackNarration(executed);
        }
        failover = failover || Boolean(narrated.failover);
        model = narrated.model ?? model;
        modelRowId = narrated.modelRowId ?? modelRowId;
      } catch {
        assistantText = fallbackNarration(executed);
      }
    }

    if (!assistantText || isBareAck(assistantText)) assistantText = fallbackNarration(executed);

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
