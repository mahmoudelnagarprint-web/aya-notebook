import type {
  AyaAttachment,
  AyaChannelId,
  AyaChannelRecord,
  AyaConversation,
  AyaInboxItem,
  AyaInboxStatus,
  AyaJournalEntry,
  AyaMemory,
  AyaMemoryCategory,
  AyaMessage,
  AyaModel,
  AyaProvider,
  AyaPublicConfig,
  AyaRole,
  AyaRouting,
  AyaSettings,
} from '@ayatodoist/shared-types';

/**
 * Typed client for `/api/aya/*` and `/api/v1/*`.
 *
 * The web app can be deployed as a static site (Netlify) while mobile apps and
 * the browser extension reuse this exact module: point `VITE_API_BASE_URL` at
 * the local server (`http://127.0.0.1:8787`, the default) or the cloud server,
 * and optionally provide `Authorization: Bearer <token>` via `VITE_AYA_TOKEN`
 * or `localStorage['aya.token']`.
 */

export const DEFAULT_AYA_API_BASE = 'http://127.0.0.1:8787';

function envValue(key: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.[key];
}

export function ayaApiBase(): string {
  const configured = (envValue('VITE_API_BASE_URL') ?? '').trim();
  const base = configured || DEFAULT_AYA_API_BASE;
  return base.replace(/\/+$/, '');
}

export function ayaUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${ayaApiBase()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function ayaToken(): string {
  try {
    return localStorage.getItem('aya.token') ?? envValue('VITE_AYA_TOKEN') ?? '';
  } catch {
    return envValue('VITE_AYA_TOKEN') ?? '';
  }
}

export class AyaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AyaApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = ayaToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(ayaUrl(path), {
      method: options.method ?? 'GET',
      headers,
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      signal: options.signal,
    });
  } catch (error) {
    throw new AyaApiError(
      `تعذّر الوصول لخادم آية (${ayaApiBase()}). شغّلي الخادم بـ bun run dev:server ثم حاولي تاني. ${(error as Error).message}`,
      0,
    );
  }
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  const errorMessage =
    (payload as { error?: { message?: string } } | null)?.error?.message ??
    (payload as { message?: string } | null)?.message ??
    `HTTP ${response.status}`;
  if (!response.ok || (payload as { ok?: boolean } | null)?.ok === false) {
    throw new AyaApiError(errorMessage, response.status);
  }
  return payload as T;
}

export interface AyaChatResponse {
  ok: boolean;
  conversationId: string;
  conversation: AyaConversation;
  messages: AyaMessage[];
  conversationMessages: AyaMessage[];
  model: string | null;
  failover: boolean;
  batchId: string | null;
  pending: Array<{ name: string; input: Record<string, unknown> }>;
  error?: string;
}

export interface AyaChatStreamInput {
  conversationId?: string | null;
  text: string;
  attachments?: AyaAttachment[];
  language?: 'ar' | 'en';
  modelId?: string | null;
}

export interface AyaStreamDone {
  conversationId: string;
  model: string | null;
  failover: boolean;
  batchId: string | null;
  pending: Array<{ name: string; input: Record<string, unknown> }>;
  executedTools: number;
}

export interface AyaStreamHandlers {
  signal?: AbortSignal;
  onMeta?: (event: { conversationId: string | null; model: string | null; failover: boolean }) => void;
  onToolStart?: (event: { name: string; args: Record<string, unknown> }) => void;
  onToolResult?: (event: { name: string; ok: boolean; summary: string }) => void;
  onDelta?: (text: string) => void;
  onDone?: (event: AyaStreamDone) => void;
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0 && event === 'message') return null;
  return { event, data: data.join('\n') };
}

export interface UploadedFile {
  filename: string;
  content_type: string;
  size: number;
  kind: 'image' | 'file';
  text?: string;
  url: string;
}

export const ayaApi = {
  config: () => request<AyaPublicConfig>('/api/aya/config'),
  health: () => request<Record<string, unknown>>('/api/aya/health'),

  addProvider: (input: { name: string; baseUrl: string; apiKey: string }) =>
    request<{ provider: AyaProvider }>('/api/aya/providers', { method: 'POST', body: input }),
  updateProvider: (id: string, patch: Partial<{ name: string; baseUrl: string; apiKey: string; enabled: boolean }>) =>
    request<{ provider: AyaProvider }>(`/api/aya/providers/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  deleteProvider: (id: string) => request<{ ok: boolean }>(`/api/aya/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  fetchModels: (id: string) =>
    request<{ models: AyaModel[]; latencyMs: number; probed: number }>(`/api/aya/providers/${encodeURIComponent(id)}/fetch-models`, {
      method: 'POST',
    }),
  addModel: (providerId: string, input: { modelId: string; label?: string; vision?: boolean }) =>
    request<{ model: AyaModel }>(`/api/aya/providers/${encodeURIComponent(providerId)}/models`, { method: 'POST', body: input }),
  updateModel: (id: string, patch: Partial<{ failover: boolean; enabled: boolean; priority: number; vision: boolean; label: string }>) =>
    request<{ model: AyaModel }>(`/api/aya/models/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  deleteModel: (id: string) => request<{ ok: boolean }>(`/api/aya/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testModel: (id: string) => request<{ model: AyaModel }>(`/api/aya/models/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  testAllModels: (providerId: string) =>
    request<{ providerId: string; models: AyaModel[]; tested: number; ok: number; failed: number }>(
      `/api/aya/providers/${encodeURIComponent(providerId)}/test-all`,
      { method: 'POST' },
    ),
  healthCheckStatus: () =>
    request<{ enabled: boolean; minutes: number; lastCheckAt: string | null }>('/api/aya/health-check'),
  runHealthCheck: () =>
    request<{ checked: number; ok: number; failed: number; reEnabled: number; lastCheckAt: string }>(
      '/api/aya/health-check/run',
      { method: 'POST' },
    ),

  setRouting: (patch: Partial<AyaRouting>) => request<{ routing: AyaRouting }>('/api/aya/routing', { method: 'PUT', body: patch }),
  smartRouting: () => request<{ routing: AyaRouting; reason: Record<AyaRole, string> }>('/api/aya/routing/auto', { method: 'POST' }),

  updateSettings: (patch: Partial<AyaSettings>) => request<{ settings: AyaSettings }>('/api/aya/settings', { method: 'PUT', body: patch }),

  conversations: () => request<{ conversations: AyaConversation[] }>('/api/aya/conversations'),
  createConversation: (title?: string) =>
    request<{ conversation: AyaConversation }>('/api/aya/conversations', { method: 'POST', body: { title } }),
  deleteConversation: (id: string) => request<{ ok: boolean }>(`/api/aya/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  messages: (conversationId: string) =>
    request<{ messages: AyaMessage[] }>(`/api/aya/conversations/${encodeURIComponent(conversationId)}/messages`),

  chat: (input: { conversationId?: string | null; text: string; attachments?: AyaAttachment[]; language?: 'ar' | 'en'; modelId?: string | null }) =>
    request<AyaChatResponse>('/api/aya/chat', { method: 'POST', body: input }),

  /**
   * Live token stream: `POST /api/aya/chat/stream`.
   * Emits meta → tool_start/tool_result chips → delta text → done.
   * The caller supplies an AbortSignal so the `إيقاف` button can stop the turn.
   */
  chatStream: async (input: AyaChatStreamInput, handlers: AyaStreamHandlers = {}): Promise<AyaStreamDone> => {
    const headers: Record<string, string> = { accept: 'text/event-stream', 'content-type': 'application/json' };
    const token = ayaToken();
    if (token) headers.authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetch(ayaUrl('/api/aya/chat/stream'), {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
        signal: handlers.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      throw new AyaApiError(
        `تعذّر الوصول لخادم آية (${ayaApiBase()}). شغّلي الخادم بـ bun run dev:server ثم حاولي تاني. ${(error as Error).message}`,
        0,
      );
    }
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      let message = `HTTP ${response.status}`;
      if (text) {
        try {
          message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
        } catch {
          /* keep the HTTP status */
        }
      }
      throw new AyaApiError(message, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finished: AyaStreamDone | null = null;
    let streamError: string | null = null;

    const dispatch = (block: string) => {
      const parsed = parseSseBlock(block);
      if (!parsed) return;
      let payload: any = {};
      try {
        payload = parsed.data ? JSON.parse(parsed.data) : {};
      } catch {
        return;
      }
      if (parsed.event === 'meta') {
        handlers.onMeta?.({ conversationId: payload.conversationId ?? null, model: payload.model ?? null, failover: !!payload.failover });
      } else if (parsed.event === 'tool_start') {
        handlers.onToolStart?.({ name: String(payload.name ?? ''), args: (payload.args ?? {}) as Record<string, unknown> });
      } else if (parsed.event === 'tool_result') {
        handlers.onToolResult?.({ name: String(payload.name ?? ''), ok: payload.ok !== false, summary: String(payload.summary ?? '') });
      } else if (parsed.event === 'delta') {
        if (typeof payload.text === 'string' && payload.text) handlers.onDelta?.(payload.text);
      } else if (parsed.event === 'done') {
        finished = {
          conversationId: String(payload.conversationId ?? ''),
          model: payload.model ?? null,
          failover: !!payload.failover,
          batchId: payload.batchId ?? null,
          pending: Array.isArray(payload.pending) ? payload.pending : [],
          executedTools: Number(payload.executedTools ?? 0),
        };
        handlers.onDone?.(finished);
      } else if (parsed.event === 'error') {
        streamError = String(payload.message ?? 'stream failed');
      }
    };

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (block.trim()) dispatch(block);
        boundary = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim()) dispatch(buffer);

    if (streamError) throw new AyaApiError(streamError, 500);
    if (!finished) throw new AyaApiError('انقطع الاتصال قبل نهاية رد آية.', 0);
    return finished;
  },
  editMessage: (conversationId: string, messageId: string, text: string) =>
    request<AyaChatResponse>(
      `/api/aya/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'PUT', body: { text } },
    ),
  undoBatch: (batchId: string) => request<{ undone: number; failed: number }>(`/api/aya/batch/${encodeURIComponent(batchId)}/undo`, { method: 'POST' }),

  inbox: (status?: AyaInboxStatus) => request<{ items: AyaInboxItem[] }>(`/api/aya/inbox${status ? `?status=${status}` : ''}`),
  setInboxStatus: (id: string, status: AyaInboxStatus) =>
    request<{ item: AyaInboxItem }>(`/api/aya/inbox/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } }),
  executeInbox: (id: string) =>
    request<{ itemId: string; batchId: string; executed: Array<{ name: string; ok: boolean; error?: string }> }>(
      `/api/aya/inbox/${encodeURIComponent(id)}/execute`,
      { method: 'POST' },
    ),

  memories: (query?: string) => request<{ memories: AyaMemory[] }>(`/api/aya/memories${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  addMemory: (input: { content: string; category: AyaMemoryCategory; importance?: number }) =>
    request<{ memory: AyaMemory }>('/api/aya/memories', { method: 'POST', body: input }),
  updateMemory: (id: string, patch: Partial<{ content: string; category: AyaMemoryCategory; importance: number }>) =>
    request<{ memory: AyaMemory }>(`/api/aya/memories/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  deleteMemory: (id: string) => request<{ ok: boolean }>(`/api/aya/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  journal: () => request<{ journal: AyaJournalEntry[] }>('/api/aya/journal'),
  addJournal: (insight: string, category?: string) => request<{ entry: AyaJournalEntry }>('/api/aya/journal', { method: 'POST', body: { insight, category } }),
  updateJournal: (id: string, patch: { insight?: string; category?: string }) =>
    request<{ entry: AyaJournalEntry }>(`/api/aya/journal/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  deleteJournal: (id: string) => request<{ ok: boolean }>(`/api/aya/journal/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reflect: () => request<{ created: AyaJournalEntry[]; journal: AyaJournalEntry[] }>('/api/aya/journal/reflect', { method: 'POST' }),

  runDaemon: () => request<{ created: number; items: AyaInboxItem[]; skipped: boolean }>('/api/aya/daemon/run', { method: 'POST' }),

  channels: () => request<{ channels: AyaChannelRecord[] }>('/api/aya/channels'),
  updateChannel: (id: AyaChannelId, patch: { enabled?: boolean; config?: Record<string, unknown> }) =>
    request<{ channel: AyaChannelRecord; status: Record<string, unknown> }>(`/api/aya/channels/${id}`, { method: 'PUT', body: patch }),
  channelStatuses: () => request<Record<string, unknown>>('/api/aya/channels/status'),

  upload: async (file: File): Promise<UploadedFile> => {
    const form = new FormData();
    form.append('file', file);
    return request<UploadedFile & { ok: boolean }>('/api/v1/uploads', { method: 'POST', form });
  },
};

export function attachmentUrl(attachment: AyaAttachment): string | null {
  if (!attachment.url) return null;
  return ayaUrl(attachment.url);
}

export type { AyaPublicConfig, AyaMessage, AyaModel, AyaProvider, AyaInboxItem, AyaMemory, AyaJournalEntry, AyaConversation };
