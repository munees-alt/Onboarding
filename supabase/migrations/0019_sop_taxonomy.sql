-- SOP master taxonomy: scope (master/client/industry), flow (accounting/tax/general),
-- a finer category (bank/gateway/fta/...), and an optional client link.
alter table sops add column if not exists scope text not null default 'master';
alter table sops add column if not exists flow text;
alter table sops add column if not exists category text;
alter table sops add column if not exists client_id uuid references clients(id) on delete cascade;
create index if not exists sops_scope_idx on sops(org_id, scope, flow);
