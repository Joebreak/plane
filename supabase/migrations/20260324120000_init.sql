-- LINE Admin schema: users, conversations, messages, schedules, RLS, realtime, cron hook

create extension if not exists "pgcrypto";

create type public.message_direction as enum ('in', 'out');
create type public.message_status as enum ('received', 'sent', 'failed');
create type public.scheduled_status as enum ('pending', 'sent', 'failed', 'cancelled');

create table public.admin_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.line_users (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text,
  picture_url text,
  status_message text,
  last_interaction_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  line_user_id uuid not null unique references public.line_users (id) on delete cascade,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  line_user_id uuid not null references public.line_users (id) on delete cascade,
  direction public.message_direction not null,
  content text not null,
  message_type text not null default 'text',
  line_message_id text,
  status public.message_status not null default 'received',
  created_at timestamptz not null default now()
);

create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

create table public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  line_user_id uuid references public.line_users (id) on delete cascade,
  content text not null,
  send_at timestamptz not null,
  status public.scheduled_status not null default 'pending',
  error_message text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index scheduled_messages_pending_send_at_idx
  on public.scheduled_messages (send_at)
  where status = 'pending';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger line_users_set_updated_at
before update on public.line_users
for each row execute function public.set_updated_at();

create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

-- Auto-create admin_profiles on signup (optional convenience)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Helper: ensure conversation exists for a line_users.id
create or replace function public.ensure_conversation(p_line_user_uuid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.conversations where line_user_id = p_line_user_uuid;
  if v_id is null then
    insert into public.conversations (line_user_id)
    values (p_line_user_uuid)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

grant execute on function public.ensure_conversation(uuid) to service_role;

alter table public.admin_profiles enable row level security;
alter table public.line_users enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.scheduled_messages enable row level security;

-- Authenticated admins can read/write operational tables
create policy "admins read own profile"
  on public.admin_profiles for select to authenticated
  using (id = auth.uid());

create policy "admins update own profile"
  on public.admin_profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "admins read line_users"
  on public.line_users for select to authenticated
  using (true);

create policy "admins update line_users"
  on public.line_users for update to authenticated
  using (true)
  with check (true);

create policy "admins read conversations"
  on public.conversations for select to authenticated
  using (true);

create policy "admins read messages"
  on public.messages for select to authenticated
  using (true);

create policy "admins manage scheduled_messages"
  on public.scheduled_messages for all to authenticated
  using (true)
  with check (true);

-- Realtime
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.scheduled_messages;

-- Cron: call process-scheduled Edge Function every minute
-- Requires: extension pg_cron, pg_net; set app settings after deploy.
-- Replace YOUR_PROJECT_REF and YOUR_SERVICE_ROLE_KEY when enabling.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Store secrets via:
--   alter database postgres set app.settings.service_role_key = '...';
--   alter database postgres set app.settings.project_url = 'https://YOUR_PROJECT_REF.supabase.co';
-- Or use vault / Dashboard cron UI. The job below reads GUCs if present.

create or replace function public.invoke_process_scheduled()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  project_url text := current_setting('app.settings.project_url', true);
  service_key text := current_setting('app.settings.service_role_key', true);
begin
  if project_url is null or service_key is null then
    raise notice 'app.settings.project_url / service_role_key not set; skip cron invoke';
    return;
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/process-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  );
end;
$$;

grant execute on function public.invoke_process_scheduled() to postgres;

-- Uncomment after setting app.settings.* :
-- select cron.schedule(
--   'process-scheduled-messages',
--   '* * * * *',
--   $$select public.invoke_process_scheduled();$$
-- );
