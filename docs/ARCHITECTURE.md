# __AYAtodoist — Architecture

A plugin-first, local-first, Arabic-RTL workspace where **every product feature is a plugin** and **every read and write flows through one Zod-validated command bus**. The same kernel and the same plugin set run in the browser, in the local server, and inside Electron.

```
┌──────────────────────────── apps ────────────────────────────┐
│  web (React + Vite + Tailwind)   server (Hono)   desktop (Electron) │
└───────────────┬───────────────────────┬──────────────────────┘
                │                       │
        plugin UI modules        plugin descriptors
                │                       │
        ┌───────▼───────────────────────▼───────┐
        │            core-kernel                 │
        │  CommandBus · EventBus · PluginHost    │
        │  MemoryStore · TracingStore · Undo     │
        │  SyncQueue · fractional orderKey       │
        └───────────────┬───────────────────────┘
                        │ DataStore contract
        ┌───────────────▼───────────────────────┐
        │ shared-types (Zod DTOs, i18n, protocol)│
        │ plugin-sdk (definePlugin, React, UI kit)│
        │ database (Prisma ⇄ MemoryStore hydrate)│
        └────────────────────────────────────────┘
```

## 1. Monorepo

| Package | Responsibility |
| --- | --- |
| `packages/shared-types` | Zod entity schemas, DataStore contract, sync/MCP protocol, Arabic/English dictionaries, date helpers. |
| `packages/core-kernel` | EventBus, CommandBus, PluginHost, MemoryStore/TracingStore, undo/redo, orderKey, json-schema, SyncEngine, Kernel builtins. |
| `packages/plugin-sdk` | `definePlugin/defineCommand/defineQuery/defineMutation`, slot ids, `TaskViewContext`, React runtime + hooks, design-system primitives, DatePicker. |
| `packages/database` | Prisma schema (SQLite first, PostgreSQL-ready), incremental write-behind adapter, seed. |
| `plugins/*` | Tasks core, quick-add NLP, views/layouts, filters & labels, reporting, Aya (AI agent). |
| `apps/web` | Shell (280px right sidebar, RTL), slot renderer, settings hub, command palette, IndexedDB persistence + offline sync queue. |
| `apps/server` | Hono REST + `/api/mcp` JSON-RPC + `/ws` live events, Prisma hydration and patch write-behind. |
| `apps/desktop` | Electron main/preload, 1200×800 window, 700×640 floating quick add, tray, global shortcuts, `ayatodoist://`. |

## 2. The microkernel

`Kernel` owns four collaborators:

- **DataStore** — synchronous canonical state (`MemoryStore`). Every collection is a `Map`; `snapshot()` / `replaceAll()` move state in and out.
- **EventBus** — `kernel:change`, `kernel:notice`, `kernel:activity`, `kernel:history`, `kernel:plugins`, `kernel:settings`.
- **CommandBus** — the only execution path. Validates input, enforces AI policy, records activity + before/after patches, pushes undo, and emits notices.
- **PluginHost** — installs descriptors, registers commands, applies persisted enabled state, removes commands on disable.

Kernel builtins are deliberately domain-neutral: system overview, settings, plugins, activity, history, clock. Nothing about tasks lives in the kernel.

### Command contract

```ts
defineMutation({
  name: 'task.create',            // namespaced, unique
  category: 'tasks',
  title: 'Create a task',
  description: '…',              // becomes the AI/MCP tool description
  input: taskCreateSchema,        // Zod — validated and converted to JSON Schema
  destructive: false,
  handler: (input, ctx) => { … },
  summarize: (input, result) => `Created “${input.content}”`,
});
```

`ctx` exposes `store`, `events`, `services`, `settings()`, `now()`, `today()`, `id()`, `notify()`, and `actor`. Handlers never touch React or fetch.

### Undo / redo

`TracingStore` records a patch for every touched row:

```ts
{ collection: 'tasks', id, op: 'upsert' | 'remove', before, after }
```

The CommandBus stores these on the `Activity` row and in the undo stack. `core.history.undo`, `core.history.redo`, and `core.activity.undo { activityId }` apply inverse/replay patches. Every mutation — including AI actions — is therefore reversible, and the activity log doubles as an audit trail.

### Ordering

`orderKey` is a 15-character zero-padded decimal string. Lexicographic order equals numeric order, appends add a 1024 gap, inserts use the midpoint, and `OrderKeyExhausted` signals a sibling rebalance (`rebalanceOrderKeys`). Lexicographic sorting also works inside SQLite/PostgreSQL.

## 3. Plugins

A plugin has two halves:

1. **Descriptor (React-free)** — `definePlugin({ id, name, nameAr, version, commands, onEnable, onDisable })`. Installed by the kernel in every runtime.
2. **UI module** — `PluginUiModule { routes, nav, slots, messages, registerServices }`, composed by the web shell's static registry. The kernel never imports React.

Eight slot ids (`SLOT.viewBody`, `viewToolbar`, `sidebarNav`, `quickAdd`, `overlays`, `settingsSections`, …) let plugins extend each other without importing each other. Cross-plugin UI reuse goes through `kernel.services` (`tasks.TaskRow`). Every slot contribution and every route is wrapped in a `PluginErrorBoundary`, so a crashing plugin degrades to an inline card and never takes down the shell.

`TaskViewContext` is the contract between the task domain and layout renderers: groups, projects, sections, labels, layout, today, quick-add handlers. `plugin-tasks-core` builds the context and renders `view.body`; `plugin-views-layouts` contributes list/board/table/calendar renderers tagged with a `layout`, and the shell filters contributions by the active layout.

## 4. Agent tool bus

The AI layer is not a side channel:

```
LLM ⇄ adapter (OpenAI-compatible | Anthropic | Gemini)
        │ tool_calls
        ▼
   kernel.execute(name, args, { actor: 'ai' })
        │
   CommandBus validation → policy → handler → activity + patches
```

- `kernel.toolCatalogue()` converts every registered command to a tool: JSON Schema from Zod, title/description, `destructive`, `kind`.
- Tool names use dots; providers that reject dots get `task__create` and the engine maps back.
- Autonomy (`full`, `safe`, `read-only`) lives in `settings.agent` and is enforced **inside the CommandBus**, not the prompt. `read-only` rejects AI mutations with `code: 'permission'`; `safe` rejects destructive commands with `code: 'confirmation'` until the UI approves.
- The agent loop (`plugins/plugin-ai-agent/src/engine.ts`) runs up to `maxSteps` rounds, feeds tool results back, emits `tool-start`/`tool-result`/`confirmation` events, and stops when a confirmation is pending.
- BYOK keys live in per-plugin IndexedDB storage (`plugin:ai-agent:credentials`), never in settings, activity, or sync.

Because tools are discovered at call time, enabling or disabling a plugin instantly changes the agent's capabilities.

## 5. MCP

`POST /api/mcp` speaks JSON-RPC 2.0:

| Method | Behaviour |
| --- | --- |
| `initialize` | protocol `2024-11-05`, `tools` capability |
| `tools/list` | every tool with `inputSchema` + annotations |
| `tools/call` | executes through the CommandBus as actor `ai` |
| `ping` | liveness |

A single endpoint therefore exposes the entire workspace to external agents with identical validation and auditability.

## 6. Persistence & sync

- **Web** is local-first: the kernel lives in memory, snapshots are persisted to IndexedDB (`ayatodoist/kv`) with a 350 ms debounce, and mutations are queued in IndexedDB for the optional server.
- **Server** hydrates a `MemoryStore` from Prisma at boot, then applies activity patches to Prisma incrementally (write-behind, serialised promise chain). SQLite runs in WAL mode; the schema avoids SQLite-only types.
- **Sync**: `POST /api/v1/sync` replays queued operations sequentially through the server's identical kernel, returning per-operation success. Repeated operations are idempotent at the command level (e.g. `project.ensureInbox`, `filter.seedStarter`).
- **Live**: `/ws` broadcasts `hello`, `change` (throttled to 120 ms) and `activity` summaries.

## 7. Design system

Tokens are CSS custom properties in `apps/web/src/styles.css`, with Tailwind mapping them through `rgb(var(--token) / <alpha-value>)`:

- Dark canvas `#1e1e1e`, sidebar `#262626`, modal `#282828`, modal pane `#222222`; light canvas `#ffffff`, sidebar `#fcfaf8`.
- Priority `#d1453b` / `#eb8909` / `#246fe0` / `#a9a9a9` (dark `#ff7066`, `#ff9a13`, `#5297ff`).
- Sidebar 280 px, nav rows 34 px/6 px radius, task rows 42–43 px, 25 px subtask indent, board columns 286 px, cards 260×46, display popover 302×395, modal 864×474 (260 px pane), date picker 252 px, quick add 580 px.
- Radii 4/6/8/10/12; durations .15/.2/.25/.3 s with `cubic-bezier(.4,0,.2,1)`.
- Arabic-first: `dir="rtl"`, `IBM Plex Sans Arabic` + system fallback, sidebar physically anchored right in both directions, `EN`/`ع` switch in the header.

## 8. Security posture

- Local-first, no telemetry, no accounts.
- Server binds `127.0.0.1` by default; CORS allows only loopback/file origins.
- All external input is Zod-validated; agent and MCP calls share that validation.
- API keys stay in the browser/desktop device storage and are excluded from snapshots.
