-- Add snooze/hold fields to admin_tasks so Master Admin can park a task
-- until an external action resolves (gov confirmation, client doc, etc.).
alter table admin_tasks
  add column if not exists snoozed_until timestamptz,
  add column if not exists hold_note      text;
