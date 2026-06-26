-- Add assigned_to to aml_records so the AML head can delegate per-client
alter table aml_records
  add column if not exists assigned_to uuid references team_members(id) on delete set null;
