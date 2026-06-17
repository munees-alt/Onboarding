// Patch the DB-stored onboarding templates to add the "Assign Team Lead" step
// to the Assign Roles stage of medium-team and micro-team. Idempotent.
// Run: node --env-file=.env.local scripts/sync-templates.mjs
import pg from "pg";

async function connect() {
  for (const [name, conn] of [["DIRECT_URL", process.env.DIRECT_URL], ["DATABASE_URL", process.env.DATABASE_URL]].filter(([, v]) => v)) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; }
    catch (e) { console.log(`x ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}

const PATCHES = [
  { id: "medium-team", stepId: "t1.1b" },
  { id: "micro-team", stepId: "m1.1b" },
];
const teamLeadStep = (stepId) => ({
  id: stepId, title: "Assign Team Lead", kind: "person", who: ["AM"],
  note: "Owns delivery quality for this client. AM can override the default.",
  act: { type: "assign", role: "Team Lead" },
});

const db = await connect();
try {
  for (const { id, stepId } of PATCHES) {
    const { rows } = await db.query("select data from onboarding_templates where id = $1", [id]);
    if (!rows.length) { console.log(`- ${id}: not in DB (will use code fallback) — skipped`); continue; }
    const data = rows[0].data;
    const stage = data.stages?.[0];
    if (!stage) { console.log(`- ${id}: no first stage — skipped`); continue; }
    const already = stage.steps.some((s) => s.act?.role === "Team Lead");
    if (already) { console.log(`= ${id}: Team Lead step already present — skipped`); continue; }
    // Insert right after the auto "run created" step (index 0), before Senior.
    stage.steps.splice(1, 0, teamLeadStep(stepId));
    await db.query("update onboarding_templates set data = $1, updated_at = now() where id = $2", [data, id]);
    console.log(`+ ${id}: inserted ${stepId} (Assign Team Lead)`);
  }
} finally {
  await db.end();
}
console.log("Done.");
