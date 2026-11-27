import { z } from 'zod';
import type {
  Activity,
  Actor,
  AppSettings,
  CommandContext,
  DataStore,
  IdGenerator,
  KernelNotice,
  ServiceRegistry,
} from '@ayatodoist/shared-types';
import { ActivitySchema } from '@ayatodoist/shared-types';
import type { EventBus, KernelEvents } from './events';
import { TracingStore, deepClone } from './store';

export interface CommandDefinition<I = unknown, O = unknown> {
  name: string;
  kind: 'query' | 'mutation';
  category: string;
  title: string;
  titleAr?: string;
  description: string;
  input: z.ZodType<I, z.ZodTypeDef, any>;
  output?: z.ZodType<O>;
  /** Destructive mutations need explicit confirmation in the "safe" autonomy mode. */
  destructive?: boolean;
  undoable?: boolean;
  /** Hidden commands are not exposed to the AI agent as tools. */
  hidden?: boolean;
  handler: (input: I, ctx: CommandContext) => O | Promise<O>;
  summarize?: (input: I, result: O) => string;
  pluginId?: string;
}

export type AnyCommandDefinition = CommandDefinition<any, any>;

export type PermissionVerdict = 'ok' | 'confirm' | 'denied';

export class CommandError extends Error {
  constructor(
    readonly code: 'validation' | 'permission' | 'confirmation' | 'not-found' | 'handler' | 'disabled',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface ExecuteOptions {
  actor?: Actor;
  /** The user already approved a destructive AI action. */
  confirmed?: boolean;
  batchId?: string;
  /** Skip activity log writing (used for hydration / seeding internal calls). */
  silent?: boolean;
  skipPermission?: boolean;
}

export interface UndoEntry {
  activityId: string;
  label: string;
  command: string;
  patches: Array<{ collection: string; id: string; op: 'upsert' | 'remove'; before: unknown | null; after: unknown | null }>;
}

export interface QueryAuditEntry {
  name: string;
  actor: Actor;
  at: string;
  input: unknown;
}

export interface CommandBusOptions {
  store: DataStore;
  events: EventBus<KernelEvents>;
  getSettings: () => AppSettings;
  services: ServiceRegistry;
  id?: IdGenerator;
  clock?: () => Date;
  onAfterMutation?: () => void;
  historyLimit?: number;
}

/** The single gateway for every read and write in the platform. */
export class CommandBus {
  private registry = new Map<string, AnyCommandDefinition>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private currentBatchId: string | null = null;
  readonly audit: QueryAuditEntry[] = [];

  constructor(private readonly options: CommandBusOptions) {}

  private get clock(): Date {
    return this.options.clock ? this.options.clock() : new Date();
  }

  private nextId(prefix: string): string {
    return this.options.id ? this.options.id(prefix) : `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
  }

  register(definition: AnyCommandDefinition, pluginId?: string): void {
    if (this.registry.has(definition.name) && this.registry.get(definition.name)?.pluginId !== pluginId) {
      throw new Error(`Command name collision: ${definition.name}`);
    }
    if (!(definition.input instanceof z.ZodType)) {
      throw new Error(`Command ${definition.name} must declare a Zod input schema`);
    }
    this.registry.set(definition.name, { ...definition, pluginId: pluginId ?? definition.pluginId });
  }

  unregisterPlugin(pluginId: string): void {
    for (const [name, definition] of [...this.registry]) {
      if (definition.pluginId === pluginId) this.registry.delete(name);
    }
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  get(name: string): AnyCommandDefinition | undefined {
    return this.registry.get(name);
  }

  list(filter?: { kind?: 'query' | 'mutation'; includeHidden?: boolean; pluginId?: string }): AnyCommandDefinition[] {
    return [...this.registry.values()].filter((definition) => {
      if (filter?.kind && definition.kind !== filter.kind) return false;
      if (filter?.pluginId && definition.pluginId !== filter.pluginId) return false;
      if (!filter?.includeHidden && definition.hidden) return false;
      return true;
    });
  }

  /** AI tool catalogue — every registered, visible command of the running kernel. */
  toolCatalogue(): AnyCommandDefinition[] {
    return this.list({ includeHidden: false });
  }

  permissionFor(definition: AnyCommandDefinition, actor: Actor): PermissionVerdict {
    if (actor !== 'ai') return 'ok';
    const autonomy = this.options.getSettings().agent.autonomy;
    if (autonomy === 'read-only') return definition.kind === 'query' ? 'ok' : 'denied';
    if (autonomy === 'safe' && definition.kind === 'mutation' && definition.destructive) return 'confirm';
    return 'ok';
  }

  historyState(): { canUndo: boolean; canRedo: boolean; label: string | null } {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      label: this.undoStack.at(-1)?.label ?? this.redoStack.at(-1)?.label ?? null,
    };
  }

  private emitHistory(): void {
    this.options.events.emit('kernel:history', this.historyState());
  }

  private buildContext(actor: Actor, store: DataStore, batchId: string): CommandContext {
    const clock = this.clock;
    return {
      store,
      actor,
      now: () => this.clock.toISOString(),
      today: () => {
        const date = this.clock;
        return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
      },
      id: (prefix?: string) => this.nextId(prefix ?? 'id'),
      settings: () => this.options.getSettings(),
      services: this.options.services,
      batchId,
      notify: (notice: KernelNotice) => this.options.events.emit('kernel:notice', notice),
    };
  }

  async execute<I = unknown, O = unknown>(name: string, rawInput: I, options: ExecuteOptions = {}): Promise<O> {
    const definition = this.registry.get(name) as CommandDefinition<I, O> | undefined;
    if (!definition) throw new CommandError('not-found', `Unknown command: ${name}`);
    const actor: Actor = options.actor ?? 'user';
    const started = performance.now();

    const parsed = definition.input.safeParse(rawInput);
    if (!parsed.success) {
      throw new CommandError('validation', `Invalid input for ${name}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`, parsed.error.issues);
    }

    if (!options.skipPermission) {
      const verdict = this.permissionFor(definition, actor);
      if (verdict === 'denied') {
        const error = new CommandError('permission', `Agent autonomy is read-only; ${name} is a mutation.`);
        this.options.events.emit('kernel:command', { name, actor, ok: false, error: error.message, durationMs: 0 });
        throw error;
      }
      if (verdict === 'confirm' && !options.confirmed) {
        throw new CommandError('confirmation', `Confirmation required for destructive command ${name}`, { command: name, input: parsed.data });
      }
    }

    if (definition.kind === 'query') {
      const audit: QueryAuditEntry = { name, actor, at: this.clock.toISOString(), input: parsed.data };
      this.audit.push(audit);
      if (this.audit.length > 300) this.audit.shift();
      this.options.events.emit('kernel:audit', audit);
      try {
        const result = await definition.handler(parsed.data, this.buildContext(actor, this.options.store, options.batchId ?? 'query'));
        this.options.events.emit('kernel:command', { name, actor, ok: true, durationMs: Math.round(performance.now() - started) });
        return result;
      } catch (error) {
        this.options.events.emit('kernel:command', { name, actor, ok: false, error: (error as Error).message, durationMs: Math.round(performance.now() - started) });
        throw error;
      }
    }

    const batchId = options.batchId ?? this.currentBatchId ?? this.nextId('batch');
    const tracing = new TracingStore(this.options.store);
    const context = this.buildContext(actor, tracing, batchId);

    try {
      const result = await definition.handler(parsed.data, context);
      const patches = tracing.flush();
      const summary = definition.summarize
        ? definition.summarize(parsed.data, result)
        : `${definition.title}`;
      const activityId = this.nextId('act');

      if (!options.silent) {
        const activity: Activity = ActivitySchema.parse({
          id: activityId,
          actor,
          command: name,
          commandTitle: definition.title,
          summary,
          input: parsed.data,
          patches,
          affected: patches.map((patch) => ({ collection: patch.collection, id: patch.id })),
          undoable: definition.undoable !== false && patches.length > 0,
          undone: false,
          batchId,
          createdAt: this.clock.toISOString(),
        });
        this.options.store.upsert('activity', activity);
        this.options.events.emit('kernel:activity', activity);

        if (activity.undoable) {
          this.undoStack.push({ activityId, label: summary, command: name, patches });
          if (this.undoStack.length > (this.options.historyLimit ?? 120)) this.undoStack.shift();
          this.redoStack = [];
          this.emitHistory();
        }
      }

      this.options.events.emit('kernel:change', {
        patches: patches.map((patch) => ({ collection: patch.collection, id: patch.id, op: patch.op })),
        activityId,
        actor,
      });
      this.options.onAfterMutation?.();
      this.options.events.emit('kernel:command', { name, actor, ok: true, durationMs: Math.round(performance.now() - started) });
      return result;
    } catch (error) {
      this.options.events.emit('kernel:command', {
        name,
        actor,
        ok: false,
        error: (error as Error).message,
        durationMs: Math.round(performance.now() - started),
      });
      throw error;
    }
  }

  async query<I = unknown, O = unknown>(name: string, input: I): Promise<O> {
    return this.execute<I, O>(name, input, { actor: 'user' });
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    TracingStore.apply(this.options.store, entry.patches, 'undo');
    this.markActivity(entry.activityId, true);
    this.redoStack.push(entry);
    this.options.events.emit('kernel:change', {
      patches: entry.patches.map((patch) => ({ collection: patch.collection, id: patch.id, op: patch.op })),
      activityId: entry.activityId,
      actor: 'user',
    });
    this.options.onAfterMutation?.();
    this.emitHistory();
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    TracingStore.apply(this.options.store, entry.patches, 'redo');
    this.markActivity(entry.activityId, false);
    this.undoStack.push(entry);
    this.options.events.emit('kernel:change', {
      patches: entry.patches.map((patch) => ({ collection: patch.collection, id: patch.id, op: patch.op })),
      activityId: entry.activityId,
      actor: 'user',
    });
    this.options.onAfterMutation?.();
    this.emitHistory();
    return true;
  }

  /** Reverts one specific activity entry (used by the agent audit view). */
  undoActivity(activityId: string): boolean {
    const index = this.undoStack.findIndex((entry) => entry.activityId === activityId);
    if (index === -1) return false;
    const [entry] = this.undoStack.splice(index, 1);
    if (!entry) return false;
    TracingStore.apply(this.options.store, entry.patches, 'undo');
    this.markActivity(activityId, true);
    this.redoStack.push(entry);
    this.options.events.emit('kernel:change', {
      patches: entry.patches.map((patch) => ({ collection: patch.collection, id: patch.id, op: patch.op })),
      activityId,
      actor: 'user',
    });
    this.options.onAfterMutation?.();
    this.emitHistory();
    return true;
  }

  private markActivity(activityId: string, undone: boolean): void {
    const activity = this.options.store.get('activity', activityId);
    if (activity) this.options.store.upsert('activity', { ...deepClone(activity), undone });
  }

  /** Groups several user/AI actions under one undo entry label (batch operations). */
  withBatch<T>(batchId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.currentBatchId;
    this.currentBatchId = batchId;
    return run().finally(() => {
      this.currentBatchId = previous;
    });
  }
}
