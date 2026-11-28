import { createServerApp } from '../../apps/server/src/app';
import { createKernel } from '../../apps/server/src/kernel';
import { MemoryStore, type DataStore } from '@ayatodoist/core-kernel';
import {
  MemoryAyaStore,
  SupabaseAyaStore,
  SupabaseDataStore,
  isSupabaseConfigured,
  type AyaStore,
} from '@ayatodoist/database';

/**
 * Netlify Functions v2 handler for the whole Hono API.
 *
 * The function is registered for `path = "/api/*"` directly, so every
 * `/api/v1/*` and `/api/aya/*` route runs on Netlify exactly as it does
 * locally. All server env vars stay inside this function: `apps/web` is a
 * static bundle and never sees the Supabase service key, the model API keys or
 * `API_KEY`.
 *
 * Persistence: in production (`NETLIFY=true`) Supabase Postgres is mandatory.
 * The task domain is written through `SupabaseDataStore` and Aya through
 * `SupabaseAyaStore`; there is deliberately no in-memory or `/tmp` fallback.
 * The kernel itself is rebuilt per cold start, so the stores are created once
 * per isolate and reused warm.
 */

type FlushableDataStore = DataStore & { flush?: () => Promise<void> };

let appPromise: Promise<{ fetch: (request: Request) => Response | Promise<Response> }> | null = null;
let dataStoreRef: FlushableDataStore | null = null;
let ayaStoreRef: AyaStore | null = null;

function isNetlifyRuntime(): boolean {
  const flag = (process.env.NETLIFY ?? '').trim().toLowerCase();
  // Functions v2 runs on AWS Lambda; the Lambda markers cover sites where the
  // `NETLIFY` flag is not exposed to the function runtime.
  return (
    flag === 'true' ||
    flag === '1' ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.LAMBDA_TASK_ROOT)
  );
}

async function buildApp() {
  const configured = isSupabaseConfigured();

  if (isNetlifyRuntime() && !configured) {
    throw new Error(
      'Supabase is required in production: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. ' +
        'Refusing to start with in-memory or ephemeral /tmp storage.',
    );
  }

  const dataStore: FlushableDataStore = configured
    ? await (async () => {
        const supabase = new SupabaseDataStore();
        await supabase.hydrate();
        return supabase;
      })()
    : new MemoryStore();

  const ayaStore: AyaStore = configured
    ? await (async () => {
        const supabase = new SupabaseAyaStore();
        await supabase.hydrate();
        return supabase;
      })()
    : new MemoryAyaStore();

  dataStoreRef = dataStore;
  ayaStoreRef = ayaStore;

  const kernel = createKernel(dataStore);
  return createServerApp(kernel, ayaStore);
}

function getApp() {
  appPromise ??= buildApp();
  return appPromise;
}

/**
 * Normalize the incoming request URL so both the direct `/api/*` path and the
 * function URL `/.netlify/functions/api/*` resolve identically on the Hono app.
 */
function normalizeRequest(request: Request): Request {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/.netlify/functions/api')) {
    url.pathname = url.pathname.replace('/.netlify/functions/api', '/api');
    return new Request(url, request);
  }
  return request;
}

export default async function handler(request: Request): Promise<Response> {
  try {
    const app = await getApp();
    const response = await app.fetch(normalizeRequest(request));
    // A frozen isolate must not lose a write: wait for both Supabase queues
    // before returning. Streaming (SSE) responses are already handed off.
    await dataStoreRef?.flush?.();
    await ayaStoreRef?.flush?.();
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const configurationError = /Supabase is required|Supabase hydrate failed|is not configured/i.test(message);
    console.error('[netlify/api]', message);
    return Response.json(
      { ok: false, error: { code: configurationError ? 'configuration' : 'error', message } },
      { status: configurationError ? 503 : 500 },
    );
  }
}

export const config = { path: '/api/*' };
