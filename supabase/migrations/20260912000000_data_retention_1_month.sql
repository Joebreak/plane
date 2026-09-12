-- Retain operational data for 1 month only (by created_at / last activity).
-- Keeps config: admin_profiles, line_channels, flows, flow_steps, flow_rules.

create index if not exists messages_created_at_idx
  on public.messages (created_at);

create index if not exists scheduled_messages_created_at_idx
  on public.scheduled_messages (created_at);

create index if not exists flow_sessions_created_at_idx
  on public.flow_sessions (created_at);

create or replace function public.cleanup_old_operational_data(
  retention interval default interval '1 month'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - retention;
  deleted_messages bigint := 0;
  deleted_scheduled bigint := 0;
  deleted_sessions bigint := 0;
  deleted_conversations bigint := 0;
  deleted_line_users bigint := 0;
begin
  -- 1) Messages older than retention
  with d as (
    delete from public.messages
    where created_at < cutoff
    returning 1
  )
  select count(*) into deleted_messages from d;

  -- 2) Scheduled messages older than retention
  with d as (
    delete from public.scheduled_messages
    where created_at < cutoff
    returning 1
  )
  select count(*) into deleted_scheduled from d;

  -- 3) Flow sessions older than retention
  with d as (
    delete from public.flow_sessions
    where created_at < cutoff
    returning 1
  )
  select count(*) into deleted_sessions from d;

  -- 4) Conversations idle past retention
  with d as (
    delete from public.conversations c
    where coalesce(c.last_message_at, c.created_at) < cutoff
    returning 1
  )
  select count(*) into deleted_conversations from d;

  -- 5) LINE users idle past retention with no remaining child rows
  with d as (
    delete from public.line_users u
    where coalesce(u.last_interaction_at, u.created_at) < cutoff
      and not exists (select 1 from public.conversations c where c.line_user_id = u.id)
      and not exists (select 1 from public.messages m where m.line_user_id = u.id)
      and not exists (select 1 from public.scheduled_messages s where s.line_user_id = u.id)
      and not exists (select 1 from public.flow_sessions f where f.line_user_id = u.id)
    returning 1
  )
  select count(*) into deleted_line_users from d;

  return jsonb_build_object(
    'cutoff', cutoff,
    'deleted_messages', deleted_messages,
    'deleted_scheduled_messages', deleted_scheduled,
    'deleted_flow_sessions', deleted_sessions,
    'deleted_conversations', deleted_conversations,
    'deleted_line_users', deleted_line_users
  );
end;
$$;

comment on function public.cleanup_old_operational_data(interval) is
  'Delete operational rows older than retention (default 1 month). Keeps channel/flow config.';

revoke all on function public.cleanup_old_operational_data(interval) from public;
grant execute on function public.cleanup_old_operational_data(interval) to service_role;

-- Daily at 03:00 UTC (idempotent if job name already exists)
do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'cleanup-old-operational-data';
exception
  when undefined_table then
    null; -- pg_cron not available in this environment
  when others then
    null;
end $$;

do $$
begin
  perform cron.schedule(
    'cleanup-old-operational-data',
    '0 3 * * *',
    $cron$select public.cleanup_old_operational_data(interval '1 month');$cron$
  );
exception
  when undefined_function then
    raise notice 'pg_cron unavailable; schedule cleanup via GitHub Actions instead';
  when others then
    raise notice 'Could not schedule cleanup cron: %', sqlerrm;
end $$;
