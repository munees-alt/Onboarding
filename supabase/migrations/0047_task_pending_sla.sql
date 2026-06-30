-- Batch 47: Per-org configurable SLA for team-task pending alert.
-- When a team task has been pending (not_started / in_progress but not complete)
-- for more than task_pending_sla_days days, the cron surfaces an admin_task for
-- the AM so nothing slips through silently.
alter table followup_config
  add column if not exists task_pending_sla_days int not null default 3;
