-- Allow master admin to manually override the auto-calculated current load per member.
alter table am_capacity add column if not exists load_override integer;
