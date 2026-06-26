-- Add a configurable default new-member capacity ceiling to orgs.
-- The TaxCapacityCard in Settings shows this value and lets the Master Admin
-- change it; the capacity system uses it when auto-adding new tax-team members.
alter table orgs add column if not exists tax_capacity_default integer not null default 60;
