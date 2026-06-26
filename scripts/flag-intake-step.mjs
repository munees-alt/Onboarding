// One-time: in every DB-stored onboarding_templates row, flag the "Send intake form
// to client" step (top of Stage 1) so it uses the PUBLIC no-login intake link
// instead of the OTP-gated portal link.
//
// What this does for each template row:
//   - Find the dispatch step whose title contains "Send intake form to client"
//     (set by an earlier batch when the step was moved to the top of Stage 1).
//   - Set act.intake = true on that step.
//   - Refresh the step's note to describe the new no-login flow.
//
// Re-runnable. Idempotent: if act.intake is already true and the note already
// mentions "no-login", the row is skipped.
//
// Run: node --env-file=.env.local scripts/flag-intake-step.mjs

import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const TITLE = "Send intake form to client";
const NEW_NOTE =
  "Generates a public no-login intake link and the ready-to-send email + WhatsApp templates. " +
  "The client just opens the link, fills the form, and their answers autosave — no password or code needed. " +
  "The team sees the answers live in this run.";

const { data: rows, error } = await db.from("onboarding_templates").select("id,name,data");
if (error) { console.error(error); process.exit(1); }

const report = [];
for (const row of rows ?? []) {
  const tpl = row.data;
  if (!tpl?.stages?.length) { report.push({ template: row.name, change: "no stages" }); continue; }

  let touched = 0;
  for (const stage of tpl.stages) {
    for (const step of stage.steps ?? []) {
      if (step?.act?.type === "dispatch" && (step.title === TITLE || step.title?.toLowerCase().includes("send intake form"))) {
        const before = JSON.stringify(step.act ?? {});
        step.act = { ...(step.act ?? {}), type: "dispatch", intake: true, btn: step.act?.btn ?? "Mark sent" };
        step.note = NEW_NOTE;
        if (JSON.stringify(step.act) !== before) touched++;
      }
    }
  }

  if (!touched) { report.push({ template: row.name, change: "no intake-send step" }); continue; }

  const { error: uerr } = await db.from("onboarding_templates").update({ data: tpl }).eq("id", row.id);
  if (uerr) { console.error("update failed", row.name, uerr); continue; }
  report.push({ template: row.name, change: `flagged ${touched} step(s) as intake=true` });
}

console.log(report);
console.log("Done.");
