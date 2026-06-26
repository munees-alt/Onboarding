-- Auto-generated tasks for the master admin (Munees) — surfaced in My Work → My Tasks.
-- A daily cron (api/cron/admin-tasks) creates a task when an onboarding run age
-- crosses a per-kind window without the underlying step being complete:
--   • zoho_followup     — Zoho Books setup incomplete > 1 day from run creation
--   • ct_reg_followup   — Corporate Tax registration incomplete every 2 days
--   • vat_reg_followup  — VAT registration incomplete every 2 days
--   • docs_overdue      — any required doc still pending > 3 days
--   • access_overdue    — any access item not confirmed shared > 3 days
-- When the admin closes a task with notes, the notes accumulate in `history` so
-- the next re-creation carries the prior context forward.

create table if not exists admin_tasks (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id) on delete cascade,
  owner_id           uuid not null references team_members(id) on delete cascade,
  kind               text not null,
  run_id             uuid references onboarding_runs(id) on delete cascade,
  client_id          uuid references clients(id) on delete cascade,
  step_id            text,
  title              text not null,
  body               text,
  status             text not null default 'open',
  notes              text,
  history            jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  closed_at          timestamptz,
  last_recreated_at  timestamptz
);
create index if not exists admin_tasks_owner_idx on admin_tasks(owner_id, status);
create index if not exists admin_tasks_run_kind_idx on admin_tasks(run_id, kind, status);
create index if not exists admin_tasks_org_idx on admin_tasks(org_id, created_at desc);

alter table admin_tasks enable row level security;
drop policy if exists "org_all" on admin_tasks;
create policy "org_all" on admin_tasks for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
