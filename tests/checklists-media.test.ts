import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Kernel, MemoryStore } from '@ayatodoist/core-kernel';
import { tasksCorePlugin } from '@ayatodoist/plugin-tasks-core';
import { checklistsPlugin, checklistToNote, noteToChecklist } from '@ayatodoist/plugin-checklists-media';
import { handleUploads } from '../apps/server/src/uploads';
import * as fs from 'node:fs';
import * as path from 'node:path';

function boot(): Kernel {
  const kernel = new Kernel({ store: new MemoryStore() });
  kernel.installAll([tasksCorePlugin, checklistsPlugin] as never);
  kernel.start();
  return kernel;
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('checklists plugin', () => {
  test('creates a task, sets items, computes stats and toggles', async () => {
    const kernel = boot();
    await kernel.execute('project.ensureInbox', {});
    const task = await kernel.execute<unknown, { id: string }>('task.create', { content: 'مهمة بقائمة' });

    await kernel.execute('checklist.setItems', {
      taskId: task.id,
      items: [
        { id: 'a', text: 'الأول', checked: true },
        { id: 'b', text: 'الثاني', checked: false },
        { id: 'c', text: 'الثالث', checked: false },
      ],
    });

    expect(await kernel.query('checklist.stats', { taskId: task.id })).toEqual({ completed: 1, total: 3 });

    await kernel.execute('checklist.toggle', { taskId: task.id, itemId: 'b' });
    expect(await kernel.query('checklist.stats', { taskId: task.id })).toEqual({ completed: 2, total: 3 });
    expect(kernel.store.get('tasks', task.id)?.checklist.map((item) => item.checked)).toEqual([true, true, false]);
  });

  test('undo rolls a checklist change back', async () => {
    const kernel = boot();
    await kernel.execute('project.ensureInbox', {});
    const task = await kernel.execute<unknown, { id: string }>('task.create', { content: 'Undo me' });
    await kernel.execute('checklist.setItems', { taskId: task.id, items: [{ id: 'x', text: 'one', checked: false }] });
    await kernel.execute('checklist.toggle', { taskId: task.id, itemId: 'x' });
    expect(kernel.store.get('tasks', task.id)?.checklist[0]?.checked).toBe(true);

    expect(kernel.undo()).toBe(true);
    expect(kernel.store.get('tasks', task.id)?.checklist[0]?.checked).toBe(false);
    expect(kernel.redo()).toBe(true);
    expect(kernel.store.get('tasks', task.id)?.checklist[0]?.checked).toBe(true);
  });

  test('add and remove items keep order', async () => {
    const kernel = boot();
    await kernel.execute('project.ensureInbox', {});
    const task = await kernel.execute<unknown, { id: string }>('task.create', { content: 'Items' });
    const added = await kernel.execute<unknown, { items: Array<{ id: string; text: string }> }>('checklist.addItem', {
      taskId: task.id,
      text: 'first',
    });
    await kernel.execute('checklist.addItem', { taskId: task.id, text: 'second', afterId: added.items[0]!.id });
    const items = await kernel.query<unknown, Array<{ id: string; text: string }>>('checklist.items', { taskId: task.id });
    expect(items.map((item) => item.text)).toEqual(['first', 'second']);

    await kernel.execute('checklist.removeItem', { taskId: task.id, itemId: items[0]!.id });
    expect(await kernel.query('checklist.items', { taskId: task.id })).toHaveLength(1);
  });
});

describe('note ⇄ checklist conversion', () => {
  test('deterministic note → checklist strips bullets and numbering (EN + AR)', () => {
    const items = noteToChecklist(['- شراء الحليب', '2. اتصل بالبريد', '• Third item', '٤. رابع بند', 'plain line'].join('\n'));
    expect(items.map((item) => item.text)).toEqual(['شراء الحليب', 'اتصل بالبريد', 'Third item', 'رابع بند', 'plain line']);
    expect(items.map((item) => item.id)).toEqual(['chk-1', 'chk-2', 'chk-3', 'chk-4', 'chk-5']);
    expect(items.every((item) => item.checked === false)).toBe(true);
  });

  test('markdown task lists carry their checked state', () => {
    const items = noteToChecklist('- [x] done\n- [ ] todo');
    expect(items.map((item) => [item.text, item.checked])).toEqual([
      ['done', true],
      ['todo', false],
    ]);
  });

  test('images are preserved through both directions', () => {
    const note = ['- صورة المنتج', '![image](uploads/sample.png)', '- https://example.com/pic.jpg'].join('\n');
    const items = noteToChecklist(note);
    expect(items[0]).toMatchObject({ text: 'صورة المنتج', image: null });
    expect(items[1]).toMatchObject({ text: '', image: 'uploads/sample.png' });
    expect(items[2]).toMatchObject({ text: '', image: 'https://example.com/pic.jpg' });

    const back = checklistToNote(items);
    expect(back).toContain('☐ صورة المنتج');
    expect(back).toContain('![image](uploads/sample.png)');
    expect(back).toContain('![image](https://example.com/pic.jpg)');
    expect(noteToChecklist(back).map((item) => item.image)).toEqual([null, 'uploads/sample.png', 'https://example.com/pic.jpg']);
    expect(noteToChecklist(back)[0]?.text).toBe('صورة المنتج');

    const checked = checklistToNote([{ id: '1', text: 'done', checked: true }]);
    expect(checked).toBe('☑ done');
  });

  test('fromNote converts a task description, toNote restores it', async () => {
    const kernel = boot();
    await kernel.execute('project.ensureInbox', {});
    const task = await kernel.execute<unknown, { id: string }>('task.create', {
      content: 'ملاحظة',
      description: '- بند أول\n- بند ثاني\n3) third',
    });
    const converted = await kernel.execute<unknown, { items: Array<{ text: string }> }>('checklist.fromNote', { taskId: task.id });
    expect(converted.items.map((item) => item.text)).toEqual(['بند أول', 'بند ثاني', 'third']);
    expect(await kernel.query('checklist.stats', { taskId: task.id })).toEqual({ completed: 0, total: 3 });
    expect(kernel.store.get('tasks', task.id)?.description).toBe('');

    await kernel.execute('checklist.toNote', { taskId: task.id });
    expect(kernel.store.get('tasks', task.id)?.description).toContain('☐ بند أول');
    expect(await kernel.query('checklist.stats', { taskId: task.id })).toEqual({ completed: 0, total: 0 });
  });
});

describe('uploads API', () => {
  const created: string[] = [];
  const app = handleUploads();
  const uploadDir = path.resolve(process.cwd(), 'data', 'uploads');
  // Pin the local-disk backend: `bun test` loads .env, so a live Supabase
  // project would otherwise receive these fixtures. The Supabase branch is
  // exercised against a real project, not in the unit suite.
  const savedEnv = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  beforeAll(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterAll(() => {
    if (savedEnv.url) process.env.SUPABASE_URL = savedEnv.url;
    if (savedEnv.key) process.env.SUPABASE_SERVICE_ROLE_KEY = savedEnv.key;
    for (const filename of created) {
      const target = path.join(uploadDir, filename);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    if (fs.existsSync(uploadDir) && fs.readdirSync(uploadDir).length === 0) fs.rmdirSync(uploadDir);
  });

  test('rejects an empty or non-image payload', async () => {
    const empty = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);

    const notImage = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: Buffer.from('plain text, not an image').toString('base64') }),
    });
    expect(notImage.status).toBe(400);
    expect((await notImage.json()).error.message).toContain('Unsupported image type');
  });

  test('stores a PNG on disk and serves it back with the right content type', async () => {
    const form = new FormData();
    form.set('file', new Blob([PNG_1PX], { type: 'image/png' }), 'pixel.png');
    const posted = await app.request('/', { method: 'POST', body: form });
    expect(posted.status).toBe(200);
    const body = (await posted.json()) as { ok: boolean; filename: string; content_type: string; size: number };
    created.push(body.filename);
    expect(body.ok).toBe(true);
    expect(body.filename.endsWith('.png')).toBe(true);
    expect(body.content_type).toBe('image/png');
    expect(body.size).toBe(PNG_1PX.length);
    expect(fs.existsSync(path.join(uploadDir, body.filename))).toBe(true);

    const fetched = await app.request(`/${body.filename}`);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('image/png');
    const bytes = Buffer.from(await fetched.arrayBuffer());
    expect(bytes.equals(PNG_1PX)).toBe(true);
  });

  test('accepts base64 JSON uploads and rejects unknown filenames', async () => {
    const posted = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: `data:image/png;base64,${PNG_1PX.toString('base64')}` }),
    });
    expect(posted.status).toBe(200);
    const body = (await posted.json()) as { filename: string };
    created.push(body.filename);

    const missing = await app.request('/does-not-exist.png');
    expect(missing.status).toBe(404);
    const badExt = await app.request('/evil.exe');
    expect(badExt.status).toBe(404);

    const removed = await app.request(`/${body.filename}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(fs.existsSync(path.join(uploadDir, body.filename))).toBe(false);
  });
});
