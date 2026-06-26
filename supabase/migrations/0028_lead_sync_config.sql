-- 2026-06-23: Master-Admin-editable rules for the email → onboarding-lead automation.
-- One row per org. All of it is changeable from Settings (no code change needed).
create table if not exists lead_sync_config (
  org_id                uuid primary key references orgs(id) on delete cascade,
  enabled               boolean not null default true,
  gmail_label           text not null default 'Cadence Onboarding',  -- watch any NEW mail in this Gmail label
  match_from            text,            -- optional extra filter; null = ignore sender
  match_subject_prefix  text,            -- optional extra filter; null = ignore subject
  services              jsonb not null default '["Accounting & Bookkeeping","Prior-Period Catch-Up & Books Cleanup"]'::jsonb,
  mailbox_member_id     uuid references team_members(id) on delete set null,  -- which connected Gmail to read
  last_synced_at        timestamptz,     -- incremental: only fetch mail after this
  last_result           jsonb,           -- {scanned, created, at}
  updated_at            timestamptz not null default now()
);

alter table lead_sync_config enable row level security;
drop policy if exists "org_all" on lead_sync_config;
create policy "org_all" on lead_sync_config for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
