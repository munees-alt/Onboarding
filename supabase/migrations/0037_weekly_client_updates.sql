-- Weekly client update drafts (Master-Admin-only workflow).
-- A daily cron creates one draft per active onboarding client every Thursday
-- (9am UAE = 5am UTC). The master admin edits per-task notes, adds key dates,
-- composes an AI-generated email + WhatsApp version, and sends. If a draft is
-- still unsent by Friday 9am UAE, the linked admin_tasks row remains open and
-- surfaces in /my-work (Action Items) as overdue.

create table if not exists weekly_client_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  run_id uuid references onboarding_runs(id) on delete cascade,
  week_of date not null,
  status text not null default 'draft' check (status in ('draft','sent','skipped')),
  completed_tasks jsonb not null default '[]'::jsonb,
  inprogress_tasks jsonb not null default '[]'::jsonb,
  client_action_tasks jsonb not null default '[]'::jsonb,
  per_task_notes jsonb not null default '{}'::jsonb,
  extra_client_actions text,
  key_dates jsonb not null default '[]'::jsonb,
  feedback_link text,
  subject text,
  email_body text,
  whatsapp_body text,
  sent_at timestamptz,
  sent_via text,
  sent_to text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, week_of)
);
create index if not exists weekly_client_updates_org_week_idx on weekly_client_updates(org_id, week_of desc);
create index if not exists weekly_client_updates_status_idx on weekly_client_updates(org_id, status);

alter table weekly_client_updates enable row level security;
drop policy if exists "org_all" on weekly_client_updates;
create policy "org_all" on weekly_client_updates for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());

alter table orgs add column if not exists feedback_form_url text;
