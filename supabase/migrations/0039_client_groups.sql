-- Client Groups — one proposal / one owner / N companies.
--
-- Story: a single owner buys our service for 3 of their LLCs. Today that
-- forces 3 separate runs and 3 separate portal logins. With a group, the
-- team sees ONE run with a "switch entity" pill in the header, and the
-- client gets ONE portal login that lists all entities.
--
-- Per-entity work (COA, docs, intake, sign-off) stays on its own run — only
-- the contract / deck / portal access are shared. Sign-off remains per
-- entity (preserves a clean FTA audit trail).

create table if not exists client_groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  primary_contact_name text,
  primary_contact_email text,
  -- Optional: links into the existing proposal table when a proposal record exists.
  proposal_id text,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists client_groups_org_idx on client_groups(org_id);

-- Each company / run / portal token belongs to at most ONE group. NULL = single-client (today's default).
alter table clients
  add column if not exists group_id uuid references client_groups(id) on delete set null;
create index if not exists clients_group_idx on clients(group_id);

alter table onboarding_runs
  add column if not exists group_id uuid references client_groups(id) on delete set null;
create index if not exists onboarding_runs_group_idx on onboarding_runs(group_id);

alter table magic_links
  add column if not exists group_id uuid references client_groups(id) on delete set null;
create index if not exists magic_links_group_idx on magic_links(group_id);
