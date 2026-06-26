// One-shot: add a "Pick handover destination" step (t7.0 / m7.0) at the TOP
// of the handover stage in every DB-stored template that has one. Idempotent.
//
// Run: node --env-file=.env.local scripts/sync-handover-pick.mjs

import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PICK_TITLE = "Pick handover destination";
const PICK_NOTE = "Choose the Team Lead / Senior who will RECEIVE this client for recurring delivery. They'll be added to the run team and notified.";

const { data: rows } = await db.from("onboarding_templates").select("id,name,data");
const report = [];
for (const row of rows ?? []) {
  const tpl = row.data;
  if (!tpl?.stages?.length) { report.push({ template: row.name, change: "no stages" }); continue; }

  let touched = 0;
  for (const stage of tpl.stages) {
    const isHandover = /handover/i.test(stage.name ?? "");
    if (!isHandover) continue;
    const steps = stage.steps ?? [];
    if (steps.some((s) => s?.title === PICK_TITLE || s?.act?.role === "Handover Lead")) continue;
    // Build the new pick step. Use stage id prefix.
    const newId = `${stage.id}.0`;
    const pickStep = {
      id: newId,
      title: PICK_TITLE,
      kind: "person",
      who: ["AM"],
      note: PICK_NOTE,
      act: { type: "assign", role: "Handover Lead", btn: "Set handover destination" },
    };
    stage.steps = [pickStep, ...steps];
    touched++;
  }

  if (!touched) { report.push({ template: row.name, change: "no handover stage" }); continue; }
  const { error: uerr } = await db.from("onboarding_templates").update({ data: tpl }).eq("id", row.id);
  if (uerr) { console.error("update failed", row.name, uerr); continue; }
  report.push({ template: row.name, change: `added handover pick to ${touched} stage(s)` });
}
console.log(report);
console.log("Done.");
