// Insert the "Upload contract & confirm deliverables" step as the FIRST step of
// the Send Magic Link stage (medium-team t2.0a, micro-team m2.0a). Idempotent.
// Run: node --env-file=.env.local scripts/sync-contract-step.mjs
import pg from "pg";

async function connect() {
  for (const [name, conn] of [["DIRECT_URL", process.env.DIRECT_URL], ["DATABASE_URL", process.env.DATABASE_URL]].filter(([, v]) => v)) {
    const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    try { await client.connect(); console.log(`Connected via ${name}`); return client; }
    catch (e) { console.log(`x ${name}: ${e.message}`); try { await client.end(); } catch {} }
  }
  throw new Error("Could not connect.");
}

const contractStep = (id) => ({
  id, title: "Upload contract & confirm deliverables", kind: "doc", who: ["AM", "Senior"],
  note: "Attach or paste the engagement contract — AI extracts the scope, exclusions, payment terms and the reports we deliver (with timelines). Shown to the client in their portal Live tab.",
  act: { type: "contract", btn: "Upload & analyze contract" },
});

const PATCHES = [
  { id: "medium-team", stepId: "t2.0a" },
  { id: "micro-team", stepId: "m2.0a" },
];

const db = await connect();
try {
  for (const { id, stepId } of PATCHES) {
    const { rows } = await db.query("select data from onboarding_templates where id = $1", [id]);
    if (!rows.length) { console.log(`- ${id}: not in DB — skipped`); continue; }
    const data = rows[0].data;
    const stage = (data.stages ?? []).find((s) => /send magic link/i.test(s.name));
    if (!stage) { console.log(`! ${id}: no Send Magic Link stage`); continue; }
    if (stage.steps.some((s) => s.act?.type === "contract")) { console.log(`= ${id}: contract step already present — skipped`); continue; }
    stage.steps.unshift(contractStep(stepId));
    await db.query("update onboarding_templates set data = $1, updated_at = now() where id = $2", [data, id]);
    console.log(`+ ${id}: inserted ${stepId} as first step of "${stage.name}"`);
  }
} finally {
  await db.end();
}
console.log("Done.");
