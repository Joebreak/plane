-- Multi-step conversational flows (e.g. 請假 → 日期 → 時間 → 假別)

do $$ begin
  create type public.flow_match_mode as enum ('exact', 'contains');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.flow_step_type as enum (
    'send_text',
    'ask_text',
    'ask_choice',
    'ask_date',
    'ask_time'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.flow_session_status as enum ('active', 'completed', 'cancelled');
exception when duplicate_object then null;
end $$;
create table public.flows (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.line_channels (id) on delete cascade,
  name text not null,
  trigger_text text not null,
  match_mode public.flow_match_mode not null default 'exact',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flows_trigger_not_empty check (char_length(trim(trigger_text)) > 0)
);

create trigger flows_set_updated_at
before update on public.flows
for each row execute function public.set_updated_at();

create table public.flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flows (id) on delete cascade,
  step_key text not null,
  sort_order int not null default 0,
  step_type public.flow_step_type not null default 'ask_text',
  prompt_text text not null,
  field_key text,
  choices jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flow_id, step_key),
  constraint flow_steps_prompt_not_empty check (char_length(trim(prompt_text)) > 0)
);

create trigger flow_steps_set_updated_at
before update on public.flow_steps
for each row execute function public.set_updated_at();

create index flow_steps_flow_sort_idx on public.flow_steps (flow_id, sort_order);

create table public.flow_sessions (
  id uuid primary key default gen_random_uuid(),
  line_user_id uuid not null references public.line_users (id) on delete cascade,
  channel_id uuid not null references public.line_channels (id) on delete cascade,
  flow_id uuid not null references public.flows (id) on delete cascade,
  current_step_key text,
  answers jsonb not null default '{}'::jsonb,
  status public.flow_session_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger flow_sessions_set_updated_at
before update on public.flow_sessions
for each row execute function public.set_updated_at();

create index flow_sessions_active_user_idx
  on public.flow_sessions (line_user_id, status)
  where status = 'active';

alter table public.flows enable row level security;
alter table public.flow_steps enable row level security;
alter table public.flow_sessions enable row level security;

create policy "admins manage flows"
  on public.flows for all to authenticated
  using (true) with check (true);

create policy "admins manage flow_steps"
  on public.flow_steps for all to authenticated
  using (true) with check (true);

create policy "admins read flow_sessions"
  on public.flow_sessions for select to authenticated
  using (true);
