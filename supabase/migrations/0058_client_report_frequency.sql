-- Reporting frequency per client — Monthly (default) / Quarterly / Annually.
-- Drives the cadence of client work and is a filter on the Clients + Onboarding
-- views. Set at client sign-up going forward; existing clients default to
-- monthly. This column is user-editable, so we DO NOT re-seed values on
-- migration re-run — the one-time backfill of the quarterly clients is a
-- separate data script.
alter table clients
  add column if not exists report_frequency text not null default 'monthly';

-- Guard against typos; keep the three allowed values.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_report_frequency_chk') then
    alter table clients add constraint clients_report_frequency_chk
      check (report_frequency in ('monthly', 'quarterly', 'annually'));
  end if;
end $$;
