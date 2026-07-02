// One-off cleanup (2026-07-02): delete all onboarding_runs still on the
// removed "compliance-renewal" template (see purge-admin-tasks-and-aml-templates.mjs,
// which purged the dead template rows + admin_tasks but flagged these runs for
// manual review instead of deleting them). All child tables (run_stages, run_items,
// run_messages, tasks, admin_tasks, weekly_client_updates, etc.) reference
// onboarding_runs(id) with ON DELETE CASCADE or SET NULL, so deleting the run
// row is sufficient — no separate cleanup needed.
//
// Run with --apply to actually delete. Without it, this only reports what would be deleted (dry run).
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const runs = await c.query(
  `select r.id, r.status, r.template_key, cl.name as client_name
   from onboarding_runs r left join clients cl on cl.id = r.client_id
   where r.template_key in ('aml-review','compliance-renewal')
   order by r.status, cl.name`
);
console.log(`onboarding_runs to delete: ${runs.rows.length}`);
for (const r of runs.rows) console.log(`  - run ${r.id} · ${r.client_name ?? r.client_id} · status ${r.status} · template ${r.template_key}`);

if (!runs.rows.length) {
  console.log("Nothing to delete.");
  await c.end();
  process.exit(0);
}

if (!APPLY) {
  console.log("\nDry run only — re-run with --apply to actually delete these onboarding_runs rows (cascades to run_stages/run_items/run_messages/tasks/etc).");
  await c.end();
  process.exit(0);
}

const ids = runs.rows.map((r) => r.id);
const del = await c.query(`delete from onboarding_runs where id = any($1::uuid[])`, [ids]);
console.log(`Deleted ${del.rowCount} onboarding_runs rows (and cascaded child rows).`);

await c.end();
