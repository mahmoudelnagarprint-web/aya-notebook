import { z } from 'zod';

/** A calendar day in local terms: YYYY-MM-DD. */
export const DayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A wall-clock time: HH:mm (24h). */
export const TimeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const PrioritySchema = z.number().int().min(1).max(4);
export const LayoutSchema = z.enum(['list', 'board', 'table', 'calendar']);
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const TASK_PRIORITIES = [1, 2, 3, 4] as const;
export type Priority = z.infer<typeof PrioritySchema>;
export type Layout = z.infer<typeof LayoutSchema>;

export const RecurrenceSchema = z.object({
  /** Raw human text, e.g. "every 3 days" / "every! week" */
  text: z.string().min(1),
  /** Normalised interval unit. */
  unit: z.enum(['day', 'week', 'month', 'year']),
  interval: z.number().int().min(1).max(365).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
  /** "every!" = strict (from completion date) rather than fixed schedule. */
  strict: z.boolean().default(false),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const ChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string().max(2000).default(''),
  checked: z.boolean().default(false),
  /** Optional image reference (uploaded filename or absolute URL) shown with the item. */
  image: z.string().nullable().optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  sectionId: z.string().nullable().default(null),
  parentId: z.string().nullable().default(null),
  content: z.string(),
  description: z.string().default(''),
  priority: PrioritySchema.default(4),
  orderKey: z.string(),
  dueDate: DayString.nullable().default(null),
  dueTime: TimeString.nullable().default(null),
  deadline: DayString.nullable().default(null),
  durationMinutes: z.number().int().min(0).max(24 * 60).nullable().default(null),
  recurrence: RecurrenceSchema.nullable().default(null),
  labels: z.array(z.string()).default([]),
  /** Inline checklist items — the source of the n/m progress badge. */
  checklist: z.array(ChecklistItemSchema).default([]),
  /** Uploaded image filenames attached to the task. */
  attachments: z.array(z.string()).default([]),
  isCompleted: z.boolean().default(false),
  completedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Behavioural counters surfaced by reporting / task rows. */
  completedCount: z.number().int().min(0).default(0),
  postponedCount: z.number().int().min(0).default(0),
  deletedAt: z.string().nullable().default(null),
});
export type Task = z.infer<typeof TaskSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: ColorSchema.default('#dc4c3e'),
  parentId: z.string().nullable().default(null),
  orderKey: z.string(),
  isFavorite: z.boolean().default(false),
  isArchived: z.boolean().default(false),
  isInbox: z.boolean().default(false),
  layout: LayoutSchema.default('list'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const SectionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string().min(1),
  orderKey: z.string(),
  isCollapsed: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Section = z.infer<typeof SectionSchema>;

export const LabelSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: ColorSchema.default('#246fe0'),
  orderKey: z.string(),
  isFavorite: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Label = z.infer<typeof LabelSchema>;

export const FilterSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  query: z.string().min(1),
  color: ColorSchema.default('#692ec2'),
  orderKey: z.string(),
  isFavorite: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Filter = z.infer<typeof FilterSchema>;

export const CommentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  content: z.string().min(1),
  author: z.enum(['user', 'ai']).default('user'),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const ReminderSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  /** Absolute ISO timestamp used by the scheduler. */
  at: z.string(),
  /** Original human text, e.g. "30m before" / "!30m". */
  text: z.string().default(''),
  createdAt: z.string(),
});
export type Reminder = z.infer<typeof ReminderSchema>;

export const PatchSchema = z.object({
  collection: z.string(),
  id: z.string(),
  op: z.enum(['upsert', 'remove']),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export type Patch = z.infer<typeof PatchSchema>;

export const ActivitySchema = z.object({
  id: z.string(),
  actor: z.enum(['user', 'ai', 'system']),
  command: z.string(),
  summary: z.string(),
  commandTitle: z.string().default(''),
  input: z.unknown().nullable().default(null),
  patches: z.array(PatchSchema).default([]),
  affected: z.array(z.object({ collection: z.string(), id: z.string() })).default([]),
  undoable: z.boolean().default(true),
  undone: z.boolean().default(false),
  batchId: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const GoalSchema = z.object({
  id: z.literal('goal'),
  dailyGoal: z.number().int().min(1).max(50).default(5),
  weeklyGoal: z.number().int().min(1).max(500).default(30),
  vacationMode: z.boolean().default(false),
  updatedAt: z.string(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const PluginStateSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  installedAt: z.string(),
});
export type PluginState = z.infer<typeof PluginStateSchema>;

export const AgentSettingsSchema = z.object({
  provider: z.enum(['openai', 'gemini', 'anthropic', 'openrouter', 'ollama', 'none']).default('none'),
  baseUrl: z.string().default('https://api.openai.com/v1'),
  model: z.string().default('gpt-4o-mini'),
  autonomy: z.enum(['full', 'safe', 'read-only']).default('safe'),
  maxSteps: z.number().int().min(1).max(30).default(10),
  temperature: z.number().min(0).max(2).default(0.2),
  autoApproveBatch: z.boolean().default(false),
});
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

export const DisplaySettingsSchema = z.object({
  showCompleted: z.boolean().default(false),
  showTaskCounts: z.boolean().default(true),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  grouping: z.enum(['section', 'priority', 'label', 'none']).default('section'),
  sorting: z.enum(['manual', 'date', 'priority', 'added', 'alphabetical']).default('manual'),
  weekStripDays: z.number().int().min(3).max(14).default(7),
  layout: LayoutSchema.default('list'),
  priorityFilter: z.enum(['all', 'p1', 'p2', 'p3', 'p4']).default('all'),
  dateFilter: z.enum(['all', 'today', 'week', 'overdue']).default('all'),
});
export type DisplaySettings = z.infer<typeof DisplaySettingsSchema>;

export const AppSettingsSchema = z.object({
  id: z.literal('app'),
  theme: z.enum(['light', 'dark', 'system']).default('dark'),
  language: z.enum(['ar', 'en']).default('ar'),
  sidebarCollapsed: z.boolean().default(false),
  weekStart: z.union([z.literal(0), z.literal(6)]).default(6),
  timeFormat: z.enum(['12h', '24h']).default('24h'),
  shortcutsEnabled: z.boolean().default(true),
  agent: AgentSettingsSchema,
  display: DisplaySettingsSchema,
  enabledPlugins: z.record(z.boolean()).default({}),
  updatedAt: z.string(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const RouteSchema = z.object({
  kind: z.enum(['inbox', 'today', 'upcoming', 'project', 'section', 'label', 'filter', 'filters-labels', 'reporting', 'settings', 'search', 'home', 'activity', 'completed', 'aya']),
  id: z.string().nullable().optional(),
  query: z.string().nullable().optional(),
});
export type Route = z.infer<typeof RouteSchema>;

export type ThemeResolved = 'light' | 'dark';
export type Language = 'ar' | 'en';
export type Actor = 'user' | 'ai' | 'system';
