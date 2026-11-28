import { z } from 'zod';
import type { AppSettings, CollectionKey, CommandContext, DataStore, ServiceRegistry } from '@ayatodoist/shared-types';
import { CommandDefinition } from './command-bus';
import { createId, toDay, defaultIdGenerator } from './utils';
import { TaskSchema, ProjectSchema, SectionSchema, LabelSchema } from '@ayatodoist/shared-types';

/** "every week" / "every! 2 months" → structured rule, so both shapes are accepted. */
function normalizeRecurrence(
  input: string | { text: string; unit: 'day' | 'week' | 'month' | 'year'; interval?: number; weekdays?: number[]; strict?: boolean } | null,
): { text: string; unit: 'day' | 'week' | 'month' | 'year'; interval: number; weekdays?: number[]; strict?: boolean } | null {
  if (!input) return null;
  if (typeof input !== 'string') return { ...input, interval: input.interval && input.interval > 0 ? input.interval : 1 };
  const text = input.trim();
  const lower = text.toLowerCase();
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekday = weekdays.findIndex((name) => lower === `every ${name}` || lower === name);
  if (weekday >= 0) return { text, unit: 'week', interval: 1, weekdays: [weekday], strict: false };
  const match = /^(?:every\s*!?\s*)?(\d+\s*)?([a-z]+)$/.exec(lower);
  const aliases: Record<string, 'day' | 'week' | 'month' | 'year'> = {
    day: 'day', days: 'day', daily: 'day', week: 'week', weeks: 'week', weekly: 'week',
    month: 'month', months: 'month', monthly: 'month', year: 'year', years: 'year', yearly: 'year',
  };
  const unit = match?.[2] ? aliases[match[2]] : undefined;
  const interval = match?.[1] ? Number.parseInt(match[1], 10) : 1;
  if (unit) return { text, unit, interval: interval > 0 ? interval : 1, weekdays: [], strict: lower.includes('!') };
  return { text, unit: 'day', interval: 1, weekdays: [], strict: false };
}

export const EXTRA_COMMANDS: CommandDefinition[] = [
  {
    name: 'project.ensureInbox',
    kind: 'query',
    category: 'projects',
    title: 'Ensure inbox project exists',
    titleAr: 'التأكد من وجود مشروع القراءة',
    description: 'Returns the inbox project, creating it on first use so quick-add and similar flows always have an inbox to target.',
    input: z.object({}),
    handler: (_input: any, ctx: CommandContext) => {
      const store = ctx.store;
      let project = store.get('projects', '__inbox') as any;
      if (!project) {
        const now = ctx.now();
        project = ProjectSchema.parse({
          id: '__inbox',
          name: 'Inbox',
          nameAr: 'القراءة',
          color: '#dc4c3e',
          parentId: null,
          orderKey: '0000000000000001',
          isFavorite: true,
          isArchived: false,
          isInbox: true,
          layout: 'list',
          createdAt: now,
          updatedAt: now,
        });
        store.upsert('projects', project);
      }
      return { id: project.id, name: project.name, isInbox: project.isInbox };
    },
  },
  {
    name: 'task.create',
    kind: 'mutation',
    category: 'tasks',
    title: 'Create a task',
    titleAr: 'إنشاء مهمة',
    description:
      'Creates a task (title + optional project, description, labels, due date/time, priority, recurrence). Always compute dueDate/dueTime from the current date and clock given in the system prompt — never pass relative text like "in 1 hour".',
    input: z.object({
      id: z.string().min(1).optional().describe('Optional client-supplied id (idempotent REST writes).'),
      content: z.string().min(1).describe('Task title — the short line the user sees (e.g. "أقفل التكييف").'),
      projectId: z
        .string()
        .optional()
        .describe('Id of an existing project from the Projects list in the system prompt. Omit only when no project fits; the task then lands in Inbox.'),
      projectName: z
        .string()
        .optional()
        .describe('Project name as the user said it (e.g. "البيت"). Matched case/whitespace-insensitively and created automatically when missing. Prefer this when you only know the name.'),
      sectionId: z.string().nullable().optional(),
      parentId: z.string().nullable().optional(),
      labelNames: z
        .array(z.string())
        .optional()
        .describe('Label names from the Labels list. Unknown names are created on the fly.'),
      description: z.string().optional().describe('Longer notes / details for the task.'),
      dueDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('Due date as YYYY-MM-DD, calculated from the current date. Never pass "today", "tomorrow" or "in 1 hour".'),
      dueTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional()
        .describe('Due time as 24-hour HH:mm, calculated from the current clock (e.g. now 01:05 + 1 hour → 02:05). Never pass relative text.'),
      deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      durationMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
      // Accepts both the structured rule and the shorthand string ("every week")
      // that quick-add and older clients send.
      recurrence: z.union([
        z.string().min(1),
        z.object({
          text: z.string().min(1),
          unit: z.enum(['day', 'week', 'month', 'year']),
          interval: z.number().int().min(1).max(365),
          weekdays: z.array(z.number()).optional(),
          strict: z.boolean().optional(),
        }),
      ]).optional(),
      priority: z
        .number()
        .int()
        .min(1)
        .max(4)
        .optional()
        .describe('1 = p1 (critical), 2 = p2 (time-critical reminders such as appliance timers or appointments), 3 = p3 (default), 4 = p4 (someday).'),
      orderKey: z.string().optional(),
      attachments: z.array(z.string()).optional(),
      isCompleted: z.boolean().optional(),
      completedAt: z.string().nullable().optional(),
      completedCount: z.number().int().min(0).optional(),
      postponedCount: z.number().int().min(0).optional(),
    }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      const now = ctx.now();
      const projectId = resolveProjectId(store, ctx, input.projectId, input.projectName);
      // A caller-supplied id means "persist exactly this row"; never collapse it
      // into the recent-duplicate heuristic used for AI retries.
      const duplicate = input.id
        ? null
        : findRecentDuplicate(store, input.content, input.dueDate ?? null, input.dueTime ?? null, now);
      if (duplicate) {
        return {
          id: duplicate.id,
          projectId: duplicate.projectId,
          projectName: projectDisplayName(store, duplicate.projectId),
          content: duplicate.content,
          labels: duplicate.labels ?? [],
          deduplicated: true,
        };
      }
      const id = input.id ?? ctx.id('task');
      const orderKey = input.orderKey ?? defaultOrderKey(store);
      const labels = resolveLabels(store, input.labelNames ?? []);
      const rule = normalizeRecurrence(input.recurrence ?? null);
      const task = TaskSchema.parse({
        id,
        projectId,
        sectionId: input.sectionId ?? null,
        parentId: input.parentId ?? null,
        content: input.content,
        description: input.description ?? '',
        priority: input.priority ?? 4,
        orderKey,
        dueDate: input.dueDate ?? null,
        dueTime: input.dueTime ?? null,
        deadline: input.deadline ?? null,
        durationMinutes: input.durationMinutes ?? null,
        recurrence: rule
          ? {
              text: rule.text,
              unit: rule.unit,
              interval: rule.interval ?? 1,
              weekdays: rule.weekdays ?? [],
              strict: rule.strict ?? false,
            }
          : null,
        labels: labels,
        checklist: [],
        attachments: input.attachments ?? [],
        isCompleted: input.isCompleted ?? false,
        completedAt: input.isCompleted ? (input.completedAt ?? now) : null,
        createdAt: now,
        updatedAt: now,
        completedCount: input.completedCount ?? 0,
        postponedCount: input.postponedCount ?? 0,
        deletedAt: null,
      });
      store.upsert('tasks', task);
      for (const labelId of labels) {
        store.upsert('labels', store.get('labels', labelId) ?? { id: labelId, name: labelId, color: '#246fe0', orderKey: defaultOrderKey(store), isFavorite: false, createdAt: now, updatedAt: now });
      }
      return {
        id: task.id,
        projectId: task.projectId,
        projectName: projectDisplayName(store, task.projectId),
        content: task.content,
        labels: task.labels,
      };
    },
  },
  {
    name: 'task.list',
    kind: 'query',
    category: 'tasks',
    title: 'List tasks',
    titleAr: 'قائمة المهام',
    description: 'Returns tasks optionally filtered by project id.',
    input: z.object({ projectId: z.string().optional() }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      let rows = store.list('tasks') as any[];
      if (input.projectId) rows = rows.filter((t) => t.projectId === input.projectId);
      return rows;
    },
  },
  {
    name: 'task.update',
    kind: 'mutation',
    category: 'tasks',
    title: 'Update a task',
    titleAr: 'تعديل مهمة',
    description:
      'Updates the given task by id, preserving fields not provided. Optionally moves it to another project by id or by name (the project is created when the name does not exist).',
    input: z.object({
      id: z.string().min(1),
      content: z.string().optional(),
      projectId: z.string().optional().describe('Id of an existing project to move the task into.'),
      projectName: z
        .string()
        .optional()
        .describe('Project name to move the task into; matched case/whitespace-insensitively and created automatically when missing.'),
      priority: z.number().int().min(1).max(4).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
      deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      completed: z.boolean().optional(),
      checklist: z.array(z.object({ id: z.string(), text: z.string(), checked: z.boolean(), image: z.string().nullable().optional() })).optional(),
    }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      const task = store.get('tasks', input.id) as any;
      if (!task) throw new Error(`Unknown task: ${input.id}`);
      const now = ctx.now();
      const updated: any = { ...task, updatedAt: now };
      if (input.projectId != null || input.projectName != null) {
        updated.projectId = resolveProjectId(store, ctx, input.projectId, input.projectName);
        updated.sectionId = null;
      }
      if (input.content != null) updated.content = input.content;
      if (input.priority != null) updated.priority = input.priority;
      if (input.dueDate !== undefined) updated.dueDate = input.dueDate;
      if (input.dueTime !== undefined) updated.dueTime = input.dueTime;
      if (input.deadline !== undefined) updated.deadline = input.deadline;
      if (input.checklist != null) updated.checklist = input.checklist;
      if (input.completed !== undefined) {
        updated.isCompleted = input.completed;
        updated.completedAt = input.completed ? now : null;
      }
      store.upsert('tasks', updated);
      return {
        id: updated.id,
        projectId: updated.projectId,
        projectName: projectDisplayName(store, updated.projectId),
        updatedAt: updated.updatedAt,
      };
    },
  },
  {
    name: 'task.complete',
    kind: 'mutation',
    category: 'tasks',
    title: 'Complete a task',
    titleAr: 'اكتمل المهمة',
    description: 'Marks a task completed and recomputes next occurrences for recurring tasks.',
    input: z.object({ id: z.string().min(1), completed: z.boolean().optional() }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      const task = store.get('tasks', input.id) as any;
      if (!task) throw new Error(`Unknown task: ${input.id}`);
      const now = ctx.now();
      task.isCompleted = input.completed !== false;
      task.completedAt = task.isCompleted ? now : null;
      task.updatedAt = now;
      if (task.recurrence && task.isCompleted) {
        const next = nextOccurrence(task.dueDate, task.recurrence);
        if (next) {
          const kid = ctx.id('task') as string;
          const nextTask: any = {
            ...task,
            id: kid,
            isCompleted: false,
            completedAt: null,
            dueDate: next,
            orderKey: defaultOrderKey(store),
            createdAt: now,
            updatedAt: now,
            completedCount: (task.completedCount ?? 0) + 1,
          };
          store.upsert('tasks', nextTask);
        }
      }
      store.upsert('tasks', task);
      return { id: task.id, done: true };
    },
  },
  {
    name: 'project.list',
    kind: 'query',
    category: 'projects',
    title: 'List projects',
    titleAr: 'قائمة المشاريع',
    description: 'Returns all projects.',
    input: z.object({}),
    handler: (_input: any, ctx: CommandContext) => ctx.store.list('projects') as any[],
  },
  {
    name: 'project.create',
    kind: 'mutation',
    category: 'projects',
    title: 'Create a project',
    titleAr: 'إنشاء مشروع',
    description: 'Creates a project with an optional colour, parent and favourite flag.',
    input: z.object({
      id: z.string().min(1).optional().describe('Optional client-supplied id (idempotent REST writes).'),
      name: z.string().min(1),
      color: z.string().optional(),
      parentId: z.string().nullable().optional(),
      orderKey: z.string().optional(),
      isFavorite: z.boolean().optional(),
      isInbox: z.boolean().optional(),
      isArchived: z.boolean().optional(),
      layout: z.enum(['list', 'board', 'table', 'calendar']).optional(),
    }),
    handler: (input: any, ctx: CommandContext) => {
      const now = ctx.now();
      const project = ProjectSchema.parse({
        id: input.id ?? ctx.id('project'),
        name: input.name,
        color: input.color ?? '#246fe0',
        parentId: input.parentId ?? null,
        orderKey: input.orderKey ?? defaultOrderKey(ctx.store),
        isFavorite: input.isFavorite ?? false,
        isArchived: input.isArchived ?? false,
        isInbox: input.isInbox ?? false,
        layout: input.layout ?? 'list',
        createdAt: now,
        updatedAt: now,
      });
      ctx.store.upsert('projects', project);
      return project;
    },
  },
  {
    name: 'label.list',
    kind: 'query',
    category: 'labels',
    title: 'List labels',
    titleAr: 'قائمة التصنيفات',
    description: 'Returns all labels.',
    input: z.object({}),
    handler: (_input: any, ctx: CommandContext) => ctx.store.list('labels') as any[],
  },
  {
    name: 'checklist.setItems',
    kind: 'mutation',
    category: 'checklists',
    title: 'Set checklist items for a task',
    titleAr: 'تعيين بنود القائمة لمهمة',
    description: 'Replaces the checklist items for a task.',
    input: z.object({ taskId: z.string().min(1), items: z.array(z.object({ id: z.string(), text: z.string(), checked: z.boolean() })) }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      const task = store.get('tasks', input.taskId) as any;
      if (!task) throw new Error(`Unknown task: ${input.taskId}`);
      const now = ctx.now();
      const checklist = input.items.map((item: any) => ({
        id: item.id,
        text: item.text,
        checked: item.checked,
        image: null,
      }));
      task.checklist = checklist;
      task.updatedAt = now;
      store.upsert('tasks', task);
      return { taskId: task.id, items: checklist };
    },
  },
  {
    name: 'checklist.addItem',
    kind: 'mutation',
    category: 'checklists',
    title: 'Add a checklist item',
    titleAr: 'إضافة بند للقائمة',
    description: 'Adds an item to a task checklist, optionally after another item.',
    input: z.object({ taskId: z.string().min(1), text: z.string().min(1), afterId: z.string().optional() }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      const task = store.get('tasks', input.taskId) as any;
      if (!task) throw new Error(`Unknown task: ${input.taskId}`);
      const now = ctx.now();
      const items = (task.checklist ?? []).slice();
      const newItem = { id: ctx.id('chk'), text: input.text, checked: false, image: null };
      if (input.afterId) {
        const idx = items.findIndex((it: any) => it.id === input.afterId);
        if (idx >= 0) items.splice(idx + 1, 0, newItem);
        else items.push(newItem);
      } else {
        items.push(newItem);
      }
      task.checklist = items;
      task.updatedAt = now;
      store.upsert('tasks', task);
      return { items: [newItem] };
    },
  },
  {
    name: 'checklist.removeItem',
    kind: 'mutation',
    category: 'checklists',
    title: 'Remove a checklist item',
    titleAr: 'إزالة بند من القائمة',
    description: 'Removes an item from a task checklist.',
    input: z.object({ taskId: z.string().min(1), itemId: z.string().min(1) }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      const task = store.get('tasks', input.taskId) as any;
      if (!task) throw new Error(`Unknown task: ${input.taskId}`);
      const now = ctx.now();
      task.checklist = (task.checklist ?? []).filter((it: any) => it.id !== input.itemId);
      task.updatedAt = now;
      store.upsert('tasks', task);
      return { removed: true };
    },
  },
  {
    name: 'checklist.toggle',
    kind: 'mutation',
    category: 'checklists',
    title: 'Toggle a checklist item',
    titleAr: 'تبديل状态 بند القائمة',
    description: 'Toggles the checked state of a checklist item.',
    input: z.object({ taskId: z.string().min(1), itemId: z.string().min(1) }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      const task = store.get('tasks', input.taskId) as any;
      if (!task) throw new Error(`Unknown task: ${input.taskId}`);
      const now = ctx.now();
      const item = (task.checklist ?? []).find((it: any) => it.id === input.itemId);
      if (!item) throw new Error(`Unknown checklist item: ${input.itemId}`);
      item.checked = !item.checked;
      task.updatedAt = now;
      store.upsert('tasks', task);
      return { item };
    },
  },
  {
    name: 'checklist.stats',
    kind: 'query',
    category: 'checklists',
    title: 'Get checklist statistics',
    titleAr: 'إحصائيات القائمة',
    description: 'Returns completed and total counts for a task checklist.',
    input: z.object({ taskId: z.string().min(1) }),
    handler: (input: any, ctx: CommandContext) => {
      const task = ctx.store.get('tasks', input.taskId) as any;
      const items = task?.checklist ?? [];
      return { completed: items.filter((it: any) => it.checked).length, total: items.length };
    },
  },
  {
    name: 'checklist.items',
    kind: 'query',
    category: 'checklists',
    title: 'Get checklist items',
    titleAr: 'بنود القائمة',
    description: 'Returns the checklist items for a task.',
    input: z.object({ taskId: z.string().min(1) }),
    handler: (input: any, ctx: CommandContext) => {
      const task = ctx.store.get('tasks', input.taskId) as any;
      return (task?.checklist ?? []).map((it: any) => ({ id: it.id, text: it.text }));
    },
  },
  {
    name: 'checklist.fromNote',
    kind: 'mutation',
    category: 'checklists',
    title: 'Convert task description to checklist',
    titleAr: 'تحويل الوصف إلى قائمة',
    description: 'Parses the task description as a note and sets the checklist items from it.',
    input: z.object({ taskId: z.string().min(1) }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      const task = store.get('tasks', input.taskId) as any;
      if (!task) throw new Error(`Unknown task: ${input.taskId}`);
      const { noteToChecklist } = require('@ayatodoist/plugin-checklists-media');
      const items = (noteToChecklist as any)(task.description ?? '');
      task.checklist = items.map((it: any, i: number) => ({ ...it, id: it.id ?? `chk-${i + 1}` }));
      task.description = '';
      task.updatedAt = ctx.now();
      store.upsert('tasks', task);
      return { items: task.checklist.map((it: any) => ({ text: it.text })) };
    },
  },
  {
    name: 'checklist.toNote',
    kind: 'mutation',
    category: 'checklists',
    title: 'Convert checklist to note in description',
    titleAr: 'تحويل القائمة إلى ملاحظة في الوصف',
    description: 'Converts the task checklist into a note in the task description.',
    input: z.object({ taskId: z.string().min(1) }),
    handler: (input: any, ctx: CommandContext) => {
      const store = ctx.store;
      const task = store.get('tasks', input.taskId) as any;
      if (!task) throw new Error(`Unknown task: ${input.taskId}`);
      const { checklistToNote } = require('@ayatodoist/plugin-checklists-media');
      task.description = (checklistToNote as any)(task.checklist ?? []);
      task.checklist = [];
      task.updatedAt = ctx.now();
      store.upsert('tasks', task);
      return { description: task.description };
    },
  },
];

/** Case/whitespace-insensitive project name key, used for every lookup. */
function normalizeName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function projectDisplayName(store: DataStore, projectId: string | null | undefined): string | null {
  if (!projectId) return null;
  const project = store.get('projects', projectId) as any;
  return project ? String(project.nameAr || project.name || '') || null : null;
}

/**
 * Resolves a project by id, then by name (case/whitespace-insensitive), and
 * creates it when the user named a project that does not exist yet. Falls back
 * to Inbox when neither an id nor a name was given.
 */
function resolveProjectId(
  store: DataStore,
  ctx: CommandContext,
  projectId?: string | null,
  projectName?: string | null,
): string {
  if (projectId) {
    const byId = store.get('projects', projectId) as any;
    if (byId) return byId.id;
  }
  const name = String(projectName ?? '').replace(/\s+/g, ' ').trim();
  if (name) {
    const wanted = normalizeName(name);
    const existing = (store.list('projects') as any[]).find(
      (project) =>
        project &&
        !project.isArchived &&
        (normalizeName(project.name) === wanted || normalizeName(project.nameAr) === wanted),
    );
    if (existing) return existing.id;
    const now = ctx.now();
    const created = ProjectSchema.parse({
      id: ctx.id('project'),
      name,
      color: '#246fe0',
      parentId: null,
      orderKey: defaultOrderKey(store),
      isFavorite: false,
      isArchived: false,
      isInbox: false,
      layout: 'list',
      createdAt: now,
      updatedAt: now,
    });
    store.upsert('projects', created);
    return created.id;
  }
  return ensureInboxId(store, ctx);
}

const DUPLICATE_WINDOW_MS = 60_000;

/**
 * Rapid identical creates (same title + due date + due time within 60 seconds)
 * are the same intent retried by the model, so the existing row is returned.
 */
function findRecentDuplicate(
  store: DataStore,
  content: unknown,
  dueDate: string | null,
  dueTime: string | null,
  now: string,
): any | null {
  const wanted = normalizeName(content);
  if (!wanted) return null;
  const at = Date.parse(now);
  for (const task of store.list('tasks') as any[]) {
    if (!task || task.deletedAt) continue;
    if (normalizeName(task.content) !== wanted) continue;
    if ((task.dueDate ?? null) !== (dueDate ?? null)) continue;
    if ((task.dueTime ?? null) !== (dueTime ?? null)) continue;
    const created = Date.parse(task.createdAt);
    if (Number.isNaN(created) || Number.isNaN(at)) continue;
    if (Math.abs(at - created) <= DUPLICATE_WINDOW_MS) return task;
  }
  return null;
}

function ensureInboxId(store: DataStore, ctx: CommandContext): string {
  let project = store.get('projects', '__inbox') as any;
  if (!project) {
    const now = ctx.now();
    project = ProjectSchema.parse({
      id: '__inbox',
      name: 'Inbox',
      nameAr: 'القراءة',
      color: '#dc4c3e',
      parentId: null,
      orderKey: '0000000000000001',
      isFavorite: true,
      isArchived: false,
      isInbox: true,
      layout: 'list',
      createdAt: now,
      updatedAt: now,
    });
    store.upsert('projects', project);
  }
  return project.id;
}

function resolveLabels(store: DataStore, names: string[]): string[] {
  const ids: string[] = [];
  const now = new Date().toISOString();
  for (const name of names) {
    if (!name) continue;
    const existing = [...store.list('labels')].find((l: any) => l.name === name);
    if (existing) { ids.push(existing.id); }
    else {
      const id = 'lbl-' + (createId() as string);
      store.upsert('labels', { id, name, color: '#246fe0', orderKey: defaultOrderKey(store), isFavorite: false, createdAt: now, updatedAt: now });
      ids.push(id);
    }
  }
  return ids;
}

function defaultOrderKey(store: DataStore): string {
  const count = store.list('tasks').length + store.list('projects').length + store.list('sections').length + store.list('labels').length;
  return String(1_000_000_000_000_000 + count).padStart(16, '0');
}

function nextOccurrence(due: string | null, rec: NonNullable<any>): string | null {
  if (!due) return null;
  const y = +due.slice(0, 4), m = +due.slice(5, 7) - 1, d = +due.slice(8, 10);
  const date = new Date(y, m, d);
  if (isNaN(date.getTime())) return null;
  const unit = rec.unit, interval = rec.interval;
  if (unit === 'day') date.setDate(date.getDate() + interval);
  else if (unit === 'week') date.setDate(date.getDate() + 7 * interval);
  else if (unit === 'month') date.setMonth(date.getMonth() + interval);
  else if (unit === 'year') date.setFullYear(date.getFullYear() + interval);
  if (isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
