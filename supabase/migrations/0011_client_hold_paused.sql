-- Add "hold" and "paused" lifecycle statuses for clients.
-- ADD VALUE IF NOT EXISTS is idempotent and safe to re-run.
alter type client_status add value if not exists 'hold';
alter type client_status add value if not exists 'paused';
