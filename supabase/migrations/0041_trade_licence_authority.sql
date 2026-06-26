-- Add trade licence issuing authority to clients (DMCC, IFZA, Mainland DED, etc.)
alter table clients add column if not exists trade_licence_authority text;
