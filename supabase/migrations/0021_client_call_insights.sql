-- Call-driven playbook insights: pain points + the call link/notes the AI extracted from.
-- (clients.description already holds the brief business description.)
alter table clients add column if not exists pain_points text[] not null default '{}';
alter table clients add column if not exists call_link text;
alter table clients add column if not exists call_notes text;
alter table clients add column if not exists call_summary text;
