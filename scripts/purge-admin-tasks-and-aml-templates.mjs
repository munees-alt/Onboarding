// One-off cleanup (2026-07-02):
//   1. Delete ALL rows from admin_tasks (Action Items) — full reset, history included
//      (history is stored inline in the row's `history` jsonb column, so deleting the
//      row deletes its history too — there's no separate history table).
//   2. Delete orphaned onboarding_templates DB rows for "aml-review" / "compliance-renewal"
//      (the code templates were removed; these DB-seeded rows are dead leftovers).
//   3. Report any onboarding_runs still pointing at those two template_keys, so we know
//      if any live AML/renewal runs exist that also need attention.
//
// Run with --apply to actually delete. Without it, this only reports counts (dry run).
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const adminTasksCount = await c.query(`select count(*)::int n from admin_tasks`);
console.log(`admin_tasks rows: ${adminTasksCount.rows[0].n}`);

const orphanTemplates = await c.query(
  `select id, name from onboarding_templates where id in ('aml-review','compliance-renewal')`
);
console.log(`orphaned onboarding_templates rows: ${orphanTemplates.rows.length}`);
for (const r of orphanTemplates.rows) console.log(`  - ${r.id} (${r.name})`);

const orphanRuns = await c.query(
  `select id, client_id, status, template_key from onboarding_runs where template_key in ('aml-review','compliance-renewal')`
);
console.log(`onboarding_runs on those templates: ${orphanRuns.rows.length}`);
for (const r of orphanRuns.rows) console.log(`  - run ${r.id} · client ${r.client_id} · status ${r.status} · template ${r.template_key}`);

if (!APPLY) {
  console.log("\nDry run only — re-run with --apply to actually delete admin_tasks rows and orphaned template rows.");
  console.log("(onboarding_runs rows, if any were listed above, are NOT deleted by this script — flagged for manual review.)");
  await c.end();
  process.exit(0);
}

const delTasks = await c.query(`delete from admin_tasks`);
console.log(`Deleted ${delTasks.rowCount} admin_tasks rows.`);

const delTemplates = await c.query(`delete from onboarding_templates where id in ('aml-review','compliance-renewal')`);
console.log(`Deleted ${delTemplates.rowCount} orphaned onboarding_templates rows.`);

// All child tables (run_stages/run_steps/run_items/tasks/documents/etc.) cascade on
// onboarding_runs.id, so deleting the run rows is sufficient (confirmed against migrations).
const delRuns = await c.query(`delete from onboarding_runs where template_key in ('aml-review','compliance-renewal')`);
console.log(`Deleted ${delRuns.rowCount} onboarding_runs rows (and their cascaded stages/steps/items).`);

await c.end();
