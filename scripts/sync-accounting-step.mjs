// Insert the "Confirm accounting software" step as the LAST step of the call stage
// (medium-enterprise e5.4, medium-team t4.3, micro-team m4.3). Idempotent.
// Run: node --env-file=.env.local scripts/sync-accounting-step.mjs
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
  id, title: "Confirm accounting software", kind: "person", who: ["AM", "Senior"],
  note: "Record which accounting software we'll run this client on (Zoho Books, QuickBooks, Xero, Odoo…). Saved to the client and shown in the playbook → Tools & Access.",
  act: { type: "accountingsoftware", btn: "Set accounting software" },
});

const PATCHES = [
  { id: "medium-enterprise", stepId: "e5.4", stageRe: /kickoff call/i },
  { id: "medium-team", stepId: "t4.3", stageRe: /call with client/i },
  { id: "micro-team", stepId: "m4.3", stageRe: /call with client/i },
];

const db = await connect();
try {
  for (const { id, stepId, stageRe } of PATCHES) {
    const { rows } = await db.query("select data from onboarding_templates where id = $1", [id]);
    if (!rows.length) { console.log(`- ${id}: not in DB — skipped`); continue; }
    const data = rows[0].data;
    const stage = (data.stages ?? []).find((s) => stageRe.test(s.name));
    if (!stage) { console.log(`! ${id}: no call stage matching ${stageRe}`); continue; }
    if (stage.steps.some((s) => s.act?.type === "accountingsoftware")) { console.log(`= ${id}: accounting-software step already present — skipped`); continue; }
    stage.steps.push(step(stepId));
    await db.query("update onboarding_templates set data = $1, updated_at = now() where id = $2", [data, id]);
    console.log(`+ ${id}: appended ${stepId} to "${stage.name}"`);
  }
} finally {
  await db.end();
}
console.log("Done.");
