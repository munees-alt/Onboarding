// Remove the redundant "Attach contract & confirm deck scope" step (m4.0a) from
// the micro-team template — contract is now captured at the m2.0a step. Idempotent.
// Run: node --env-file=.env.local scripts/sync-remove-deckscope.mjs
import pg from "pg";
async function connect() {
  for (const [name, conn] of [["DIRECT_URL", process.env.DIRECT_URL], ["DATABASE_URL", process.env.DATABASE_URL]].filter(([, v]) => v)) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; } catch (e) { console.log(`x ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}
const db = await connect();
try {
  for (const id of ["micro-team", "medium-team", "medium-enterprise"]) {
    const { rows } = await db.query("select data from onboarding_templates where id=$1", [id]);
    if (!rows.length) continue;
    const data = rows[0].data;
    let removed = 0;
    for (const stage of data.stages ?? []) {
      const before = stage.steps.length;
      stage.steps = stage.steps.filter((s) => !(s.act?.type === "checklist" && s.act?.btn === "Confirm scope from contract") && s.id !== "m4.0a");
      removed += before - stage.steps.length;
    }
    if (removed) { await db.query("update onboarding_templates set data=$1, updated_at=now() where id=$2", [data, id]); console.log(`+ ${id}: removed ${removed} redundant deck-scope step(s)`); }
    else console.log(`= ${id}: none to remove`);
  }
} finally { await db.end(); }
console.log("Done.");
