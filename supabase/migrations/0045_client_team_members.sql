-- Client team members — the client's own people (owner, GM, POC, director, etc.)
create table if not exists client_team_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  name        text not null,
  role_label  text not null default 'Contact', -- e.g. Owner, GM, Director, POC
  email       text,
  phone       text,
  notes       text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_client_team_members_client on client_team_members(client_id);

alter table client_team_members enable row level security;

drop policy if exists "org members can read client team" on client_team_members;
create policy "org members can read client team" on client_team_members
  for select using (org_id = auth_org_id());

drop policy if exists "am and above can manage client team" on client_team_members;
create policy "am and above can manage client team" on client_team_members
  for all using (org_id = auth_org_id());
