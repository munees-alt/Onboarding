-- Master Chart of Accounts library: editable, industry-based COA templates owned
-- by the org. The per-run COA builder seeds from these. Access is enforced in
-- the server actions (Master Admin / Ops Head / AM only).
create table if not exists coa_master (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  industry text not null,
  accounts jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(org_id, industry)
);
alter table coa_master enable row level security;
