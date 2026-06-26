-- AM capacity: per-AM max-task ceiling used by the compliance auto-assigner.
-- When a new compliance run is created, the picker sorts AMs (under Suhail /
-- the configured Ops Head) by their current load vs max_tasks, preferring the
-- one with the lowest load below capacity. Empty / unset means "no ceiling".

create table if not exists am_capacity (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  team_member_id  uuid not null references team_members(id) on delete cascade,
  max_tasks       int not null default 10,
  notes           text,
  updated_at      timestamptz not null default now(),
  unique(org_id, team_member_id)
);

create index if not exists am_capacity_org_idx on am_capacity(org_id);

alter table am_capacity enable row level security;
drop policy if exists "org_all" on am_capacity;
create policy "org_all" on am_capacity for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
