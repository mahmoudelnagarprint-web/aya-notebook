import { z } from 'zod';
import type { CommandContext, PluginDescriptor } from '@ayatodoist/core-kernel';
import { EXTRA_COMMANDS } from '@ayatodoist/core-kernel';

/**
 * `tasks-core` owns every task, project and label command. Ownership matters:
 * disabling the plugin has to remove those commands from the bus, which is only
 * true when they are registered under this plugin id.
 */
export const tasksCorePlugin: PluginDescriptor = {
  id: 'tasks-core',
  name: 'Tasks core',
  nameAr: 'المهام الأساسية',
  version: '0.1.0',
  description: 'Core task, project, section and label commands',
  descriptionAr: 'أوامر المهام والمشاريع والأقسام والتصنيفات الأساسية',
  capabilities: ['task.create', 'task.update', 'task.complete', 'task.delete', 'project.ensureInbox'],
  defaultEnabled: true,
  commands: [
    ...EXTRA_COMMANDS.filter((command) => !command.name.startsWith('checklist.')),
    {
      name: 'task.delete',
      kind: 'mutation',
      category: 'tasks',
      title: 'Delete a task',
      titleAr: 'حذف مهمة',
      description: 'Deletes a task by id. The row is removed; undo restores it from the activity patches.',
      destructive: true,
      input: z.object({ id: z.string().min(1) }),
      handler: (input: { id: string }, ctx: CommandContext) => {
        const task = ctx.store.get('tasks', input.id) as any;
        if (!task) throw new Error(`Unknown task: ${input.id}`);
        ctx.store.remove('tasks', input.id);
        return { id: input.id, deleted: true };
      },
    },
    {
      name: 'task.reschedule',
      kind: 'mutation',
      category: 'tasks',
      title: 'Reschedule a task',
      titleAr: 'إعادة جدولة مهمة',
      description: 'Moves a task to a new due date.',
      input: z.object({ id: z.string().min(1), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      handler: (input: { id: string; dueDate: string }, ctx: CommandContext) => {
        const task = ctx.store.get('tasks', input.id) as any;
        if (!task) throw new Error(`Unknown task: ${input.id}`);
        ctx.store.upsert('tasks', { ...task, dueDate: input.dueDate, updatedAt: ctx.now() });
        return { id: input.id, dueDate: input.dueDate };
      },
    },
  ],
};
