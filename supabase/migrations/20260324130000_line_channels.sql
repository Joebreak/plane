-- Multi-channel credentials stored in DB (webhook key + access token + secret)

create table public.line_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  webhook_key text not null unique,
  channel_access_token text not null,
  channel_secret text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_channels_webhook_key_format check (
    webhook_key ~ '^[a-zA-Z0-9_-]{3,64}$'
  )
);

create trigger line_channels_set_updated_at
before update on public.line_channels
for each row execute function public.set_updated_at();

alter table public.line_users
  add column if not exists channel_id uuid references public.line_channels (id) on delete set null;

create index if not exists line_users_channel_id_idx on public.line_users (channel_id);

-- Unique per channel: same LINE user can appear under different Official Accounts
alter table public.line_users drop constraint if exists line_users_line_user_id_key;
create unique index if not exists line_users_channel_line_user_uidx
  on public.line_users (channel_id, line_user_id);

alter table public.line_channels enable row level security;

create policy "admins manage line_channels"
  on public.line_channels for all to authenticated
  using (true)
  with check (true);

-- Admins can list other admin profiles (read-only; no insert policy for clients)
create policy "admins read all admin_profiles"
  on public.admin_profiles for select to authenticated
  using (true);
