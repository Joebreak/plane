-- Allow any authenticated admin to toggle/delete channels (unrestricted).
-- Fixes PostgREST update/delete failing without usable SELECT on base table.

create or replace function public.set_line_channel_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.line_channels
  set is_active = p_active,
      updated_at = now()
  where id = p_id;

  if not found then
    raise exception 'channel not found';
  end if;
end;
$$;

create or replace function public.delete_line_channel(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.line_channels where id = p_id;

  if not found then
    raise exception 'channel not found';
  end if;
end;
$$;

grant execute on function public.set_line_channel_active(uuid, boolean) to authenticated;
grant execute on function public.delete_line_channel(uuid) to authenticated;
