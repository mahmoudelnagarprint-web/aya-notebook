import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Kernel, MemoryStore } from '@ayatodoist/core-kernel';
import { tasksCorePlugin } from '@ayatodoist/plugin-tasks-core';
import { SqliteAyaStore } from '@ayatodoist/database';
import {
  AYA_ROLES,
  DEFAULT_AYA_SETTINGS,
  type AyaConversation,
  type AyaMessage,
  type AyaModel,
  type AyaProvider,
  type AyaRouting,
} from '@ayatodoist/shared-types';
import { authHeaders, cleanApiKey, fetchProviderModels, normalizeBaseUrl, redactSecret } from '../plugins/plugin-ai-agent/src/aya/providers';
import { AyaModelRouter, sanitizeToolHistory } from '../plugins/plugin-ai-agent/src/aya/router';
import { suggestRouting } from '../plugins/plugin-ai-agent/src/aya/routing';
import { AyaMemoryEngine } from '../plugins/plugin-ai-agent/src/aya/memory';
import { AyaProactiveEngine, executeInboxActions } from '../plugins/plugin-ai-agent/src/aya/proactive';
import { AyaBrain, buildHistoryMessages, selectAyaToolSpecs } from '../plugins/plugin-ai-agent/src/aya/brain';
import { createServerApp } from '../apps/server/src/app';
import { hydrateKernelFromSnapshot } from '../apps/web/src/app/server-sync';
import { buildAyaSystemPrompt } from '../plugins/plugin-ai-agent/src/aya/persona';
import { TelegramBridge } from '../apps/server/src/aya-channels/telegram';
import { AyaService } from '../apps/server/src/aya-service';

const originalFetch = globalThis.fetch;

let dbPath = '';
let store: SqliteAyaStore;
let kernel: Kernel;

function now(): string {
  return new Date().toISOString();
}

beforeEach(() => {
  dbPath = join(tmpdir(), `aya-v2-${crypto.randomUUID()}.db`);
  store = new SqliteAyaStore(dbPath);
  kernel = new Kernel({ store: new MemoryStore() });
  kernel.installAll([tasksCorePlugin] as never);
  kernel.start();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  try {
    store.close();
  } catch {
    /* closed */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function provider(id: string, baseUrl: string, name = id): AyaProvider {
  const at = now();
  return { id, name, baseUrl, apiKey: 'sk-test', enabled: true, createdAt: at, updatedAt: at };
}

function model(overrides: Partial<AyaModel> & Pick<AyaModel, 'id' | 'providerId' | 'modelId'>): AyaModel {
  return {
    label: overrides.modelId,
    contextWindow: 32_000,
    vision: false,
    priority: 1,
    failover: true,
    enabled: true,
    status: 'unknown',
    latencyMs: null,
    lastTestedAt: null,
    createdAt: now(),
    ...overrides,
  } as AyaModel;
}

function message(conversationId: string, seq: number, role: AyaMessage['role'], content: string): AyaMessage {
  return {
    id: `msg_${conversationId}_${seq}`,
    conversationId,
    role,
    content,
    attachments: [],
    toolCalls: [],
    model: null,
    failover: false,
    batchId: null,
    seq,
    createdAt: now(),
  };
}

describe('Aya v2 — universal /v1 providers', () => {
  test('normalises base URLs and calls GET /models with a bearer key', async () => {
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1');
    expect(normalizeBaseUrl('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1');

    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      return jsonResponse({
        data: [{ id: 'gpt-4o-mini', context_length: 128000 }, { id: 'llava-1.6-vision' }],
      });
    }) as unknown as typeof fetch;

    const result = await fetchProviderModels({ baseUrl: 'https://api.mock.dev/v1/', apiKey: 'sk-test', fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.mock.dev/v1/models');
    expect(calls[0]!.auth).toBe('Bearer sk-test');
    expect(result.models.map((entry) => entry.modelId)).toEqual(['gpt-4o-mini', 'llava-1.6-vision']);
    expect(result.models[0]!.contextWindow).toBe(128000);
    expect(result.models[1]!.vision).toBe(true);
  });

  test('provider CRUD persists, replaces and cascades to models', async () => {
    const created = provider('prv_1', 'https://api.mock.dev/v1', 'Mock');
    await store.saveProvider(created);
    let providers = await store.listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe('Mock');

    await store.saveProvider({ ...created, name: 'Mock Renamed', updatedAt: now() });
    providers = await store.listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe('Mock Renamed');

    const first = model({ id: 'mdl_1', providerId: 'prv_1', modelId: 'mock-large', priority: 1 });
    const second = model({ id: 'mdl_2', providerId: 'prv_1', modelId: 'mock-small', priority: 2, failover: false });
    await store.saveModel(first);
    await store.saveModel(second);
    expect((await store.listModels('prv_1')).map((entry) => entry.id)).toEqual(['mdl_1', 'mdl_2']);

    await store.saveModel({ ...second, failover: true });
    expect((await store.listModels('prv_1')).find((entry) => entry.id === 'mdl_2')!.failover).toBe(true);

    await store.deleteProvider('prv_1');
    expect(await store.listProviders()).toHaveLength(0);
    expect(await store.listModels()).toHaveLength(0);
  });
});

describe('Aya v2 — provider key hygiene', () => {
  test('normalises Bearer prefixes, quotes, whitespace and zero-width characters', () => {
    expect(cleanApiKey('  Bearer  sk-live-123 \n')).toBe('sk-live-123');
    expect(cleanApiKey('"bearer sk-live-123"')).toBe('sk-live-123');
    expect(cleanApiKey('Bearer Bearer sk-live-123')).toBe('sk-live-123');
    expect(cleanApiKey('\u200b sk-live-123\u200b')).toBe('sk-live-123');
    expect(cleanApiKey('')).toBe('');
    expect(authHeaders(' "Bearer sk-live-123" ')).toEqual({ authorization: 'Bearer sk-live-123' });
    expect(authHeaders('')).toEqual({});
    expect(redactSecret('rejected sk-live-123', 'Bearer sk-live-123')).not.toContain('sk-live-123');
  });

  test('editing a provider with an empty or masked key preserves the stored key', async () => {
    const service = new AyaService({ kernel, adapter: store });
    const created = await service.addProvider({
      name: 'Dahl',
      baseUrl: 'https://inference.dahl.global/v1',
      apiKey: '  "Bearer dah_test_key_123"  ',
    });
    expect((await store.listProviders()).find((entry) => entry.id === created.id)!.apiKey).toBe('dah_test_key_123');

    await service.updateProvider(created.id, { name: 'Dahl renamed', apiKey: '' });
    await service.updateProvider(created.id, { apiKey: '   ' });
    await service.updateProvider(created.id, { apiKey: '••••••••' });
    expect((await store.listProviders())[0]!.apiKey).toBe('dah_test_key_123');

    await service.updateProvider(created.id, { apiKey: 'Bearer dah_new_key_456' });
    expect((await store.listProviders())[0]!.apiKey).toBe('dah_new_key_456');
  });

  test('a failed probe stores the provider diagnostic without the key', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: { code: 'invalid_api_key', message: 'invalid API token', type: 'authentication_error' } }, 401)) as unknown as typeof fetch;
    const service = new AyaService({ kernel, adapter: store, fetchImpl });
    const created = await service.addProvider({
      name: 'Dahl',
      baseUrl: 'https://inference.dahl.global/v1',
      apiKey: 'klay_wrong_key_999',
    });
    const added = await service.addManualModel(created.id, { modelId: 'deepseek-ai/DeepSeek-V4-Flash-0731' });
    const tested = await service.testModel(added.id);
    expect(tested.status).toBe('failed');
    expect(tested.lastError).toContain('401');
    expect(tested.lastError).toContain('invalid_api_key');
    expect(tested.lastError).not.toContain('klay_wrong_key_999');
    expect((await store.listModels())[0]!.lastError).toBe(tested.lastError);
  });
});

describe('Aya v2 — AyaModelRouter automatic failover', () => {
  test('429 on the primary transparently fails over to the next checked model', async () => {
    const providers = [provider('prv_primary', 'https://primary.mock/v1', 'Primary'), provider('prv_secondary', 'https://secondary.mock/v1', 'Secondary')];
    const models = [
      model({ id: 'm1', providerId: 'prv_primary', modelId: 'primary-model', priority: 1, failover: true }),
      model({ id: 'm2', providerId: 'prv_secondary', modelId: 'secondary-model', priority: 2, failover: true }),
      model({ id: 'm3', providerId: 'prv_secondary', modelId: 'unchecked-model', priority: 3, failover: false }),
    ];
    const routing: AyaRouting = { chat_deep: 'm1', background_24_7: null, vision: null, memory_summarizer: null };
    const called: string[] = [];

    globalThis.fetch = (async (url: string) => {
      called.push(String(url));
      if (String(url).includes('primary.mock')) return new Response('rate limited', { status: 429 });
      return jsonResponse({ choices: [{ message: { content: 'رد من النموذج البديل' } }] });
    }) as unknown as typeof fetch;

    const router = new AyaModelRouter({ models, providers });
    const result = await router.chat({
      role: 'chat_deep',
      routing,
      models,
      providers,
      messages: [{ role: 'user', content: 'اعملي ملخص' }],
      system: 'أنتِ آية',
    });

    expect(result.text).toBe('رد من النموذج البديل');
    expect(result.model).toBe('Secondary/secondary-model');
    expect(result.modelRowId).toBe('m2');
    expect(result.failover).toBe(true);
    expect(called).toHaveLength(2);
    expect(called.some((url) => url.includes('unchecked'))).toBe(false);
    expect(result.attempts[0]).toMatchObject({ modelRowId: 'm1', ok: false, status: 429 });
    expect(result.attempts[1]).toMatchObject({ modelRowId: 'm2', ok: true, failover: true });
  });

  test('quota exhaustion also moves down the checked pool, and a non-retryable 401 stops', async () => {
    const providers = [provider('p1', 'https://a.mock/v1', 'A'), provider('p2', 'https://b.mock/v1', 'B')];
    const models = [
      model({ id: 'a1', providerId: 'p1', modelId: 'quota-model', priority: 1 }),
      model({ id: 'b1', providerId: 'p2', modelId: 'working-model', priority: 2 }),
    ];
    const routing: AyaRouting = { chat_deep: 'a1', background_24_7: null, vision: null, memory_summarizer: null };

    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('a.mock')) return new Response('insufficient credits / quota exhausted', { status: 402 });
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }) as unknown as typeof fetch;

    const router = new AyaModelRouter({ models, providers });
    const result = await router.chat({ role: 'chat_deep', routing, models, providers, messages: [], system: 's' });
    expect(result.modelRowId).toBe('b1');
    expect(result.failover).toBe(true);

    globalThis.fetch = (async () => new Response('bad key', { status: 401 })) as unknown as typeof fetch;
    await expect(router.chat({ role: 'chat_deep', routing, models, providers, messages: [], system: 's' })).rejects.toThrow(/401/);
  });
});

describe('Aya v2 — smart routing across the four roles', () => {
  test('assigns a model to every role and prefers vision + large context', () => {
    const models = [
      model({ id: 'strong', providerId: 'p', modelId: 'claude-3-5-sonnet', contextWindow: 200_000, vision: true, priority: 1 }),
      model({ id: 'fast', providerId: 'p', modelId: 'gemini-2.0-flash', contextWindow: 1_000_000, vision: true, priority: 2 }),
      model({ id: 'tiny', providerId: 'p', modelId: 'llama-3-8b', contextWindow: 8_192, priority: 3 }),
    ];
    const suggestion = suggestRouting(models);
    for (const role of AYA_ROLES) expect(suggestion[role]).toBeTruthy();
    expect(suggestion.chat_deep).toBe('strong');
    expect(suggestion.vision).toBe('strong');
    expect(suggestion.memory_summarizer).toBe('fast');
    expect(suggestion.background_24_7).not.toBe('strong');
  });
});

describe('Aya v2 — smart routing distributes models', () => {
  test('spreads 3 Dahl models across the four roles instead of collapsing to models[0]', () => {
    const models = [
      model({ id: 'deep', providerId: 'dahal', modelId: 'deepseek-ai/DeepSeek-V4-Flash-0731', priority: 1, status: 'failed' }),
      model({ id: 'mini', providerId: 'dahal', modelId: 'MiniMaxAI/MiniMax-M2.7', priority: 2, status: 'failed' }),
      model({ id: 'glm', providerId: 'dahal', modelId: 'zai-org/GLM-5.3-Flash', priority: 3, status: 'failed' }),
    ];
    const suggestion = suggestRouting(models);
    const assigned = AYA_ROLES.map((role) => suggestion[role]);
    expect(assigned.every(Boolean)).toBe(true);
    expect(new Set(assigned).size).toBe(3);
    expect(suggestion.chat_deep).toBe('mini');
    expect(suggestion.background_24_7).not.toBe(suggestion.chat_deep);
    expect(suggestion.vision).not.toBe(suggestion.chat_deep);
  });

  test('keeps spreading when every model is already healthy and probed', () => {
    const models = [
      model({ id: 'a', providerId: 'p', modelId: 'deepseek-ai/DeepSeek-V4-Flash-0731', priority: 1, status: 'ok', latencyMs: 300 }),
      model({ id: 'b', providerId: 'p', modelId: 'MiniMaxAI/MiniMax-M2.7', priority: 2, status: 'ok', latencyMs: 320 }),
      model({ id: 'c', providerId: 'p', modelId: 'zai-org/GLM-5.3-Flash', priority: 3, status: 'ok', latencyMs: 280 }),
    ];
    const suggestion = suggestRouting(models);
    expect(new Set(AYA_ROLES.map((role) => suggestion[role])).size).toBe(3);
  });
});

describe('Aya v2 — 4-layer memory', () => {
  test('remember / dedupe / search / rolling summary survive a SQLite reload', async () => {
    const memory = new AyaMemoryEngine(store);
    const first = await memory.remember({ category: 'preferences', content: 'بيحب يشتغل الصبح بدري' });
    await memory.remember({ category: 'projects', content: 'مشروع __AYAtodoist هو الأولوية' });
    await memory.remember({ category: 'preferences', content: 'بيحب يشتغل الصبح بدري' });
    expect(await memory.list()).toHaveLength(2);

    const found = await memory.search('الصبح');
    expect(found.map((entry) => entry.id)).toContain(first.id);

    const conversation: AyaConversation = { id: 'conv_1', title: 'خطة الأسبوع', channel: 'web', summary: '', createdAt: now(), updatedAt: now() };
    await store.saveConversation(conversation);
    for (let index = 1; index <= 10; index += 1) {
      await store.saveMessage(message('conv_1', index, index % 2 === 1 ? 'user' : 'assistant', `رسالة رقم ${index} عن تنظيم المهام`));
    }
    const summary = await memory.rollingSummary('conv_1', 3);
    expect(summary.length).toBeGreaterThan(20);
    expect(summary).toContain('المستخدم');

    const workspaceHits = await (async () => {
      await kernel.execute('project.ensureInbox', {});
      await kernel.execute('task.create', { content: 'مراجعة تقرير المشروع', description: 'تفاصيل مهمة عن المشروع' });
      const { searchWorkspace } = await import('../plugins/plugin-ai-agent/src/aya/workspace');
      return searchWorkspace(kernel, 'المشروع');
    })();
    expect(workspaceHits.length).toBeGreaterThan(0);

    store.close();
    store = new SqliteAyaStore(dbPath);
    const reloadedMemories = await store.listMemories();
    expect(reloadedMemories).toHaveLength(2);
    expect(reloadedMemories.some((entry) => entry.content.includes('الصبح'))).toBe(true);
    const [reloadedConversation] = await store.listConversations();
    expect(reloadedConversation!.summary.length).toBeGreaterThan(20);
    expect(await store.listMessages('conv_1')).toHaveLength(10);
  });
});

describe('Aya v2 — chat turns, message editing and atomic batch undo', () => {
  async function seedLlm(): Promise<void> {
    await store.saveProvider(provider('p1', 'http://localhost:9999/v1', 'Local Mock'));
    await store.saveModel(
      model({ id: 'm1', providerId: 'p1', modelId: 'mock-model', contextWindow: 128_000, priority: 1 }),
    );
    await store.saveRouting({ chat_deep: 'm1', background_24_7: 'm1', vision: 'm1', memory_summarizer: 'm1' });
    await store.saveSettings({ ...DEFAULT_AYA_SETTINGS, autonomy: 'full_undo' });
  }

  test('executes tools with one batch id, then undoes every action of the turn', async () => {
    await seedLlm();
    await kernel.execute('project.ensureInbox', {});

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string }> };
      const hasToolResult = body.messages.some((entry) => entry.role === 'tool');
      if (!hasToolResult) {
        return jsonResponse({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  { id: 'call_1', function: { name: 'task__create', arguments: JSON.stringify({ content: 'مهمة من آية' }) } },
                ],
              },
            },
          ],
        });
      }
      return jsonResponse({ choices: [{ message: { content: 'اتعملت المهمة ✅' } }] });
    }) as unknown as typeof fetch;

    const brain = new AyaBrain({ kernel, adapter: store });
    const turn = await brain.handleMessage({ text: 'اعملي مهمة اسمها مهمة من آية', language: 'ar' });

    const created = kernel.store.list('tasks').find((task) => task.content === 'مهمة من آية');
    expect(created).toBeDefined();
    expect(turn.model).toBe('Local Mock/mock-model');
    expect(turn.failover).toBe(false);
    const assistant = turn.messages.find((entry) => entry.role === 'assistant')!;
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls[0]!.name).toBe('task.create');
    expect(assistant.batchId).toBeTruthy();
    expect(turn.batchId).toBe(assistant.batchId);
    const activity = kernel.store.list('activity').find((entry) => entry.batchId === assistant.batchId);
    expect(activity).toBeDefined();

    const undone = await brain.undoBatch(assistant.batchId!);
    expect(undone.undone).toBeGreaterThan(0);
    expect(kernel.store.list('tasks').some((task) => task.content === 'مهمة من آية')).toBe(false);
  });

  test('editing a user message truncates later replies and re-runs from that point', async () => {
    await seedLlm();
    globalThis.fetch = (async () =>
      jsonResponse({ choices: [{ message: { content: 'تمام، سجلت ده.' } }] })) as unknown as typeof fetch;

    const brain = new AyaBrain({ kernel, adapter: store });
    const conversation = await store.saveConversation({
      id: 'conv_edit',
      title: 'تعديل',
      channel: 'web',
      summary: '',
      createdAt: now(),
      updatedAt: now(),
    }).then(() => 'conv_edit');

    const first = await brain.handleMessage({ conversationId: conversation, text: 'الطلب الأصلي', language: 'ar' });
    const firstUser = first.messages.find((entry) => entry.role === 'user')!;
    await brain.handleMessage({ conversationId: conversation, text: 'رسالة تانية', language: 'ar' });
    expect((await store.listMessages(conversation)).length).toBe(4);

    globalThis.fetch = (async () =>
      jsonResponse({ choices: [{ message: { content: 'نفّذت النسخة المعدلة.' } }] })) as unknown as typeof fetch;

    const edited = await brain.editMessage({ conversationId: conversation, messageId: firstUser.id, text: 'الطلب المعدل' });
    const timeline = edited.conversationMessages;
    expect(timeline).toHaveLength(2);
    expect(timeline[0]!.id).toBe(firstUser.id);
    expect(timeline[0]!.content).toBe('الطلب المعدل');
    expect(timeline[1]!.role).toBe('assistant');
    expect(timeline[1]!.content).toBe('نفّذت النسخة المعدلة.');
    expect(timeline.some((entry) => entry.content === 'رسالة تانية')).toBe(false);
  });
});

describe('Aya v2 — proactive inbox + execution', () => {
  test('creates cards from overdue/procrastinated work and executes actions as one batch', async () => {
    await kernel.execute('project.ensureInbox', {});
    const created = await kernel.execute<unknown, { id: string }>('task.create', { content: 'تقرير متأخر' });
    const task = kernel.store.get('tasks', created.id)!;
    kernel.store.upsert('tasks', { ...task, dueDate: '2026-01-01', postponedCount: 3 });

    const engine = new AyaProactiveEngine(store);
    const cards = await engine.scan(kernel, new Date('2026-11-26T10:00:00Z'));
    expect(cards.length).toBeGreaterThan(0);
    const reminder = cards.find((card) => card.kind === 'reminder') ?? cards[0]!;
    expect(reminder.actions.length).toBeGreaterThan(0);

    // A second scan must not duplicate the same card.
    const again = await engine.scan(kernel, new Date('2026-11-26T11:00:00Z'));
    expect(again.some((card) => card.title === reminder.title)).toBe(false);

    const execution = await executeInboxActions(kernel, reminder, 'batch_proactive');
    expect(execution.executed.some((entry) => entry.ok)).toBe(true);
    expect(kernel.store.get('tasks', created.id)!.dueDate).toBe('2026-11-26');

    const stored = await store.listInbox();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some((entry) => entry.id === 'aya_welcome')).toBe(true);
  });
});

describe('Aya v2 — Telegram bridge pipeline', () => {
  test('routes allowed messages into the same brain and replies, blocking unknown chats', async () => {
    const inbound: Array<{ chatId: string; text: string }> = [];
    const sent: Array<{ chat_id: string; text: string }> = [];

    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/sendMessage')) {
        sent.push(JSON.parse(String(init?.body)) as { chat_id: string; text: string });
        return jsonResponse({ ok: true, result: {} });
      }
      return jsonResponse({ ok: true, result: [] });
    }) as unknown as typeof fetch;

    const bridge = new TelegramBridge({
      fetchImpl,
      onMessage: async (input) => {
        inbound.push({ chatId: input.chatId, text: input.text });
        return 'أهلاً بيك، أنا آية 🤍';
      },
    });
    bridge.configure({ botToken: 'test-token', allowedChatIds: '111', proactive: false });

    const reply = await bridge.handleUpdate({
      update_id: 1,
      message: { message_id: 1, chat: { id: 111 }, text: 'ازيك يا آية' },
    });
    expect(reply).toBe('أهلاً بيك، أنا آية 🤍');
    expect(inbound).toEqual([{ chatId: '111', text: 'ازيك يا آية' }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chat_id).toBe('111');

    const blocked = await bridge.handleUpdate({
      update_id: 2,
      message: { message_id: 2, chat: { id: 999 }, text: 'مش مسموح' },
    });
    expect(blocked).toBeNull();
    expect(inbound).toHaveLength(1);
    expect(bridge.status().running).toBe(false);
  });
});

describe('Aya v2 — partial model updates keep NOT NULL columns intact', () => {
  test('toggling failover and reordering priority never nulls the label', async () => {
    const service = new AyaService({ kernel, adapter: store });
    const created = await service.addProvider({ name: 'Dahl', baseUrl: 'https://inference.dahl.global/v1', apiKey: 'ah_test' });
    const first = await service.addManualModel(created.id, { modelId: 'deepseek-ai/DeepSeek-V4-Flash-0731', label: 'DeepSeek V4 Flash' });
    const second = await service.addManualModel(created.id, { modelId: 'zai-org/GLM-5.3-Flash' });

    // The exact shape the settings screen sends: only `failover` is meaningful.
    const toggled = await service.updateModel(first.id, { failover: false, label: undefined, priority: undefined });
    expect(toggled.label).toBe('DeepSeek V4 Flash');
    expect(toggled.failover).toBe(false);
    const reloaded = (await store.listModels()).find((entry) => entry.id === first.id)!;
    expect(reloaded.label).toBe('DeepSeek V4 Flash');
    expect(reloaded.failover).toBe(false);

    // Reorder: swap priorities, both rows keep their labels.
    await service.updateModel(first.id, { priority: second.priority });
    await service.updateModel(second.id, { priority: first.priority });
    const reordered = await store.listModels();
    expect(reordered.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(reordered.every((entry) => entry.label.length > 0)).toBe(true);
  });

  test('a single-model re-test stores status, latency and diagnostic without losing the label', async () => {
    const fetchImpl = (async () => jsonResponse({ error: { code: 'invalid_api_key', message: 'invalid API token' } }, 401)) as unknown as typeof fetch;
    const service = new AyaService({ kernel, adapter: store, fetchImpl });
    const created = await service.addProvider({ name: 'Dahl', baseUrl: 'https://inference.dahl.global/v1', apiKey: 'ah_test' });
    const added = await service.addManualModel(created.id, { modelId: 'MiniMaxAI/MiniMax-M2.7', label: 'MiniMax M2.7' });

    const tested = await service.testModel(added.id);
    expect(tested.label).toBe('MiniMax M2.7');
    expect(tested.status).toBe('failed');
    expect(tested.lastError).toContain('401');
    expect(tested.lastTestedAt).toBeTruthy();
    const stored = (await store.listModels()).find((entry) => entry.id === added.id)!;
    expect(stored.label).toBe('MiniMax M2.7');
    expect(stored.status).toBe('failed');
  });
});

describe('Aya v2 — failover prefers healthy models and honours explicit overrides', () => {
  test('a failed primary is demoted behind a healthy model in the pool', () => {
    const providers = [provider('p', 'https://p.mock/v1', 'P')];
    const models = [
      model({ id: 'dead', providerId: 'p', modelId: 'dead-model', priority: 1, status: 'failed' }),
      model({ id: 'healthy', providerId: 'p', modelId: 'healthy-model', priority: 2, status: 'ok', latencyMs: 97 }),
    ];
    const routing: AyaRouting = { chat_deep: 'dead', background_24_7: null, vision: null, memory_summarizer: null };
    const router = new AyaModelRouter({ models, providers });
    expect(router.pool('chat_deep', routing).map((entry) => entry.model.id)).toEqual(['healthy', 'dead']);
  });

  test('a failed primary is skipped at call time instead of eating the turn', async () => {
    const providers = [provider('p', 'https://p.mock/v1', 'P')];
    const models = [
      model({ id: 'dead', providerId: 'p', modelId: 'dead-model', priority: 1, status: 'failed' }),
      model({ id: 'healthy', providerId: 'p', modelId: 'healthy-model', priority: 2, status: 'ok' }),
    ];
    const routing: AyaRouting = { chat_deep: 'dead', background_24_7: null, vision: null, memory_summarizer: null };
    const called: string[] = [];
    globalThis.fetch = (async (url: string) => {
      called.push(String(url));
      return jsonResponse({ choices: [{ message: { content: 'من النموذج الشغال' } }] });
    }) as unknown as typeof fetch;

    const router = new AyaModelRouter({ models, providers, fetchImpl: globalThis.fetch });
    const result = await router.chat({ role: 'chat_deep', routing, models, providers, messages: [], system: 's' });
    expect(result.modelRowId).toBe('healthy');
    expect(called).toHaveLength(1);
  });

  test('an explicit chat modelId overrides the routed role model', () => {
    const providers = [provider('p', 'https://p.mock/v1', 'P')];
    const models = [
      model({ id: 'routed', providerId: 'p', modelId: 'routed-model', priority: 1, status: 'ok' }),
      model({ id: 'picked', providerId: 'p', modelId: 'picked-model', priority: 5, status: 'ok', failover: false }),
    ];
    const routing: AyaRouting = { chat_deep: 'routed', background_24_7: null, vision: null, memory_summarizer: null };
    const router = new AyaModelRouter({ models, providers });
    expect(router.pool('chat_deep', routing, 'picked')[0]!.model.id).toBe('picked');
  });
});

describe('Aya v2 — compact tool selection', () => {
  const spec = (name: string) => ({ name, originalName: name, description: `${name} — ${'very long schema description '.repeat(20)}`, parameters: { type: 'object' } });
  const catalogue = [
    ...[
      'workspace.list',
      'task.counts',
      'task.create',
      'task.update',
      'task.complete',
      'task.reschedule',
      'project.list',
      'label.list',
      'checklist.setItems',
      'aya.remember',
      'aya.searchWorkspace',
      'core.system.overview',
    ].map(spec),
    spec('report.stats'),
    spec('filter.create'),
    spec('core.plugins.setEnabled'),
    spec('view.setLayout'),
    spec('subtask.create'),
    spec('comment.create'),
  ];

  test('a plain message ships only the compact core toolset', () => {
    const selected = selectAyaToolSpecs(catalogue, 'اعملي مهمة جديدة بكرة');
    expect(selected.length).toBeLessThan(catalogue.length);
    expect(selected.some((tool) => tool.originalName === 'task.create')).toBe(true);
    expect(selected.some((tool) => tool.originalName === 'report.stats')).toBe(false);
    expect(selected.some((tool) => tool.originalName === 'core.plugins.setEnabled')).toBe(false);
  });

  test('specialised tools appear only when the message needs them', () => {
    const selected = selectAyaToolSpecs(catalogue, 'اعملي تقرير إحصائيات الأسبوع');
    expect(selected.some((tool) => tool.originalName === 'report.stats')).toBe(true);
    expect(selected.some((tool) => tool.originalName === 'task.create')).toBe(true);
    expect(selected.some((tool) => tool.originalName === 'filter.create')).toBe(false);
  });

  test('tools already used in the conversation stay available and descriptions are compacted', () => {
    const history = [
      {
        ...message('conv', 1, 'assistant', ''),
        toolCalls: [{ name: 'view.setLayout', input: { id: 'v1' } }],
      },
    ];
    const selected = selectAyaToolSpecs(catalogue, 'كملي', history);
    expect(selected.some((tool) => tool.originalName === 'view.setLayout')).toBe(true);
    for (const tool of selected) expect(tool.description.length).toBeLessThanOrEqual(160);
  });
});

describe('Aya v2 — live workspace snapshot in system prompt', () => {
  test('contains projects, labels, counts and clock plus the no-redundant-calls instruction', async () => {
    await kernel.execute('project.ensureInbox', {});
    await kernel.execute('project.create', { name: 'مشروع اختبار' });
    kernel.store.upsert('labels', { id: 'lbl_urgent', name: 'عاجل', color: '#f00', deletedAt: null } as never);
    await kernel.execute('task.create', { content: 'مهمة اختبار 1', dueDate: '2020-01-01' });

    const { AyaBrain: AyaBrainCls } = await import('../plugins/plugin-ai-agent/src/aya/brain');
    const settings = await new AyaBrainCls({ kernel, adapter: store }).settings();
    const prompt = buildAyaSystemPrompt({
      kernel,
      settings,
      language: 'ar',
      memories: [],
      summary: '',
      workspace: [],
      toolCount: 77,
      pendingInbox: 0,
    });
    expect(prompt).toContain('مشروع اختبار');
    expect(prompt).toContain('عاجل');
    expect(prompt).toContain('مهمة اختبار 1');
    expect(prompt).toContain('الآن');
    expect(prompt).toContain('Do NOT call workspace.list, project.list, core.system.overview, or core.system.clock');
  });
});

describe('Aya v2 — graceful fallback when narration fails after tools succeed', () => {
  test('emits the Egyptian Arabic confirmation listing succeeded actions', async () => {
    await store.saveProvider(provider('p1', 'http://localhost:9999/v1', 'Local Mock'));
    await store.saveModel(model({ id: 'm1', providerId: 'p1', modelId: 'mock-model', contextWindow: 128_000, priority: 1 }));
    await store.saveRouting({ chat_deep: 'm1', background_24_7: 'm1', vision: 'm1', memory_summarizer: 'm1' });
    await store.saveSettings({ ...DEFAULT_AYA_SETTINGS, autonomy: 'full_undo' });
    await kernel.execute('project.ensureInbox', {});

    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'task__create', arguments: JSON.stringify({ content: 'مهمة' }) } }] } }] });
      }
      // all subsequent narration attempts fail
      return new Response('server error', { status: 500 });
    }) as unknown as typeof fetch;

    const brain = new AyaBrain({ kernel, adapter: store });
    const turn = await brain.handleMessage({ text: 'اعملي مهمة', language: 'ar' });
    const assistant = turn.messages.find((m) => m.role === 'assistant')!;
    expect(assistant.content).toContain('تم تنفيذ الإجراءات بنجاح');
    expect(assistant.content).toContain('task.create');
  });
});

describe('Aya v2 — Google Gemini default provider seeding', () => {
  test('seeds Google Gemini with the OpenAI-compat URL and empty key', async () => {
    const service = new AyaService({ kernel, adapter: store });
    await service.init();
    const providers = await store.listProviders();
    const gemini = providers.find((p) => p.name === 'Google Gemini');
    expect(gemini).toBeDefined();
    expect(gemini!.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(gemini!.apiKey).toBe('');
  });
});

describe('Aya v2 — Gemini thought_signature via the native Google provider', () => {
  test('routes generativelanguage providers to the native API and strips the models/ prefix', async () => {
    const providers = [provider('g1', 'https://generativelanguage.googleapis.com/v1beta/openai', 'Google Gemini')];
    const models = [model({ id: 'gm', providerId: 'g1', modelId: 'models/gemini-3-flash-preview', priority: 1 })];
    const routing: AyaRouting = { chat_deep: 'gm', background_24_7: null, vision: null, memory_summarizer: null };
    const urls: string[] = [];

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      urls.push(String(url));
      const body = JSON.parse(String(init?.body)) as { tools?: unknown[] };
      if (body.tools?.length) {
        return jsonResponse({
          candidates: [
            { content: { role: 'model', parts: [{ functionCall: { name: 'task__create', args: { content: 'مهمة' } } }] }, finishReason: 'STOP' },
          ],
        });
      }
      return jsonResponse({ candidates: [{ content: { role: 'model', parts: [{ text: 'اتعملت ✅' }] }, finishReason: 'STOP' }] });
    }) as unknown as typeof fetch;

    const router = new AyaModelRouter({ models, providers });
    const response = await router.chat({
      role: 'chat_deep',
      routing,
      models,
      providers,
      messages: [{ role: 'user', content: 'اعملي مهمة' }],
      system: 'أنتِ آية',
      tools: [{ name: 'task__create', originalName: 'task.create', description: 'create a task', parameters: { type: 'object', properties: {} } }],
    });

    expect(urls[0]).toContain('/v1beta/models/gemini-3-flash-preview:generateContent');
    expect(urls[0]).not.toContain('/openai');
    expect(urls[0]).not.toContain('models/models/');
    expect(response.toolCalls[0]).toMatchObject({ name: 'task.create', args: { content: 'مهمة' } });
  });
});

describe('Aya v2 — post-tool narration fallback uses a clean plain-text transcript', () => {
  test('the fallback call carries no tool schemas and no raw tool_calls history', async () => {
    await store.saveProvider(provider('p1', 'http://localhost:9999/v1', 'Local Mock'));
    await store.saveModel(model({ id: 'm1', providerId: 'p1', modelId: 'mock-model', contextWindow: 128_000, priority: 1 }));
    await store.saveRouting({ chat_deep: 'm1', background_24_7: 'm1', vision: 'm1', memory_summarizer: 'm1' });
    await store.saveSettings({ ...DEFAULT_AYA_SETTINGS, autonomy: 'full_undo' });
    await kernel.execute('project.ensureInbox', {});

    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (bodies.length === 1) {
        return jsonResponse({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'task__create', arguments: JSON.stringify({ content: 'مهمة' }) } }] } }] });
      }
      // The multi-step call with tool history explodes, exactly like Gemini's 400.
      if (bodies.length === 2) return new Response('missing thought_signature', { status: 400 });
      return jsonResponse({ choices: [{ message: { content: 'اتعملت المهمة يا فندم ✅' } }] });
    }) as unknown as typeof fetch;

    const brain = new AyaBrain({ kernel, adapter: store });
    const turn = await brain.handleMessage({ text: 'اعملي مهمة اسمها مهمة', language: 'ar' });

    expect(bodies).toHaveLength(3);
    const narration = bodies[2]!;
    expect(narration.tools).toBeUndefined();
    const messages = narration.messages as Array<{ role: string; tool_calls?: unknown }>;
    expect(messages.some((entry) => entry.role === 'tool')).toBe(false);
    expect(messages.some((entry) => entry.tool_calls !== undefined)).toBe(false);
    expect(JSON.stringify(messages)).toContain('task.create');
    expect(JSON.stringify(messages)).toContain('اعملي مهمة اسمها مهمة');
    expect(turn.messages.find((entry) => entry.role === 'assistant')!.content).toBe('اتعملت المهمة يا فندم ✅');
  });
});

describe('Aya v2 — SSE-style event emission from brain', () => {
  test('emits tool_start, tool_result and delta in order', async () => {
    await store.saveProvider(provider('p1', 'http://localhost:9999/v1', 'Local Mock'));
    await store.saveModel(model({ id: 'm1', providerId: 'p1', modelId: 'mock-model', contextWindow: 128_000, priority: 1 }));
    await store.saveRouting({ chat_deep: 'm1', background_24_7: 'm1', vision: 'm1', memory_summarizer: 'm1' });
    await store.saveSettings({ ...DEFAULT_AYA_SETTINGS, autonomy: 'full_undo' });
    await kernel.execute('project.ensureInbox', {});

    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'task__create', arguments: JSON.stringify({ content: 'مهمة' }) } }] } }] });
      }
      return jsonResponse({ choices: [{ message: { content: 'تم' } }] });
    }) as unknown as typeof fetch;

    const events: string[] = [];
    const brain = new AyaBrain({ kernel, adapter: store });
    await brain.handleMessage({ text: 'اعملي مهمة', language: 'ar', onEvent: (e) => events.push(String(e.type)) });
    expect(events).toContain('tool_start');
    expect(events).toContain('tool_result');
    expect(events).toContain('delta');
    const ti = events.indexOf('tool_start');
    const ri = events.indexOf('tool_result');
    const di = events.indexOf('delta');
    expect(ti).toBeLessThan(ri);
    expect(ri).toBeLessThan(di);
  });
});

describe('Aya v2 — poisoned history: stored tool calls never break a turn', () => {
  /** A conversation like `hi2`: assistant rows that executed tools, results never persisted. */
  async function seedPoisonedConversation(): Promise<string> {
    const id = 'conv_hi2';
    await store.saveConversation({ id, title: 'hi2', channel: 'web', summary: '', createdAt: now(), updatedAt: now() });
    await store.saveMessage(message(id, 1, 'user', 'اعملي مهمة اسمها تجربة'));
    const first = message(id, 2, 'assistant', 'تمام، عملت المهمة.');
    await store.saveMessage({ ...first, toolCalls: [{ name: 'task.create', input: { content: 'تجربة' } }] });
    await store.saveMessage(message(id, 3, 'user', 'وكمان عدّلي العنوان'));
    const second = message(id, 4, 'assistant', 'اتعدل.');
    await store.saveMessage({
      ...second,
      toolCalls: [
        { name: 'task.update', input: { id: 't1', content: 'عنوان جديد' } },
        { name: 'checklists.setItems', input: { taskId: 't1', items: ['خطوة'] } },
      ],
    });
    return id;
  }

  test('past turns hydrate as clean text with a readable tool note', () => {
    const history: AyaMessage[] = [];
    for (let index = 1; index <= 4; index += 1) {
      history.push(message('c', index, index % 2 === 1 ? 'user' : 'assistant', `رد ${index}`));
    }
    history[1] = { ...history[1]!, toolCalls: [{ name: 'task.create', input: {} }] };
    history[3] = {
      ...history[3]!,
      toolCalls: [
        { name: 'task.update', input: {} },
        { name: 'task.complete', input: {} },
      ],
    };

    const llm = buildHistoryMessages(history);
    expect(llm).toHaveLength(4);
    expect(llm.every((entry) => entry.toolCalls === undefined)).toBe(true);
    expect(llm.some((entry) => entry.role === 'tool')).toBe(false);
    expect(llm[1]!.content).toBe('رد 2\n\n[الأدوات المنفذة سابقاً: task.create]');
    expect(llm[3]!.content).toContain('[الأدوات المنفذة سابقاً: task.update، task.complete]');
  });

  test('the router degrades an orphaned tool call to text instead of sending it', () => {
    const cleaned = sanitizeToolHistory([
      { role: 'user', content: 'اعملي مهمة' },
      { role: 'assistant', content: 'اتعملت', toolCalls: [{ id: 'orphan_1', name: 'task.create', args: { content: 'x' } }] },
      { role: 'tool', toolCallId: 'someone_else', content: 'stray result' },
      { role: 'user', content: 'شكرًا' },
    ]);
    expect(cleaned).toHaveLength(3);
    expect(cleaned[1]).toMatchObject({ role: 'assistant' });
    expect(cleaned[1]!.toolCalls).toBeUndefined();
    expect(cleaned[1]!.content).toContain('[الأدوات المنفذة سابقاً: task.create]');
    expect(cleaned.some((entry) => entry.role === 'tool')).toBe(false);

    // A complete call/result pair inside the live turn is preserved untouched.
    const live = sanitizeToolHistory([
      { role: 'user', content: 'اعملي مهمة' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'task.create', args: { content: 'x' } }] },
      { role: 'tool', toolCallId: 'call_1', toolName: 'task.create', content: '{"id":"t1"}' },
    ]);
    expect(live).toHaveLength(3);
    expect(live[1]!.toolCalls).toHaveLength(1);
    expect(live[2]!.role).toBe('tool');
  });

  test('an existing conversation full of old tool calls answers cleanly on every provider', async () => {
    await store.saveProvider(provider('p1', 'http://localhost:9999/v1', 'Local Mock'));
    await store.saveModel(model({ id: 'm1', providerId: 'p1', modelId: 'mock-model', contextWindow: 128_000, priority: 1 }));
    await store.saveProvider(provider('g1', 'https://generativelanguage.googleapis.com/v1beta/openai', 'Google Gemini'));
    await store.saveModel(
      model({ id: 'gm', providerId: 'g1', modelId: 'models/gemini-3-flash-preview', contextWindow: 1_000_000, priority: 2 }),
    );
    await store.saveRouting({ chat_deep: 'm1', background_24_7: 'm1', vision: 'gm', memory_summarizer: 'm1' });
    await store.saveSettings({ ...DEFAULT_AYA_SETTINGS, autonomy: 'full_undo' });
    await kernel.execute('project.ensureInbox', {});
    const conversationId = await seedPoisonedConversation();

    const requests: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      requests.push({ url: String(url), body });
      if (String(url).includes('generativelanguage')) {
        return jsonResponse({ candidates: [{ content: { role: 'model', parts: [{ text: 'من جيميني ✅' }] }, finishReason: 'STOP' }] });
      }
      return jsonResponse({ choices: [{ message: { content: 'من المزوّد العادي ✅' } }] });
    }) as unknown as typeof fetch;

    const brain = new AyaBrain({ kernel, adapter: store });

    const openAiTurn = await brain.handleMessage({ conversationId, text: 'كمّلي', language: 'ar', modelId: 'm1' });
    expect(openAiTurn.error).toBeUndefined();
    expect(openAiTurn.messages.find((entry) => entry.role === 'assistant')!.content).toBe('من المزوّد العادي ✅');
    const openAiBody = requests[0]!.body;
    expect((openAiBody.messages as Array<{ role: string; tool_calls?: unknown }>).some((entry) => entry.role === 'tool')).toBe(false);
    expect((openAiBody.messages as Array<{ tool_calls?: unknown }>).some((entry) => entry.tool_calls !== undefined)).toBe(false);
    expect(JSON.stringify(openAiBody.messages)).toContain('الأدوات المنفذة سابقاً');

    const geminiTurn = await brain.handleMessage({ conversationId, text: 'وكمان؟', language: 'ar', modelId: 'gm' });
    expect(geminiTurn.error).toBeUndefined();
    const geminiRequest = requests.find((entry) => entry.url.includes('generativelanguage'))!;
    expect(geminiRequest.url).toContain('/v1beta/models/gemini-3-flash-preview:generateContent');
    const contents = geminiRequest.body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    expect(contents.every((entry) => entry.role === 'user' || entry.role === 'model')).toBe(true);
    expect(contents.some((entry) => entry.parts.some((part) => 'functionCall' in part || 'functionResponse' in part))).toBe(false);
    expect(geminiTurn.messages.find((entry) => entry.role === 'assistant')!.content).toBe('من جيميني ✅');
  });
});

describe('Aya v2 — server mutations sync into the browser kernel', () => {
  test('a task created by Aya on the server appears after hydrating /api/v1/bootstrap', async () => {
    const serverKernel = new Kernel({ store: new MemoryStore() });
    serverKernel.installAll([tasksCorePlugin] as never);
    serverKernel.start();
    await serverKernel.execute('project.ensureInbox', {});
    await serverKernel.execute('task.create', { content: 'مهمة من آية على السيرفر' }, { actor: 'ai' });

    const clientKernel = new Kernel({ store: new MemoryStore() });
    clientKernel.installAll([tasksCorePlugin] as never);
    clientKernel.start();
    expect(clientKernel.store.list('tasks')).toHaveLength(0);

    const response = await createServerApp(serverKernel).request('/api/v1/bootstrap');
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { snapshot?: { collections?: Record<string, unknown[]> } };
    const applied = hydrateKernelFromSnapshot(clientKernel, payload.snapshot!.collections!);

    expect(applied).toBe(1);
    expect(clientKernel.store.list('tasks').some((task) => task.content === 'مهمة من آية على السيرفر')).toBe(true);
    expect(clientKernel.store.list('tasks').find((task) => task.content === 'مهمة من آية على السيرفر')!.projectId).toBeTruthy();
  });

  test('an unreachable or empty snapshot never wipes the live kernel', async () => {
    const clientKernel = new Kernel({ store: new MemoryStore() });
    clientKernel.installAll([tasksCorePlugin] as never);
    clientKernel.start();
    await clientKernel.execute('project.ensureInbox', {});
    await clientKernel.execute('task.create', { content: 'مهمة محلية' });

    expect(hydrateKernelFromSnapshot(clientKernel, null)).toBeNull();
    expect(hydrateKernelFromSnapshot(clientKernel, {})).toBeNull();
    expect(clientKernel.store.list('tasks')).toHaveLength(1);
  });
});
