// Insert the "Configure system access requests" step into the DB-stored templates
// (medium-team after t2.2, micro-team after m2.2). Idempotent.
// Run: node --env-file=.env.local scripts/sync-access-step.mjs
import pg from "pg";

async function connect() {
  for (const [name, conn] of [["DIRECT_URL", process.env.DIRECT_URL], ["DATABASE_URL", process.env.DATABASE_URL]].filter(([, v]) => v)) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; }
    catch (e) { console.log(`x ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}

const accessStep = (id) => ({
  id, title: "Configure system access requests", kind: "person", who: ["Senior"],
  note: "Choose which systems the client must give us access to (FTA portal, bank, payment gateways, accounting software, payroll…). Each gets a step-by-step SOP in the client portal.",
  act: { type: "access", btn: "Configure access requests" },
});

const PATCHES = [
  { id: "medium-team", after: "t2.2", stepId: "t2.2b" },
  { id: "micro-team", after: "m2.2", stepId: "m2.2b" },
];

const db = await connect();
try {
  for (const { id, after, stepId } of PATCHES) {
    const { rows } = await db.query("select data from onboarding_templates where id = $1", [id]);
    if (!rows.length) { console.log(`- ${id}: not in DB — skipped`); continue; }
    const data = rows[0].data;
    let done = false;
    for (const stage of data.stages ?? []) {
      if (stage.steps.some((s) => s.act?.type === "access")) { console.log(`= ${id}: access step already present — skipped`); done = true; break; }
      const idx = stage.steps.findIndex((s) => s.id === after);
      if (idx >= 0) { stage.steps.splice(idx + 1, 0, accessStep(stepId)); done = true; console.log(`+ ${id}: inserted ${stepId} after ${after}`); break; }
    }
    if (done) await db.query("update onboarding_templates set data = $1, updated_at = now() where id = $2", [data, id]);
    else console.log(`! ${id}: could not find step ${after}`);
  }
} finally {
  await db.end();
}
console.log("Done.");
