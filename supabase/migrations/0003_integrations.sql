-- ============================================================================
-- Per-member integration connections.
-- Each team member connects their OWN Google account (Gmail + Drive) so that
-- onboarding folder structures are created inside THEIR Drive. Fathom can be
-- connected per member too (notes API). Org-wide keys (AI providers, PMS,
-- org Fathom) stay in ai_settings / integration_settings.
-- ============================================================================

create table if not exists member_connections (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  team_member_id      uuid not null references team_members(id) on delete cascade,
  provider            text not null,                       -- 'google' | 'fathom'
  account_email       text,
  access_token_enc    text,
  refresh_token_enc   text,
  token_expiry        timestamptz,
  scopes              text[] not null default '{}',
  drive_root_folder_id text,                                -- where client folders are created
  connected           boolean not null default false,
  config              jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique(team_member_id, provider)
);
create index if not exists member_connections_org_idx on member_connections(org_id);

drop trigger if exists trg_member_connections_updated on member_connections;
create trigger trg_member_connections_updated before update on member_connections
  for each row execute function set_updated_at();

-- RLS: org-scoped for the team; tokens are only ever read server-side.
alter table member_connections enable row level security;
drop policy if exists "org_all" on member_connections;
create policy "org_all" on member_connections for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
