import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const sql = `
create table if not exists dept_overrides (
  org_id uuid not null references orgs(id) on delete cascade,
  dept text not null,
  nav_id text not null,
  allow bool not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, dept, nav_id)
);
alter table dept_overrides enable row level security;
drop policy if exists dept_overrides_org_all on dept_overrides;
create policy dept_overrides_org_all on dept_overrides for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());

create table if not exists user_nav_overrides (
  org_id uuid not null references orgs(id) on delete cascade,
  member_id uuid not null references team_members(id) on delete cascade,
  nav_id text not null,
  allow bool not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, member_id, nav_id)
);
alter table user_nav_overrides enable row level security;
drop policy if exists user_nav_overrides_org_all on user_nav_overrides;
create policy user_nav_overrides_org_all on user_nav_overrides for all to authenticated
  using (org_id = auth_org_id()) with check (org_id = auth_org_id());
`;

// Try the pg-style RPC if it exists
const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ sql }),
});
const text = await res.text();
if (res.ok) {
  console.log("Tables created via exec_sql RPC:", text);
} else {
  // exec_sql not available — print the SQL for manual execution
  console.error("exec_sql RPC not available:", text);
  console.log("\n=== Run this SQL in the Supabase SQL editor ===\n");
  console.log(sql);
}
