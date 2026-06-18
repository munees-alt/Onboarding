-- Diagram builder upgrade: nodes carry x/y positions (within the existing jsonb),
-- and a new `edges` array stores the connectors drawn on the canvas.
alter table run_diagrams add column if not exists edges jsonb not null default '[]'::jsonb;
