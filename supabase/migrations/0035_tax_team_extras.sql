-- Tax team extras: people the Master Admin manually adds to the tax-team
-- capacity list who aren't already in Gautam Sanoj's (Head – Tax Team) org
-- subtree. The capacity card UNIONs these with descendantsOf(taxHead).

create table if not exists tax_team_extras (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  team_member_id  uuid not null references team_members(id) on delete cascade,
  added_by        uuid references team_members(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  unique(org_id, team_member_id)
);
create index if not exists tax_team_extras_org_idx on tax_team_extras(org_id);

alter table tax_team_extras enable row level security;
drop policy if exists "org_all" on tax_team_extras;
create policy "org_all" on tax_team_extras for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
