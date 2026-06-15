-- Feature requests / suggestions raised from within the app.
create table if not exists tickets (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  created_by_id   uuid references team_members(id) on delete set null,
  created_by_name text,
  created_by_role text,
  kind            text not null default 'feature',   -- feature | suggestion | bug
  title           text not null,
  body            text,
  status          text not null default 'open',       -- open | in_progress | resolved
  admin_note      text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index if not exists tickets_org_idx on tickets(org_id, created_at desc);

alter table tickets enable row level security;
drop policy if exists "org_all" on tickets;
create policy "org_all" on tickets for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());
