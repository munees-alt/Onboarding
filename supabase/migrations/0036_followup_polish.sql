-- Batch 18: Follow-up SLA polish + mark-as-received outside the portal.
--
-- 1) Per-org configurable SLA windows for the admin_tasks cron — Master Admin
--    controls these from Settings (no code changes when policy moves).
-- 2) Documents + tasks gain a "follow-up note" (extends the next auto-task
--    window by note_extension_days) and documents gain "received outside the
--    portal" fields the team uses when a client emails / WhatsApps the doc.

create table if not exists followup_config (
  org_id              uuid primary key references orgs(id) on delete cascade,
  docs_overdue_days   int not null default 2,
  access_overdue_days int not null default 2,
  task_overdue_days   int not null default 0,
  note_extension_days int not null default 2,
  updated_at          timestamptz not null default now()
);
alter table followup_config enable row level security;
drop policy if exists "org_all" on followup_config;
create policy "org_all" on followup_config for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());

alter table documents add column if not exists received_outside_portal boolean not null default false;
alter table documents add column if not exists received_note text;
alter table documents add column if not exists received_at timestamptz;
alter table documents add column if not exists received_by uuid references team_members(id) on delete set null;
alter table documents add column if not exists followup_note text;
alter table documents add column if not exists followup_note_at timestamptz;

alter table tasks add column if not exists followup_note text;
alter table tasks add column if not exists followup_note_at timestamptz;
