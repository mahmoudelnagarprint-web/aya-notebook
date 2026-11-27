import { beforeEach, describe, expect, test } from 'bun:test';
import { Kernel, MemoryStore } from '@ayatodoist/core-kernel';
import { tasksCorePlugin } from '@ayatodoist/plugin-tasks-core';

function boot(): Kernel {
  const kernel = new Kernel({ store: new MemoryStore() });
  kernel.installAll([tasksCorePlugin] as never);
  kernel.start();
  return kernel;
}

describe('CommandBus + undo', () => {
  let kernel: Kernel;

  beforeEach(async () => {
    kernel = boot();
    await kernel.execute('project.ensureInbox', {});
  });

  test('every mutation is logged and undoable', async () => {
    const task = await kernel.execute<unknown, { id: string }>('task.create', { content: 'Write the architecture doc', priority: 2 });
    expect(kernel.store.get('tasks', task.id)?.content).toBe('Write the architecture doc');

    const activity = kernel.store.list('activity').at(-1)!;
    expect(activity.command).toBe('task.create');
    expect(activity.patches.length).toBeGreaterThan(0);

    expect(kernel.undo()).toBe(true);
    expect(kernel.store.get('tasks', task.id)).toBeNull();
    expect(kernel.redo()).toBe(true);
    expect(kernel.store.get('tasks', task.id)?.content).toBe('Write the architecture doc');
  });

  test('validation rejects malformed input with a validation code', async () => {
    await expect(kernel.execute('task.create', { content: '' })).rejects.toMatchObject({ code: 'validation' });
  });

  test('read-only autonomy blocks AI mutations but allows queries', async () => {
    await kernel.execute('core.settings.update', { agent: { autonomy: 'read-only' } });
    await expect(kernel.execute('task.create', { content: 'AI task' }, { actor: 'ai' })).rejects.toMatchObject({ code: 'permission' });
    const overview = await kernel.query<unknown, { tools: number }>('core.system.overview', {});
    expect(overview.tools).toBeGreaterThan(5);
  });

  test('safe autonomy requires confirmation for destructive AI actions', async () => {
    await kernel.execute('core.settings.update', { agent: { autonomy: 'safe' } });
    const task = await kernel.execute<unknown, { id: string }>('task.create', { content: 'Delete me' });
    await expect(kernel.execute('task.delete', { id: task.id }, { actor: 'ai' })).rejects.toMatchObject({ code: 'confirmation' });
    await kernel.execute('task.delete', { id: task.id }, { actor: 'ai', confirmed: true });
    expect(kernel.store.get('tasks', task.id)).toBeNull();
  });

  test('disabling a plugin removes its commands and re-enabling restores them', async () => {
    expect(kernel.bus.has('task.create')).toBe(true);
    await kernel.execute('core.plugins.setEnabled', { pluginId: 'tasks-core', enabled: false });
    expect(kernel.bus.has('task.create')).toBe(false);
    await kernel.execute('core.plugins.setEnabled', { pluginId: 'tasks-core', enabled: true });
    expect(kernel.bus.has('task.create')).toBe(true);
  });

  test('completing a recurring task spawns the next occurrence', async () => {
    const task = await kernel.execute<unknown, { id: string }>('task.create', {
      content: 'Weekly review',
      dueDate: '2026-11-24',
      recurrence: 'every week',
    });
    await kernel.execute('task.complete', { id: task.id, completed: true });
    const next = kernel.store
      .list('tasks')
      .filter((row) => row.content === 'Weekly review' && !row.isCompleted)
      .at(0);
    expect(next).toBeDefined();
    expect(next!.dueDate).toBe('2026-12-01');
  });
});
