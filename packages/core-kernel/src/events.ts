/** Typed, dependency-free event bus. */
export type Listener<T> = (payload: T) => void;
export type Unsubscribe = () => void;

export class EventBus<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<never>);
    this.listeners.set(event, set);
    return () => set.delete(listener as Listener<never>);
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as Listener<Events[K]>)(payload);
      } catch (error) {
        // A listener must never take down the kernel.
        console.error('[kernel] event listener failed', event, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export interface KernelEvents extends Record<string, unknown> {
  'kernel:change': { patches: Array<{ collection: string; id: string; op: 'upsert' | 'remove' }>; activityId: string | null; actor: 'user' | 'ai' | 'system' };
  'kernel:notice': import('@ayatodoist/shared-types').KernelNotice;
  'kernel:activity': import('@ayatodoist/shared-types').Activity;
  'kernel:history': { canUndo: boolean; canRedo: boolean; label: string | null };
  'kernel:plugins': { pluginId: string; enabled: boolean };
  'kernel:settings': { settings: import('@ayatodoist/shared-types').AppSettings };
  'kernel:command': { name: string; actor: string; ok: boolean; error?: string; durationMs: number };
  'kernel:audit': { name: string; input: unknown; at: string; actor: string };
}
