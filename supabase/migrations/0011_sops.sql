-- Standard operating procedures (created manually or with AI; linkable to runs/clients).
create table if not exists sops (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  title           text not null,
  industry        text,
  steps           jsonb not null default '[]'::jsonb,   -- string[]
  created_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists sops_org_idx on sops(org_id, created_at desc);

alter table sops enable row level security;
drop policy if exists "org_all" on sops;
create policy "org_all" on sops for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());
