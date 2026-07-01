-- client_groups (0039) has an org_id column but was never added to the
-- org-scoped RLS pattern from 0002 — this closes that gap using the same
-- auth_org_id() policy every other org-scoped table (clients, onboarding_runs,
-- magic_links, ...) already uses.

alter table client_groups enable row level security;

drop policy if exists "org_all" on client_groups;
create policy "org_all" on client_groups for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
