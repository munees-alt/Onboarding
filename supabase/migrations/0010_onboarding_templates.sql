-- Editable onboarding templates (seeded from code, then editable by admin/ops).
create table if not exists onboarding_templates (
  id          text primary key,
  name        text not null,
  tier        text,
  color       text,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table onboarding_templates enable row level security;
drop policy if exists "tpl_read" on onboarding_templates;
create policy "tpl_read" on onboarding_templates for select to authenticated using (true);
drop policy if exists "tpl_write" on onboarding_templates;
create policy "tpl_write" on onboarding_templates for all to authenticated
  using (auth_role() in ('admin','ops_head')) with check (auth_role() in ('admin','ops_head'));
