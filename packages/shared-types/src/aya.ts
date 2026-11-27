/**
 * Aya (آية) — the living personal agent of __AYAtodoist.
 *
 * These types are the single contract shared by the server brain, the SQLite /
 * Supabase persistence adapters, the web control room and the mobile/extension
 * clients that will talk to the exact same `/api/aya/*` endpoints.
 */

export const AYA_ROLES = ['chat_deep', 'background_24_7', 'vision', 'memory_summarizer'] as const;
export type AyaRole = (typeof AYA_ROLES)[number];

export const AYA_ROLE_LABELS: Record<AyaRole, { ar: string; en: string }> = {
  chat_deep: { ar: 'المحادثة والتفكير العميق', en: 'Chat & deep reasoning' },
  background_24_7: { ar: 'القراءة الخلفية 24/7 والتنظيم', en: '24/7 background reading' },
  vision: { ar: 'قراءة الصور والملفات', en: 'Vision & files' },
  memory_summarizer: { ar: 'تلخيص الذاكرة الطويلة', en: 'Long-term memory summarizer' },
};

export type AyaAutonomy = 'full_undo' | 'confirm_delete' | 'read_only';

export const AYA_MEMORY_CATEGORIES = ['preferences', 'projects', 'people', 'rules', 'ideas'] as const;
export type AyaMemoryCategory = (typeof AYA_MEMORY_CATEGORIES)[number];

export const AYA_MEMORY_CATEGORY_LABELS: Record<AyaMemoryCategory, { ar: string; en: string }> = {
  preferences: { ar: 'تفضيلات', en: 'Preferences' },
  projects: { ar: 'مشاريع', en: 'Projects' },
  people: { ar: 'أشخاص', en: 'People' },
  rules: { ar: 'قواعد وتوجيهات', en: 'Rules' },
  ideas: { ar: 'أفكار', en: 'Ideas' },
};

export const AYA_INBOX_KINDS = ['question', 'reminder', 'organization', 'procrastination', 'tip'] as const;
export type AyaInboxKind = (typeof AYA_INBOX_KINDS)[number];

export const AYA_INBOX_KIND_LABELS: Record<AyaInboxKind, { ar: string; en: string }> = {
  question: { ar: 'استفسارات وأسئلة', en: 'Questions' },
  reminder: { ar: 'تذكيرات ذكية', en: 'Smart reminders' },
  organization: { ar: 'اقتراحات تنظيم', en: 'Organization proposals' },
  procrastination: { ar: 'رادار التسويف', en: 'Procrastination radar' },
  tip: { ar: 'نصائح وأفكار', en: 'Tips & ideas' },
};

export type AyaChannelId = 'telegram' | 'whatsapp';
export type AyaMessageRole = 'user' | 'assistant' | 'system';
export type AyaInboxStatus = 'unread' | 'read' | 'done' | 'dismissed';
export type AyaModelStatus = 'unknown' | 'ok' | 'failed';

export interface AyaProvider {
  id: string;
  name: string;
  /** Normalised OpenAI-compatible base URL, always ending in `/v1`. */
  baseUrl: string;
  /** Stored server-side only; responses never include the raw key. */
  apiKey?: string;
  hasKey?: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AyaModel {
  id: string;
  providerId: string;
  /** Provider-native model id, e.g. `openai/gpt-4o-mini`. */
  modelId: string;
  label: string;
  contextWindow: number | null;
  vision: boolean;
  /** Lower runs first inside the failover pool. */
  priority: number;
  /** Checked = allowed as an automatic failover target. */
  failover: boolean;
  enabled: boolean;
  status: AyaModelStatus;
  latencyMs: number | null;
  /** Short, secret-free diagnostic from the last probe (e.g. `HTTP 401: invalid_api_key`). */
  lastError?: string | null;
  lastTestedAt: string | null;
  createdAt: string;
}

export type AyaRouting = Record<AyaRole, string | null>;

export interface AyaConversation {
  id: string;
  title: string;
  channel: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface AyaAttachment {
  id?: string;
  kind: 'image' | 'file';
  name: string;
  mime: string;
  /** Stored upload filename (served by /api/v1/uploads/:filename). */
  filename?: string;
  url?: string;
  size?: number;
  /** Extracted text for text/code/markdown/JSON/CSV/PDF attachments. */
  text?: string;
}

export interface AyaToolAction {
  name: string;
  input: Record<string, unknown>;
}

export interface AyaMessage {
  id: string;
  conversationId: string;
  role: AyaMessageRole;
  content: string;
  attachments: AyaAttachment[];
  toolCalls: AyaToolAction[];
  /** Provider-qualified model that actually answered, e.g. `OpenRouter/qwen-2.5`. */
  model: string | null;
  /** True when a fallback model answered instead of the primary. */
  failover: boolean;
  /** Groups every mutation from one turn for atomic batch undo. */
  batchId: string | null;
  seq: number;
  createdAt: string;
}

export interface AyaMemory {
  id: string;
  category: AyaMemoryCategory;
  content: string;
  source: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
}

export interface AyaInboxItem {
  id: string;
  kind: AyaInboxKind;
  title: string;
  body: string;
  status: AyaInboxStatus;
  actions: AyaToolAction[];
  createdAt: string;
  updatedAt: string;
}

export interface AyaJournalEntry {
  id: string;
  insight: string;
  category: string;
  createdAt: string;
}

export interface AyaChannelRecord {
  id: AyaChannelId;
  enabled: boolean;
  config: Record<string, string | number | boolean>;
  updatedAt: string;
}

export interface AyaSettings {
  personaAr: string;
  personaEn: string;
  autonomy: AyaAutonomy;
  daemonEnabled: boolean;
  heartbeatMinutes: number;
  /** Periodic model health check + automatic re-activation of recovered models. */
  healthCheckEnabled: boolean;
  healthCheckMinutes: number;
  healthCheckLastAt: string | null;
  /** Command names Aya may never call. */
  disabledTools: string[];
  updatedAt: string;
}

/** Everything the Aya brain needs from storage. Implemented by SQLite and Supabase-ready SQL. */
export interface AyaPersistenceAdapter {
  listProviders(): Promise<AyaProvider[]>;
  saveProvider(provider: AyaProvider): Promise<void>;
  deleteProvider(id: string): Promise<void>;

  listModels(providerId?: string): Promise<AyaModel[]>;
  saveModel(model: AyaModel): Promise<void>;
  deleteModel(id: string): Promise<void>;

  getRouting(): Promise<AyaRouting>;
  saveRouting(routing: AyaRouting): Promise<void>;

  listConversations(): Promise<AyaConversation[]>;
  saveConversation(conversation: AyaConversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  listMessages(conversationId: string): Promise<AyaMessage[]>;
  saveMessage(message: AyaMessage): Promise<void>;
  updateMessage(message: AyaMessage): Promise<void>;
  deleteMessage(conversationId: string, id: string): Promise<void>;
  deleteMessagesAfter(conversationId: string, seq: number): Promise<void>;
  nextMessageSeq(conversationId: string): Promise<number>;

  listMemories(): Promise<AyaMemory[]>;
  saveMemory(memory: AyaMemory): Promise<void>;
  deleteMemory(id: string): Promise<void>;

  listInbox(status?: AyaInboxStatus): Promise<AyaInboxItem[]>;
  saveInboxItem(item: AyaInboxItem): Promise<void>;
  deleteInboxItem(id: string): Promise<void>;

  listJournal(): Promise<AyaJournalEntry[]>;
  saveJournal(entry: AyaJournalEntry): Promise<void>;
  deleteJournal(id: string): Promise<void>;

  listChannels(): Promise<AyaChannelRecord[]>;
  saveChannel(channel: AyaChannelRecord): Promise<void>;

  getSettings(): Promise<AyaSettings>;
  saveSettings(settings: AyaSettings): Promise<void>;
}

export const DEFAULT_AYA_ROUTING: AyaRouting = {
  chat_deep: null,
  background_24_7: null,
  vision: null,
  memory_summarizer: null,
};

export const DEFAULT_AYA_SETTINGS: AyaSettings = {
  personaAr: '',
  personaEn: '',
  autonomy: 'confirm_delete',
  daemonEnabled: true,
  heartbeatMinutes: 20,
  healthCheckEnabled: true,
  healthCheckMinutes: 15,
  healthCheckLastAt: null,
  disabledTools: [],
  updatedAt: new Date(0).toISOString(),
};

/** Serialisable projection sent to every client (never contains raw provider keys). */
export interface AyaPublicConfig {
  providers: Array<AyaProvider & { models: AyaModel[] }>;
  routing: AyaRouting;
  settings: AyaSettings;
  channels: AyaChannelRecord[];
  tools: Array<{ name: string; title: string; description: string; category: string; destructive: boolean; enabled: boolean }>;
  daemon: { enabled: boolean; heartbeatMinutes: number; lastRunAt: string | null; lastCandidateCount: number };
}

/** Server → client SSE / REST envelope. */
export interface AyaChatResult {
  conversationId: string;
  messages: AyaMessage[];
  model: string | null;
  failover: boolean;
  batchId: string | null;
  pending: AyaToolAction[];
  error?: string;
}
