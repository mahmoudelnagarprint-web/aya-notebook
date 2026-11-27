import type { AyaAttachment, AyaModel } from '@ayatodoist/shared-types';

/**
 * Universal OpenAI-compatible provider helpers.
 *
 * Every modern provider (OpenRouter, DeepSeek, Gemini's OpenAI-compat layer,
 * Ollama, Kaggle/vLLM, Groq, Together, LM Studio…) speaks `GET /v1/models` and
 * `POST /v1/chat/completions`. Aya only needs those two calls, so adding a
 * provider is just a name + base URL + key.
 */

export class AyaProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'AyaProviderError';
  }
}

/** Strips trailing slashes and appends `/v1` only when no path was given. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    if (url.pathname === '' || url.pathname === '/') return `${url.origin}/v1`;
    return trimmed;
  } catch {
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
  }
}

/**
 * Keys arrive from copy/paste, .env files and account UIs, so they routinely
 * carry invisible characters, wrapping quotes or a duplicated `Bearer ` prefix.
 * One normaliser is used on save *and* before every header so a key can never
 * end up as `Bearer Bearer sk-…`.
 */
export function cleanApiKey(raw: string | null | undefined): string {
  let key = String(raw ?? '')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .trim();
  // Alternate quote-unwrapping and Bearer stripping: the pasted value can be
  // a quoted Bearer line, a quoted raw key, or even a doubled Bearer prefix.
  for (let i = 0; i < 4; i += 1) {
    const before = key;
    if (key.length >= 2) {
      const first = key[0];
      const last = key[key.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) key = key.slice(1, -1).trim();
    }
    key = key.replace(/^bearer\s+/i, '').trim();
    if (key === before) break;
  }
  return key;
}

export function authHeaders(apiKey: string | null | undefined): Record<string, string> {
  const key = cleanApiKey(apiKey);
  return key ? { authorization: `Bearer ${key}` } : {};
}

/** Google's native Gemini API lives on this host (with or without `/openai`). */
export function isGoogleGenerative(baseUrl: string | null | undefined): boolean {
  return /generativelanguage\.googleapis\.com/i.test(String(baseUrl ?? ''));
}

/**
 * Native Gemini root: `…/v1beta/openai` → `…/v1beta`, `…/v1` stays `…/v1`.
 * `:generateContent` and `/models` both hang off this root.
 */
export function googleApiRoot(rawBaseUrl: string): string {
  return normalizeBaseUrl(rawBaseUrl).replace(/\/openai\/?$/i, '');
}

/**
 * Per-provider auth headers.
 *
 * Google's native endpoint rejects `Authorization: Bearer <key>` with
 * `401 Expected OAuth 2 access token`; it only accepts `x-goog-api-key`. Every
 * other provider keeps the OpenAI-compatible Bearer header.
 */
export function providerAuthHeaders(baseUrl: string | null | undefined, apiKey: string | null | undefined): Record<string, string> {
  const key = cleanApiKey(apiKey);
  if (!key) return {};
  if (isGoogleGenerative(baseUrl)) return { 'x-goog-api-key': key };
  return { authorization: `Bearer ${key}` };
}

/** Turns an OpenAI-style error body into a short, human-readable diagnostic. */
export function describeProviderFailure(status: number, bodyText: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText) as { error?: unknown; message?: string };
    const error = parsed.error;
    if (typeof error === 'string') detail = error;
    else if (error && typeof error === 'object') {
      const typed = error as { code?: string; message?: string; type?: string };
      detail = [typed.code, typed.message].filter(Boolean).join(': ');
      if (!detail) detail = typed.type ?? '';
    }
    if (!detail) detail = parsed.message ?? '';
  } catch {
    detail = bodyText.replace(/\s+/g, ' ').trim();
  }
  detail = detail.replace(/\s+/g, ' ').slice(0, 200);
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
}

const RETRYABLE_STATUS = new Set([402, 408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status) || status >= 500;
}

function quotaish(message: string): boolean {
  return /(quota|credit|rate.?limit|too many requests|insufficient|exceeded|capacity)/i.test(message);
}

export function classifyFailure(error: unknown): { retryable: boolean; message: string; status: number } {
  if (error instanceof AyaProviderError) {
    return { retryable: error.retryable, message: error.message, status: error.status };
  }
  const typed = error as { name?: string; message?: string };
  const message = typed?.message ?? String(error);
  if (typed?.name === 'AbortError' || /timeout|timed out|aborted/i.test(message)) {
    return { retryable: true, message, status: 0 };
  }
  if (typed?.name === 'TypeError' || /fetch failed|network|ECONN|ENOTFOUND|socket/i.test(message)) {
    return { retryable: true, message, status: 0 };
  }
  return { retryable: quotaish(message), message, status: 0 };
}

function scopedTimeout(ms: number, signal?: AbortSignal): { signal: AbortSignal; release: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timeout after ${ms}ms`)), ms);
  const forward = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', forward, { once: true });
  }
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
}

export interface FetchModelsOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface FetchedModel {
  modelId: string;
  label: string;
  contextWindow: number | null;
  vision: boolean;
}

/** `GET {baseUrl}/models` — imports every model the endpoint advertises. */
export async function fetchProviderModels(options: FetchModelsOptions): Promise<{ models: FetchedModel[]; latencyMs: number }> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) throw new AyaProviderError('Base URL is required', 0, false);
  const fetchImpl = options.fetchImpl ?? fetch;
  const google = isGoogleGenerative(baseUrl);
  const endpoint = google ? `${googleApiRoot(baseUrl)}/models` : `${baseUrl}/models`;
  const { signal, release } = scopedTimeout(options.timeoutMs ?? 20_000);
  const started = performance.now();
  try {
    const response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json', ...providerAuthHeaders(baseUrl, options.apiKey) },
      signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new AyaProviderError(
        describeProviderFailure(response.status, text),
        response.status,
        isRetryableStatus(response.status),
        text.slice(0, 300),
      );
    }
    type RawModel = {
      id?: string;
      name?: string;
      displayName?: string;
      context_length?: number;
      context_window?: number;
      inputTokenLimit?: number;
      supportedGenerationMethods?: string[];
      architecture?: { input_modalities?: string[] };
    };
    const payload = JSON.parse(text) as { data?: RawModel[]; models?: RawModel[] };
    const models: FetchedModel[] = [];
    if (google) {
      // Native shape: { models: [{ name: 'models/gemini-2.5-flash', … }] }.
      for (const entry of payload.models ?? []) {
        const modelId = String(entry.name ?? '').replace(/^models\//, '');
        if (!modelId) continue;
        const methods = entry.supportedGenerationMethods;
        if (Array.isArray(methods) && !methods.includes('generateContent')) continue;
        models.push({
          modelId,
          label: entry.displayName ?? modelId,
          contextWindow: entry.inputTokenLimit ?? estimateContextWindow(modelId),
          vision: detectVision(modelId),
        });
      }
    } else {
      for (const entry of payload.data ?? payload.models ?? []) {
        const modelId = entry.id ?? entry.name;
        if (!modelId) continue;
        models.push({
          modelId,
          label: entry.name ?? modelId,
          contextWindow: entry.context_length ?? entry.context_window ?? estimateContextWindow(modelId),
          vision: detectVision(modelId) || (entry.architecture?.input_modalities?.includes('image') ?? false),
        });
      }
    }
    models.sort((a, b) => a.modelId.localeCompare(b.modelId));
    return { models, latencyMs: Math.round(performance.now() - started) };
  } finally {
    release();
  }
}

/** Fast live health probe: one-token completion, measured end to end. */
export async function probeModel(options: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const google = isGoogleGenerative(baseUrl);
  const modelId = String(options.modelId ?? '').replace(/^models\//, '');
  const url = google
    ? `${googleApiRoot(baseUrl)}/models/${modelId}:generateContent`
    : `${baseUrl}/chat/completions`;
  const body = google
    ? { contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 16 } }
    : { model: modelId, messages: [{ role: 'user', content: 'ping' }], max_tokens: 16, stream: false };
  const { signal, release } = scopedTimeout(options.timeoutMs ?? 25_000);
  const started = performance.now();
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...providerAuthHeaders(baseUrl, options.apiKey) },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) {
      return { ok: false, latencyMs, error: describeProviderFailure(response.status, text) };
    }
    return { ok: true, latencyMs };
  } catch (error) {
    return { ok: false, latencyMs: Math.round(performance.now() - started), error: (error as Error).message };
  } finally {
    release();
  }
}

export function detectVision(modelId: string): boolean {
  return /(gpt-4o|gpt-4\.1|gpt-5|o3|o4|gemini|claude-3|claude-4|sonnet|opus|vision|llava|pixtral|qwen.*vl|gemma3|internvl|minicpm-v)/i.test(
    modelId,
  );
}

export function estimateContextWindow(modelId: string): number | null {
  const id = modelId.toLowerCase();
  if (/(128k|gpt-4o|gpt-4\.1|gpt-5|claude|sonnet|opus)/.test(id)) return 128_000;
  if (/gemini/.test(id)) return 1_000_000;
  if (/(32k|qwen|deepseek|mistral|mixtral)/.test(id)) return 32_000;
  if (/(8b|7b|3b|1\.5b|mini|nano|tiny)/.test(id)) return 8_192;
  if (/(llama|70b|72b|405b)/.test(id)) return 32_768;
  return null;
}

/** Removes any accidental echo of the secret from an error we plan to persist. */
export function redactSecret(message: string, apiKey: string | null | undefined): string {
  const key = cleanApiKey(apiKey);
  if (!key || key.length < 6) return message;
  return message.split(key).join('••••');
}

export interface MeasuredModel extends AyaModel {
  providerName: string;
  baseUrl: string;
}

/** Reads image bytes as a data URL for multimodal (vision) messages. */
export function toDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

export type AyaImagePart = { name: string; dataUrl: string; attachment?: AyaAttachment };
