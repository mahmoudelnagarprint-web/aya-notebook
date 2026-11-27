import { normalizeBaseUrl, providerAuthHeaders, isGoogleGenerative, googleApiRoot, classifyFailure } from './providers';

/**
 * The failover router. One request, an ordered pool of models, and a per-attempt
 * trace so the UI can explain exactly which provider answered and why.
 *
 * Pool order: explicit override → the routed role model → every other checked
 * model, with models that passed their last probe first and failed ones last.
 */

export interface RouterAttempt {
  modelRowId: string;
  ok: boolean;
  status?: number;
  failover?: boolean;
  error?: string;
}

interface ChatOptions {
  role: string;
  routing: Record<string, string | null>;
  models: any[];
  providers: any[];
  messages: any[];
  system?: string;
  tools?: any[];
  /** Explicit model chosen by the user for this turn; always tried first. */
  preferred?: string;
  /** `required` forces the provider to emit a real tool call (anti-hallucination retry). */
  toolChoice?: 'auto' | 'required';
}

function toOpenAiTool(tool: any) {
  return {
    type: 'function',
    function: { name: tool.name, description: (tool.description ?? '').slice(0, 160), parameters: tool.parameters ?? { type: 'object', properties: {} } },
  };
}

function toGeminiTool(tool: any) {
  return {
    name: tool.name,
    description: (tool.description ?? '').slice(0, 160),
    parameters: tool.parameters ?? { type: 'object', properties: {} },
  };
}

export class AyaModelRouter {
  private readonly models: any[];
  private readonly providers: any[];
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: { models: any[]; providers: any[]; fetchImpl?: typeof fetch }) {
    this.models = opts.models ?? [];
    this.providers = opts.providers ?? [];
    this.fetchImpl = opts.fetchImpl;
  }

  /** Ordered failover pool for one role. `preferred` always runs first. */
  pool(role: string, routing: Record<string, string | null>, preferred?: string): Array<{ model: any }> {
    const pinned = preferred ? this.models.find((model) => model.id === preferred) : undefined;
    const ordered: any[] = [];
    const push = (model: any) => {
      if (!model || model.enabled === false) return;
      if (pinned && model.id === pinned.id) return;
      if (ordered.some((entry) => entry.id === model.id)) return;
      ordered.push(model);
    };

    const routed = routing?.[role];
    if (routed) push(this.models.find((model) => model.id === routed));
    for (const model of this.models) {
      if (model.failover !== false) push(model);
    }

    ordered.sort((a, b) => {
      const rank = (model: any) => (model.status === 'ok' ? 0 : model.status === 'failed' ? 2 : 1);
      return rank(a) - rank(b) || (a.priority ?? 0) - (b.priority ?? 0) || String(a.modelId).localeCompare(String(b.modelId));
    });

    // An explicit choice always runs first, whatever its priority or health.
    const pool = pinned ? [pinned, ...ordered] : ordered;
    return pool.map((model) => ({ model }));
  }

  async chat(opts: ChatOptions): Promise<any> {
    const { role, routing, models, providers, messages, system, tools, preferred } = opts;
    const forceTool = opts.toolChoice === 'required' && Boolean(tools?.length);
    const pool = this.pool(role, routing, preferred);
    const fetchImpl = this.fetchImpl ?? globalThis.fetch;
    const attempts: RouterAttempt[] = [];
    let lastError: Error | null = null;

    for (const entry of pool) {
      const model = entry.model;
      const provider = (providers ?? this.providers).find((row) => row.id === model.providerId);
      if (!provider) continue;

      const baseUrl = normalizeBaseUrl(provider.baseUrl);
      const nativeGoogle = isGoogleGenerative(baseUrl);
      const modelId = String(model.modelId ?? '').replace(/^models\//, '');

      let url: string;
      let body: Record<string, unknown>;

      if (nativeGoogle) {
        url = `${googleApiRoot(baseUrl)}/models/${modelId}:generateContent`;
        body = {
          contents: messages
            .filter((message) => message.role !== 'system')
            .map((message) => ({
              role: message.role === 'assistant' ? 'model' : 'user',
              parts: message.content ? [{ text: String(message.content) }] : [],
            })),
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          tools: tools && tools.length ? [{ functionDeclarations: tools.map(toGeminiTool) }] : undefined,
          toolConfig: forceTool ? { functionCallingConfig: { mode: 'ANY' } } : undefined,
        };
      } else {
        url = `${baseUrl}/chat/completions`;
        body = {
          model: modelId,
          messages: messages.map((message) => {
            if (message.role === 'tool') {
              return { role: 'tool', tool_call_id: message.toolCallId ?? message.tool_call_id ?? '', content: String(message.content ?? '') };
            }
            if (message.role === 'assistant' && message.toolCalls?.length) {
              return {
                role: 'assistant',
                content: message.content || null,
                tool_calls: message.toolCalls.map((call: any) => ({
                  id: call.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
                  type: 'function',
                  function: {
                    name: String(call.name ?? '').replace(/\./g, '__'),
                    arguments: JSON.stringify(call.input ?? call.args ?? {}),
                  },
                })),
              };
            }
            return { role: message.role, content: message.content ?? '' };
          }),
          system: system || undefined,
          tools: tools && tools.length ? tools.map(toOpenAiTool) : undefined,
          tool_choice: forceTool ? 'required' : undefined,
        };
      }

      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          // Native Gemini needs `x-goog-api-key`; a Bearer header there is
          // rejected with `401 Expected OAuth 2 access token`.
          headers: { 'content-type': 'application/json', accept: 'application/json', ...providerAuthHeaders(baseUrl, provider.apiKey ?? '') },
          body: JSON.stringify(body),
        });
        const text = await response.text();

        if (!response.ok) {
          attempts.push({ modelRowId: model.id, ok: false, status: response.status, failover: attempts.length > 0, error: text.slice(0, 200) });
          lastError = new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
          if (response.status === 401) throw lastError;
          continue;
        }

        const data = JSON.parse(text) as any;
        const parsed = nativeGoogle ? parseGemini(data) : parseOpenAi(data);
        attempts.push({ modelRowId: model.id, ok: true, status: response.status, failover: attempts.length > 0 });

        return {
          text: parsed.text,
          toolCalls: parsed.toolCalls,
          model: `${provider.name}/${model.modelId}`,
          modelRowId: model.id,
          failover: attempts.length > 1,
          attempts,
        };
      } catch (error) {
        if (error instanceof Error && /^HTTP 401/.test(error.message)) throw error;
        const classified = classifyFailure(error);
        if (classified.status === 401) throw error instanceof Error ? error : new Error(classified.message);
        attempts.push({ modelRowId: model.id, ok: false, status: classified.status, failover: attempts.length > 0, error: classified.message.slice(0, 200) });
        lastError = error instanceof Error ? error : new Error(classified.message);
      }
    }

    throw lastError ?? new Error('No models available');
  }
}

function parseOpenAi(data: any): { text: string; toolCalls: any[] } {
  const message = data?.choices?.[0]?.message ?? {};
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((call: any) => {
        let args: any = call?.function?.arguments ?? {};
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = {};
          }
        }
        return { id: call?.id ?? `call_${Math.random().toString(36).slice(2, 10)}`, name: String(call?.function?.name ?? '').replace(/__/g, '.'), args };
      })
    : [];
  return { text: String(message.content ?? ''), toolCalls };
}

function parseGemini(data: any): { text: string; toolCalls: any[] } {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  let text = '';
  const toolCalls: any[] = [];
  for (const part of parts) {
    if (typeof part?.text === 'string') text += (text ? '\n' : '') + part.text;
    if (part?.functionCall) {
      toolCalls.push({
        id: `call_${Math.random().toString(36).slice(2, 10)}`,
        name: String(part.functionCall.name ?? '').replace(/__/g, '.'),
        args: part.functionCall.args ?? {},
      });
    }
  }
  return { text, toolCalls };
}

/**
 * Stored conversations may contain assistant rows that ran tools whose results
 * were never persisted. Providers reject such history, so every orphaned call is
 * degraded to a readable text note and stray tool rows are dropped.
 */
export function sanitizeToolHistory(messages: any[]): any[] {
  const resultsById = new Map<string, any>();
  for (const message of messages) {
    if (message.role === 'tool' && message.toolCallId) resultsById.set(message.toolCallId, message);
  }

  const cleaned: any[] = [];
  for (const message of messages) {
    if (message.role === 'tool') continue;

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const calls = message.toolCalls as any[];
      const complete = calls.every((call) => call.id && resultsById.has(call.id));
      if (complete) {
        cleaned.push({ ...message });
        for (const call of calls) {
          const result = resultsById.get(call.id);
          cleaned.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: String(result?.content ?? ''),
          });
        }
        continue;
      }
      const names = calls.map((call) => call.name).join('، ');
      cleaned.push({
        role: 'assistant',
        content: message.content ? `${message.content}\n\n[الأدوات المنفذة سابقاً: ${names}]` : `[الأدوات المنفذة سابقاً: ${names}]`,
      });
      continue;
    }

    cleaned.push({ ...message });
  }
  return cleaned;
}

export const ToolSpec = 0;
export function routerCall(_call: any): void {}
