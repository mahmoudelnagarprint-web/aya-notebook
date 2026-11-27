import type { z } from 'zod';
import type { AppSettings, CommandContext, DataStore, KernelNotice, ServiceRegistry } from '@ayatodoist/shared-types';
import type { CommandBus, CommandDefinition } from './command-bus';
import type { EventBus, KernelEvents } from './events';
import { createId } from './utils';

export interface PluginDescriptor {
  id: string;
  name: string;
  nameAr?: string;
  version: string;
  description: string;
  descriptionAr?: string;
  /** Human-readable capability bullets rendered in the plugins settings page. */
  capabilities?: string[];
  requires?: string[];
  commands?: CommandDefinition<any, any>[];
  settingsSchema?: z.ZodTypeAny;
  defaultEnabled?: boolean;
  /** Seed callback executed once when the plugin is enabled for the first time. */
  onEnable?: (ctx: PluginLifecycleContext) => void | Promise<void>;
  onDisable?: (ctx: PluginLifecycleContext) => void | Promise<void>;
}

export interface PluginLifecycleContext {
  pluginId: string;
  store: DataStore;
  settings: AppSettings;
  services: ServiceRegistry;
  notify: (notice: KernelNotice) => void;
}

export interface PluginStatus {
  id: string;
  name: string;
  nameAr: string;
  version: string;
  description: string;
  descriptionAr: string;
  capabilities: string[];
  enabled: boolean;
  commandCount: number;
  queryCount: number;
  mutationCount: number;
  installedAt: string;
}

export interface PluginHostOptions {
  bus: CommandBus;
  store: DataStore;
  events: EventBus<KernelEvents>;
  getSettings: () => AppSettings;
  services: ServiceRegistry;
}

export class PluginHost {
  private descriptors = new Map<string, PluginDescriptor>();
  private enabled = new Set<string>();
  private bootstrapped = new Set<string>();
  private changeListeners = new Set<() => void>();

  constructor(private readonly options: PluginHostOptions) {}

  install(descriptor: PluginDescriptor): void {
    if (this.descriptors.has(descriptor.id)) {
      // Re-installing the same plugin id simply refreshes the descriptor.
      this.descriptors.set(descriptor.id, descriptor);
      return;
    }
    for (const required of descriptor.requires ?? []) {
      if (!this.descriptors.has(required)) {
        console.warn(`[plugin-host] ${descriptor.id} requires ${required} which is not installed yet`);
      }
    }
    this.descriptors.set(descriptor.id, descriptor);
    const existing = this.options.store.get('plugins', descriptor.id);
    if (!existing) {
      this.options.store.upsert('plugins', {
        id: descriptor.id,
        enabled: descriptor.defaultEnabled !== false,
        installedAt: new Date().toISOString(),
      });
    }
  }

  installAll(descriptors: PluginDescriptor[]): void {
    // Two passes so `requires` resolution is order independent.
    for (const descriptor of descriptors) this.install(descriptor);
    this.applyState();
  }

  applyState(): void {
    for (const descriptor of this.descriptors.values()) {
      const row = this.options.store.get('plugins', descriptor.id);
      const shouldEnable = row ? row.enabled : descriptor.defaultEnabled !== false;
      const isEnabled = this.enabled.has(descriptor.id);
      if (shouldEnable && !isEnabled) {
        this.registerCommands(descriptor);
        this.enabled.add(descriptor.id);
        if (!this.bootstrapped.has(descriptor.id)) {
          this.bootstrapped.add(descriptor.id);
          void this.runHook(descriptor, 'onEnable');
        }
        this.options.events.emit('kernel:plugins', { pluginId: descriptor.id, enabled: true });
      } else if (!shouldEnable && isEnabled) {
        this.options.bus.unregisterPlugin(descriptor.id);
        this.enabled.delete(descriptor.id);
        void this.runHook(descriptor, 'onDisable');
        this.options.events.emit('kernel:plugins', { pluginId: descriptor.id, enabled: false });
      }
    }
    for (const listener of this.changeListeners) listener();
  }

  private registerCommands(descriptor: PluginDescriptor): void {
    for (const command of descriptor.commands ?? []) {
      this.options.bus.register(command, descriptor.id);
    }
  }

  private async runHook(descriptor: PluginDescriptor, hook: 'onEnable' | 'onDisable'): Promise<void> {
    const handler = descriptor[hook];
    if (!handler) return;
    try {
      await handler({
        pluginId: descriptor.id,
        store: this.options.store,
        settings: this.options.getSettings(),
        services: this.options.services,
        notify: (notice) => this.options.events.emit('kernel:notice', notice),
      });
    } catch (error) {
      console.error(`[plugin-host] ${descriptor.id}.${hook} failed`, error);
    }
  }

  isEnabled(pluginId: string): boolean {
    return this.enabled.has(pluginId);
  }

  get(pluginId: string): PluginDescriptor | undefined {
    return this.descriptors.get(pluginId);
  }

  all(): PluginDescriptor[] {
    return [...this.descriptors.values()];
  }

  statuses(): PluginStatus[] {
    return this.all().map((descriptor) => {
      const commands = descriptor.commands ?? [];
      const state = this.options.store.get('plugins', descriptor.id);
      return {
        id: descriptor.id,
        name: descriptor.name,
        nameAr: descriptor.nameAr ?? descriptor.name,
        version: descriptor.version,
        description: descriptor.description,
        descriptionAr: descriptor.descriptionAr ?? descriptor.description,
        capabilities: descriptor.capabilities ?? [],
        enabled: state ? state.enabled : this.enabled.has(descriptor.id),
        commandCount: commands.length,
        queryCount: commands.filter((command) => command.kind === 'query').length,
        mutationCount: commands.filter((command) => command.kind === 'mutation').length,
        installedAt: state?.installedAt ?? new Date().toISOString(),
      };
    });
  }

  /** Writes the enable flag; command registration follows through `applyState`. */
  writeEnabled(pluginId: string, enabled: boolean, store: DataStore): void {
    const existing = store.get('plugins', pluginId);
    store.upsert('plugins', {
      id: pluginId,
      enabled,
      installedAt: existing?.installedAt ?? new Date().toISOString(),
    });
    this.applyState();
  }

  /** Invoked by the plugin.toggle command from inside a traced handler. */
  setEnabledWithinCommand(pluginId: string, enabled: boolean, store: DataStore): void {
    if (!this.descriptors.has(pluginId)) throw new Error(`Unknown plugin: ${pluginId}`);
    const existing = store.get('plugins', pluginId);
    store.upsert('plugins', { id: pluginId, enabled, installedAt: existing?.installedAt ?? createId() });
    this.applyState();
  }

  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Context helper for plugins that need to reach the bus in hooks. */
  bus(): CommandBus {
    return this.options.bus;
  }
}
