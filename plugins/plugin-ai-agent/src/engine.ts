import { commandsForAgent, buildToolSpecs, type ToolSpec } from './commands-for-agent';
import type { Kernel } from '@ayatodoist/core-kernel';

export { buildToolSpecs };

export interface AgentConfig {
  provider: 'openai' | 'ollama' | 'gemini' | string;
  baseUrl: string;
  model: string;
  autonomy: 'full' | 'safe' | 'read-only';
  maxSteps: number;
  temperature: number;
  autoApproveBatch: boolean;
  apiKey?: string;
}

export interface AgentPendingAction {
  name: string;
  input: Record<string, unknown>;
  toolCallId: string;
}

export interface RunAgentOptions {
  kernel: Kernel;
  agent: AgentConfig;
  apiKey: string;
  history: Array<{ role: string; content: string }>;
  userText: string;
  onEvent?: (event: { type: string; [key: string]: unknown }) => void;
  fetchImpl?: typeof fetch;
}

export interface RunAgentResult {
  text: string;
  pending: AgentPendingAction[];
  messages: any[];
}

function toProviderTool(tool: ToolSpec) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * Standalone provider-agnostic agent loop (used by the extension and any
 * non-server client). Destructive calls stop for approval when the agent is in
 * `safe` autonomy; everything else runs through the same CommandBus.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { kernel, agent, apiKey, history, userText, onEvent } = options;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const tools = commandsForAgent(kernel);
  const byProviderName = new Map(tools.map((entry) => [entry.tool.name, entry]));

  let messages: any[] = [
    ...history.filter((message) => message.role === 'user' || message.role === 'assistant' || message.role === 'system'),
    { role: 'user', content: userText },
  ];

  const maxSteps = Math.max(1, agent.maxSteps || 4);
  const pending: AgentPendingAction[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await fetchImpl(`${agent.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey.replace(/^bearer\s+/i, '').trim()}` } : {}),
      },
      body: JSON.stringify({
        model: agent.model,
        temperature: agent.temperature,
        messages,
        tools: tools.map((entry) => toProviderTool(entry.tool)),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Agent provider failed: HTTP ${response.status} ${text.slice(0, 200)}`);
    }

    const payload = (await response.json()) as any;
    const message = payload?.choices?.[0]?.message ?? {};
    const rawCalls: any[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const content = String(message.content ?? '');

    if (rawCalls.length === 0) {
      onEvent?.({ type: 'done' });
      return { text: content, pending, messages };
    }

    messages = [
      ...messages,
      {
        role: 'assistant',
        content,
        tool_calls: rawCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.function?.name, arguments: call.function?.arguments ?? '{}' },
        })),
      },
    ];

    for (const call of rawCalls) {
      const providerName = String(call.function?.name ?? '');
      const entry = byProviderName.get(providerName);
      if (!entry) continue;

      let input: Record<string, unknown> = {};
      try {
        input = typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments) : (call.function?.arguments ?? {});
      } catch {
        input = {};
      }

      if (agent.autonomy === 'safe' && entry.destructive) {
        pending.push({ name: entry.tool.originalName, input, toolCallId: call.id });
        continue;
      }

      onEvent?.({ type: 'tool-start', name: entry.tool.originalName, toolCallId: call.id });
      let result: unknown;
      try {
        result = await entry.handler(input);
        onEvent?.({ type: 'tool-result', name: entry.tool.originalName, toolCallId: call.id, ok: true });
      } catch (error) {
        result = { error: (error as Error).message };
        onEvent?.({ type: 'tool-result', name: entry.tool.originalName, toolCallId: call.id, ok: false });
      }

      messages = [
        ...messages,
        { role: 'tool', tool_call_id: call.id, name: providerName, content: JSON.stringify(result) },
      ];
    }

    if (pending.length > 0) {
      onEvent?.({ type: 'done' });
      return { text: content, pending, messages };
    }
  }

  onEvent?.({ type: 'done' });
  const lastText = [...messages].reverse().find((message) => message.role === 'assistant')?.content ?? '';
  return { text: String(lastText), pending, messages };
}

export function providerPresets() {
  return [
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', needsKey: true },
    { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', needsKey: true },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat', needsKey: true },
    { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3', needsKey: false },
  ];
}

export function toolFn(_tool: any): void {}
