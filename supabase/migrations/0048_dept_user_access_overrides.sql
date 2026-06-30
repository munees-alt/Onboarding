-- Access overrides by department and by individual user (2026-06-29).
-- Extends the role_overrides pattern to cover two more dimensions.

-- Department-level overrides: same tri-state logic as role_overrides.
create table if not exists dept_overrides (
  org_id     uuid not null references orgs(id) on delete cascade,
  dept       text not null,
  nav_id     text not null,
  allow      bool not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, dept, nav_id)
);
alter table dept_overrides enable row level security;
drop policy if exists dept_overrides_org_all on dept_overrides;
create policy dept_overrides_org_all on dept_overrides for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

-- User-level overrides: highest priority, per individual team member.
create table if not exists user_nav_overrides (
  org_id     uuid not null references orgs(id) on delete cascade,
  member_id  uuid not null references team_members(id) on delete cascade,
  nav_id     text not null,
  allow      bool not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, member_id, nav_id)
);
alter table user_nav_overrides enable row level security;
drop policy if exists user_nav_overrides_org_all on user_nav_overrides;
create policy user_nav_overrides_org_all on user_nav_overrides for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
