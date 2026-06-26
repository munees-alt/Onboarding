-- Adds a portal-status snapshot to each weekly client update so the editor +
-- the AI composer can reference doc / intake / COA / access state without
-- re-querying at compose time. Refreshed by the cron and by regenerateDraft.
--
-- Shape:
--   { docs: { received, total }, access: { shared, total },
--     intake: 'submitted'|'awaiting'|'none',
--     coa:    'signed_off'|'pending'|'none' }

alter table weekly_client_updates
  add column if not exists status_snapshot jsonb not null default '{}'::jsonb;
