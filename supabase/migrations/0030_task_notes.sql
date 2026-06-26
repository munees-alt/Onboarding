-- Task board redesign — minimal columns: Task name, Owner, Due date, Status, Notes.
-- "Notes" is a new free-text column; due moves from the prior service-string convention
-- into the proper tasks.due_date column (already exists).
alter table tasks add column if not exists notes text;
