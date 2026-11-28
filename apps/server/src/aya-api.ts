import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Kernel } from '@ayatodoist/core-kernel';
import type { AyaStore } from '@ayatodoist/database';
import type {
  AyaChannelId,
  AyaChannelRecord,
  AyaInboxItem,
  AyaInboxStatus,
  AyaMemoryCategory,
  AyaProvider,
  AyaRouting,
  AyaSettings,
} from '@ayatodoist/shared-types';
import { AYA_ROLES, DEFAULT_AYA_ROUTING, DEFAULT_AYA_SETTINGS } from '@ayatodoist/shared-types';
import { AyaService } from './aya-service';
import { AyaBrain } from '../../../plugins/plugin-ai-agent/src/aya/brain';
import { AyaMemoryEngine } from '../../../plugins/plugin-ai-agent/src/aya/memory';
import { AyaProactiveEngine, executeInboxActions, type AyaInboxCard } from '../../../plugins/plugin-ai-agent/src/aya/proactive';
import { suggestRouting } from '../../../plugins/plugin-ai-agent/src/aya/routing';
import { AyaProviderError } from '../../../plugins/plugin-ai-agent/src/aya/providers';

/**
 * `/api/aya/*` — the HTTP + SSE surface of Aya.
 *
 * Everything here delegates to the same modules the server brain and tests use:
 * `AyaService` for provider/model CRUD and probing, `AyaBrain` for turns,
 * `AyaModelRouter` (inside the brain) for failover, `AyaMemoryEngine` for
 * durable memory and `AyaProactiveEngine` for the inbox radar.
 *
 * Routes accept the exact shapes `aya-client.ts` (web) and
 * `apps/extension/src/lib/server.ts` already send, and keep the aliases older
 * clients used (PUT routing/settings, batch undo, inbox PATCH/execute).
 */

interface AyaApiDeps {
  kernel: Kernel;
  store: AyaStore;
  service: AyaService;
}

const INBOX_STATUSES: AyaInboxStatus[] = ['unread', 'read', 'done', 'dismissed'];
const MEMORY_CATEGORIES: AyaMemoryCategory[] = ['preferences', 'projects', 'people', 'rules', 'ideas'];

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

/** Never let a raw key leave the process, even when a row is returned directly. */
function publicProvider(provider: AyaProvider & { models?: unknown[] }) {
  const { apiKey, ...rest } = provider as AyaProvider & { models?: unknown[] };
  const key = typeof apiKey === 'string' ? apiKey : '';
  return {
    ...rest,
    hasKey: Boolean(key),
    keyHint: key ? `${key.slice(0, 2)}••••${key.slice(-4)}` : '',
    models: provider.models ?? [],
  };
}

function readSettings(store: AyaStore): AyaSettings {
  return { ...DEFAULT_AYA_SETTINGS, ...((store.getSettings() ?? {}) as Partial<AyaSettings>) } as AyaSettings;
}

function readRouting(store: AyaStore): AyaRouting {
  return { ...DEFAULT_AYA_ROUTING, ...((store.getRouting() ?? {}) as Partial<AyaRouting>) } as AyaRouting;
}

function ensureChannels(store: AyaStore): AyaChannelRecord[] {
  const saved = store.listChannels() as AyaChannelRecord[];
  return (['telegram', 'whatsapp'] as AyaChannelId[]).map(
    (id) => saved.find((channel) => channel.id === id) ?? { id, enabled: false, config: {}, updatedAt: new Date(0).toISOString() },
  );
}

async function readBody(c: { req: { json: () => Promise<unknown> } }): Promise<any> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function findConversationForMessage(store: AyaStore, messageId: string): string | null {
  for (const conversation of store.listConversations() as any[]) {
    const found = (store.listMessages(conversation.id) as any[]).some((message) => message.id === messageId);
    if (found) return conversation.id;
  }
  return null;
}

function cardFromItem(item: AyaInboxItem): AyaInboxCard {
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    kind: item.kind === 'procrastination' ? 'procrastination' : 'reminder',
    actions: (item.actions ?? []).map((action) => ({ name: action.name, input: action.input, label: '' })),
  };
}

export function createAyaApi({ kernel, store, service }: AyaApiDeps) {
  const app = new Hono();
  const memory = new AyaMemoryEngine(store);
  const proactive = new AyaProactiveEngine(store);
  const daemon = { lastRunAt: null as string | null, lastCandidateCount: 0 };
  let lastScanAt = 0;

  /* -------------------------------------------------------------- config */

  app.get('/config', (c) => {
    const settings = readSettings(store);
    const models = store.listModels() as any[];
    const providers = (store.listProviders() as any[]).map((provider) =>
      publicProvider({ ...provider, models: models.filter((model) => model.providerId === provider.id) }),
    );
    const tools = kernel.toolCatalogue().map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: String(tool.description ?? '').slice(0, 200),
      category: tool.category,
      destructive: tool.destructive,
      enabled: !settings.disabledTools.includes(tool.name),
    }));

    return c.json({
      providers,
      routing: readRouting(store),
      settings,
      channels: ensureChannels(store),
      tools,
      daemon: {
        enabled: settings.daemonEnabled,
        heartbeatMinutes: settings.heartbeatMinutes,
        lastRunAt: daemon.lastRunAt,
        lastCandidateCount: daemon.lastCandidateCount,
      },
    });
  });

  app.get('/health', (c) =>
    c.json({
      ok: true,
      name: 'aya',
      at: now(),
      providers: (store.listProviders() as any[]).length,
      models: (store.listModels() as any[]).length,
      tools: kernel.toolCatalogue().length,
      inbox: (store.listInbox('unread') as any[]).length,
    }),
  );

  /* ----------------------------------------------------------- providers */

  app.post('/providers', async (c) => {
    const body = await readBody(c);
    const name = String(body.name ?? '').trim();
    const baseUrl = String(body.baseUrl ?? '').trim();
    if (!name) return c.json({ ok: false, error: { message: 'Provider name is required' } }, 400);
    if (!baseUrl) return c.json({ ok: false, error: { message: 'Base URL is required' } }, 400);
    const provider = await service.addProvider({ name, baseUrl, apiKey: String(body.apiKey ?? '') });
    return c.json({ provider: publicProvider({ ...provider, models: [] }) });
  });

  app.patch('/providers/:id', async (c) => {
    const body = await readBody(c);
    const provider = await service.updateProvider(c.req.param('id'), {
      name: typeof body.name === 'string' ? body.name : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    });
    const models = (store.listModels() as any[]).filter((model) => model.providerId === provider.id);
    return c.json({ provider: publicProvider({ ...provider, models }) });
  });

  app.delete('/providers/:id', (c) => {
    service.deleteProvider(c.req.param('id'));
    return c.json({ ok: true });
  });

  /**
   * Imports the provider catalogue and returns the saved model rows. With
   * `{ preview: true }` it only discovers them so the UI can show a picker.
   */
  app.post('/providers/:id/fetch-models', async (c) => {
    const body = await readBody(c);
    if (body.preview === true) return c.json(await service.previewModels(c.req.param('id')));
    const result = await service.fetchModels(c.req.param('id'));
    return c.json(result);
  });

  /** Saves only the models chosen in the picker. */
  app.post('/providers/:id/models/bulk', async (c) => {
    const body = await readBody(c);
    const entries = Array.isArray(body.models) ? body.models : [];
    return c.json(await service.addModels(c.req.param('id'), entries));
  });

  /** One-click cleanup of every failed / disabled model of a provider. */
  app.delete('/providers/:id/failed-models', async (c) => c.json(await service.deleteFailedModels(c.req.param('id'))));

  app.post('/providers/:id/models', async (c) => {
    const body = await readBody(c);
    const modelId = String(body.modelId ?? '').trim();
    if (!modelId) return c.json({ ok: false, error: { message: 'Model id is required' } }, 400);
    const model = await service.addManualModel(c.req.param('id'), {
      modelId,
      label: typeof body.label === 'string' ? body.label : undefined,
    });
    return c.json({ model });
  });

  /* -------------------------------------------------------------- models */

  app.post('/models', async (c) => {
    const body = await readBody(c);
    const providerId = String(body.providerId ?? '').trim();
    const modelId = String(body.modelId ?? '').trim();
    if (!providerId) return c.json({ ok: false, error: { message: 'providerId is required' } }, 400);
    if (!modelId) return c.json({ ok: false, error: { message: 'Model id is required' } }, 400);
    const model = await service.addManualModel(providerId, {
      modelId,
      label: typeof body.label === 'string' ? body.label : undefined,
    });
    return c.json({ model });
  });

  app.patch('/models/:id', async (c) => {
    const body = await readBody(c);
    const model = await service.updateModel(c.req.param('id'), {
      failover: typeof body.failover === 'boolean' ? body.failover : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : undefined,
      label: typeof body.label === 'string' ? body.label : undefined,
      vision: typeof body.vision === 'boolean' ? body.vision : undefined,
    });
    return c.json({ model });
  });

  app.delete('/models/:id', (c) => {
    service.deleteModel(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/models/:id/test', async (c) => {
    const model = await service.testModel(c.req.param('id'));
    return c.json({ model });
  });

  /** Batched probe of every model on a provider (concurrency 4). */
  app.post('/providers/:id/test-all', async (c) => {
    const result = await service.testAllModels(c.req.param('id'));
    return c.json(result);
  });

  /* ------------------------------------------------------- health checks */

  app.get('/health-check', (c) => {
    const settings = readSettings(store);
    return c.json({
      enabled: settings.healthCheckEnabled,
      minutes: settings.healthCheckMinutes,
      lastCheckAt: settings.healthCheckLastAt,
    });
  });

  app.post('/health-check/run', async (c) => c.json(await service.runHealthCheck()));

  /* ----------------------------------------------------- routing/settings */

  const saveRouting = async (c: any) => {
    const body = await readBody(c);
    const current = readRouting(store);
    const patch: Record<string, string | null> = {};
    for (const role of AYA_ROLES) {
      if (typeof body[role] === 'string' || body[role] === null) {
        patch[role] = body[role] === '' ? null : body[role];
      }
    }
    const routing = { ...current, ...patch } as AyaRouting;
    store.saveRouting(routing);
    return c.json({ routing });
  };

  app.post('/routing', saveRouting);
  app.put('/routing', saveRouting);

  app.post('/routing/auto', (c) => {
    const suggestion = suggestRouting(store.listModels() as any[]);
    const routing: AyaRouting = {
      chat_deep: suggestion.chat_deep,
      background_24_7: suggestion.background_24_7,
      vision: suggestion.vision,
      memory_summarizer: suggestion.memory_summarizer,
    };
    store.saveRouting(routing);
    return c.json({ routing, reason: suggestion.reason });
  });

  const saveSettings = async (c: any) => {
    const body = await readBody(c);
    const current = readSettings(store);
    const next = {
      ...current,
      ...(typeof body.personaAr === 'string' ? { personaAr: body.personaAr } : {}),
      ...(typeof body.personaEn === 'string' ? { personaEn: body.personaEn } : {}),
      ...(typeof body.autonomy === 'string' ? { autonomy: body.autonomy } : {}),
      ...(typeof body.daemonEnabled === 'boolean' ? { daemonEnabled: body.daemonEnabled } : {}),
      ...(Number.isFinite(Number(body.heartbeatMinutes)) ? { heartbeatMinutes: Number(body.heartbeatMinutes) } : {}),
      ...(typeof body.healthCheckEnabled === 'boolean' ? { healthCheckEnabled: body.healthCheckEnabled } : {}),
      ...(Number.isFinite(Number(body.healthCheckMinutes)) ? { healthCheckMinutes: Math.max(5, Number(body.healthCheckMinutes)) } : {}),
      ...(Array.isArray(body.disabledTools) ? { disabledTools: body.disabledTools.map(String) } : {}),
    } as AyaSettings;
    const settings = { ...(store.saveSettings(next) as AyaSettings), updatedAt: now() };
    return c.json({ settings });
  };

  app.patch('/settings', saveSettings);
  app.put('/settings', saveSettings);

  /* ------------------------------------------------------- conversations */

  app.get('/conversations', (c) => c.json({ conversations: store.listConversations() }));

  app.post('/conversations', async (c) => {
    const body = await readBody(c);
    const at = now();
    const conversation = await store.saveConversation({
      id: newId('conv'),
      title: String(body.title ?? '').trim() || 'محادثة جديدة',
      channel: 'web',
      summary: '',
      createdAt: at,
      updatedAt: at,
    });
    return c.json({ conversation });
  });

  app.delete('/conversations/:id', (c) => {
    store.deleteConversation(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/conversations/:id/messages', (c) => c.json({ messages: store.listMessages(c.req.param('id')) }));

  app.get('/messages/:id', (c) => {
    const conversationId = findConversationForMessage(store, c.req.param('id'));
    if (!conversationId) return c.json({ ok: false, error: { message: 'Message not found' } }, 404);
    const message = (store.listMessages(conversationId) as any[]).find((row) => row.id === c.req.param('id'));
    return c.json({ message });
  });

  /* ---------------------------------------------------------------- chat */

  app.post('/chat', async (c) => {
    const body = await readBody(c);
    const text = String(body.text ?? '').trim();
    if (!text) return c.json({ ok: false, error: { message: 'text is required' } }, 400);

    const brain = new AyaBrain({ kernel, adapter: store });
    const turn = await brain.handleMessage({
      text,
      conversationId: typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : undefined,
      language: body.language === 'en' ? 'en' : 'ar',
      modelId: typeof body.modelId === 'string' && body.modelId ? body.modelId : undefined,
    });

    return c.json({
      ok: true,
      conversationId: turn.conversationId,
      conversation: (store.listConversations() as any[]).find((row) => row.id === turn.conversationId) ?? null,
      messages: turn.messages ?? [],
      conversationMessages: store.listMessages(turn.conversationId),
      model: turn.model ?? null,
      failover: Boolean(turn.failover),
      batchId: turn.batchId ?? null,
      pending: turn.pending ?? [],
    });
  });

  app.post('/chat/stream', async (c) => {
    const body = await readBody(c);
    const text = String(body.text ?? '').trim();
    if (!text) return c.json({ ok: false, error: { message: 'text is required' } }, 400);
    const language = body.language === 'en' ? 'en' : 'ar';
    const modelId = typeof body.modelId === 'string' && body.modelId ? body.modelId : undefined;

    return streamSSE(c, async (stream) => {
      // Serialise every event: the brain emits from inside async tool loops and
      // SSE frames must never interleave.
      let chain: Promise<void> = Promise.resolve();
      const emit = (event: string, data: Record<string, unknown>) => {
        chain = chain
          .then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
          .then(() => undefined)
          .catch(() => undefined);
      };

      try {
        let conversationId =
          typeof body.conversationId === 'string' && body.conversationId ? body.conversationId : null;
        if (!conversationId) {
          const at = now();
          const conversation = await store.saveConversation({
            id: newId('conv'),
            title: text.slice(0, 60),
            channel: 'web',
            summary: '',
            createdAt: at,
            updatedAt: at,
          });
          conversationId = conversation.id as string;
        }

        emit('meta', { conversationId, model: null, failover: false });

        const brain = new AyaBrain({ kernel, adapter: store });
        const turn = await brain.handleMessage({
          text,
          conversationId,
          language,
          modelId,
          onEvent: (event: any) => {
            if (event?.type === 'tool_start') {
              emit('tool_start', { name: event.name, args: {}, toolCallId: event.toolCallId ?? null, batchId: event.batchId ?? null });
            } else if (event?.type === 'tool_result') {
              emit('tool_result', {
                name: event.name,
                ok: event.ok !== false,
                summary: event.ok === false ? String(event.error ?? 'فشل') : 'تم التنفيذ',
              });
            } else if (event?.type === 'delta' && typeof event.content === 'string') {
              emit('delta', { text: event.content });
            }
          },
        });

        await chain;
        emit('meta', { conversationId: turn.conversationId, model: turn.model ?? null, failover: Boolean(turn.failover) });
        emit('done', {
          conversationId: turn.conversationId,
          model: turn.model ?? null,
          failover: Boolean(turn.failover),
          batchId: turn.batchId ?? null,
          pending: turn.pending ?? [],
          executedTools: (turn.toolCalls ?? []).length,
        });
        await chain;
      } catch (error) {
        const typed = error as Error;
        emit('error', { message: typed?.message ?? 'stream failed' });
        await chain;
      }
    });
  });

  const editMessage = async (c: any, conversationId: string, messageId: string) => {
    const body = await readBody(c);
    const text = String(body.text ?? '').trim();
    if (!text) return c.json({ ok: false, error: { message: 'text is required' } }, 400);
    const brain = new AyaBrain({ kernel, adapter: store });
    await brain.editMessage({
      conversationId,
      messageId,
      text,
      language: body.language === 'en' ? 'en' : 'ar',
    });
    return c.json({
      ok: true,
      conversationId,
      conversationMessages: store.listMessages(conversationId),
      messages: store.listMessages(conversationId),
    });
  };

  app.post('/messages/:id/edit', async (c) => {
    const conversationId = findConversationForMessage(store, c.req.param('id'));
    if (!conversationId) return c.json({ ok: false, error: { message: 'Message not found' } }, 404);
    return editMessage(c, conversationId, c.req.param('id'));
  });

  app.put('/conversations/:conversationId/messages/:messageId', (c) =>
    editMessage(c, c.req.param('conversationId'), c.req.param('messageId')),
  );

  const undo = async (c: any) => {
    const brain = new AyaBrain({ kernel, adapter: store });
    const result = await brain.undoBatch(c.req.param('batchId'));
    return c.json({ ok: true, undone: result.undone, failed: 0 });
  };

  app.post('/undo/:batchId', undo);
  app.post('/batch/:batchId/undo', undo);

  /* --------------------------------------------------------------- inbox */

  app.get('/inbox', async (c) => {
    // Refresh the radar at most once every 30 seconds, so a polling client does
    // not rescan the whole task table on every request.
    if (Date.now() - lastScanAt > 30_000) {
      lastScanAt = Date.now();
      try {
        const cards = await proactive.scan(kernel);
        daemon.lastRunAt = now();
        daemon.lastCandidateCount = cards.length;
      } catch {
        /* a radar failure must never break the inbox read */
      }
    }
    const status = c.req.query('status');
    const items = store.listInbox(status && INBOX_STATUSES.includes(status as AyaInboxStatus) ? status : undefined);
    return c.json({ items });
  });

  const setInboxStatus = (id: string, status: AyaInboxStatus) => {
    const item = (store.listInbox() as AyaInboxItem[]).find((row) => row.id === id);
    if (!item) return null;
    return store.saveInboxItem({ ...item, status });
  };

  const inboxAction = async (c: any) => {
    const body = await readBody(c);
    const id = c.req.param('id');
    const item = (store.listInbox() as AyaInboxItem[]).find((row) => row.id === id);
    if (!item) return c.json({ ok: false, error: { message: 'Inbox item not found' } }, 404);

    const action = String(body.action ?? body.status ?? 'done');
    if (action === 'execute') {
      const batchId = newId('batch');
      const { executed } = await executeInboxActions(kernel, cardFromItem(item), batchId);
      const saved = setInboxStatus(id, 'done');
      return c.json({ ok: true, item: saved, itemId: id, batchId, executed });
    }
    const status: AyaInboxStatus =
      action === 'dismiss' || action === 'dismissed' ? 'dismissed' : action === 'read' ? 'read' : 'done';
    const saved = setInboxStatus(id, status);
    return c.json({ ok: true, item: saved, itemId: id, executed: [] });
  };

  app.post('/inbox/:id/action', inboxAction);
  app.patch('/inbox/:id', inboxAction);
  app.post('/inbox/:id/execute', inboxAction);

  app.delete('/inbox/:id', (c) => {
    store.deleteInboxItem(c.req.param('id'));
    return c.json({ ok: true });
  });

  /* ------------------------------------------------------------ memories */

  app.get('/memories', (c) => {
    const query = c.req.query('q');
    const memories = query ? store.search(query) : store.listMemories();
    return c.json({ memories });
  });

  app.post('/memories', async (c) => {
    const body = await readBody(c);
    const content = String(body.content ?? '').trim();
    if (!content) return c.json({ ok: false, error: { message: 'content is required' } }, 400);
    const category = MEMORY_CATEGORIES.includes(body.category) ? body.category : 'ideas';
    const saved = await memory.remember({
      content,
      category,
      source: typeof body.source === 'string' ? body.source : 'settings',
      importance: Number.isFinite(Number(body.importance)) ? Number(body.importance) : 1,
    });
    return c.json({ memory: saved });
  });

  app.patch('/memories/:id', async (c) => {
    const body = await readBody(c);
    const existing = (store.listMemories() as any[]).find((row) => row.id === c.req.param('id'));
    if (!existing) return c.json({ ok: false, error: { message: 'Memory not found' } }, 404);
    const saved = store.saveMemory({
      ...existing,
      ...(typeof body.content === 'string' && body.content.trim() ? { content: body.content.trim() } : {}),
      ...(MEMORY_CATEGORIES.includes(body.category) ? { category: body.category } : {}),
      ...(Number.isFinite(Number(body.importance)) ? { importance: Number(body.importance) } : {}),
    });
    return c.json({ memory: saved });
  });

  app.delete('/memories/:id', (c) => {
    store.deleteMemory(c.req.param('id'));
    return c.json({ ok: true });
  });

  /* ------------------------------------------------------------ channels */

  app.get('/channels', (c) => c.json({ channels: ensureChannels(store) }));

  app.put('/channels/:id', async (c) => {
    const id = c.req.param('id');
    if (id !== 'telegram' && id !== 'whatsapp') return c.json({ ok: false, error: { message: 'Unknown channel' } }, 404);
    const body = await readBody(c);
    const existing = ensureChannels(store).find((channel) => channel.id === id) as AyaChannelRecord;
    const channel: AyaChannelRecord = {
      ...existing,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : existing.enabled,
      config: { ...existing.config, ...((body.config ?? {}) as Record<string, string | number | boolean>) },
      updatedAt: now(),
    };
    await store.saveChannel(channel);
    const record = ensureChannels(store).find((row) => row.id === id)!;
    return c.json({ channel: record, status: { enabled: record.enabled, configured: Boolean(record.config?.token) } });
  });

  app.get('/channels/status', (c) => {
    const channels = ensureChannels(store);
    return c.json(
      Object.fromEntries(channels.map((channel) => [channel.id, { enabled: channel.enabled, configured: Boolean(channel.config?.token) }])),
    );
  });

  /* -------------------------------------------------------------- daemon */

  app.post('/daemon/run', async (c) => {
    const cards = await proactive.scan(kernel);
    daemon.lastRunAt = now();
    daemon.lastCandidateCount = cards.length;
    return c.json({ ok: true, created: cards.length, items: store.listInbox('unread'), skipped: false });
  });

  app.onError((error, c) => {
    const message = error instanceof Error ? error.message : String(error);
    const typed = error as AyaProviderError;
    const status =
      typeof typed?.status === 'number' && typed.status >= 400 && typed.status < 600
        ? typed.status
        : /required|invalid|unknown|cannot|missing/i.test(message)
          ? 400
          : 500;
    return c.json({ ok: false, error: { code: status === 400 ? 'validation' : 'error', message } }, status as 400);
  });

  return app;
}
