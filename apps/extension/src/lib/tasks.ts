/**
 * Task / project / label access shared by the side panel, popup and content
 * script. Reads come from the kernel snapshot so counts and badges agree with
 * the web app; writes go through the same commands the web app uses.
 */

import { ayaServer } from './server';

export interface TaskRow {
  id: string;
  projectId: string;
  content: string;
  description: string;
  priority: number;
  dueDate: string | null;
  dueTime: string | null;
  deadline: string | null;
  labels: string[];
  checklist: Array<{ id: string; text: string; checked: boolean; image?: string | null }>;
  attachments?: string[];
  isCompleted: boolean;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  nameAr?: string;
  color: string;
  isInbox?: boolean;
  isArchived?: boolean;
}

export interface LabelRow {
  id: string;
  name: string;
  color?: string;
}

export interface KernelData {
  tasks: TaskRow[];
  projects: ProjectRow[];
  labels: LabelRow[];
}

export const NOTE_LABEL = 'ملاحظة';
export const PRIORITY_LABELS: Record<number, string> = {
  1: 'P1',
  2: 'P2',
  3: 'P3',
  4: 'P4',
};
export const PRIORITY_COLORS: Record<number, string> = {
  1: '#de4c4a',
  2: '#f59e0b',
  3: '#1e78ff',
  4: '#7b8794',
};

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function loadData(): Promise<KernelData> {
  const snapshot = await ayaServer.snapshot();
  const collections = snapshot?.collections ?? {};
  const tasks: TaskRow[] = (collections.tasks ?? []).filter((task: TaskRow) => !task.deletedAt);
  const projects: ProjectRow[] = (collections.projects ?? []).filter((project: ProjectRow) => !project.isArchived);
  const labels: LabelRow[] = collections.labels ?? [];
  return { tasks, projects, labels };
}

export function projectName(project: ProjectRow | undefined): string {
  if (!project) return '';
  return project.nameAr || project.name || '';
}

export function labelName(category: LabelRow | undefined): string {
  return category?.name ?? '';
}

export function taskLabelNames(task: TaskRow, labels: LabelRow[]): string[] {
  return (task.labels ?? [])
    .map((id) => labels.find((label) => label.id === id)?.name ?? '')
    .filter(Boolean);
}

export function isNote(task: TaskRow, labels: LabelRow[]): boolean {
  return taskLabelNames(task, labels).includes(NOTE_LABEL);
}

export function sourceUrl(task: TaskRow): string | null {
  const match = /https?:\/\/[^\s)\]]+/.exec(task.description ?? '');
  return match ? match[0] : null;
}

export function isToday(task: TaskRow): boolean {
  return task.dueDate === todayISO();
}

export function isOverdue(task: TaskRow): boolean {
  return Boolean(task.dueDate && task.dueDate < todayISO() && !task.isCompleted);
}

export function sortTasks(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((a, b) => {
    if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
    const aDue = a.dueDate ?? '9999-99-99';
    const bDue = b.dueDate ?? '9999-99-99';
    if (aDue !== bDue) return aDue < bDue ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  });
}

export interface CreateTaskInput {
  content: string;
  description?: string;
  projectId?: string;
  priority?: number;
  dueDate?: string;
  dueTime?: string;
  labelNames?: string[];
}

export async function createTask(input: CreateTaskInput): Promise<{ id: string }> {
  return ayaServer.command<{ id: string }>('task.create', input);
}

export async function createTaskWithChecklist(
  input: CreateTaskInput,
  items: string[],
): Promise<{ id: string }> {
  const created = await createTask(input);
  if (items.length) {
    await updateTask(created.id, {
      checklist: items.map((text, index) => ({ id: `chk-${Date.now()}-${index}`, text, checked: false, image: null })),
    });
  }
  return created;
}

export async function updateTask(
  id: string,
  patch: {
    content?: string;
    priority?: number;
    dueDate?: string | null;
    dueTime?: string | null;
    completed?: boolean;
    checklist?: TaskRow['checklist'];
  },
): Promise<any> {
  return ayaServer.command('task.update', { id, ...patch });
}

export async function completeTask(id: string, completed = true): Promise<any> {
  return ayaServer.command('task.complete', { id, completed });
}

export async function deleteTask(id: string): Promise<any> {
  return ayaServer.command('task.delete', { id });
}

export async function toggleChecklistItem(task: TaskRow, itemId: string): Promise<TaskRow['checklist']> {
  await ayaServer.command('checklist.toggle', { taskId: task.id, itemId });
  return (task.checklist ?? []).map((item) =>
    item.id === itemId ? { ...item, checked: !item.checked } : item,
  );
}

/* --------------------------------------------------------------- quick add */

export interface ParsedQuickAdd {
  content: string;
  priority?: number;
  dueDate?: string;
  projectName?: string;
  labels: string[];
}

/**
 * Lightweight natural-language parsing: `p1`…`p4`, `#project`, `@label`,
 * `!today` / `!tomorrow` (and the Arabic `اليوم` / `بكرة` tokens) are removed
 * from the title and turned into real fields.
 */
export function parseQuickAdd(raw: string, defaultPriority = 4): ParsedQuickAdd {
  let text = ` ${raw} `;
  const labels: string[] = [];
  let priority: number | undefined;
  let dueDate: string | undefined;
  let projectName: string | undefined;

  text = text.replace(/(^|\s)(?:p|P)([1-4])(?=\s)/g, (_all, lead: string, level: string) => {
    priority = Number(level);
    return lead;
  });
  text = text.replace(/(^|\s)#([^\s#]+)/g, (_all, lead: string, name: string) => {
    projectName = name;
    return lead;
  });
  text = text.replace(/(^|\s)@([^\s@]+)/g, (_all, lead: string, name: string) => {
    labels.push(name);
    return lead;
  });

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  text = text.replace(/(^|\s)(?:!today|!اليوم|اليوم)(?=\s)/g, (_all, lead: string) => {
    dueDate = iso(today);
    return lead;
  });
  text = text.replace(/(^|\s)(?:!tomorrow|!بكرة|!غدا|بكرة|غدا)(?=\s)/g, (_all, lead: string) => {
    dueDate = iso(tomorrow);
    return lead;
  });

  const content = text.replace(/\s+/g, ' ').trim();
  return {
    content: content || raw.trim(),
    priority: priority ?? defaultPriority,
    dueDate,
    projectName,
    labels,
  };
}

export function resolveProjectId(projects: ProjectRow[], name?: string): string | undefined {
  if (!name) return undefined;
  const needle = name.trim().toLowerCase();
  const found = projects.find(
    (project) =>
      project.name.toLowerCase() === needle ||
      (project.nameAr ?? '').toLowerCase() === needle ||
      project.id === name,
  );
  return found?.id;
}

export function filterCounts(data: KernelData) {
  const active = data.tasks.filter((task) => !task.isCompleted);
  return {
    all: active.length,
    today: active.filter((task) => isToday(task)).length,
    inbox: active.filter((task) => task.projectId === '__inbox' || data.projects.find((p) => p.id === task.projectId)?.isInbox).length,
    notes: active.filter((task) => isNote(task, data.labels)).length,
    projects: data.projects.filter((project) => !project.isInbox).length,
  };
}
