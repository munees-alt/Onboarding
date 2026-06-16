-- Custom kanban column per task (free text; the column set is stored per-run
-- in run_items kind='board_columns'). Independent of the status enum.
alter table tasks add column if not exists board_column text;
