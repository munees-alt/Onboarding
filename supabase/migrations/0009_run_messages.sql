-- Per-run team chat thread.
create table if not exists run_messages (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references onboarding_runs(id) on delete cascade,
  author_id    uuid references team_members(id) on delete set null,
  author_name  text,
  author_role  text,
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists run_messages_run_idx on run_messages(run_id, created_at);

alter table run_messages enable row level security;
drop policy if exists "auth_all" on run_messages;
create policy "auth_all" on run_messages for all to authenticated using (true) with check (true);
