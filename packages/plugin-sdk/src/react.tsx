import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type {
  AppSettings,
  Filter,
  Kernel,
  Label,
  PluginStatus,
  Project,
  Section,
  Task,
} from '@ayatodoist/core-kernel';

/* ------------------------------------------------------------------ kernel */

const KernelContext = createContext<Kernel | null>(null);

export function KernelProvider({ kernel, children }: { kernel: Kernel; children: ReactNode }) {
  return <KernelContext.Provider value={kernel}>{children}</KernelContext.Provider>;
}

export function useKernel(): Kernel {
  const kernel = useContext(KernelContext);
  if (!kernel) throw new Error('useKernel must be used inside <KernelProvider>');
  return kernel;
}

/* --------------------------------------------------------------- revisions */

let revision = 0;
const revisionListeners = new Set<() => void>();

/** Signals a data change React cannot observe (server hydration, file import). */
export function bumpKernelRevision(): void {
  revision += 1;
  for (const listener of revisionListeners) listener();
}

function subscribeRevision(listener: () => void): () => void {
  revisionListeners.add(listener);
  return () => revisionListeners.delete(listener);
}

function getRevision(): number {
  return revision;
}

/**
 * Re-renders on any kernel mutation and on explicit `bumpKernelRevision()`.
 * Rows read straight from `kernel.store` are therefore always live.
 */
export function useKernelVersion(): number {
  const kernel = useKernel();
  return useSyncExternalStore(
    (listener) => {
      const offKernel = kernel.subscribe(() => {
        revision += 1;
        listener();
      });
      const offRevision = subscribeRevision(listener);
      return () => {
        offKernel();
        offRevision();
      };
    },
    getRevision,
    getRevision,
  );
}

/* ------------------------------------------------------------------- data */

export function useSettings(): AppSettings {
  const kernel = useKernel();
  useKernelVersion();
  return kernel.getSettings();
}

export function useLanguage(): 'ar' | 'en' {
  return useSettings().language;
}

export function useTasks(): Task[] {
  const kernel = useKernel();
  useKernelVersion();
  return useMemo(() => kernel.store.list('tasks').filter((task) => !task.deletedAt), [kernel, revision]);
}

export function useProjects(): Project[] {
  const kernel = useKernel();
  useKernelVersion();
  return useMemo(() => sortRows(kernel.store.list('projects')), [kernel, revision]);
}

export function useSections(): Section[] {
  const kernel = useKernel();
  useKernelVersion();
  return useMemo(() => sortRows(kernel.store.list('sections')), [kernel, revision]);
}

export function useLabels(): Label[] {
  const kernel = useKernel();
  useKernelVersion();
  return useMemo(() => sortRows(kernel.store.list('labels')), [kernel, revision]);
}

export function useFilters(): Filter[] {
  const kernel = useKernel();
  useKernelVersion();
  return useMemo(() => sortRows(kernel.store.list('filters')), [kernel, revision]);
}

export function usePluginStatuses(): PluginStatus[] {
  const kernel = useKernel();
  useKernelVersion();
  return kernel.pluginStatuses();
}

export function useToolCount(): number {
  const kernel = useKernel();
  useKernelVersion();
  return kernel.toolCatalogue().length;
}

/** Manual order for collections that use `orderKey` strings. */
function sortRows<T extends { orderKey?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const left = a.orderKey ?? '~';
    const right = b.orderKey ?? '~';
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export function todayString(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDayString(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const value = new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1);
  value.setDate(value.getDate() + amount);
  return `${value.getFullYear()}-${`${value.getMonth() + 1}`.padStart(2, '0')}-${`${value.getDate()}`.padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- commands */

let commandErrorHandler: ((message: string) => void) | null = null;

/** Wired by the web runtime so plugins can surface failures without importing the app. */
export function setCommandErrorHandler(handler: ((message: string) => void) | null): void {
  commandErrorHandler = handler;
}

export type Runner = <T = unknown>(name: string, input?: unknown) => Promise<T | null>;

/**
 * Fire-and-forget command runner: every caller can `void run(...)` from a click
 * handler, and a failure becomes a toast instead of an unhandled rejection.
 */
export function useExecute(): Runner {
  const kernel = useKernel();
  return useCallback<Runner>(
    async (name, input) => {
      try {
        return (await kernel.execute(name, (input ?? {}) as never)) as never;
      } catch (error) {
        commandErrorHandler?.((error as Error).message || String(error));
        return null;
      }
    },
    [kernel],
  );
}

export function useUndoRedo(): { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void } {
  const kernel = useKernel();
  useKernelVersion();
  const state = kernel.bus.historyState();
  return {
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    undo: () => void kernel.execute('core.history.undo', {} as never),
    redo: () => void kernel.execute('core.history.redo', {} as never),
  };
}
