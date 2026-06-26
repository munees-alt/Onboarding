import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: cli } = await c.query("select id, name, custom_code from clients where name ilike '%blu%talent%' or name ilike '%blutalent%' limit 5");
console.log("CLIENT:", cli);
if (!cli.length) { await c.end(); process.exit(0); }
const clientId = cli[0].id;
const { rows: df } = await c.query("select tree from drive_folders where client_id = $1", [clientId]);
console.log("\nDRIVE_FOLDERS row tree:", df[0]?.tree ?? "(none)");
const { rows: runs } = await c.query("select id, status, am_id, current_stage from onboarding_runs where client_id = $1", [clientId]);
console.log("\nRUNS:", runs);
const runId = runs[0]?.id;
if (runId) {
  const { rows: team } = await c.query(`
    select rt.role_in_run, tm.full_name, tm.id as team_member_id,
      exists (select 1 from member_connections mc where mc.team_member_id = tm.id and mc.provider='google' and mc.connected=true) as google_connected
    from run_team rt join team_members tm on tm.id = rt.team_member_id where rt.run_id = $1`, [runId]);
  console.log("\nRUN_TEAM (with Google connected flag):", team);
  const { rows: items } = await c.query("select kind, status, data from run_items where run_id = $1 and kind = 'compliance'", [runId]);
  console.log("\nCOMPLIANCE ITEMS in run:", JSON.stringify(items, null, 2));
}
await c.end();
