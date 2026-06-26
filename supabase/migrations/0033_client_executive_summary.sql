-- One-page client executive summary — narrative AI-stitched from intake +
-- call notes + contract + uploaded compliance docs. Sits alongside the
-- existing business_description / call_summary fields. Generated on demand
-- from the playbook.
alter table clients add column if not exists executive_summary text;
alter table clients add column if not exists executive_summary_at timestamptz;
