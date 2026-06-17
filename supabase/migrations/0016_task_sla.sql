-- Task SLA reminders: dedup marker so the AM isn't notified repeatedly for the
-- same task. Values: null | 'not_started' | 'overdue'.
alter table tasks add column if not exists sla_notified text;
