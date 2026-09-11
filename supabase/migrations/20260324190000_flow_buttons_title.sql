-- Buttons template: optional title + richer button actions

alter table public.flow_steps
  add column if not exists title_text text;
