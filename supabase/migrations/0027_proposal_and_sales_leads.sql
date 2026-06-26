-- 2026-06-23: Proposal ID on clients + a log of sales "Payment Received" emails that were
-- auto-converted into onboarding leads (used to dedupe so the same email never creates two leads).

alter table clients add column if not exists proposal_id text;

create table if not exists sales_email_leads (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  gmail_message_id  text not null,
  client_id         uuid references clients(id) on delete set null,
  subject           text,
  from_addr         text,
  proposal_id       text,
  created_at        timestamptz not null default now(),
  unique (org_id, gmail_message_id)
);
create index if not exists sales_email_leads_org_idx on sales_email_leads(org_id);

-- Org members can read their org's lead log; writes happen via the service-role cron (bypasses RLS).
alter table sales_email_leads enable row level security;
drop policy if exists "org_all" on sales_email_leads;
create policy "org_all" on sales_email_leads for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
