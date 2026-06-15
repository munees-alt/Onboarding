-- ============================================================================
-- Row-Level Security
-- v1 is a single internal org. Strategy:
--   • anon has NO access (client portal goes through server routes w/ service role)
--   • authenticated team members get access scoped to their org
--   • child tables (no org_id) allow authenticated access; the parent run/client
--     is already org-scoped, and most writes happen server-side via service role
-- ============================================================================

-- Effective org of the signed-in user.
create or replace function auth_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid()
$$;

-- Effective role of the signed-in user.
create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- Auto-create a profile when a new auth user signs up; link to a team_member by
-- email and inherit their role. Runs as definer so it bypasses RLS.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare tm team_members; fallback_org uuid;
begin
  select * into tm from team_members where lower(email) = lower(new.email) limit 1;
  select id into fallback_org from orgs order by created_at limit 1;
  insert into profiles (id, org_id, email, full_name, team_member_id, role)
  values (
    new.id,
    coalesce(tm.org_id, fallback_org),
    new.email,
    coalesce(tm.full_name, new.raw_user_meta_data->>'full_name', new.email),
    tm.id,
    coalesce(tm.role, 'junior')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Enable RLS + policies ------------------------------------------
do $$
declare
  org_tables text[] := array[
    'team_members','clients','onboarding_runs','tasks','magic_links',
    'ai_settings','integration_settings','ai_generations','audit_events','notifications'
  ];
  child_tables text[] := array[
    'run_team','run_stages','run_steps','intake_forms','coa_instances',
    'documents','drive_folders','handover_checklists'
  ];
  t text;
begin
  -- org-scoped tables
  foreach t in array org_tables loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "org_all" on %I;', t);
    execute format(
      'create policy "org_all" on %I for all to authenticated
         using (org_id = auth_org_id())
         with check (org_id = auth_org_id());', t);
  end loop;

  -- child tables (parent already org-scoped)
  foreach t in array child_tables loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "auth_all" on %I;', t);
    execute format(
      'create policy "auth_all" on %I for all to authenticated
         using (true) with check (true);', t);
  end loop;
end $$;

-- orgs: a user can see their own org
alter table orgs enable row level security;
drop policy if exists "own_org" on orgs;
create policy "own_org" on orgs for select to authenticated
  using (id = auth_org_id());

-- profiles: see self + same-org colleagues; update self
alter table profiles enable row level security;
drop policy if exists "profiles_read" on profiles;
create policy "profiles_read" on profiles for select to authenticated
  using (id = auth.uid() or org_id = auth_org_id());
drop policy if exists "profiles_update_self" on profiles;
create policy "profiles_update_self" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- coa_templates: global reference data, readable by any authenticated user
alter table coa_templates enable row level security;
drop policy if exists "coa_templates_read" on coa_templates;
create policy "coa_templates_read" on coa_templates for select to authenticated
  using (true);
