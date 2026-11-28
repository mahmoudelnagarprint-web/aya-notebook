import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * One service-role client per process. The service role key is server-only:
 * never import this module from `apps/web` or any browser bundle.
 */

let cached: { key: string; client: SupabaseClient } | null = null;

export interface SupabaseEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
}

export function isSupabaseConfigured(env: SupabaseEnv = process.env): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

/** Normalised base URL (no trailing slash) or `null` when Supabase is unset. */
export function supabaseUrl(env: SupabaseEnv = process.env): string | null {
  const url = env.SUPABASE_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

export function getSupabaseAdmin(env: SupabaseEnv = process.env): SupabaseClient {
  const url = supabaseUrl(env);
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('Supabase is not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  const cacheKey = `${url}::${key.slice(-8)}`;
  if (cached && cached.key === cacheKey) return cached.client;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'ayatodoist' } },
  });
  cached = { key: cacheKey, client };
  return client;
}

/** Public URL of an object in the public `uploads` bucket. */
export function publicUploadUrl(filename: string, env: SupabaseEnv = process.env): string | null {
  const base = supabaseUrl(env);
  if (!base) return null;
  return `${base}/storage/v1/object/public/uploads/${encodeURIComponent(filename)}`;
}
