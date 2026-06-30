-- Add 'document_created' as a valid AML status (signing link prepared, pre-send).
alter table aml_records drop constraint if exists aml_records_status_check;
alter table aml_records add constraint aml_records_status_check
  check (status in ('pending', 'in_review', 'document_created', 'link_sent', 'signed', 'completed'));
