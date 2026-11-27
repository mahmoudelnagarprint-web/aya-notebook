import { z } from 'zod';
import type { CommandContext, PluginDescriptor } from '@ayatodoist/core-kernel';
import type { ChecklistItem } from './checklist-types';

export type { ChecklistItem, ChecklistData } from './checklist-types';

const ITEM_SCHEMA = z.object({
  id: z.string().min(1),
  text: z.string(),
  checked: z.boolean(),
  image: z.string().nullable().optional(),
});

function normalizeItem(item: Partial<ChecklistItem> & { id?: string; text?: string; checked?: boolean }): ChecklistItem {
  return {
    id: item.id ?? `chk-${Math.random().toString(36).slice(2, 8)}`,
    text: String(item.text ?? ''),
    checked: Boolean(item.checked),
    image: item.image ?? null,
  };
}

function readChecklist(ctx: CommandContext, taskId: string): ChecklistItem[] {
  const task = ctx.store.get('tasks', taskId) as any;
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  return Array.isArray(task.checklist) ? task.checklist : [];
}

function writeChecklist(ctx: CommandContext, taskId: string, items: ChecklistItem[]): void {
  const task = ctx.store.get('tasks', taskId) as any;
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  ctx.store.upsert('tasks', { ...task, checklist: items, updatedAt: ctx.now() });
}

/* ---------------------------------------------------------- conversions */

const BULLET = /^[•\-*+]\s*/;
const NUMBERED = /^[\d\u0660-\u0669]+[.)]\s*/;
const MARKDOWN_TASK = /^-\s\[([ xX])\]\s+(.*)$/s;
const CHECKBOX = /^([☑☐])\s*(.*)$/s;
const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const BARE_URL = /^(https?:\/\/\S+)$/;

/** Deterministic note → checklist: bullets, numbering (EN + AR digits), images. */
export function noteToChecklist(text: string): ChecklistItem[] {
  if (!text) return [];
  const items: ChecklistItem[] = [];
  let counter = 0;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    let checked = false;
    let body = line;

    const markdown = body.match(MARKDOWN_TASK);
    if (markdown) {
      checked = /[xX]/.test(markdown[1] ?? '');
      body = (markdown[2] ?? '').trim();
    } else {
      const checkbox = body.match(CHECKBOX);
      if (checkbox) {
        checked = checkbox[1] === '☑';
        body = (checkbox[2] ?? '').trim();
      }
    }

    body = body.replace(BULLET, '').replace(NUMBERED, '').trim();

    // A line that only carries an image (markdown or bare URL) becomes an image item.
    const imageMatch = body.match(IMAGE_ONLY);
    if (imageMatch) {
      items.push({ id: `chk-${++counter}`, text: '', checked, image: imageMatch[2]! });
      continue;
    }
    const urlMatch = body.match(BARE_URL);
    if (urlMatch && !body.startsWith('- ')) {
      items.push({ id: `chk-${++counter}`, text: '', checked, image: urlMatch[1]! });
      continue;
    }

    // Inline trailing image on a text line stays attached to the text.
    const inline = body.match(/^(.*?)\s*!\[[^\]]*\]\(([^)]+)\)$/);
    if (inline && inline[1]) {
      items.push({ id: `chk-${++counter}`, text: inline[1].trim(), checked, image: inline[2]! });
      continue;
    }

    items.push({ id: `chk-${++counter}`, text: body, checked, image: null });
  }

  return items;
}

/** Checklist → note. Images go on their own line so the round-trip is lossless. */
export function checklistToNote(items: ChecklistItem[]): string {
  if (!items || items.length === 0) return '';
  const lines: string[] = [];
  for (const item of items) {
    // Image-only items must not emit a bare checkbox line: '' would round-trip
    // back as an extra empty text item.
    if (item.text) lines.push(`${item.checked ? '☑' : '☐'} ${item.text}`);
    if (item.image) lines.push(`![image](${item.image})`);
  }
  return lines.join('\n');
}

/* --------------------------------------------------------------- plugin */

export const checklistsPlugin: PluginDescriptor = {
  id: 'checklists-media',
  name: 'Checklists & media',
  nameAr: 'قوائم المهام والوسائط',
  version: '0.1.0',
  description: 'Checklist sub-items with undo, note ⇄ checklist conversion and image attachments.',
  descriptionAr: 'قوائم فرعية قابلة للتراجع وتحويل الملاحظات والصور.',
  capabilities: ['checklist.setItems', 'checklist.toggle', 'note ⇄ checklist', 'image items'],
  defaultEnabled: true,
  commands: [
    {
      name: 'checklist.setItems',
      kind: 'mutation',
      category: 'checklists',
      title: 'Set checklist items',
      titleAr: 'تعيين عناصر القائمة',
      description: 'Replaces the checklist of a task.',
      input: z.object({ taskId: z.string().min(1), items: z.array(ITEM_SCHEMA) }),
      handler: (input: { taskId: string; items: ChecklistItem[] }, ctx: CommandContext) => {
        const items = input.items.map(normalizeItem);
        writeChecklist(ctx, input.taskId, items);
        return { items };
      },
    },
    {
      name: 'checklist.toggle',
      kind: 'mutation',
      category: 'checklists',
      title: 'Toggle a checklist item',
      description: 'Flips the checked state of one checklist item.',
      input: z.object({ taskId: z.string().min(1), itemId: z.string().min(1) }),
      handler: (input: { taskId: string; itemId: string }, ctx: CommandContext) => {
        const items = readChecklist(ctx, input.taskId).map((item) =>
          item.id === input.itemId ? { ...item, checked: !item.checked } : item,
        );
        writeChecklist(ctx, input.taskId, items);
        return { items };
      },
    },
    {
      name: 'checklist.addItem',
      kind: 'mutation',
      category: 'checklists',
      title: 'Add a checklist item',
      description: 'Appends (or inserts after a given item) a new checklist item.',
      input: z.object({ taskId: z.string().min(1), text: z.string().min(1), afterId: z.string().optional() }),
      handler: (input: { taskId: string; text: string; afterId?: string }, ctx: CommandContext) => {
        const items = [...readChecklist(ctx, input.taskId)];
        const item = normalizeItem({ id: ctx.id('chk') as unknown as string, text: input.text, checked: false });
        const index = input.afterId ? items.findIndex((entry) => entry.id === input.afterId) : -1;
        if (index >= 0) items.splice(index + 1, 0, item);
        else items.push(item);
        writeChecklist(ctx, input.taskId, items);
        return { items };
      },
    },
    {
      name: 'checklist.removeItem',
      kind: 'mutation',
      category: 'checklists',
      title: 'Remove a checklist item',
      description: 'Removes one checklist item by id.',
      input: z.object({ taskId: z.string().min(1), itemId: z.string().min(1) }),
      handler: (input: { taskId: string; itemId: string }, ctx: CommandContext) => {
        const items = readChecklist(ctx, input.taskId).filter((item) => item.id !== input.itemId);
        writeChecklist(ctx, input.taskId, items);
        return { items };
      },
    },
    {
      name: 'checklist.fromNote',
      kind: 'mutation',
      category: 'checklists',
      title: 'Convert the description into a checklist',
      description: 'Parses the task description into checklist items and clears the description.',
      input: z.object({ taskId: z.string().min(1) }),
      handler: (input: { taskId: string }, ctx: CommandContext) => {
        const task = ctx.store.get('tasks', input.taskId) as any;
        if (!task) throw new Error(`Unknown task: ${input.taskId}`);
        const items = noteToChecklist(task.description ?? '');
        ctx.store.upsert('tasks', { ...task, description: '', checklist: items, updatedAt: ctx.now() });
        return { items };
      },
    },
    {
      name: 'checklist.toNote',
      kind: 'mutation',
      category: 'checklists',
      title: 'Convert the checklist into a note',
      description: 'Writes the checklist back into the task description and clears it.',
      input: z.object({ taskId: z.string().min(1) }),
      handler: (input: { taskId: string }, ctx: CommandContext) => {
        const task = ctx.store.get('tasks', input.taskId) as any;
        if (!task) throw new Error(`Unknown task: ${input.taskId}`);
        const description = checklistToNote(Array.isArray(task.checklist) ? task.checklist : []);
        ctx.store.upsert('tasks', { ...task, description, checklist: [], updatedAt: ctx.now() });
        return { description };
      },
    },
    {
      name: 'checklist.stats',
      kind: 'query',
      category: 'checklists',
      title: 'Checklist progress',
      description: 'Returns completed / total counts for a task checklist.',
      input: z.object({ taskId: z.string().min(1) }),
      handler: (input: { taskId: string }, ctx: CommandContext) => {
        const items = readChecklist(ctx, input.taskId);
        return { completed: items.filter((item) => item.checked).length, total: items.length };
      },
    },
    {
      name: 'checklist.items',
      kind: 'query',
      category: 'checklists',
      title: 'List checklist items',
      description: 'Returns the checklist items of a task in order.',
      input: z.object({ taskId: z.string().min(1) }),
      handler: (input: { taskId: string }, ctx: CommandContext) => readChecklist(ctx, input.taskId),
    },
  ],
};

export const checklistsUi = checklistsPlugin;
export function checklistsInput(_input: any): void {}
export function checklistsCtx(_ctx: any): void {}
