import { afterEach, describe, expect, test } from 'bun:test';
import { Kernel, MemoryStore } from '@ayatodoist/core-kernel';
import { tasksCorePlugin } from '@ayatodoist/plugin-tasks-core';
import { runAgent, buildToolSpecs, providerPresets } from '@ayatodoist/plugin-ai-agent/engine';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function boot(): Kernel {
  const kernel = new Kernel({ store: new MemoryStore() });
  kernel.installAll([tasksCorePlugin] as never);
  kernel.start();
  return kernel;
}

const agent = {
  provider: 'openai' as const,
  baseUrl: 'https://example.invalid/v1',
  model: 'test-model',
  autonomy: 'full' as const,
  maxSteps: 4,
  temperature: 0,
  autoApproveBatch: false,
};

describe('agent tool loop', () => {
  test('every kernel command is exposed as a sanitized tool', async () => {
    const kernel = boot();
    const tools = buildToolSpecs(kernel);
    const create = tools.find((tool) => tool.originalName === 'task.create');
    expect(create).toBeDefined();
    expect(create!.name).toBe('task__create');
    expect(create!.parameters).toMatchObject({ type: 'object' });
    expect(tools.some((tool) => tool.name.includes('.'))).toBe(false);
    expect(providerPresets().some((preset) => preset.id === 'ollama' && !preset.needsKey)).toBe(true);
  });

  test('executes tool calls through the CommandBus and feeds results back', async () => {
    const kernel = boot();
    await kernel.execute('project.ensureInbox', {});
    const calls: Array<{ body: unknown }> = [];
    let round = 0;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) });
      round += 1;
      if (round === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'call_1',
                      function: { name: 'task__create', arguments: JSON.stringify({ content: 'From Aya', priority: 1 }) },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Created one task.' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const events: string[] = [];
    const result = await runAgent({
      kernel,
      agent,
      apiKey: 'test-key',
      history: [],
      userText: 'Create a task called From Aya',
      onEvent: (event) => events.push(event.type),
    });

    const task = kernel.store.list('tasks').find((row) => row.content === 'From Aya');
    expect(task).toBeDefined();
    expect(task!.priority).toBe(1);
    expect(task!.createdAt).toBeTruthy();
    expect(result.text).toBe('Created one task.');
    expect(events).toContain('tool-start');
    expect(events).toContain('tool-result');
    expect(events).toContain('done');
    expect(calls).toHaveLength(2);
    const secondBody = calls[1]!.body as { messages: Array<{ role: string; content: string }> };
    expect(secondBody.messages.some((message) => message.role === 'tool' && message.content.includes('From Aya'))).toBe(true);
  });

  test('destructive AI tool calls stop for approval', async () => {
    const kernel = boot();
    await kernel.execute('core.settings.update', { agent: { autonomy: 'safe' } });
    const task = await kernel.execute<unknown, { id: string }>('task.create', { content: 'Temporary' });
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'Deleting it.',
                tool_calls: [{ id: 'call_2', function: { name: 'task__delete', arguments: JSON.stringify({ id: task.id }) } }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    const result = await runAgent({ kernel, agent: { ...agent, autonomy: 'safe' }, apiKey: 'k', history: [], userText: 'Delete it' });
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.name).toBe('task.delete');
    expect(kernel.store.get('tasks', task.id)).not.toBeNull();
  });
});
