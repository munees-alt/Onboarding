-- Block a run when its deadlines aren't the team's fault.
--
-- Real story: CT filing waits for catch-up bookkeeping; VAT registration waits
-- for the client to send the trade licence. Without a block flag the SLA cron
-- keeps paging the AM as "overdue" and the dashboard shows red — even though
-- the team is correctly waiting on an upstream dependency.
--
-- When `blocked_reason` is set:
--   • SLA cron skips this run (task overdue + compliance reminder)
--   • admin_tasks cron does NOT create new compliance_alert chips
--   • Run header shows a "Blocked: <reason>" pill so the cause is visible
-- Clearing the column re-enables alerts and the SLA clock resumes.

alter table onboarding_runs
  add column if not exists blocked_reason text,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_by uuid references team_members(id) on delete set null;

create index if not exists onboarding_runs_blocked_idx on onboarding_runs(blocked_reason) where blocked_reason is not null;
