import type {
  Activity,
  AppSettings,
  Comment,
  Filter,
  Goal,
  Label,
  PluginState,
  Project,
  Reminder,
  Section,
  Task,
} from './entities';

/** Every persisted collection in the platform. Adding a domain means adding a key here. */
export interface CollectionMap {
  tasks: Task;
  projects: Project;
  sections: Section;
  labels: Label;
  filters: Filter;
  comments: Comment;
  reminders: Reminder;
  activity: Activity;
  goals: Goal;
  plugins: PluginState;
  settings: AppSettings;
}

export type CollectionKey = keyof CollectionMap;
export type RowOf<K extends CollectionKey> = CollectionMap[K];

export const COLLECTION_KEYS: readonly CollectionKey[] = [
  'tasks',
  'projects',
  'sections',
  'labels',
  'filters',
  'comments',
  'reminders',
  'activity',
  'goals',
  'plugins',
  'settings',
] as const;

/** Structural view of the persistence layer used by the kernel and every plugin. */
export interface DataStore {
  list<K extends CollectionKey>(collection: K): RowOf<K>[];
  get<K extends CollectionKey>(collection: K, id: string): RowOf<K> | null;
  upsert<K extends CollectionKey>(collection: K, row: RowOf<K>): void;
  remove<K extends CollectionKey>(collection: K, id: string): void;
  replaceAll(snapshot: Partial<Record<CollectionKey, unknown[]>>): void;
  snapshot(): Record<CollectionKey, unknown[]>;
}

export interface IdGenerator {
  (prefix?: string): string;
}

export interface CommandContext {
  store: DataStore;
  now: () => string;
  today: () => string;
  id: IdGenerator;
  settings: () => AppSettings;
  actor: 'user' | 'ai' | 'system';
  /** Emit a transient UI event (toast, navigation request, highlight…) without persisting it. */
  notify: (event: KernelNotice) => void;
  /** Deterministic-ish random id helper shared by plugins. */
  batchId: string;
  services: ServiceRegistry;
}

export interface KernelNotice {
  type: 'toast' | 'navigate' | 'open-task' | 'highlight' | 'refresh';
  message?: string;
  tone?: 'info' | 'success' | 'error';
  route?: { kind: string; id?: string | null };
  taskId?: string;
  undoable?: boolean;
}

export interface ServiceRegistry {
  provide(name: string, value: unknown): void;
  get<T = unknown>(name: string): T | undefined;
  has(name: string): boolean;
}

export interface SnapshotEnvelope {
  version: number;
  collections: Record<CollectionKey, unknown[]>;
  savedAt: string;
}
