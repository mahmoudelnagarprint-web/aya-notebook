import { Hono } from 'hono';
import type { Kernel } from '@ayatodoist/core-kernel';
import { MemoryAyaStore, type AyaStore } from '@ayatodoist/database';
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

/** Routes that stay reachable without an API key (liveness + agent discovery). */
const API_KEY_OPEN_PATHS = new Set(['/api/v1/health', '/api/v1/openapi.json']);

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
    'access-control-allow-headers': requestHeaders || 'content-type, authorization, x-api-key',
    'access-control-max-age': '86400',
    'access-control-expose-headers': 'content-length, x-request-id',
    vary: 'Origin',
  };
}

/** Length-independent string comparison so key checks do not leak timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function requestPath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** A browser request coming from the app's own origin (never needs a key). */
function isSameOriginRequest(c: { req: { header: (name: string) => string | undefined; url: string } }): boolean {
  if (c.req.header('sec-fetch-site') === 'same-origin') return true;
  const origin = c.req.header('origin');
  if (!origin) return false;
  let requestHost = c.req.header('host') ?? '';
  if (!requestHost) {
    try {
      requestHost = new URL(c.req.url).host;
    } catch {
      return false;
    }
  }
  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

function openApiDocument(origin: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Aya Todoist API',
      version: '1.0.0',
      description:
        'Task, upload and Aya (AI agent) API. External agents authenticate with `Authorization: Bearer <API_KEY>` or `x-api-key: <API_KEY>`.',
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      },
      schemas: {
        Task: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            projectId: { type: 'string' },
            content: { type: 'string' },
            description: { type: 'string' },
            priority: { type: 'integer' },
            dueDate: { type: 'string', nullable: true },
            isCompleted: { type: 'boolean' },
          },
        },
        Snapshot: { type: 'object', properties: { version: { type: 'integer' }, collections: { type: 'object' } } },
        Error: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'object' } } },
      },
    },
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    paths: {
      '/api/v1/health': {
        get: { operationId: 'health', summary: 'Liveness probe', security: [], responses: { '200': { description: 'ok' } } },
      },
      '/api/v1/openapi.json': {
        get: {
          operationId: 'openapi',
          summary: 'This document — for external agent auto-discovery',
          security: [],
          responses: { '200': { description: 'OpenAPI document' } },
        },
      },
      '/api/v1/snapshot': {
        get: {
          operationId: 'getSnapshot',
          summary: 'Full kernel snapshot (projects, tasks, labels, settings…)',
          responses: { '200': { description: 'Snapshot' } },
        },
      },
      '/api/v1/bootstrap': {
        get: { operationId: 'getBootstrap', summary: 'Small task projection for first paint', responses: { '200': { description: 'Snapshot' } } },
      },
      '/api/v1/command/{name}': {
        post: {
          operationId: 'executeCommand',
          summary: 'Execute a kernel command (task.create, task.complete, …)',
          parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: { required: false, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: {
            '200': { description: 'Command result' },
            '400': { description: 'Validation error' },
            '404': { description: 'Unknown command' },
          },
        },
      },
      '/api/v1/uploads': {
        post: {
          operationId: 'uploadFile',
          summary: 'Upload an image/text/PDF (multipart `file`, raw body or JSON base64)',
          requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
          responses: { '200': { description: 'Uploaded file with public URL' } },
        },
      },
      '/api/v1/uploads/{filename}': {
        get: {
          operationId: 'getUpload',
          parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'File bytes' }, '404': { description: 'Not found' } },
        },
        delete: {
          operationId: 'deleteUpload',
          parameters: [{ name: 'filename', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Deleted' } },
        },
      },
      '/api/v1/tasks': {
        get: {
          operationId: 'listTasks',
          summary: 'Tasks from the live snapshot',
          parameters: [
            { name: 'projectId', in: 'query', schema: { type: 'string' } },
            { name: 'completed', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { '200': { description: 'Task list' } },
        },
      },
      '/api/v1/projects': {
        get: { operationId: 'listProjects', responses: { '200': { description: 'Project list' } } },
      },
      '/api/aya/health': { get: { operationId: 'ayaHealth', responses: { '200': { description: 'Aya status' } } } },
      '/api/aya/config': { get: { operationId: 'ayaConfig', responses: { '200': { description: 'Aya configuration' } } } },
      '/api/aya/chat': {
        post: {
          operationId: 'ayaChat',
          summary: 'Send a message to Aya and get the full turn',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['text'],
                  properties: {
                    text: { type: 'string' },
                    conversationId: { type: 'string' },
                    language: { type: 'string', enum: ['ar', 'en'] },
                    modelId: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Turn result' } },
        },
      },
      '/api/aya/conversations': {
        get: { operationId: 'listConversations', responses: { '200': { description: 'Conversations' } } },
        post: { operationId: 'createConversation', responses: { '200': { description: 'Conversation' } } },
      },
      '/api/aya/health-check/run': {
        post: {
          operationId: 'runHealthCheck',
          summary: 'Re-probe every configured model (the serverless replacement for the background loop)',
          responses: { '200': { description: 'Probe summary' } },
        },
      },
      '/api/aya/inbox': { get: { operationId: 'ayaInbox', responses: { '200': { description: 'Proactive inbox' } } } },
      '/api/aya/memories': {
        get: { operationId: 'listMemories', responses: { '200': { description: 'Memories' } } },
        post: { operationId: 'createMemory', responses: { '200': { description: 'Memory' } } },
      },
    },
  };
}

export async function createServerApp(kernel: Kernel, ayaStore?: AyaStore) {
  const app = new Hono();
  // A standalone app (tests, serverless boot) still gets a working Aya API; the
  // Node server passes its configured store so every route shares one backend.
  const store: AyaStore = ayaStore ?? new MemoryAyaStore();
  const ayaService = new AyaService({ kernel, adapter: store });
  void ayaService.init().then(() => {
    // A serverless platform freezes between requests, so a periodic timer would
    // never be dependable: Netlify relies on POST /api/aya/health-check/run.
    if (process.env.NETLIFY !== 'true') ayaService.startHealthChecks();
  });

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

  /**
   * Optional API-key gate for `/api/*`. Enabled only when `API_KEY` is set.
   * Open: health, the OpenAPI document, and same-origin requests from the web UI
   * (the browser app works with no key). Everything else needs
   * `Authorization: Bearer <API_KEY>` or `x-api-key: <API_KEY>`.
   */
  app.use('/api/*', async (c, next) => {
    const apiKey = process.env.API_KEY?.trim();
    if (!apiKey) return next();
    if (API_KEY_OPEN_PATHS.has(requestPath(new URL(c.req.url).pathname))) return next();
    if (isSameOriginRequest(c)) return next();

    const authorization = c.req.header('authorization') ?? '';
    const bearer = /^bearer\s+/i.test(authorization) ? authorization.replace(/^bearer\s+/i, '').trim() : '';
    const provided = bearer || (c.req.header('x-api-key') ?? '').trim();
    if (provided && safeEqual(provided, apiKey)) return next();

    return c.json(
      { ok: false, error: { code: 'unauthorized', message: 'Missing or invalid API key' } },
      401,
    );
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

  app.get('/api/v1/openapi.json', (c) => {
    let origin = c.req.header('origin') ?? '';
    if (!origin) {
      try {
        const url = new URL(c.req.url);
        origin = `${url.protocol}//${url.host}`;
      } catch {
        origin = '';
      }
    }
    return c.json(openApiDocument(origin));
  });

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

  /** Convenience read models for external agents: plain arrays of tasks/projects. */
  app.get('/api/v1/tasks', (c) => {
    const tasks = (kernel.snapshot().collections.tasks ?? []) as Array<Record<string, unknown>>;
    const projectId = c.req.query('projectId');
    const completedParam = c.req.query('completed');
    const completed = completedParam === undefined ? undefined : completedParam === 'true' || completedParam === '1';
    const filtered = tasks.filter((task) => {
      if (projectId && task.projectId !== projectId) return false;
      if (completed !== undefined && Boolean(task.isCompleted) !== completed) return false;
      return true;
    });
    return c.json({ ok: true, tasks: filtered, count: filtered.length });
  });

  app.get('/api/v1/projects', (c) => {
    const projects = (kernel.snapshot().collections.projects ?? []) as unknown[];
    return c.json({ ok: true, projects, count: projects.length });
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
