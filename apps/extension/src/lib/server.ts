/**
 * Typed helpers for talking to `__AYAtodoist` from the extension.
 */

export interface ServerConfig {
  baseUrl: string;
  token?: string;
}

function headers(cfg: ServerConfig) {
  const h = new Headers();
  h.set('accept', 'application/json');
  h.set('content-type', 'application/json');
  h.set('x-aya-extension', '1');
  if (cfg.token) h.set('authorization', `Bearer ${cfg.token}`);
  return h;
}

let cfg: ServerConfig | null = null;

async function resolveConfig() {
  if (cfg) return cfg;
  const raw = await chrome.storage.local.get(['aya:server']);
  const stored = (raw as any)['aya:server'] as ServerConfig | undefined;
  const url = stored?.baseUrl ?? undefined;
  if (!url) {
    const defaults = await chrome.storage.local.get(['aya:bearer']);
    const token = defaults['aya:bearer'] as string | undefined;
    cfg = { baseUrl: 'http://127.0.0.1:8787', token };
    return cfg;
  }
  const token = (await chrome.storage.local.get(['aya:bearer']))['aya:bearer'] as string | undefined;
  cfg = { baseUrl: url, token };
  return cfg;
}

export const ayaServer = {
  getConfig: resolveConfig,

  setBaseUrl: async (url: string) => {
    const cur = await resolveConfig();
    await chrome.storage.local.set({ 'aya:server': { baseUrl: url, token: cur.token }, 'aya:bearer': cur.token });
    cfg = null;
  },

  setToken: async (token: string) => {
    const cur = await resolveConfig();
    await chrome.storage.local.set({ 'aya:bearer': token, 'aya:server': { baseUrl: cur.baseUrl, token } });
    cfg = null;
  },

  health: async () => {
    const { baseUrl } = await resolveConfig();
    return fetch(`${baseUrl}/api/v1/health`, { headers: headers({ baseUrl, token: (await resolveConfig()).token }) }).then((r) => r.json()) as Promise<{ ok: boolean; name: string; aya: { enabled: boolean }; tools: number }>;
  },

  command(body: any) {
    return fetch(`${cfg!.baseUrl}/api/v1/commands`, { method: 'POST', headers: headers(cfg!), body: JSON.stringify(body) }).then(async (r) => {
      const body = await r.json();
      if (!r.ok) throw Object.assign(new Error(body?.error?.message || r.statusText), { status: r.status, body });
      return body;
    }) as Promise<{ ok: boolean; result?: any; error?: any }>;
  },

  sync(clientId: string, operations: any[]) {
    return fetch(`${cfg!.baseUrl}/api/v1/sync`, {
      method: 'POST',
      headers: headers(cfg!),
      body: JSON.stringify({ clientId, operations }),
    }).then((r) => r.json());
  },

  inboxUnread() {
    return fetch(`${cfg!.baseUrl}/api/aya/inbox`, { headers: headers(cfg!) }).then(async (r) => {
      if (!r.ok) return { items: [] };
      const data = await r.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      return { items };
    }) as Promise<{ items: Array<{ id: string; kind: string; title: string; status?: string }> }>;
  },

  chatStream(payload: any): ReadableStream<{ event: string; data: any }> {
    const { baseUrl } = cfg!;
    const body = JSON.stringify(payload);
    return fetch(`${baseUrl}/api/aya/chat/stream`, {
      method: 'POST',
      headers: headers(cfg!),
      body,
    }).then((r) => {
      if (!r.ok) throw Object.assign(new Error(`chat stream failed: ${r.status}`), { status: r.status });
      const reader = r.body!.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      return new ReadableStream<{ event: string; data: any }>({
        async start(controller) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) { controller.close(); break; }
              buffer += decoder.decode(value, { stream: true });
              const chunks = buffer.split('\n\n');
              buffer = chunks.pop()!;
              for (const chunk of chunks) {
                if (!chunk.trim()) continue;
                const m = chunk.match(/^event: ([^\n]+)\ndata: (.+)$/m);
                if (m) {
                  const event = m[1]!;
                  let data: any;
                  try { data = JSON.parse(m[2].trimStart()); } catch { data = { raw: chunk }; }
                  controller.enqueue({ event, data });
                }
              }
            }
          } catch (err) {
            controller.error(err);
          }
        },
      });
    }) as any;
  },

  async upload(file: File): Promise<{ id: string; url: string; name: string; kind: string }> {
    const { baseUrl } = await resolveConfig();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${baseUrl}/api/v1/uploads`, { method: 'POST', headers: headers(cfg!), body: form });
    if (!res.ok) {
      const text = await res.text();
      throw Object.assign(new Error(`upload failed: ${res.status} ${text}`), { status: res.status });
    }
    const data = await res.json();
    return data as any;
  },

  publicUrl(path: string) {
    return new URL(path, cfg?.baseUrl ?? 'http://127.0.0.1:8787').href;
  },
};
