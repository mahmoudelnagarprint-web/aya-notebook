-- ============================================================================
-- __AYAtodoist — Supabase / PostgreSQL schema
-- ============================================================================
-- Idempotent: safe to paste into Supabase → SQL Editor and run any number of
-- times. `CREATE TABLE IF NOT EXISTS` everywhere, no destructive statements.
--
-- Two families of tables:
--   1. Task domain (projects, tasks, checklist_items, labels, task_labels,
--      command_history, uploads) — the relational projection of the kernel.
--   2. Aya (aya_providers … aya_settings) — one row per record with its natural
--      payload in a `data jsonb` column, mirroring the SQLite `aya_rows` table
--      so the server can switch backends without changing a single query.
--
-- Access model: the server talks to Postgres with the service-role key.
-- RLS is enabled with no policies, so the anon/publishable key can never read
-- provider API keys, Aya memory or conversations.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. TASK DOMAIN
-- ============================================================================

-- --------------------------------------------------------------- projects
create table if not exists public.projects (
  id          text primary key,
  name        text not null,
  color       text not null default '#dc4c3e',
  parent_id   text references public.projects(id) on delete cascade,
  order_key   text not null default '',
  is_favorite boolean not null default false,
  is_archived boolean not null default false,
  is_inbox    boolean not null default false,
  layout      text not null default 'list',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_parent_idx on public.projects (parent_id);
create index if not exists projects_order_idx on public.projects (order_key);

-- ---------------------------------------------------------------- sections
create table if not exists public.sections (
  id           text primary key,
  project_id   text not null references public.projects(id) on delete cascade,
  name         text not null default '',
  order_key    text not null default '',
  is_collapsed boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists sections_project_idx on public.sections (project_id, order_key);

-- ------------------------------------------------------------------ tasks
create table if not exists public.tasks (
  id               text primary key,
  project_id       text references public.projects(id) on delete cascade,
  section_id       text references public.sections(id) on delete set null,
  parent_id        text references public.tasks(id) on delete cascade,
  content          text not null default '',
  description      text not null default '',
  priority         integer not null default 4,
  order_key        text not null default '',
  due_date         date,
  due_time         text,
  deadline         date,
  duration_minutes integer,
  recurrence       text,
  labels           jsonb not null default '[]'::jsonb,
  checklist        jsonb not null default '[]'::jsonb,
  attachments      jsonb not null default '[]'::jsonb,
  is_completed     boolean not null default false,
  completed_at     timestamptz,
  completed_count  integer not null default 0,
  postponed_count  integer not null default 0,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists tasks_project_idx  on public.tasks (project_id, order_key);
create index if not exists tasks_section_idx  on public.tasks (section_id);
create index if not exists tasks_parent_idx   on public.tasks (parent_id);
create index if not exists tasks_due_idx      on public.tasks (due_date);
create index if not exists tasks_completed_idx on public.tasks (is_completed, updated_at);

-- --------------------------------------------------------- checklist_items
create table if not exists public.checklist_items (
  id         text primary key,
  task_id    text not null references public.tasks(id) on delete cascade,
  content    text not null default '',
  is_done    boolean not null default false,
  order_key  text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists checklist_items_task_idx on public.checklist_items (task_id, order_key);

-- ----------------------------------------------------------------- labels
create table if not exists public.labels (
  id          text primary key,
  name        text not null,
  color       text not null default '#246fe0',
  order_key   text not null default '',
  is_favorite boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists labels_name_idx on public.labels (name);

-- ------------------------------------------------------------- task_labels
create table if not exists public.task_labels (
  task_id    text not null references public.tasks(id) on delete cascade,
  label_id   text not null references public.labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, label_id)
);
create index if not exists task_labels_label_idx on public.task_labels (label_id);

-- -------------------------------------------------------- command_history
create table if not exists public.command_history (
  id            text primary key,
  actor         text not null default 'user',
  command       text not null,
  command_title text not null default '',
  summary       text not null default '',
  input         jsonb,
  patches       jsonb not null default '[]'::jsonb,
  affected      jsonb not null default '[]'::jsonb,
  undoable      boolean not null default true,
  undone        boolean not null default false,
  batch_id      text,
  created_at    timestamptz not null default now()
);
create index if not exists command_history_created_idx on public.command_history (created_at desc);
create index if not exists command_history_actor_idx   on public.command_history (actor);

-- ---------------------------------------------------------------- uploads
create table if not exists public.uploads (
  id           text primary key,
  filename     text not null,
  content_type text not null default 'application/octet-stream',
  size         bigint not null default 0,
  kind         text not null default 'file',
  url          text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists uploads_created_idx on public.uploads (created_at desc);

-- ============================================================================
-- 2. AYA (AI agent) — payload rows, mirroring the SQLite `aya_rows` table
-- ============================================================================

-- ------------------------------------------------------------- providers
create table if not exists public.aya_providers (
  id         text primary key,
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- models
create table if not exists public.aya_models (
  id         text primary key,
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aya_models_seq_idx on public.aya_models (seq);

-- --------------------------------------------------------------- routing
create table if not exists public.aya_routing (
  id         text primary key,
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------- conversations
create table if not exists public.aya_conversations (
  id         text primary key,
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aya_conversations_updated_idx on public.aya_conversations (updated_at desc);
create index if not exists aya_conversations_seq_idx on public.aya_conversations (seq);

-- -------------------------------------------------------------- messages
create table if not exists public.aya_messages (
  id         text primary key,
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aya_messages_seq_idx on public.aya_messages (seq);
create index if not exists aya_messages_conversation_idx on public.aya_messages ((data ->> 'conversationId'), seq);

-- -------------------------------------------------------------- memories
create table if not exists public.aya_memories (
  id         text primary key,
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aya_memories_category_idx on public.aya_memories ((data ->> 'category'));
create index if not exists aya_memories_created_idx on public.aya_memories (created_at);

-- ------------------------------------------------ notifications (inbox)
create table if not exists public.aya_notifications (
  id         text primary key,
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aya_notifications_status_idx on public.aya_notifications ((data ->> 'status'), created_at desc);

-- ------------------------------------------------------- learning journal
create table if not exists public.aya_learning_journal (
  id         text primary key,
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------- channels
create table if not exists public.aya_channels (
  id         text primary key,
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------- settings
create table if not exists public.aya_settings (
  id         text primary key default 'aya',
  seq        integer not null default 0,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 3. STORAGE — public `uploads` bucket
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update set public = true;

-- ============================================================================
-- 4. SEED — routing, channels and the welcome notification
-- ============================================================================
insert into public.aya_routing (id, data)
values ('default', '{"chat_deep":null,"background_24_7":null,"vision":null,"memory_summarizer":null}'::jsonb)
on conflict (id) do nothing;

insert into public.aya_channels (id, data)
values
  ('telegram', '{"id":"telegram","enabled":false,"config":{}}'::jsonb),
  ('whatsapp', '{"id":"whatsapp","enabled":false,"config":{"mode":"cloud"}}'::jsonb)
on conflict (id) do nothing;

insert into public.aya_settings (id, data)
values ('aya', '{}'::jsonb)
on conflict (id) do nothing;

insert into public.aya_notifications (id, data)
values (
  'aya_welcome',
  jsonb_build_object(
    'id', 'aya_welcome',
    'kind', 'tip',
    'title', 'أهلًا بيك، أنا آية ✨',
    'body', 'أنا المسؤولة عن تنظيم شغلك هنا. اربطي مزوّد نماذج من تبويب «المزودون» وأنا هبدأ أقرأ مهامك وأساعدك أولًا بأول.',
    'status', 'unread',
    'actions', '[]'::jsonb,
    'createdAt', to_jsonb(now())
  )
)
on conflict (id) do nothing;

-- ============================================================================
-- 5. RLS — service role only (no public policies)
-- ============================================================================
alter table public.projects            enable row level security;
alter table public.sections            enable row level security;
alter table public.tasks               enable row level security;
alter table public.checklist_items     enable row level security;
alter table public.labels              enable row level security;
alter table public.task_labels         enable row level security;
alter table public.command_history     enable row level security;
alter table public.uploads             enable row level security;
alter table public.aya_providers       enable row level security;
alter table public.aya_models          enable row level security;
alter table public.aya_routing         enable row level security;
alter table public.aya_conversations   enable row level security;
alter table public.aya_messages        enable row level security;
alter table public.aya_memories        enable row level security;
alter table public.aya_notifications   enable row level security;
alter table public.aya_learning_journal enable row level security;
alter table public.aya_channels        enable row level security;
alter table public.aya_settings        enable row level security;

-- No policies on purpose: the server (service role) is the only reader/writer.
-- When multi-user auth lands, scope each table by `user_id` and add policies
-- such as: using (user_id = auth.uid()) with check (user_id = auth.uid()).
