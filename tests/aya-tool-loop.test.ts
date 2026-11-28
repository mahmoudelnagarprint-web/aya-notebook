import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Kernel, MemoryStore } from '@ayatodoist/core-kernel';
import { tasksCorePlugin } from '@ayatodoist/plugin-tasks-core';
import { SqliteAyaStore } from '@ayatodoist/database/sqlite';
import { DEFAULT_AYA_SETTINGS, type AyaModel, type AyaProvider } from '@ayatodoist/shared-types';
import { AyaBrain, claimsToolExecution, stripToolLeaks } from '../plugins/plugin-ai-agent/src/aya/brain';
import { suggestRouting } from '../plugins/plugin-ai-agent/src/aya/routing';
import { buildAyaSystemPrompt } from '../plugins/plugin-ai-agent/src/aya/persona';

const originalFetch = globalThis.fetch;

let dbPath = '';
let store: SqliteAyaStore;
let kernel: Kernel;

function now(): string {
  return new Date().toISOString();
}

beforeEach(() => {
  dbPath = join(tmpdir(), `aya-loop-${crypto.randomUUID()}.db`);
  store = new SqliteAyaStore(dbPath);
  kernel = new Kernel({ store: new MemoryStore() });
  kernel.installAll([tasksCorePlugin] as never);
  kernel.start();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  try {
    store.close();
  } catch {
    /* closed */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return jsonResponse({ choices: [{ message: { content: '', tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] } }] });
}

function textReply(content: string) {
  return jsonResponse({ choices: [{ message: { content } }] });
}

function provider(): AyaProvider {
  const at = now();
  return { id: 'p1', name: 'Local Mock', baseUrl: 'http://localhost:9999/v1', apiKey: 'sk-test', enabled: true, createdAt: at, updatedAt: at };
}

function mockModel(): AyaModel {
  const at = now();
  return {
    id: 'm1',
    providerId: 'p1',
    modelId: 'mock-model',
    label: 'mock-model',
    contextWindow: 128_000,
    vision: false,
    priority: 1,
    failover: true,
    enabled: true,
    status: 'unknown',
    latencyMs: null,
    lastTestedAt: null,
    createdAt: at,
    updatedAt: at,
  } as AyaModel;
}

async function seedLlm(): Promise<void> {
  await store.saveProvider(provider());
  await store.saveModel(mockModel());
  await store.saveRouting({ chat_deep: 'm1', background_24_7: 'm1', vision: 'm1', memory_summarizer: 'm1' });
  await store.saveSettings({ ...DEFAULT_AYA_SETTINGS, autonomy: 'full_undo' });
  await kernel.execute('project.ensureInbox', {});
}

describe('Aya — multi-step tool loop', () => {
  test('a created project id flows into the very next task.create call in the same turn', async () => {
    await seedLlm();
    const bodies: Array<Record<string, any>> = [];

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
      bodies.push(body);
      if (bodies.length === 1) {
        return toolCall('c1', 'project__create', { name: 'البيت' });
      }
      if (bodies.length === 2) {
        const project = (kernel.store.list('projects') as any[]).find((row) => row.name === 'البيت');
        expect(project).toBeDefined();
        expect(JSON.stringify(body.messages)).toContain(project.id);
        return toolCall('c2', 'task__create', { content: 'تغيير لمبة الصالة', projectId: project.id });
      }
      return textReply('عملت مشروع البيت وحطيت المهمة جواه.');
    }) as unknown as typeof fetch;

    const brain = new AyaBrain({ kernel, adapter: store });
    const turn = await brain.handleMessage({ text: 'حطي مهمة تغيير لمبة الصالة في مشروع البيت', language: 'ar' });

    const project = (kernel.store.list('projects') as any[]).find((row) => row.name === 'البيت');
    const task = (kernel.store.list('tasks') as any[]).find((row) => row.content === 'تغيير لمبة الصالة');
    expect(project).toBeDefined();
    expect(task).toBeDefined();
    expect(task.projectId).toBe(project.id);
    expect(turn.toolCalls.map((call: any) => call.name)).toEqual(['project.create', 'task.create']);
    expect(turn.toolRounds).toBe(2);
    expect(turn.messages.find((entry) => entry.role === 'assistant')!.content).toContain('مشروع البيت');
  });

  test('a hallucinated tool log with no functionCall is rejected and retried with tool_choice=required', async () => {
    await seedLlm();
    const bodies: Array<Record<string, any>> = [];

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
      bodies.push(body);
      if (bodies.length === 1) {
        return textReply('تمام، [الأدوات المنفذة: project.create، task.create]\n(جارِ تنفيذ العمليات...)');
      }
      if (bodies.length === 2) {
        return toolCall('c1', 'task__create', { content: 'أقفل التكييف', dueDate: '2026-11-27', dueTime: '20:00' });
      }
      return textReply('قفلت التكييف وحطيت التذكير الساعة 8 بالليل.');
    }) as unknown as typeof fetch;

    const brain = new AyaBrain({ kernel, adapter: store });
    const turn = await brain.handleMessage({ text: 'اه نفذي', language: 'ar' });

    expect(bodies.length).toBeGreaterThanOrEqual(3);
    expect(bodies[1]!.tool_choice).toBe('required');
    const tasks = (kernel.store.list('tasks') as any[]).filter((row) => row.content === 'أقفل التكييف');
    expect(tasks).toHaveLength(1);
    const assistant = turn.messages.find((entry) => entry.role === 'assistant')!;
    expect(assistant.content).not.toContain('الأدوات المنفذة');
    expect(assistant.content).not.toContain('جارِ تنفيذ');
  });

  test('claimsToolExecution detects fake execution text and stripToolLeaks removes it', () => {
    expect(claimsToolExecution('[الأدوات المنفذة: project.create]')).toBe(true);
    expect(claimsToolExecution('(جارِ تنفيذ العمليات...)')).toBe(true);
    expect(claimsToolExecution('المهمة في مشروع البيت الساعة 8')).toBe(false);

    const dirty = 'حطيتها في البيت ✅\n[الأدوات المنفذة: project.create، task.create]\n(جارِ تنفيذ العمليات...)';
    const clean = stripToolLeaks(dirty);
    expect(clean).toContain('حطيتها في البيت');
    expect(clean).not.toContain('الأدوات المنفذة');
    expect(clean).not.toContain('جارِ تنفيذ');
  });
});

describe('Aya — project resolution by name and duplicate prevention', () => {
  test('task.create auto-creates a named project and later reuses it case/whitespace-insensitively', async () => {
    const first = (await kernel.execute('task.create', { content: 'شراء لمبات', projectName: 'البيت' })) as any;
    const project = (kernel.store.list('projects') as any[]).find((row) => row.name === 'البيت');
    expect(project).toBeDefined();
    expect(first.projectId).toBe(project.id);
    expect(first.projectName).toBe('البيت');

    const second = (await kernel.execute('task.create', { content: 'تنظيف السجاد', projectName: '  البيت  ' })) as any;
    expect(second.projectId).toBe(project.id);
    expect((kernel.store.list('projects') as any[]).filter((row) => row.name === 'البيت')).toHaveLength(1);
  });

  test('an identical title + due date/time within 60 seconds returns the existing task', async () => {
    const payload = { content: 'أقفل التكييف', dueDate: '2026-11-27', dueTime: '20:00' };
    const first = (await kernel.execute('task.create', payload)) as any;
    const second = (await kernel.execute('task.create', { ...payload, content: '  أقفل   التكييف ' })) as any;

    expect(second.id).toBe(first.id);
    expect(second.deduplicated).toBe(true);
    expect((kernel.store.list('tasks') as any[]).filter((row) => String(row.content).includes('أقفل'))).toHaveLength(1);
  });

  test('task.update moves a task into a project created by name', async () => {
    const created = (await kernel.execute('task.create', { content: 'مراجعة العرض' })) as any;
    expect(created.projectId).toBe('__inbox');

    const updated = (await kernel.execute('task.update', { id: created.id, projectName: 'الشغل' })) as any;
    const project = (kernel.store.list('projects') as any[]).find((row) => row.name === 'الشغل');
    expect(project).toBeDefined();
    expect(updated.projectId).toBe(project.id);
    expect((kernel.store.get('tasks', created.id) as any).projectId).toBe(project.id);
  });
});

describe('Aya — routing and persona guardrails', () => {
  test('chat_deep never picks a lite model while a full Flash/Pro model is available', () => {
    const at = now();
    const model = (id: string, modelId: string, priority: number): AyaModel =>
      ({
        id,
        providerId: 'g',
        modelId,
        label: modelId,
        contextWindow: 1_000_000,
        vision: false,
        priority,
        failover: true,
        enabled: true,
        status: 'ok',
        latencyMs: 500,
        lastTestedAt: null,
        createdAt: at,
        updatedAt: at,
      }) as AyaModel;

    const suggestion = suggestRouting([
      model('lite', 'gemini-3.1-flash-lite', 1),
      model('flash', 'gemini-2.5-flash', 2),
      model('pro', 'gemini-2.5-pro', 3),
    ]);

    expect(['flash', 'pro']).toContain(suggestion.chat_deep);
    expect(suggestion.chat_deep).not.toBe('lite');
  });

  test('the prompt tells Aya to create a user-named project immediately, without asking', () => {
    const prompt = buildAyaSystemPrompt({ kernel, language: 'ar', memories: [], summary: '', toolCount: 20 });
    expect(prompt).toContain('فلا تطلبي إذن');
    expect(prompt).toContain('projectName');
    expect(prompt).toContain('احفظي المهمة في Inbox');
  });
});
