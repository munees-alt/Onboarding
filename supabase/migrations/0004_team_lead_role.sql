-- Add the Team Lead role. Removable later by dropping this value + reverting
-- the bucketing in scripts/seed.mjs and src/lib/roles.ts.
alter type user_role add value if not exists 'team_lead' after 'am';
