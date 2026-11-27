import { z } from 'zod';
import type {
  Activity,
  AppSettings,
  CollectionKey,
  DataStore,
  KernelNotice,
  ServiceRegistry,
  SnapshotEnvelope,
} from '@ayatodoist/shared-types';
import { AgentSettingsSchema, AppSettingsSchema, DisplaySettingsSchema } from '@ayatodoist/shared-types';
import { CommandBus, CommandError, type CommandDefinition } from './command-bus';
import { EventBus, type KernelEvents } from './events';
import { PluginHost, type PluginDescriptor, type PluginStatus } from './plugin-host';
import { MemoryStore } from './store';
import { createDefaultSettings, defaultIdGenerator, toDay } from './utils';
import { zodToJsonSchema } from './json-schema';
import { EXTRA_COMMANDS } from './ext-commands';

export interface KernelOptions {
  store?: DataStore;
  clock?: () => Date;
  id?: (prefix?: string) => string;
  persist?: (snapshot: SnapshotEnvelope) => void | Promise<void>;
  historyLimit?: number;
}

class ServiceRegistryImpl implements ServiceRegistry {
  private services = new Map<string, unknown>();
  provide(name: string, value: unknown): void {
    this.services.set(name, value);
  }
  get<T = unknown>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }
  has(name: string): boolean {
    return this.services.has(name);
  }
}

const settingsPatchSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.enum(['ar', 'en']).optional(),
  sidebarCollapsed: z.boolean().optional(),
  weekStart: z.union([z.literal(0), z.literal(6)]).optional(),
  timeFormat: z.enum(['12h', '24h']).optional(),
  shortcutsEnabled: z.boolean().optional(),
  agent: AgentSettingsSchema.partial().optional(),
  display: DisplaySettingsSchema.partial().optional(),
  enabledPlugins: z.record(z.boolean()).optional(),
});

type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/**
 * The microkernel. It owns nothing domain specific: every product capability is a
 * plugin installed through the PluginHost, and every read/write goes through the bus.
 */
export class Kernel {
  readonly store: DataStore;
  readonly events: EventBus<KernelEvents>;
  readonly services: ServiceRegistry;
  readonly bus: CommandBus;
  readonly plugins: PluginHost;
  private settings: AppSettings;
  private started = false;
  private listeners = new Set<() => void>();

  constructor(private readonly options: KernelOptions = {}) {
    this.store = options.store ?? new MemoryStore();
    this.events = new EventBus<KernelEvents>();
    this.services = new ServiceRegistryImpl();

    const stored = this.store.get('settings', 'app');
    this.settings = stored ?? createDefaultSettings();

    this.bus = new CommandBus({
      store: this.store,
      events: this.events,
      getSettings: () => this.settings,
      services: this.services,
      id: options.id ?? defaultIdGenerator,
      clock: options.clock,
      historyLimit: options.historyLimit,
      onAfterMutation: () => {
        this.emitChange();
      },
    });

    this.plugins = new PluginHost({
      bus: this.bus,
      store: this.store,
      events: this.events,
      getSettings: () => this.settings,
      services: this.services,
    });
    this.plugins.subscribe(() => this.emitChange());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }

  install(descriptor: PluginDescriptor): void {
    this.plugins.install(descriptor);
  }

  installAll(descriptors: PluginDescriptor[]): void {
    this.plugins.installAll(descriptors);
    this.emitChange();
  }

  getSettings(): AppSettings {
    return this.settings;
  }

  /** Applies settings in-memory + persists the settings row. Used by the settings command. */
  applySettings(next: AppSettings, store: DataStore = this.store): void {
    this.settings = next;
    store.upsert('settings', next);
    this.events.emit('kernel:settings', { settings: next });
    this.emitChange();
  }

  settingsPatch(input: SettingsPatch): AppSettings {
    return AppSettingsSchema.parse({
      ...this.settings,
      ...input,
      agent: { ...this.settings.agent, ...(input.agent ?? {}) },
      display: { ...this.settings.display, ...(input.display ?? {}) },
      enabledPlugins: { ...this.settings.enabledPlugins, ...(input.enabledPlugins ?? {}) },
      updatedAt: new Date().toISOString(),
    });
  }

  pluginStatuses(): PluginStatus[] {
    return this.plugins.statuses();
  }

  async execute<I, O>(name: string, input: I, opts?: Parameters<CommandBus['execute']>[2]): Promise<O> {
    return this.bus.execute<I, O>(name, input, opts);
  }

  async query<I, O>(name: string, input: I): Promise<O> {
    return this.bus.query<I, O>(name, input);
  }

  toolCatalogue() {
    return this.bus.toolCatalogue().map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      kind: definition.kind,
      destructive: definition.destructive === true,
      category: definition.category,
      pluginId: definition.pluginId ?? 'kernel',
      inputSchema: zodToJsonSchema(definition.input),
    }));
  }

  undo(): boolean {
    return this.bus.undo();
  }

  redo(): boolean {
    return this.bus.redo();
  }

  snapshot(): SnapshotEnvelope {
    return {
      version: 1,
      collections: this.store.snapshot() as SnapshotEnvelope['collections'],
      savedAt: new Date().toISOString(),
    };
  }

  async persist(): Promise<void> {
    if (!this.options.persist) return;
    await this.options.persist(this.snapshot());
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.registerKernelCommands();
    if (!this.store.get('settings', 'app')) {
      this.store.upsert('settings', this.settings);
    }
    this.plugins.applyState();
    this.emitChange();
  }

  private registerKernelCommands(): void {
    const define = <I, O>(definition: CommandDefinition<I, O>) =>
      this.bus.register(definition as CommandDefinition<any, any>, 'core-kernel');

    // Domain commands (task/project/label) belong to the tasks-core plugin so
    // that disabling a plugin actually removes them from the bus.

    define<Record<string, never>, { overview: Record<CollectionKey, number>; settings: AppSettings; plugins: PluginStatus[]; tools: number; undo: ReturnType<CommandBus['historyState']> }>({
      name: 'core.system.overview',
      kind: 'query',
      category: 'system',
      title: 'System overview',
      titleAr: 'نظرة عامة على النظام',
      description: 'Returns collection counts, active settings, installed plugins and the registered tool count. Use this first to understand the workspace.',
      input: z.object({}),
      handler: (_input, ctx) => {
        const overview = {} as Record<CollectionKey, number>;
        for (const key of ['tasks', 'projects', 'sections', 'labels', 'filters', 'comments', 'reminders', 'activity', 'goals', 'plugins', 'settings'] as CollectionKey[]) {
          overview[key] = ctx.store.list(key).length;
        }
        return {
          overview,
          settings: ctx.settings(),
          plugins: this.pluginStatuses(),
          tools: this.toolCatalogue().length,
          undo: this.bus.historyState(),
        };
      },
    });

    define<SettingsPatch, AppSettings>({
      name: 'core.settings.update',
      kind: 'mutation',
      category: 'settings',
      title: 'Update application settings',
      titleAr: 'تحديث إعدادات التطبيق',
      description: 'Updates theme, language, sidebar, display preferences or AI agent autonomy/provider configuration. Only provided fields change.',
      input: settingsPatchSchema,
      handler: (input, ctx) => {
        const next = this.settingsPatch(input);
        ctx.store.upsert('settings', next);
        this.settings = next;
        this.events.emit('kernel:settings', { settings: next });
        return next;
      },
      summarize: (input) => `Settings updated: ${Object.keys(input).join(', ') || 'no changes'}`,
    });

    define<Record<string, never>, AppSettings>({
      name: 'core.settings.get',
      kind: 'query',
      category: 'settings',
      title: 'Get application settings',
      description: 'Returns the full settings object including agent autonomy rules and display options.',
      input: z.object({}),
      handler: (_input, ctx) => ctx.settings(),
    });

    define<Record<string, never>, PluginStatus[]>({
      name: 'core.plugins.list',
      kind: 'query',
      category: 'plugins',
      title: 'List plugins',
      description: 'Lists every installed plugin, whether it is enabled, and how many commands it contributes.',
      input: z.object({}),
      handler: () => this.pluginStatuses(),
    });

    define<{ pluginId: string; enabled: boolean }, PluginStatus>({
      name: 'core.plugins.setEnabled',
      kind: 'mutation',
      category: 'plugins',
      title: 'Enable or disable a plugin',
      titleAr: 'تفعيل أو تعطيل إضافة',
      description: 'Turns a plugin on or off. Disabling removes its commands and UI immediately and can be undone.',
      input: z.object({ pluginId: z.string().min(1), enabled: z.boolean() }).strict() as z.ZodType<{ pluginId: string; enabled: boolean }, z.ZodTypeDef, any>,
      handler: (input, ctx) => {
        this.plugins.setEnabledWithinCommand(input.pluginId, input.enabled, ctx.store);
        const settings = AppSettingsSchema.parse({
          ...ctx.settings(),
          enabledPlugins: { ...ctx.settings().enabledPlugins, [input.pluginId]: input.enabled },
          updatedAt: ctx.now(),
        });
        ctx.store.upsert('settings', settings);
        this.settings = settings;
        const status = this.pluginStatuses().find((plugin) => plugin.id === input.pluginId);
        if (!status) throw new CommandError('not-found', `Unknown plugin ${input.pluginId}`);
        ctx.notify({ type: 'toast', message: `${status.name} ${input.enabled ? 'enabled' : 'disabled'}`, tone: 'info' });
        return status;
      },
      summarize: (input) => `Plugin ${input.pluginId} ${input.enabled ? 'enabled' : 'disabled'}`,
    });

    define<{ limit?: number; actor?: 'user' | 'ai' | 'system'; includeUndone?: boolean }, Activity[]>({
      name: 'core.activity.list',
      kind: 'query',
      category: 'activity',
      title: 'List activity log',
      description: 'Returns the newest activity entries (what changed, by whom, and the resulting patches).',
      input: z.object({
        limit: z.number().int().min(1).max(500).default(50),
        actor: z.enum(['user', 'ai', 'system']).optional(),
        includeUndone: z.boolean().default(true),
      }),
      handler: (input, ctx) => {
        return ctx.store
          .list('activity')
          .filter((entry) => (input.actor ? entry.actor === input.actor : true))
          .filter((entry) => (input.includeUndone || !entry.undone ? true : false))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, input.limit);
      },
    });

    define<{ activityId: string }, { undone: boolean }>({
      name: 'core.activity.undo',
      kind: 'mutation',
      category: 'activity',
      title: 'Undo a specific activity',
      titleAr: 'التراجع عن عملية محددة',
      description: 'Reverts a single logged activity (including AI actions) by applying its inverse patches.',
      input: z.object({ activityId: z.string().min(1) }).strict() as z.ZodType<{ activityId: string }, z.ZodTypeDef, any>,
      destructive: false,
      undoable: false,
      handler: (input) => ({ undone: this.bus.undoActivity(input.activityId) }),
      summarize: (input) => `Undo activity ${input.activityId}`,
    });

    define<Record<string, never>, { canUndo: boolean; canRedo: boolean; label: string | null }>({
      name: 'core.history.state',
      kind: 'query',
      category: 'history',
      title: 'Undo/redo state',
      description: 'Reports whether undo and redo are available and the label of the next entry.',
      input: z.object({}),
      handler: () => this.bus.historyState(),
    });

    define<Record<string, never>, { undone: boolean }>({
      name: 'core.history.undo',
      kind: 'mutation',
      category: 'history',
      title: 'Undo the last action',
      titleAr: 'التراجع عن آخر إجراء',
      description: 'Reverts the most recent mutation (user or AI).',
      input: z.object({}),
      undoable: false,
      handler: () => ({ undone: this.bus.undo() }),
      summarize: () => 'Undo last action',
    });

    define<Record<string, never>, { redone: boolean }>({
      name: 'core.history.redo',
      kind: 'mutation',
      category: 'history',
      title: 'Redo the last undone action',
      description: 'Re-applies the most recently undone mutation.',
      input: z.object({}),
      undoable: false,
      handler: () => ({ redone: this.bus.redo() }),
      summarize: () => 'Redo last action',
    });

    define<Record<string, never>, { today: string; timezoneOffset: number }>({
      name: 'core.system.clock',
      kind: 'query',
      category: 'system',
      title: 'Current date and time',
      description: 'Returns today as YYYY-MM-DD plus the ISO timestamp, so relative dates can be resolved before creating tasks.',
      input: z.object({}),
      handler: (_input, ctx) => ({
        today: ctx.today(),
        timezoneOffset: new Date().getTimezoneOffset(),
      }),
    });
  }
}

export function createKernel(options?: KernelOptions): Kernel {
  return new Kernel(options);
}

export function notifyHelper(kernel: Kernel, notice: KernelNotice): void {
  kernel.events.emit('kernel:notice', notice);
}

export function todayIso(clock: Date = new Date()): string {
  return toDay(clock);
}
