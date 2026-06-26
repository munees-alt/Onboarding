-- Master-admin polish batch (2026-06-23):
--  * client trade-licence + contract-start + custom code  (F01-{TL#}-{CoFirst}-{YYMM})
--  * per-client onboarding template override (fork-on-edit, master template untouched)
--  * user_points (per-member performance points, leaderboard)
--  * role_overrides (master-admin tweaks which roles can open which nav modules)

alter table clients add column if not exists trade_licence_no  text;
alter table clients add column if not exists contract_start_date date;
alter table clients add column if not exists custom_code        text;
create index if not exists clients_custom_code_idx on clients(org_id, custom_code);

-- Fork-on-edit: when a master-admin edits a run's template, we duplicate the
-- master template into this column and write subsequent edits here only.
alter table onboarding_runs
  add column if not exists template_override jsonb;

-- Per-member performance points (gamification). Roll up by sum(points).
create table if not exists user_points (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  member_id   uuid not null references team_members(id) on delete cascade,
  points      int  not null,
  reason      text not null,
  awarded_by  uuid references team_members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists user_points_org_member_idx on user_points(org_id, member_id);
alter table user_points enable row level security;
drop policy if exists user_points_org_all on user_points;
create policy user_points_org_all on user_points for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

-- Master-admin overrides for "which role sees which nav module".  Defaults come
-- from src/lib/nav.ts; rows here only record EXPLICIT allow/deny.
create table if not exists role_overrides (
  org_id  uuid not null references orgs(id) on delete cascade,
  role    text not null,
  nav_id  text not null,
  allow   bool not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, role, nav_id)
);
alter table role_overrides enable row level security;
drop policy if exists role_overrides_org_all on role_overrides;
create policy role_overrides_org_all on role_overrides for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
