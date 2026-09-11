-- New flow step types: text / buttons / confirm / flex

do $$ begin
  alter type public.flow_step_type add value if not exists 'text';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.flow_step_type add value if not exists 'buttons';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.flow_step_type add value if not exists 'confirm';
exception when duplicate_object then null;
end $$;

do $$ begin
  alter type public.flow_step_type add value if not exists 'flex';
exception when duplicate_object then null;
end $$;

alter table public.flow_steps
  add column if not exists flex_json jsonb;
