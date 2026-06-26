// Append the "Generate onboarding one-pager" step to the end of the Project & Tasks stage
// (medium-team t6.3, micro-team m6.3). Idempotent — skipped if an onepager step already exists.
// Run: node --env-file=.env.local scripts/sync-onepager-step.mjs
import pg from "pg";

// On this machine the DIRECT db host (:5432) is firewalled; the SESSION pooler (:5432 on the
// pooler host) is reachable + supports DDL. Try DIRECT/DATABASE first, then the session-pooler
// rewrite (DATABASE_URL with :6543/ → :5432/).
async function connect() {
  const candidates = [
    ["DIRECT_URL", process.env.DIRECT_URL],
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["SESSION_POOLER", (process.env.DATABASE_URL ?? "").replace(":6543/", ":5432/")],
  ].filter(([, v]) => v);
  for (const [name, conn] of candidates) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; }
    catch (e) { console.log(`x ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}

const step = (id) => ({
  id, title: "Generate onboarding one-pager", kind: "person", who: ["AM"],
  note: "Polished one-pager summarising the compliance calendar, first delivery date, team contacts and UAE compliance details. Share with the client before recurring delivery kicks off.",
  act: { type: "onepager", btn: "Generate one-pager" },
});

const PATCHES = [
  { id: "medium-team", stageId: "t6", stepId: "t6.3" },
  { id: "micro-team", stageId: "m6", stepId: "m6.3" },
];

const db = await connect();
try {
  for (const { id, stageId, stepId } of PATCHES) {
    const { rows } = await db.query("select data from onboarding_templates where id = $1", [id]);
    if (!rows.length) { console.log(`- ${id}: not in DB — skipped`); continue; }
    const data = rows[0].data;
    const stage = (data.stages ?? []).find((s) => s.id === stageId);
    if (!stage) { console.log(`! ${id}: stage ${stageId} not found`); continue; }
    if (stage.steps.some((s) => s.act?.type === "onepager")) { console.log(`= ${id}: onepager step already present — skipped`); continue; }
    stage.steps.push(step(stepId));
    await db.query("update onboarding_templates set data = $1, updated_at = now() where id = $2", [data, id]);
    console.log(`+ ${id}: appended ${stepId} to "${stage.name}"`);
  }
} finally {
  await db.end();
}
console.log("Done.");
