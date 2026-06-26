-- Client Data panel: one shared, growable schema across ALL clients.
--   • clients.facts   — per-client values for the extra (discovered) fields, keyed by field key.
--   • client_field_defs — the org-wide list of extra field definitions. When a call surfaces
--     a fact that isn't a built-in column, we add it here once → it then shows for EVERY client
--     (blank where that client has no value). This is how the schema "grows from every call".
-- (Access credentials are stored encrypted inside run_items.data — no schema change needed.)

alter table clients add column if not exists facts jsonb not null default '{}'::jsonb;

create table if not exists client_field_defs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  key         text not null,           -- stable machine key, e.g. "trade_license_no"
  label       text not null,           -- human label shown in the panel
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (org_id, key)
);
create index if not exists client_field_defs_org_idx on client_field_defs(org_id);

-- Org-scoped RLS, mirroring the other org tables.
alter table client_field_defs enable row level security;
drop policy if exists "org_all" on client_field_defs;
create policy "org_all" on client_field_defs for all to authenticated
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());
