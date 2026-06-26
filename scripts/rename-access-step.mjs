// One-time: rename the access-step title + note in any DB-stored onboarding_templates
// rows. Templates rendered from DB override the code defaults, so editing the .ts file
// alone is not enough — we must rewrite the JSON stored against each template row.
// Run: node --env-file=.env.local scripts/rename-access-step.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const NEW_TITLE = "Configure all access & tools";
const NEW_NOTE = "The single step where we lock in every system the team will use for this client AND the access the client needs to grant. Tick each tool (accounting software, banks, payment gateways, FTA portal, payroll) and add the team emails the access should be shared with. Each gets a step-by-step SOP in the client portal.";
const NEW_BTN = "Configure all access & tools";

const { data: rows, error } = await db.from("onboarding_templates").select("id,name,data");
if (error) { console.error(error); process.exit(1); }

const report = [];
for (const row of rows ?? []) {
  const tpl = row.data;
  if (!tpl?.stages) { report.push({ template: row.name, changed: 0, note: "no stages" }); continue; }
  let changes = 0;
  for (const stage of tpl.stages) {
    for (const step of stage.steps ?? []) {
      if (step?.act?.type === "access") {
        step.title = NEW_TITLE;
        step.note = NEW_NOTE;
        if (step.act.btn) step.act.btn = NEW_BTN;
        changes++;
      }
    }
  }
  if (changes) {
    const { error: uErr } = await db.from("onboarding_templates").update({ data: tpl }).eq("id", row.id);
    if (uErr) { report.push({ template: row.name, changed: changes, error: uErr.message }); continue; }
  }
  report.push({ template: row.name, changed: changes });
}

console.log("Result:");
console.table(report);
