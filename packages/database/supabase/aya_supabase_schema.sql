-- ============================================================================
-- آية (Aya) — Supabase / PostgreSQL schema
-- ============================================================================
-- One-paste migration: open Supabase → SQL Editor → paste this file → Run.
-- Column names and semantics are identical to the SQLite tables created on boot
-- by `packages/database/src/aya-store.ts`, so the server can switch adapters
-- without changing a single query in the brain.
--
-- Security: all access goes through the server (service role). RLS is enabled
-- with no public policies, so the anon/client key can never read Aya's memory,
-- provider API keys or conversations.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- providers
create table if not exists public.aya_providers (
  id          text primary key,
  name        text not null,
  base_url    text not null,
  api_key     text not null default '',
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------- models
create table if not exists public.aya_models (
  id             text primary key,
  provider_id    text not null references public.aya_providers(id) on delete cascade,
  model_id       text not null,
  label          text not null default '',
  context_window integer,
  vision         boolean not null default false,
  priority       integer not null default 0,
  failover       boolean not null default true,
  enabled        boolean not null default true,
  status         text not null default 'unknown' check (status in ('unknown', 'ok', 'failed')),
  latency_ms     integer,
  last_error     text,
  last_tested_at timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists aya_models_provider_idx on public.aya_models (provider_id, priority);

-- ------------------------------------------------------------------ routing
create table if not exists public.aya_routing (
  role         text primary key check (role in ('chat_deep', 'background_24_7', 'vision', 'memory_summarizer')),
  model_row_id text,
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------ conversations
create table if not exists public.aya_conversations (
  id         text primary key,
  title      text not null default '',
  channel    text not null default 'web',
  summary    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- messages
create table if not exists public.aya_messages (
  id              text primary key,
  conversation_id text not null references public.aya_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant', 'system')),
  content         text not null default '',
  attachments     jsonb not null default '[]'::jsonb,
  tool_calls      jsonb not null default '[]'::jsonb,
  model           text,
  failover        boolean not null default false,
  batch_id        text,
  seq             integer not null default 1,
  created_at      timestamptz not null default now()
);
create index if not exists aya_messages_conversation_idx on public.aya_messages (conversation_id, seq);

-- ----------------------------------------------------------------- memories
create table if not exists public.aya_memories (
  id         text primary key,
  category   text not null default 'preferences'
             check (category in ('preferences', 'projects', 'people', 'rules', 'ideas')),
  content    text not null,
  source     text not null default 'chat',
  importance integer not null default 2,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------- proactive inbox
create table if not exists public.aya_proactive_inbox (
  id         text primary key,
  kind       text not null check (kind in ('question', 'reminder', 'organization', 'procrastination', 'tip')),
  title      text not null,
  body       text not null default '',
  status     text not null default 'unread' check (status in ('unread', 'read', 'done', 'dismissed')),
  actions    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aya_inbox_status_idx on public.aya_proactive_inbox (status, created_at);

-- ----------------------------------------------------------- learning journal
create table if not exists public.aya_learning_journal (
  id         text primary key,
  insight    text not null,
  category   text not null default 'pattern',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- channels
create table if not exists public.aya_channels (
  id         text primary key check (id in ('telegram', 'whatsapp')),
  enabled    boolean not null default false,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- settings
create table if not exists public.aya_settings (
  id                 text primary key default 'aya' check (id = 'aya'),
  persona_ar         text not null default '',
  persona_en         text not null default '',
  autonomy           text not null default 'confirm_delete'
                     check (autonomy in ('full_undo', 'confirm_delete', 'read_only')),
  daemon_enabled     boolean not null default true,
  heartbeat_minutes  integer not null default 20,
  disabled_tools     jsonb not null default '[]'::jsonb,
  updated_at         timestamptz not null default now()
);

-- ------------------------------------------------------------------- seed
insert into public.aya_routing (role)
values ('chat_deep'), ('background_24_7'), ('vision'), ('memory_summarizer')
on conflict (role) do nothing;

insert into public.aya_channels (id, enabled, config)
values ('telegram', false, '{}'::jsonb), ('whatsapp', false, '{"mode":"cloud"}'::jsonb)
on conflict (id) do nothing;

insert into public.aya_settings (id) values ('aya') on conflict (id) do nothing;

insert into public.aya_proactive_inbox (id, kind, title, body, status, actions)
values (
  'aya_welcome',
  'tip',
  'أهلًا بيك، أنا آية ✨',
  'أنا المسؤولة عن تنظيم شغلك هنا. اربطي مزوّد نماذج من تبويب «المزودون» وأنا هبدأ أقرأ مهامك وأساعدك أولًا بأول.',
  'unread',
  '[]'::jsonb
)
on conflict (id) do nothing;

-- --------------------------------------------------------------------- RLS
alter table public.aya_providers         enable row level security;
alter table public.aya_models            enable row level security;
alter table public.aya_routing           enable row level security;
alter table public.aya_conversations     enable row level security;
alter table public.aya_messages          enable row level security;
alter table public.aya_memories          enable row level security;
alter table public.aya_proactive_inbox   enable row level security;
alter table public.aya_learning_journal  enable row level security;
alter table public.aya_channels          enable row level security;
alter table public.aya_settings          enable row level security;

-- No policies on purpose: the server (service role) is the only writer/reader.
-- When multi-user auth lands, scope each table by `user_id` and add policies
-- such as: using (user_id = auth.uid()) with check (user_id = auth.uid()).
