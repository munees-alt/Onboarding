-- Fix: 'shared_to_client' was added as an AML board status/column (commit 2cf39da)
-- but the DB check constraint was never updated, so saving that status 500s.
alter table aml_records drop constraint if exists aml_records_status_check;
alter table aml_records add constraint aml_records_status_check
  check (status in ('pending', 'in_review', 'document_created', 'link_sent', 'signed', 'shared_to_client', 'completed'));
