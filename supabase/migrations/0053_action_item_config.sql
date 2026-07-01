-- Batch: Action Item Configuration (platform cleanup).
-- Splits the old single "team_escalation_days" step into two configurable
-- escalation windows (team member -> Team Lead, then Team Lead -> AM), and
-- adds a re-fire cadence for client-data action items (docs/access) which now
-- fire immediately once pending (no initial waiting window) and re-fire on a
-- separate cadence if still open after being closed once.
alter table followup_config
  add column if not exists tl_escalation_days int not null default 2,
  add column if not exists am_escalation_days int not null default 1,
  add column if not exists client_data_refire_days int not null default 3;
