// One-time: in every DB-stored onboarding_templates row, move the "dispatch" step
// from the end of Stage 2 → top of Stage 1 (right after the auto-created step,
// before any "assign" steps). Renames the old end-of-stage-2 dispatch to a
// "Re-send portal link (optional)" fallback so it doesn't run twice for in-flight
// runs.
// Run: node --env-file=.env.local scripts/move-intake-step.mjs
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const NEW_FIRST_TITLE = "Send intake form to client";
const NEW_FIRST_NOTE = "Generates the secure client portal link and the ready-to-send email + WhatsApp templates. The team copies or sends them; the client logs in with their email + a one-time code to fill the intake form (optional but recommended).";

const RESEND_TITLE = "Re-send portal link (optional)";
const RESEND_NOTE = "Optional — if the client lost the original link, re-send the intake/portal templates. Same link, fresh email/WhatsApp message.";

const { data: rows, error } = await db.from("onboarding_templates").select("id,name,data");
if (error) { console.error(error); process.exit(1); }

const report = [];
for (const row of rows ?? []) {
  const tpl = row.data;
  if (!tpl?.stages?.length) { report.push({ template: row.name, change: "no stages" }); continue; }

  const changes = [];
  // 1) Find existing dispatch steps anywhere. Re-label all of them as the "Re-send"
  //    fallback (the new top-of-stage-1 step will be the primary send).
  for (const stage of tpl.stages) {
    for (const step of stage.steps ?? []) {
      if (step?.act?.type === "dispatch" && step.title !== NEW_FIRST_TITLE) {
        step.title = RESEND_TITLE;
        step.note = RESEND_NOTE;
        step.who = ["AM"];
        step.act = { ...step.act, btn: "Mark re-sent", optional: true };
        changes.push(`renamed ${step.id} → resend`);
      }
    }
  }

  // 2) Insert a fresh dispatch step at position 1 of Stage 1 if not already present.
  const stage1 = tpl.stages[0];
  if (stage1?.steps) {
    const alreadyTop = stage1.steps.some((s) => s?.title === NEW_FIRST_TITLE);
    if (!alreadyTop) {
      // Place RIGHT AFTER the auto-created step (which is always step[0] with pre:true)
      const afterPre = stage1.steps[0]?.pre ? 1 : 0;
      const idPrefix = (stage1.steps[afterPre]?.id ?? "x1.1").match(/^[a-z]+/i)?.[0] ?? "x";
      const stageNo = (stage1.steps[afterPre]?.id ?? "x1.1").match(/^[a-z]+(\d+)/i)?.[1] ?? "1";
      const newStep = {
        id: `${idPrefix}${stageNo}.1a`,
        title: NEW_FIRST_TITLE,
        kind: "link",
        who: ["AM"],
        note: NEW_FIRST_NOTE,
        act: { type: "dispatch", btn: "Mark sent" },
      };
      stage1.steps.splice(afterPre, 0, newStep);
      changes.push(`inserted ${newStep.id} at top of stage 1`);
    }
  }

  if (!changes.length) { report.push({ template: row.name, change: "no-op" }); continue; }
  const { error: uErr } = await db.from("onboarding_templates").update({ data: tpl }).eq("id", row.id);
  if (uErr) { report.push({ template: row.name, change: changes.join("; "), error: uErr.message }); continue; }
  report.push({ template: row.name, change: changes.join("; ") });
}

console.log("Result:");
console.table(report);
