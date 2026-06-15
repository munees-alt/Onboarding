-- Generic per-run lists: catch-up tasks, internal projects, compliance calendar.
create table if not exists run_items (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid references onboarding_runs(id) on delete cascade,
  client_id   uuid references clients(id) on delete cascade,
  kind        text not null,                       -- catchup | project | compliance
  data        jsonb not null default '{}'::jsonb,
  status      text not null default 'open',
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists run_items_run_kind_idx on run_items(run_id, kind);

alter table run_items enable row level security;
drop policy if exists "auth_all" on run_items;
create policy "auth_all" on run_items for all to authenticated using (true) with check (true);
