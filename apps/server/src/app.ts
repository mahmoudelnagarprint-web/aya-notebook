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
        post: {
          operationId: 'createTask',
          summary: 'Create a task (camelCase or snake_case payload; persists to Supabase)',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: {
            '201': { description: 'Persisted task' },
            '400': { description: 'Validation error' },
          },
        },
      },
      '/api/v1/projects': {
        get: { operationId: 'listProjects', responses: { '200': { description: 'Project list' } } },
        post: {
          operationId: 'createProject',
          summary: 'Create a project (camelCase or snake_case payload; persists to Supabase)',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: {
            '201': { description: 'Persisted project' },
            '400': { description: 'Validation error' },
          },
        },
      },
      '/api/v1/sync': {
        post: {
          operationId: 'sync',
          summary: 'Replay queued kernel commands (offline queue)',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
          responses: { '200': { description: 'Per-operation results' } },
        },
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

/* ------------------------------------------------------- REST write helpers */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readFirst(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) return source[key];
  }
  return undefined;
}

function readString(source: Record<string, unknown>, keys: string[]): string | undefined {
  const value = readFirst(source, keys);
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function readNumber(source: Record<string, unknown>, keys: string[]): number | undefined {
  const value = readFirst(source, keys);
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readBoolean(source: Record<string, unknown>, keys: string[]): boolean | undefined {
  const value = readFirst(source, keys);
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return undefined;
}

function readDay(source: Record<string, unknown>, keys: string[]): string | undefined {
  const text = readString(source, keys);
  const match = text ? /^(\d{4}-\d{2}-\d{2})/.exec(text) : null;
  return match?.[1];
}

function readTime(source: Record<string, unknown>, keys: string[]): string | undefined {
  const text = readString(source, keys);
  const match = text ? /^([01]\d|2[0-3]):([0-5]\d)/.exec(text) : null;
  return match ? `${match[1]}:${match[2]}` : undefined;
}

function projectPayload(body: Record<string, unknown>): Record<string, unknown> {
  return {
    id: readString(body, ['id']),
    name: readString(body, ['name', 'title']),
    color: readString(body, ['color']),
    parentId: readString(body, ['parentId', 'parent_id']),
    orderKey: readString(body, ['orderKey', 'order_key']),
    isFavorite: readBoolean(body, ['isFavorite', 'is_favorite']),
    isArchived: readBoolean(body, ['isArchived', 'is_archived']),
    isInbox: readBoolean(body, ['isInbox', 'is_inbox']),
    layout: readString(body, ['layout']),
  };
}

function taskPayload(body: Record<string, unknown>): Record<string, unknown> {
  const rawLabels = readFirst(body, ['labelNames', 'label_names', 'labels']);
  const rawAttachments = readFirst(body, ['attachments']);
  return {
    id: readString(body, ['id']),
    content: readString(body, ['content', 'title', 'name']),
    projectId: readString(body, ['projectId', 'project_id']),
    projectName: readString(body, ['projectName', 'project_name']),
    sectionId: readString(body, ['sectionId', 'section_id']),
    parentId: readString(body, ['parentId', 'parent_id']),
    description: readString(body, ['description', 'notes']),
    priority: readNumber(body, ['priority']),
    dueDate: readDay(body, ['dueDate', 'due_date']),
    dueTime: readTime(body, ['dueTime', 'due_time']),
    deadline: readDay(body, ['deadline']),
    durationMinutes: readNumber(body, ['durationMinutes', 'duration_minutes']),
    recurrence: readFirst(body, ['recurrence']),
    labelNames: Array.isArray(rawLabels) ? rawLabels.map((label) => String(label)) : undefined,
    orderKey: readString(body, ['orderKey', 'order_key']),
    attachments: Array.isArray(rawAttachments) ? rawAttachments.map((item) => String(item)) : undefined,
    isCompleted: readBoolean(body, ['isCompleted', 'is_completed', 'completed']),
  };
}

function writeFailure(c: { json: (body: unknown, status: 400) => Response }, error: unknown): Response {
  const typed = error as { code?: string; message?: string; name?: string };
  // Zod errors raised inside a command handler are client validation failures,
  // not server faults; without this they surfaced as HTTP 500.
  const validation = typed.code === 'validation' || typed.name === 'ZodError';
  const status = validation ? 400 : typed.code === 'not-found' ? 404 : typed.code === 'permission' ? 403 : 500;
  return c.json(
    {
      ok: false,
      error: {
        code: validation ? 'validation' : (typed.code ?? 'error'),
        message: typed.message ?? 'Write failed',
      },
    },
    status as 400,
  );
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

  // A write-behind Postgres store (SupabaseDataStore) must reach the database
  // before the response leaves the isolate. MemoryStore has no flush, so this is
  // a no-op locally.
  const persistentStore = kernel.store as typeof kernel.store & { flush?: () => Promise<void> };
  app.use('*', async (c, next) => {
    await next();
    await persistentStore.flush?.();
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

  /**
   * REST writes for external agents. Both endpoints accept camelCase and the
   * snake_case shape that a Supabase/PostgREST client naturally sends
   * (`project_id`, `due_date`, `title`, …), validate references against the
   * hydrated store, and return the persisted row (not just a command ack).
   */
  app.post('/api/v1/projects', async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = asRecord(await c.req.json());
    } catch {
      body = {};
    }
    const input = projectPayload(body);
    if (!input.name) {
      return c.json({ ok: false, error: { code: 'validation', message: 'Project name (name or title) is required' } }, 400);
    }
    try {
      const project = await kernel.execute<unknown, Record<string, unknown>>('project.create', input as never);
      return c.json({ ok: true, project }, 201);
    } catch (error) {
      return writeFailure(c, error);
    }
  });

  app.post('/api/v1/tasks', async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = asRecord(await c.req.json());
    } catch {
      body = {};
    }
    const input = taskPayload(body);
    if (!input.content) {
      return c.json({ ok: false, error: { code: 'validation', message: 'Task content (content, title or name) is required' } }, 400);
    }

    // A dangling section/parent id would violate a Postgres foreign key and turn
    // a perfectly valid task write into a 500. Drop only the broken reference.
    if (typeof input.sectionId === 'string' && !kernel.store.get('sections', input.sectionId)) input.sectionId = null;
    if (typeof input.parentId === 'string' && !kernel.store.get('tasks', input.parentId)) input.parentId = null;

    // `labels` may be ids or names; the command resolves names and creates
    // missing labels, so map known ids back to their names first.
    if (Array.isArray(input.labelNames)) {
      input.labelNames = (input.labelNames as unknown[]).map((value) => {
        const text = String(value);
        const label = kernel.store.get('labels', text);
        return label?.name ?? text;
      });
    }

    try {
      const created = await kernel.execute<unknown, { id: string }>('task.create', input as never);
      const task = kernel.store.get('tasks', created.id) ?? created;
      return c.json({ ok: true, task }, 201);
    } catch (error) {
      return writeFailure(c, error);
    }
  });

  /**
   * Command replay for the web client's offline queue. Operations are applied in
   * order through the same kernel as `/api/v1/command/:name`, so a Supabase
   * deployment persists every mutation before the request returns.
   */
  app.post('/api/v1/sync', async (c) => {
    let body: Record<string, unknown> = {};
    try {
      body = asRecord(await c.req.json());
    } catch {
      body = {};
    }
    const operations = Array.isArray(body.operations)
      ? body.operations
      : Array.isArray(body.commands)
        ? body.commands
        : [];
    const results: Array<{ id: string; ok: boolean; result?: unknown; error?: string }> = [];
    for (const raw of operations) {
      const operation = asRecord(raw);
      const id = typeof operation.id === 'string' ? operation.id : `op-${results.length}`;
      const name = typeof operation.name === 'string' ? operation.name : '';
      if (!name) {
        results.push({ id, ok: false, error: 'Missing command name' });
        continue;
      }
      const actor = operation.actor === 'ai' || operation.actor === 'system' ? operation.actor : 'user';
      try {
        const result = await kernel.execute(name, (operation.input ?? {}) as never, {
          actor,
          batchId: typeof operation.batchId === 'string' ? operation.batchId : undefined,
        });
        results.push({ id, ok: true, result });
      } catch (error) {
        results.push({ id, ok: false, error: (error as Error).message });
      }
    }
    const snapshot = kernel.snapshot();
    return c.json({
      ok: results.every((result) => result.ok),
      cursor: new Date().toISOString(),
      serverTime: new Date().toISOString(),
      results,
      deltas: [],
      activity: snapshot.collections.activity ?? [],
      collections: snapshot.collections,
    });
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
