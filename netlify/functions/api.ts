import { createServerApp } from '../../apps/server/src/app';
import { createKernel } from '../../apps/server/src/kernel';
import {
  MemoryAyaStore,
  SupabaseAyaStore,
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
 * Persistence: Supabase Postgres when configured, otherwise an in-memory store
 * (serverless has no writable SQLite volume). The kernel itself is rebuilt per
 * cold start, so the store is created once per isolate and reused warm.
 */

let appPromise: Promise<{ fetch: (request: Request) => Response | Promise<Response> }> | null = null;
let storeRef: AyaStore | null = null;

async function buildApp() {
  const kernel = createKernel();
  const store = isSupabaseConfigured()
    ? await (async () => {
        const supabaseStore = new SupabaseAyaStore();
        await supabaseStore.hydrate();
        return supabaseStore;
      })()
    : new MemoryAyaStore();
  storeRef = store;
  return createServerApp(kernel, store);
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
  const app = await getApp();
  const response = await app.fetch(normalizeRequest(request));
  // A frozen isolate must not lose a write: wait for the Supabase queue before
  // returning. Streaming (SSE) responses are already handed off at this point.
  await storeRef?.flush?.();
  return response;
}

export const config = { path: '/api/*' };
