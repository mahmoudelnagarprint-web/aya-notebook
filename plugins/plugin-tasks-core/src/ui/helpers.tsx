import type { Language, Task } from '@ayatodoist/core-kernel';
import { addDayString, todayString, useKernel, useKernelVersion } from '@ayatodoist/plugin-sdk/react';
import type { Tone } from '@ayatodoist/plugin-sdk/ui';

export interface PriorityMeta {
  ar: string;
  en: string;
  tone: Tone;
}

export const PRIORITY_META: Record<number, PriorityMeta> = {
  1: { ar: 'عاجل', en: 'Urgent', tone: 'rose' },
  2: { ar: 'مرتفع', en: 'High', tone: 'amber' },
  3: { ar: 'متوسط', en: 'Medium', tone: 'blue' },
  4: { ar: 'منخفض', en: 'Low', tone: 'slate' },
};

export function priorityMeta(priority: number): PriorityMeta {
  return PRIORITY_META[priority] ?? PRIORITY_META[4]!;
}

export function taskTime(task: Task, language: Language): string {
  if (!task.dueTime) return '';
  const [hourRaw, minute] = task.dueTime.split(':').map(Number);
  const hour = hourRaw ?? 0;
  if (language === 'ar') return `${`${hour}`.padStart(2, '0')}:${`${minute ?? 0}`.padStart(2, '0')}`;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 === 0 ? 12 : hour % 12}:${`${minute ?? 0}`.padStart(2, '0')} ${suffix}`;
}

/** Arabic relative day label; falls back to a short numeric date beyond a week. */
export function formatDue(task: Task, language: Language, withTime = true): string {
  if (!task.dueDate) return '';
  const today = todayString();
  const time = withTime ? taskTime(task, language) : '';
  let label: string;
  if (task.dueDate === today) label = language === 'ar' ? 'اليوم' : 'Today';
  else if (task.dueDate === addDayString(today, 1)) label = language === 'ar' ? 'غدًا' : 'Tomorrow';
  else if (task.dueDate === addDayString(today, -1)) label = language === 'ar' ? 'أمس' : 'Yesterday';
  else {
    const [year, month, day] = task.dueDate.split('-');
    label = language === 'ar' ? `${day}/${month}/${year?.slice(2)}` : `${day}/${month}/${year?.slice(2)}`;
  }
  return time ? `${label} · ${time}` : label;
}

export function isOverdue(task: Task): boolean {
  return Boolean(task.dueDate && !task.isCompleted && task.dueDate < todayString());
}

export function isToday(task: Task): boolean {
  return task.dueDate === todayString();
}

export function startOfWeek(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  const diff = (value.getDay() - 6 + 7) % 7;
  return addDayString(day, -diff);
}

export interface Buckets {
  today: Task[];
  completed: Task[];
  upcoming: Task[];
  inbox: Task[];
  overdue: Task[];
  all: Task[];
}

export function useTaskBuckets(): Buckets {
  const kernel = useKernel();
  useKernelVersion();
  const today = todayString();
  const weekEnd = addDayString(today, 7);
  const all = kernel.store.list('tasks').filter((task) => !task.deletedAt);
  const open = all.filter((task) => !task.isCompleted);
  return {
    all,
    today: open.filter((task) => task.dueDate === today),
    completed: all.filter((task) => task.isCompleted),
    upcoming: open.filter((task) => task.dueDate !== null && task.dueDate > today && task.dueDate <= weekEnd),
    inbox: open.filter((task) => task.projectId === '__inbox'),
    overdue: open.filter((task) => task.dueDate !== null && task.dueDate < today),
  };
}

/** Shared sort: dated first (soonest), then priority, then manual order. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aDate = a.dueDate ?? '9999-12-31';
    const bDate = b.dueDate ?? '9999-12-31';
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0;
  });
}
