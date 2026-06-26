-- Weekly Pulse (Master-Admin only): the running knowledge base of everything happening with
-- the app + business — features shipped, improvements, security updates, feedback, problems,
-- meetings, research, and the management to-dos / focus for the week. The weekly management
-- digest email is generated from these entries plus live onboarding + meeting data.
create table if not exists pulse_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  category    text not null,            -- feature | improvement | security | feedback | problem | meeting | research | todo | focus | onboarding
  title       text not null,
  detail      text,
  status      text,                     -- todos: open | in_progress | done
  owner       text,                     -- todos: who owns it
  entry_date  date not null default current_date,
  source      text not null default 'manual',  -- manual | system | fathom
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists pulse_entries_org_idx on pulse_entries(org_id);
create index if not exists pulse_entries_date_idx on pulse_entries(entry_date);

alter table pulse_entries enable row level security;
drop policy if exists "org_all" on pulse_entries;
create policy "org_all" on pulse_entries for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
