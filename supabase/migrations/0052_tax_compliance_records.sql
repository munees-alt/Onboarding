-- Tax Compliance — mirrors AML records but for the Tax team.
-- Cards are triggered from the onboarding urgent-compliance flow and assigned
-- to Gautam (Tax Head) + Nafila (Tax Team Lead) by default. Nafila / the
-- coordinator can multi-assign to tax team members.

create table if not exists tax_compliance_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  status text not null default 'open_item'
    check (status in ('open_item', 'pending', 'awaiting', 'application_submitted', 'completed')),
  -- which tax services apply on this card (any subset)
  services text[] not null default '{}',
  -- only meaningful when status='awaiting'
  awaiting_tag text
    check (awaiting_tag is null or awaiting_tag in ('fta_dependency', 'team_dependency', 'task_dependency', 'client_dependency')),
  -- multi-assign to tax team members (set by Nafila / coordinator)
  assigned_to uuid[] not null default '{}',
  notes text,
  drive_link text,
  reference_link text,
  created_by uuid references team_members(id) on delete set null,
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

create index if not exists tax_compliance_records_org_status_idx on tax_compliance_records(org_id, status);
create index if not exists tax_compliance_records_assigned_to_idx on tax_compliance_records using gin (assigned_to);

alter table tax_compliance_records enable row level security;
drop policy if exists "org_all" on tax_compliance_records;
create policy "org_all" on tax_compliance_records for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());
