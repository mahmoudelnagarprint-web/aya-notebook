# Building a plugin for __AYAtodoist

A plugin is a folder under `plugins/`, a descriptor registered by the kernel, and — optionally — a UI module composed by the web shell. This guide builds a complete **Notes** plugin as the worked example.

## 0. Ground rules

- No plugin imports another plugin's source. Depend only on `@ayatodoist/plugin-sdk` and `@ayatodoist/shared-types`.
- All state changes go through commands; queries never mutate.
- Nothing in the kernel may know your domain.
- A plugin must survive being disabled at any moment: its commands disappear and its UI contributions are filtered out.

## 1. Create the package

```text
plugins/plugin-notes/
├── package.json
└── src/
    ├── index.ts      # descriptor + commands (React-free)
    └── ui.tsx        # optional React module
```

```json
{
  "name": "@ayatodoist/plugin-notes",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./ui": "./src/ui.tsx" },
  "dependencies": {
    "@ayatodoist/plugin-sdk": "workspace:*",
    "@ayatodoist/shared-types": "workspace:*",
    "react": "^18.3.1",
    "zod": "^3.24.1"
  }
}
```

Then run `bun install` at the repository root.

## 2. Register it in three places

1. `tsconfig.json` → `paths`: `@ayatodoist/plugin-notes` and `@ayatodoist/plugin-notes/ui`.
2. `apps/web/vite.config.ts` → matching `resolve.alias` entries (specific subpaths before the bare package).
3. `apps/web/src/app/registry.ts` and `apps/server/src/plugins.ts` → import the descriptor/UI module and append it to the arrays.

Everything else — installing, enabling, disabling, tool discovery — is automatic.

## 3. Define commands

```ts
// plugins/plugin-notes/src/index.ts
import { z } from 'zod';
import { defineMutation, definePlugin, defineQuery } from '@ayatodoist/plugin-sdk';

const noteCreate = defineMutation<{ title: string; body?: string }, { id: string }>({
  name: 'note.create',
  category: 'notes',
  title: 'Create note',
  titleAr: 'إنشاء ملاحظة',
  description: 'Creates a note. Use note.list first to avoid duplicates.',
  input: z.object({ title: z.string().min(1).max(200), body: z.string().max(20000).default('') }),
  summarize: (input) => `Created note “${input.title}”`,
  handler: (input, ctx) => {
    const note = {
      id: ctx.id('note'),
      title: input.title,
      body: input.body ?? '',
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
    };
    ctx.store.upsert('notes' as never, note as never); // use a real schema/collection
    return { id: note.id };
  },
});

const noteList = defineQuery<{ limit?: number }, unknown[]>({
  name: 'note.list',
  category: 'notes',
  title: 'List notes',
  description: 'Returns the newest notes.',
  input: z.object({ limit: z.number().int().min(1).max(100).default(20) }),
  handler: (input, ctx) => ctx.store.list('notes' as never).slice(0, input.limit ?? 20),
});

export const notesPlugin = definePlugin({
  id: 'notes',
  name: 'Notes',
  nameAr: 'ملاحظات',
  version: '0.1.0',
  description: 'A second-brain notebook.',
  descriptionAr: 'دفتر ملاحظات.',
  capabilities: ['notes'],
  commands: [noteCreate, noteList],
  defaultEnabled: true,
});
```

Notes:

- `category` groups tools for the agent UI; `title`/`description` are the tool documentation the LLM sees.
- Mark destructive commands with `destructive: true` so `safe` autonomy requires approval.
- Add `undoable: false` only for commands that must not be undone.
- New entities require a Zod schema in `shared-types`, a `CollectionKey`, a Prisma model, and a hydrate mapping. Prefer reusing existing collections while prototyping.

## 4. Add UI

```tsx
// plugins/plugin-notes/src/ui.tsx
import { SLOT, type PluginUiModule } from '@ayatodoist/plugin-sdk';
import { useExecute, useQuery, useLanguage } from '@ayatodoist/plugin-sdk/react';
import { Button, Icon, Input } from '@ayatodoist/plugin-sdk/ui';

function NotesPanel() {
  const language = useLanguage();
  const notes = useQuery<Array<{ id: string; title: string }>>('note.list', {});
  const execute = useExecute();
  return (
    <section className="rounded-card border border-line bg-modal p-4">
      <h2 className="text-[14px] font-semibold">{language === 'ar' ? 'ملاحظات' : 'Notes'}</h2>
      {(notes.data ?? []).map((note) => (
        <p key={note.id} className="border-b border-line py-1 text-[12px]">{note.title}</p>
      ))}
      <Button size="sm" onClick={() => void execute('note.create', { title: 'Untitled' })}>
        <Icon name="plus" size={13} /> {language === 'ar' ? 'جديدة' : 'New'}
      </Button>
    </section>
  );
}

export const notesUi: PluginUiModule = {
  id: 'notes',
  messages: { ar: { 'notes.title': 'ملاحظات' }, en: { 'notes.title': 'Notes' } },
  routes: [],
  nav: [],
  slots: {
    [SLOT.settingsSections]: [{ id: 'notes-settings', component: NotesPanel }],
  },
};
```

Available hooks: `useRuntime`, `useKernel`, `useSettings`, `useLanguage`, `useDirection`, `useQuery`, `useExecute`, `useSlot`, `useT`, `useStorage`, `useKernelEvents`, `useToast`. `useStorage(pluginId)` returns async `get/set/remove/keys` scoped to your plugin (IndexedDB on web).

Available slots: `sidebar.nav`, `sidebar.footer`, `topbar.actions`, `view.body`, `view.toolbar`, `task.detail.sidebar`, `quickadd.renderer`, `settings.sections`, `app.overlays`, `reporting.extra`.

For a layout plugin, contribute to `SLOT.viewBody` with a `layout` tag and accept `{ ctx: TaskViewContext }`.

## 5. Provide and consume services

```ts
// provider (in PluginUiModule)
registerServices: (services) => services.provide('notes.Card', NotesCard),

// consumer
const Card = kernel.services.get<React.ComponentType<{ id: string }>>('notes.Card');
```

Services are optional; always guard for `undefined`.

## 6. Settings schema

Add fields to `AppSettingsSchema` (or store plugin data through `useStorage`) and document the command that mutates them. Settings mutations must go through `core.settings.update` so they are validated and undoable.

## 7. Test

Tests live in `tests/` and run with `bun test`:

```ts
import { expect, test } from 'bun:test';
import { Kernel, MemoryStore } from '@ayatodoist/core-kernel';
import { notesPlugin } from '@ayatodoist/plugin-notes';

test('creates and undoes a note', async () => {
  const kernel = new Kernel({ store: new MemoryStore() });
  kernel.installAll([notesPlugin] as never);
  kernel.start();
  const { id } = await kernel.execute<unknown, { id: string }>('note.create', { title: 'Hello' });
  expect(kernel.undo()).toBe(true);
  expect(kernel.store.get('notes' as never, id)).toBeNull();
});
```

Also assert that the tool appears: `kernel.toolCatalogue().some(tool => tool.name === 'note.create')`.

## 8. Verification checklist

- [ ] `bunx tsc -p tsconfig.json --noEmit` passes.
- [ ] `bun test` passes.
- [ ] `bun run build` succeeds (UI plugins must be import-free of Node builtins).
- [ ] Disabling the plugin removes its nav entry, view, commands and AI tools.
- [ ] Every mutation shows in Activity and can be undone.
- [ ] Arabic and English strings both exist; layout works in RTL and LTR.
- [ ] No network calls except those the user configured.

## 9. Let Aya build the plugin

Because the agent can call `core.plugins.list`, `core.settings.update` and every command, it can prototype domain logic through existing commands. For *new source files*, the agent's audit trail still applies: ask it to create tasks/labels/projects/filters, and use this guide for the code scaffolding.
