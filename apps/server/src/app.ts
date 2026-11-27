import { Hono } from 'hono';
import type { Kernel } from '@ayatodoist/core-kernel';
import { SqliteAyaStore } from '@ayatodoist/database';
import { handleUploads } from './uploads';
import { AyaService } from './aya-service';
import { createAyaApi } from './aya-api';

/**
 * Origins allowed to talk to the local API: the web app on loopback, the
 * Electron shell (file://) and browser extensions.
 *
 * Extensions are the reason this list is prefix-based: Chrome derives a
 * per-install id, so `chrome-extension://<id>` can never be enumerated ahead of
 * time. Firefox/Safari use the `extension://` scheme.
 */
const ALLOWED_ORIGIN_PREFIXES = [
  'chrome-extension://',
  'extension://',
  'moz-extension://',
  'safari-web-extension://',
  'http://127.0.0.1',
  'http://localhost',
  'https://127.0.0.1',
  'https://localhost',
  'file://',
];

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  if (origin === 'null') return true;
  return ALLOWED_ORIGIN_PREFIXES.some((prefix) => origin.startsWith(prefix));
}

function corsHeaders(origin: string | null, requestHeaders?: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin) || !origin) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': requestHeaders || 'content-type, authorization',
    'access-control-max-age': '86400',
    'access-control-expose-headers': 'content-length, x-request-id',
    vary: 'Origin',
  };
}

export function createServerApp(kernel: Kernel, ayaStore?: SqliteAyaStore) {
  const app = new Hono();
  // A standalone app (tests, embedded use) still gets a working Aya API; the
  // server passes its file-backed store so every route shares one database.
  const store = ayaStore ?? new SqliteAyaStore(':memory:');
  const ayaService = new AyaService({ kernel, adapter: store });
  void ayaService.init();

  // CORS for every route, including the preflight itself.
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin') ?? null;
    if (c.req.method === 'OPTIONS') {
      if (!isAllowedOrigin(origin)) return c.body(null, 403);
      return c.body(null, 204, corsHeaders(origin, c.req.header('access-control-request-headers')));
    }
    await next();
    for (const [key, value] of Object.entries(corsHeaders(origin))) c.res.headers.set(key, value);
  });

  // Explicit extension CORS for the Aya API: web (loopback), Chrome/Firefox/Safari
  // extension origins and `file://` are the same allowlist as every other route.
  app.use('/api/aya/*', async (c, next) => {
    const origin = c.req.header('origin') ?? null;
    if (c.req.method === 'OPTIONS') {
      if (!isAllowedOrigin(origin)) return c.body(null, 403);
      return c.body(null, 204, corsHeaders(origin, c.req.header('access-control-request-headers')));
    }
    await next();
    for (const [key, value] of Object.entries(corsHeaders(origin))) c.res.headers.set(key, value);
  });

  app.get('/api/v1/health', (c) => c.json({ ok: true, at: new Date().toISOString() }));

  /**
   * Bootstrap carries the task projection the browser kernel hydrates before its
   * first render. The full snapshot (projects, labels, settings…) is available
   * from /api/v1/snapshot so the first paint stays small.
   */
  app.get('/api/v1/bootstrap', (c) => {
    const collections = kernel.snapshot().collections;
    return c.json({
      ok: true,
      snapshot: {
        version: 1,
        savedAt: new Date().toISOString(),
        collections: { tasks: collections.tasks ?? [] },
      },
    });
  });

  app.get('/api/v1/snapshot', (c) => {
    const snapshot = kernel.snapshot();
    return c.json({ ok: true, snapshot });
  });

  app.post('/api/v1/command/:name', async (c) => {
    const name = c.req.param('name');
    let input: unknown = {};
    try {
      input = await c.req.json();
    } catch {
      input = {};
    }
    try {
      const result = await kernel.execute(name, input as never);
      return c.json({ ok: true, result });
    } catch (error) {
      const typed = error as { code?: string; message?: string };
      const status = typed.code === 'not-found' ? 404 : typed.code === 'validation' ? 400 : 500;
      return c.json({ ok: false, error: { code: typed.code ?? 'error', message: typed.message ?? 'Command failed' } }, status as 400);
    }
  });

  app.route('/api/v1/uploads', handleUploads());

  // Aya: providers, models, routing, settings, conversations, chat + SSE,
  // proactive inbox, memory and channels.
  app.route('/api/aya', createAyaApi({ kernel, store, service: ayaService }));

  app.notFound((c) => c.json({ ok: false, error: { code: 'not-found', message: 'Unknown route' } }, 404));

  app.onError((error, c) => {
    console.error('[server]', error);
    return c.json({ ok: false, error: { code: 'error', message: error.message } }, 500);
  });

  return app;
}
