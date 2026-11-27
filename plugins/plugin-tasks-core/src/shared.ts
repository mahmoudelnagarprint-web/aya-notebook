import { addDays, nextOccurrence, parseDay } from '@ayatodoist/shared-types';
import type { Task, Project, Section, Label, Filter, Comment, Reminder } from '@ayatodoist/shared-types';

export const DEFAULT_COLORS = ['#dc4c3e', '#42a5f5', '#66d9a8', '#f4b840'];
export const MAX_TASK_DEPTH = 4;
export const ORDER_GAP = '00000000000000000000';

export interface TaskStore {
  get(key: string, id: string): any;
  list(key: string): any[];
  upsert(key: string, value: any): void;
  remove(key: string, id: string): void;
}

export interface CommandContext {
  store: TaskStore;
  id(prefix: string): string;
  now(): string;
  today(): string;
}

const idCounter = new Map<string, number>();

export function makeCommandContext(store: TaskStore, now = () => new Date().toISOString(), today = () => new Date().toISOString().slice(0, 10)) {
  return {
    store,
    id(prefix: string) {
      const next = (idCounter.get(prefix) ?? 0) + 1;
      idCounter.set(prefix, next);
      return `${prefix}-${next}-${Math.random().toString(36).slice(2, 8)}`;
    },
    now,
    today,
  };
}

export function padOrderKey(key: string, length = 24): string {
  return key.padStart(length, '0');
}

export function insertionKey(
  _store: TaskStore,
  _scope: { projectId: string; sectionId: string | null; parentId: string | null },
  _opts?: { afterId?: string | null; beforeId?: string | null; excludeId?: string },
) {
  return _scope.projectId + '|' + (_scope.sectionId ?? '') + '|' + (_scope.parentId ?? '') + '|' + Date.now().toString(36) + '|' + Math.random().toString(36).slice(2, 8);
}

export function nextDueAfter(recurrence: NormalizedRecurrence | string | null | undefined, base: string): string {
  const rule = typeof recurrence === 'string' ? normalizeRecurrence(recurrence) : recurrence ?? null;
  if (!rule) return base;
  const interval = rule.interval && rule.interval > 0 ? rule.interval : 1;
  if (rule.weekdays && rule.weekdays.length) {
    for (let step = 1; step <= 7 * interval + 7; step += 1) {
      const candidate = addDays(base, step);
      if (rule.weekdays.includes(parseDay(candidate).getDay())) return candidate;
    }
  }
  return nextOccurrence(base, { unit: rule.unit, interval });
}

export type NormalizedRecurrence =
  | null
  | { text: string; unit: 'day' | 'week' | 'month' | 'year'; interval?: number; weekdays?: number[]; strict?: boolean };

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const UNIT_ALIASES: Record<string, 'day' | 'week' | 'month' | 'year'> = {
  day: 'day',
  days: 'day',
  daily: 'day',
  week: 'week',
  weeks: 'week',
  weekly: 'week',
  month: 'month',
  months: 'month',
  monthly: 'month',
  year: 'year',
  years: 'year',
  yearly: 'year',
  annually: 'year',
};

export function normalizeRecurrence(
  input: string | null | { text: string; unit: 'day' | 'week' | 'month' | 'year'; interval?: number; weekdays?: number[]; strict?: boolean } | null,
): NormalizedRecurrence {
  if (!input) return null;
  if (typeof input !== 'string') return input;
  const text = input.trim();
  const lower = text.toLowerCase();
  const weekday = WEEKDAY_NAMES.findIndex((name) => lower === `every ${name}` || lower === name);
  if (weekday >= 0) return { text, unit: 'week', interval: 1, weekdays: [weekday], strict: false };
  const match = /^(?:every\s+)?(\d+\s*)?([a-z]+)$/.exec(lower);
  const unit = match?.[2] ? UNIT_ALIASES[match[2]] : undefined;
  const interval = match?.[1] ? Number.parseInt(match[1], 10) : 1;
  if (unit) return { text, unit, interval: interval > 0 ? interval : 1, weekdays: [], strict: false };
  return { text, unit: 'day', interval: 1, weekdays: [], strict: false };
}

export function requireProject(store: TaskStore, id: string): Project {
  const project = store.get('projects', id) as Project | undefined;
  if (!project) throw new Error(`Project not found: ${id}`);
  return project;
}

export function requireSection(store: TaskStore, id: string): Section {
  const section = store.get('sections', id) as Section | undefined;
  if (!section) throw new Error(`Section not found: ${id}`);
  return section;
}

export function requireTask(store: TaskStore, id: string): Task {
  const task = store.get('tasks', id) as Task | undefined;
  if (!task) throw new Error(`Task not found: ${id}`);
  return task;
}

export function resolveLabels(_store: TaskStore, _ctx: CommandContext, labels: string[]): string[] {
  return labels;
}

export function ancestorsOf(store: TaskStore, task: Task): Task[] {
  const ancestors: Task[] = [];
  let current: Task | undefined = task;
  while (current?.parentId) {
    const parent = store.get('tasks', current.parentId) as Task | undefined;
    if (!parent) break;
    ancestors.unshift(parent);
    current = parent;
  }
  return ancestors;
}

export function descendantsOf(store: TaskStore, task: Task): Task[] {
  const found: Task[] = [];
  const queue: string[] = [task.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const child of store.list('tasks') as Task[]) {
      if (child.parentId !== id) continue;
      found.push(child);
      queue.push(child.id);
    }
  }
  return found;
}

export function descendantIds(store: TaskStore, task: Task): string[] {
  const ids: string[] = [];
  const queue = [task.id];
  while (queue.length) {
    const id = queue.pop()!;
    for (const child of store.list('tasks').filter((t) => (t as Task).parentId === id)) {
      ids.push((child as Task).id);
      queue.push((child as Task).id);
    }
  }
  return ids;
}

export function inboxProject(store: TaskStore): Project {
  const inbox = store.list('projects').find((p) => (p as Project).isInbox) as Project | undefined;
  if (inbox) return inbox;
  const now = new Date().toISOString();
  const created: Project = {
    id: inboxProjectId,
    name: 'Inbox',
    color: '#246fe0',
    parentId: null,
    orderKey: ORDER_GAP,
    isFavorite: false,
    isArchived: false,
    isInbox: true,
    layout: 'list',
    createdAt: now,
    updatedAt: now,
  };
  store.upsert('projects', created);
  return created;
}

export function siblingsOf(store: TaskStore, task: Task): Task[] {
  return store.list('tasks').filter((t) => (t as Task).parentId === task.parentId && (t as Task).id !== task.id) as Task[];
}

export function subtreeHeight(store: TaskStore, taskId: string): number {
  const task = store.get('tasks', taskId) as Task | undefined;
  if (!task) return 0;
  let maxDepth = 0;
  const queue: Array<{ id: string; depth: number }> = [{ id: taskId, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.pop()!;
    if (depth > maxDepth) maxDepth = depth;
    for (const child of store.list('tasks').filter((t) => (t as Task).parentId === id)) {
      queue.push({ id: (child as Task).id, depth: depth + 1 });
    }
  }
  return maxDepth;
}

export function taskDepth(store: TaskStore, task: Task): number {
  return ancestorsOf(store, task).length;
}

export const inboxProjectId = 'inbox';

export function describeRecurrence(recurrence: NormalizedRecurrence | null | undefined, _language: 'ar' | 'en'): string {
  if (!recurrence) return '';
  if (typeof recurrence === 'string') return recurrence;
  const unit = recurrence.unit;
  const count = recurrence.interval ?? 1;
  if (count === 1) {
    return unit === 'day' ? (_language === 'ar' ? 'يوميًا' : 'Daily') : unit === 'week' ? (_language === 'ar' ? 'أسبوعيًا' : 'Weekly') : unit === 'month' ? (_language === 'ar' ? 'شهريًا' : 'Monthly') : (_language === 'ar' ? 'سنويًا' : 'Yearly');
  }
  return `${count} ${unit}${count === 1 ? '' : 's'}`
    .replace(/day/, _language === 'ar' ? 'يوم' : 'day')
    .replace(/week/, _language === 'ar' ? 'أسبوع' : 'week')
    .replace(/month/, _language === 'ar' ? 'شهر' : 'month')
    .replace(/year/, _language === 'ar' ? 'سنة' : 'year');
}

export {}
