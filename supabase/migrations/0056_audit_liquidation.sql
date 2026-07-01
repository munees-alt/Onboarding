-- Batch: Liquidation & Audit module.
-- Cases are backed by onboarding_runs (template_key = 'audit-workflow' |
-- 'liquidation-workflow'); this migration only adds the email-intake
-- automation config + dedup, and seeds department access for the new nav module.

-- Per-org config for the "Cadence Audit and Liquidation" Gmail automation.
-- Mirrors lead_sync_config; creating a case row here is what the sync writes.
create table if not exists al_sync_config (
  org_id             uuid primary key references orgs(id) on delete cascade,
  enabled            boolean not null default true,
  gmail_label        text not null default 'Cadence Audit and Liquidation',
  match_from         text,
  match_subject_prefix text,
  mailbox_member_id  uuid references team_members(id) on delete set null,
  last_synced_at     timestamptz,
  last_result        jsonb,
  updated_at         timestamptz not null default now()
);
alter table al_sync_config enable row level security;
drop policy if exists "org_all" on al_sync_config;
create policy "org_all" on al_sync_config for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());

-- Dedup: one case per source Gmail message.
create table if not exists al_email_cases (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  gmail_message_id  text not null,
  client_id         uuid references clients(id) on delete set null,
  run_id            uuid references onboarding_runs(id) on delete set null,
  flow              text,
  subject           text,
  from_addr         text,
  created_at        timestamptz not null default now(),
  unique (org_id, gmail_message_id)
);
alter table al_email_cases enable row level security;
drop policy if exists "org_all" on al_email_cases;
create policy "org_all" on al_email_cases for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());

-- Department access for the new nav module 'audit-liquidation'. Granted to the
-- delivery/leadership departments; explicitly blocked for the audit-log-only
-- departments so it doesn't fall back to the default (allowed). Master Admin
-- can retune any of this from Settings → Access.
do $$
declare
  grant_depts text[] := array['COE','Center of Excellence','Management','FinOps and Finance Operations and Onboarding'];
  block_depts text[] := array['HR and TA','Marketing','Office Admin and IT','Partnership','Sales','Engineering','Clients and Team Health','AML','Tax','Tax External','Tax SPC'];
  r record;
  d text;
begin
  for r in select id from orgs loop
    foreach d in array grant_depts loop
      insert into dept_overrides (org_id, dept, nav_id, allow)
      values (r.id, d, 'audit-liquidation', true)
      on conflict (org_id, dept, nav_id) do update set allow = excluded.allow, updated_at = now();
    end loop;
    foreach d in array block_depts loop
      insert into dept_overrides (org_id, dept, nav_id, allow)
      values (r.id, d, 'audit-liquidation', false)
      on conflict (org_id, dept, nav_id) do update set allow = excluded.allow, updated_at = now();
    end loop;
  end loop;
end $$;
