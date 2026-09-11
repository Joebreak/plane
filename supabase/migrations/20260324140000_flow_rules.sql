-- Configurable auto-reply / simple flow rules

create type public.flow_match_mode as enum ('exact', 'contains');

create table public.flow_rules (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references public.line_channels (id) on delete cascade,
  name text not null default '',
  match_mode public.flow_match_mode not null default 'exact',
  trigger_text text not null,
  reply_text text not null,
  priority int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flow_rules_trigger_not_empty check (char_length(trim(trigger_text)) > 0),
  constraint flow_rules_reply_not_empty check (char_length(trim(reply_text)) > 0)
);

create index flow_rules_lookup_idx
  on public.flow_rules (channel_id, is_active, priority);

create trigger flow_rules_set_updated_at
before update on public.flow_rules
for each row execute function public.set_updated_at();

alter table public.flow_rules enable row level security;

create policy "admins manage flow_rules"
  on public.flow_rules for all to authenticated
  using (true)
  with check (true);
