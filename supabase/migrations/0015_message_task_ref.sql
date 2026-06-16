-- Chat messages can reference a specific task ("tag which task").
alter table run_messages add column if not exists task_ref text;
