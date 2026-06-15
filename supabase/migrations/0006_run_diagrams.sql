-- Workflow diagrams drawn in the run's "Build workflow diagrams" step.
create table if not exists run_diagrams (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid references onboarding_runs(id) on delete cascade,
  client_id   uuid references clients(id) on delete cascade,
  name        text not null,
  nodes       jsonb not null default '[]'::jsonb,  -- [{id,label,type}]
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists run_diagrams_run_idx on run_diagrams(run_id);

alter table run_diagrams enable row level security;
drop policy if exists "auth_all" on run_diagrams;
create policy "auth_all" on run_diagrams for all to authenticated using (true) with check (true);
