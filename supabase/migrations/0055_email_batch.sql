-- Batch: SendGrid scaffold. Queues outbound client emails (follow-ups, data
-- requests, team updates) for later sending — creating a row here does NOT
-- send anything. Actual sending is wired up separately and stays disabled
-- until SENDGRID_API_KEY + ENABLE_EMAIL_SENDING=true are both set.
create table if not exists email_batch (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  kind        text not null check (kind in ('followup', 'data_request', 'team_update', 'other')),
  to_email    text not null,
  to_name     text,
  subject     text not null,
  body_html   text not null,
  body_text   text,
  client_id   uuid references clients(id) on delete set null,
  run_id      uuid references onboarding_runs(id) on delete set null,
  status      text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'disabled')),
  error       text,
  created_by  uuid references team_members(id) on delete set null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists email_batch_org_status_idx on email_batch (org_id, status, created_at desc);

alter table email_batch enable row level security;
drop policy if exists "org_all" on email_batch;
create policy "org_all" on email_batch for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());
