-- Master tax codes: per-industry, per-org tax-code lists similar to the master
-- COA. Each row carries the full codes array as JSONB so the editor can save
-- in one shot. UAE defaults are seeded by lib/tax-codes-seed.ts at first read.

create table if not exists tax_code_sets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  industry    text not null,
  -- [{ code, name, rate, kind: 'standard'|'zero'|'exempt'|'rcm'|'out_of_scope', notes }]
  codes       jsonb not null default '[]'::jsonb,
  source      text not null default 'manual',
  updated_at  timestamptz not null default now(),
  unique(org_id, industry)
);

create index if not exists tax_code_sets_org_idx on tax_code_sets(org_id);

alter table tax_code_sets enable row level security;
drop policy if exists "org_all" on tax_code_sets;
create policy "org_all" on tax_code_sets for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
