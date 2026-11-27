/**
 * Typed client for the local `__AYAtodoist` server.
 *
 * All extension surfaces (background worker, side panel, popup, content script
 * proxied through the worker) use this one module so the base URL, bearer token
 * and error handling stay consistent.
 */

export const DEFAULT_BASE_URL = 'http://127.0.0.1:8787';

export interface ServerConfig {
  baseUrl: string;
  token?: string;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

let cached: ServerConfig | null = null;

export function invalidateConfig(): void {
  cached = null;
}

export async function resolveConfig(): Promise<ServerConfig> {
  if (cached) return cached;
  let baseUrl = DEFAULT_BASE_URL;
  let token = '';
  try {
    const stored = (await chrome.storage.local.get(['aya:settings', 'aya:server', 'aya:bearer'])) as Record<string, any>;
    const settings = stored['aya:settings'] ?? {};
    if (typeof settings.serverBaseUrl === 'string' && settings.serverBaseUrl.trim()) baseUrl = settings.serverBaseUrl.trim();
    if (typeof settings.bearerToken === 'string') token = settings.bearerToken.trim();
    if (!settings.serverBaseUrl && typeof stored['aya:server']?.baseUrl === 'string') baseUrl = stored['aya:server'].baseUrl;
    if (!token && typeof stored['aya:bearer'] === 'string') token = stored['aya:bearer'];
  } catch {
    /* storage unavailable — defaults are fine */
  }
  cached = { baseUrl: baseUrl.replace(/\/+$/, ''), token: token || undefined };
  return cached;
}

export async function setBaseUrl(url: string): Promise<void> {
  const next = url.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
  const current = await resolveConfig();
  await chrome.storage.local.set({
    'aya:server': { baseUrl: next, token: current.token },
    'aya:settings': { ...(await readSettings()), serverBaseUrl: next },
  });
  invalidateConfig();
}

export async function setToken(token: string): Promise<void> {
  const current = await resolveConfig();
  await chrome.storage.local.set({
    'aya:bearer': token,
    'aya:server': { baseUrl: current.baseUrl, token },
    'aya:settings': { ...(await readSettings()), bearerToken: token },
  });
  invalidateConfig();
}

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const stored = (await chrome.storage.local.get(['aya:settings'])) as Record<string, any>;
    return (stored['aya:settings'] ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function headers(cfg: ServerConfig, json: boolean): Promise<Headers> {
  const h = new Headers();
  h.set('accept', 'application/json');
  if (json) h.set('content-type', 'application/json');
  h.set('x-aya-extension', '1');
  if (cfg.token) h.set('authorization', `Bearer ${cfg.token}`);
  return h;
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const cfg = await resolveConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: init.headers ?? (await headers(cfg, init.body !== undefined)),
      signal: init.signal ?? controller.signal,
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const message = data?.error?.message || data?.error || res.statusText || `HTTP ${res.status}`;
      throw new ApiError(String(message), res.status, data);
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ types */

export interface HealthResponse {
  ok: boolean;
  at: string;
}

export interface UploadResult {
  ok: boolean;
  filename: string;
  url: string;
  absoluteUrl: string;
  content_type: string;
  size: number;
  kind: 'image' | 'file';
  text?: string;
}

export interface AyaConfig {
  providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    enabled: boolean;
    hasKey: boolean;
    models: Array<{
      id: string;
      modelId: string;
      label: string;
      providerId: string;
      enabled: boolean;
      failover: boolean;
      status?: string;
      latencyMs?: number | null;
      vision?: boolean;
    }>;
  }>;
  routing: Record<string, string | null>;
  settings: Record<string, unknown>;
}

export interface InboxItem {
  id: string;
  kind: string;
  title: string;
  body?: string;
  status: string;
  actions?: Array<{ name: string; input?: unknown }>;
  createdAt?: string;
}

export interface ConversationRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatEvent {
  event: string;
  data: any;
}

/* -------------------------------------------------------------------- API */

export const ayaServer = {
  getConfig: resolveConfig,
  setBaseUrl,
  setToken,

  async health(): Promise<HealthResponse> {
    return request<HealthResponse>('/api/v1/health', { timeoutMs: 5000 });
  },

  async command<T = any>(name: string, input: unknown = {}): Promise<T> {
    return request<T>(`/api/v1/command/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async snapshot(): Promise<any> {
    const res = await request<{ ok: boolean; snapshot: any }>('/api/v1/snapshot');
    return res.snapshot;
  },

  async bootstrap(): Promise<any> {
    const res = await request<{ ok: boolean; snapshot: any }>('/api/v1/bootstrap');
    return res.snapshot;
  },

  async ayaConfig(): Promise<AyaConfig> {
    return request<AyaConfig>('/api/aya/config');
  },

  async inbox(): Promise<{ items: InboxItem[] }> {
    return request<{ items: InboxItem[] }>('/api/aya/inbox');
  },

  async inboxAction(id: string, action: 'execute' | 'done' | 'dismiss'): Promise<any> {
    return request(`/api/aya/inbox/${encodeURIComponent(id)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
  },

  async conversations(): Promise<{ conversations: ConversationRow[] }> {
    return request<{ conversations: ConversationRow[] }>('/api/aya/conversations');
  },

  async messages(conversationId: string): Promise<{ messages: any[] }> {
    return request<{ messages: any[] }>(`/api/aya/conversations/${encodeURIComponent(conversationId)}/messages`);
  },

  async undo(batchId: string): Promise<any> {
    return request(`/api/aya/undo/${encodeURIComponent(batchId)}`, { method: 'POST', body: JSON.stringify({}) });
  },

  async upload(file: File | Blob, filename = 'upload.png'): Promise<UploadResult> {
    const cfg = await resolveConfig();
    const form = new FormData();
    form.append('file', file, (file as File).name || filename);
    const res = await fetch(`${cfg.baseUrl}/api/v1/uploads`, {
      method: 'POST',
      headers: await headers(cfg, false),
      body: form,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new ApiError(data?.error?.message || `upload failed (${res.status})`, res.status, data);
    }
    return {
      ...data,
      url: data.url,
      absoluteUrl: data.url?.startsWith('http') ? data.url : `${cfg.baseUrl}${data.url}`,
    } as UploadResult;
  },

  /** Streaming chat. Resolves when the stream ends; honours `signal`. */
  async streamChat(
    payload: {
      text: string;
      conversationId?: string | null;
      modelId?: string;
      language?: 'ar' | 'en';
      pageContext?: string | null;
    },
    options: { signal?: AbortSignal; onEvent: (event: ChatEvent) => void },
  ): Promise<void> {
    const cfg = await resolveConfig();
    const res = await fetch(`${cfg.baseUrl}/api/aya/chat/stream`, {
      method: 'POST',
      headers: await headers(cfg, true),
      body: JSON.stringify({ language: 'ar', ...payload }),
      signal: options.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new ApiError(text || `chat stream failed (${res.status})`, res.status, text);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const eventMatch = /^event:\s*(.+)$/m.exec(frame);
        const dataLines = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());
        if (!eventMatch) continue;
        let data: any = {};
        const raw = dataLines.join('\n');
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = { raw };
          }
        }
        options.onEvent({ event: eventMatch[1]!.trim(), data });
      }
    }
  },

  publicUrl(path: string, baseUrl?: string): string {
    if (/^https?:\/\//.test(path)) return path;
    const base = baseUrl ?? cached?.baseUrl ?? DEFAULT_BASE_URL;
    return new URL(path, base).href;
  },
};
