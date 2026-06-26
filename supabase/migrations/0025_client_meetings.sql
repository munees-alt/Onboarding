-- Client meeting recordings + notes. Every meeting held with a client (kickoff, review,
-- catch-up, ad-hoc) is saved here with its recording link and the prepared notes/summary.
-- Notes can be auto-fetched from Fathom (by recording link) and summarised by AI, or pasted.

create table if not exists client_meetings (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  client_id      uuid not null references clients(id) on delete cascade,
  title          text not null default 'Meeting',
  meeting_date   date,
  recording_link text,
  notes          text,           -- prepared notes / minutes (from Fathom or pasted)
  summary        text,           -- short AI summary
  source         text not null default 'manual',  -- manual | fathom
  created_by     text,
  created_at     timestamptz not null default now()
);
create index if not exists client_meetings_client_idx on client_meetings(client_id);

-- Org-scoped RLS, mirroring the other org tables.
alter table client_meetings enable row level security;
drop policy if exists "org_all" on client_meetings;
create policy "org_all" on client_meetings for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
