-- Auto-points columns on user_points + week_key dedup index.
-- Existing user_points rows are manual awards; new auto rows carry source + ref_id + week_key.

alter table user_points add column if not exists source   text not null default 'manual'
  check (source in ('manual','auto_sla','auto_task','auto_overdue','auto_other'));
alter table user_points add column if not exists ref_id   text;          -- run_id / task_id / stage_id
alter table user_points add column if not exists week_key text;          -- YYYY-Www for dedup

-- Prevent double-awarding the same auto event in the same week
create unique index if not exists user_points_auto_dedup
  on user_points (org_id, member_id, source, ref_id, week_key)
  where source <> 'manual' and ref_id is not null and week_key is not null;
