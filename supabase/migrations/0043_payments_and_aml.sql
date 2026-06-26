-- Payment plans: one plan per client (billing cycle + amount), entries = individual monthly/quarterly bills.
create table if not exists client_payment_plans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  billing_cycle text not null default 'monthly',
  amount numeric not null default 0,
  currency text not null default 'AED',
  start_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);
alter table client_payment_plans enable row level security;
drop policy if exists "org_all" on client_payment_plans;
create policy "org_all" on client_payment_plans for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());

-- Individual payment entries (one row per billing period).
create table if not exists client_payment_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  due_date date not null,
  period_label text,         -- e.g. "June 2026"
  amount numeric,
  invoice_no text,
  invoice_link text,
  status text not null default 'pending'
    check (status in ('pending', 'invoiced', 'paid', 'overdue')),
  paid_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_payment_entries_client_idx on client_payment_entries(client_id, due_date);
alter table client_payment_entries enable row level security;
drop policy if exists "org_all" on client_payment_entries;
create policy "org_all" on client_payment_entries for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());

-- AML compliance records: one per client. Team updates status + adds signing link.
create table if not exists aml_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'link_sent', 'signed', 'completed')),
  notes text,
  signing_link text,
  signing_completed_link text,
  completed_by text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);
alter table aml_records enable row level security;
drop policy if exists "org_all" on aml_records;
create policy "org_all" on aml_records for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());
