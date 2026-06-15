-- ============================================================================
-- Cadence — initial schema (onboarding product, standalone)
-- Single-org v1, built multi-tenant-ready (org_id on every table).
-- Client-portal access happens server-side via validated magic links using the
-- service role, so anon RLS is intentionally closed.
-- ============================================================================

-- gen_random_uuid() is available on Supabase by default.

-- ---------- Enums ----------------------------------------------------------
do $$ begin
  create type user_role as enum
    ('admin','ops_head','am','senior','junior','associate','intern','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type client_status as enum
    ('lead','signed','onboarding','active','inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type run_status as enum
    ('pending','active','in_progress','blocked','complete','closed','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type stage_status as enum ('upcoming','active','complete','blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type step_status as enum
    ('pending','active','complete','awaiting_client','blocked','skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type step_type as enum
    ('system','automated','manual','internal_confirm','form','approval','client_action','ai','link');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_type as enum ('internal','client_action','milestone');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum
    ('not_started','in_progress','complete','needs_input','blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ai_provider as enum ('openai','anthropic','google');
exception when duplicate_object then null; end $$;

do $$ begin
  create type doc_status as enum ('pending','uploaded','not_needed');
exception when duplicate_object then null; end $$;

-- ---------- Core: orgs, people, auth profiles ------------------------------
create table if not exists orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Org chart / people directory. Seedable, NOT tied to auth — demo personas and
-- real staff both live here. Roles are resolved from this tree.
create table if not exists team_members (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  full_name       text not null,
  email           text,
  role            user_role not null default 'other',
  title           text,
  dept            text,
  location        text,
  reports_to      uuid references team_members(id) on delete set null,
  avatar_initials text,
  avatar_color    text,
  is_demo         boolean not null default false,
  active          boolean not null default true,
  sort            int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists team_members_org_idx on team_members(org_id);
create index if not exists team_members_reports_to_idx on team_members(reports_to);

-- Auth accounts. Created on signup; linked to a team_member by email.
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  org_id          uuid references orgs(id) on delete set null,
  email           text,
  full_name       text,
  team_member_id  uuid references team_members(id) on delete set null,
  role            user_role not null default 'junior',
  created_at      timestamptz not null default now()
);

-- ---------- Clients --------------------------------------------------------
create table if not exists clients (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references orgs(id) on delete cascade,
  slug                  text unique,
  name                  text not null,
  owner_name            text,
  industry              text,
  entity_type           text,                       -- mainland | free_zone | offshore
  status                client_status not null default 'lead',
  services              text[] not null default '{}',
  primary_contact_name  text,
  primary_contact_email text,
  phone                 text,
  preferred_channel     text,
  established_year      int,
  employees             text,
  revenue_channels      text[] not null default '{}',
  revenue_bracket       text,
  vat_registered        text,
  vat_trn               text,
  ct_registered         text,
  bank_names            text[] not null default '{}',
  payment_gateways      text[] not null default '{}',
  accounting_software   text,
  historical_months     text,
  profile_complete      boolean not null default false,
  am_id                 uuid references team_members(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists clients_org_idx on clients(org_id);
create index if not exists clients_status_idx on clients(status);

-- ---------- Onboarding runs, stages, steps ---------------------------------
create table if not exists onboarding_runs (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  am_id             uuid references team_members(id) on delete set null,
  status            run_status not null default 'active',
  template_key      text not null default 'medium_enterprise',
  started_at        date,
  target_completion date,
  go_live_date      date,
  progress          int not null default 0,
  current_stage     int not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists runs_org_idx on onboarding_runs(org_id);
create index if not exists runs_client_idx on onboarding_runs(client_id);

create table if not exists run_team (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references onboarding_runs(id) on delete cascade,
  team_member_id  uuid not null references team_members(id) on delete cascade,
  role_in_run     user_role not null,
  unique(run_id, team_member_id)
);

create table if not exists run_stages (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references onboarding_runs(id) on delete cascade,
  stage_no    int not null,
  name        text not null,
  status      stage_status not null default 'upcoming',
  step_total  int not null default 0,
  step_done   int not null default 0,
  sort        int not null default 0,
  unique(run_id, stage_no)
);

create table if not exists run_steps (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references onboarding_runs(id) on delete cascade,
  stage_no      int not null,
  step_no       text not null,                       -- "4.1"
  title         text not null,
  description   text,
  type          step_type not null default 'manual',
  status        step_status not null default 'pending',
  assignee_id   uuid references team_members(id) on delete set null,
  ai_generated  boolean not null default false,
  is_approval   boolean not null default false,
  payload       jsonb not null default '{}'::jsonb,
  sort          int not null default 0,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists run_steps_run_idx on run_steps(run_id);

-- ---------- Intake form ----------------------------------------------------
create table if not exists intake_forms (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references onboarding_runs(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  prefilled     jsonb not null default '{}'::jsonb,
  submitted     jsonb not null default '{}'::jsonb,
  status        text not null default 'draft',        -- draft|sent|submitted|reviewed
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique(run_id)
);

-- ---------- Chart of accounts ----------------------------------------------
-- Industry base templates from the Finanshels workbook (single source of truth).
create table if not exists coa_templates (
  id          uuid primary key default gen_random_uuid(),
  industry    text not null unique,                   -- "Retail", "SaaS", ...
  accounts    jsonb not null,                          -- [{code,account,description,tag,category,subcategory}]
  source      text not null default 'workbook',
  created_at  timestamptz not null default now()
);

-- Per-run COA after AI tailoring + Senior Accountant edits + client sign-off.
create table if not exists coa_instances (
  id               uuid primary key default gen_random_uuid(),
  run_id           uuid not null references onboarding_runs(id) on delete cascade,
  client_id        uuid not null references clients(id) on delete cascade,
  base_industry    text,
  accounts         jsonb not null default '[]'::jsonb,  -- tailored, each {…, include, ai_note}
  ai_rationale     text,
  status           text not null default 'draft',       -- draft|sa_adjusted|sent_to_client|signed_off|changes_requested
  client_signed_off boolean not null default false,
  signed_off_at    timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique(run_id)
);

-- ---------- Task board ------------------------------------------------------
create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  run_id          uuid references onboarding_runs(id) on delete cascade,
  client_id       uuid references clients(id) on delete cascade,
  title           text not null,
  description     text,
  type            task_type not null default 'internal',
  status          task_status not null default 'not_started',
  owner_id        uuid references team_members(id) on delete set null,
  owner_kind      text not null default 'team',        -- team|client
  due_date        date,
  client_visible  boolean not null default false,
  service         text,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tasks_run_idx on tasks(run_id);

-- ---------- Documents (Supabase Storage paths) -----------------------------
create table if not exists documents (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid references onboarding_runs(id) on delete cascade,
  client_id       uuid not null references clients(id) on delete cascade,
  label           text not null,
  doc_type        text,
  status          doc_status not null default 'pending',
  storage_path    text,
  drive_subfolder text,
  required        boolean not null default true,
  uploaded_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- ---------- Magic links (client portal) ------------------------------------
create table if not exists magic_links (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  run_id      uuid references onboarding_runs(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  email       text not null,
  token       text not null unique,
  purpose     text not null default 'portal',          -- portal|intake|coa_review
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------- Settings (encrypted secrets) -----------------------------------
create table if not exists ai_settings (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade unique,
  openai_key_enc  text,
  anthropic_key_enc text,
  google_key_enc  text,
  feature_models  jsonb not null default '{}'::jsonb,   -- {brief:{provider,model}, coa:{...}, ...}
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists integration_settings (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade unique,
  pms_name          text,
  pms_key_enc       text,
  drive_connected   boolean not null default false,
  drive_config      jsonb not null default '{}'::jsonb,
  fathom_connected  boolean not null default false,
  fathom_config     jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------- AI generation log ----------------------------------------------
create table if not exists ai_generations (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references orgs(id) on delete cascade,
  run_id            uuid references onboarding_runs(id) on delete set null,
  feature           text not null,
  provider          ai_provider,
  model             text,
  prompt_tokens     int,
  completion_tokens int,
  total_tokens      int,
  status            text not null default 'ok',
  error             text,
  created_at        timestamptz not null default now()
);

-- ---------- Audit + notifications + drive ----------------------------------
create table if not exists audit_events (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references orgs(id) on delete cascade,
  actor         text,
  actor_role    text,
  action        text not null,
  module        text,
  resource_ref  text,
  resource_id   text,
  resource_type text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists audit_org_idx on audit_events(org_id, created_at desc);

create table if not exists notifications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  run_id        uuid references onboarding_runs(id) on delete cascade,
  recipient_id  uuid references team_members(id) on delete cascade,  -- null = team-wide
  kind          text not null default 'info',          -- task_tag|escalation|milestone|info
  title         text not null,
  body          text,
  read          boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists drive_folders (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade unique,
  tree        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists handover_checklists (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references onboarding_runs(id) on delete cascade unique,
  items           jsonb not null default '[]'::jsonb,    -- [{key,label,done,owner,resolution}]
  summary_pdf_path text,
  complete        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- updated_at triggers --------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','onboarding_runs','coa_instances','tasks',
    'ai_settings','integration_settings','drive_folders','handover_checklists'
  ] loop
    execute format(
      'drop trigger if exists trg_%1$s_updated on %1$s;
       create trigger trg_%1$s_updated before update on %1$s
       for each row execute function set_updated_at();', t);
  end loop;
end $$;
