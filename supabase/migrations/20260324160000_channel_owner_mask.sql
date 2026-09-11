-- Ownership on line_channels: only owner sees secrets; others see masked via view

alter table public.line_channels
  add column if not exists created_by uuid references auth.users (id) on delete set null;

create index if not exists line_channels_created_by_idx on public.line_channels (created_by);

create or replace function public.set_line_channel_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists line_channels_set_owner on public.line_channels;
create trigger line_channels_set_owner
before insert on public.line_channels
for each row execute function public.set_line_channel_owner();

-- Replace open "all" policy with insert/update/delete only (no select on base table)
drop policy if exists "admins manage line_channels" on public.line_channels;

create policy "admins insert line_channels"
  on public.line_channels for insert to authenticated
  with check (true);

create policy "admins update line_channels"
  on public.line_channels for update to authenticated
  using (true)
  with check (true);

create policy "admins delete line_channels"
  on public.line_channels for delete to authenticated
  using (true);

-- Masked list for authenticated users (view runs with definer rights; auth.uid() still applies)
create or replace view public.line_channels_list as
select
  id,
  name,
  case
    when created_by is not distinct from auth.uid() then webhook_key
    else '***'
  end as webhook_key,
  case
    when created_by is not distinct from auth.uid() then channel_access_token
    else '***'
  end as channel_access_token,
  case
    when created_by is not distinct from auth.uid() then channel_secret
    else '***'
  end as channel_secret,
  is_active,
  created_by,
  created_at,
  updated_at,
  (created_by is not distinct from auth.uid()) as is_owner
from public.line_channels;

grant select on public.line_channels_list to authenticated;
grant select on public.line_channels_list to service_role;
