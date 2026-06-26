// After removing the Catch-up Accounting stage + intake-prep step from the
// onboarding templates, existing runs still have run_stages / run_steps rows
// referring to the now-deleted stages/steps. Clean them up and re-sync
// run_stages rows to the new stage_no ordering.
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const TARGETS = ["micro-2", "micro-team", "medium-team"];

// 1) Load the current templates
const templates = {};
for (const id of TARGETS) {
  const { data } = await db.from("onboarding_templates").select("data").eq("id", id).maybeSingle();
  templates[id] = data?.data;
}

const REPORT = [];
for (const [tid, tpl] of Object.entries(templates)) {
  if (!tpl) continue;
  const validStepIds = new Set(tpl.stages.flatMap((s) => (s.steps ?? []).map((st) => st.id)));
  // Find all runs of this template
  const { data: runs } = await db.from("onboarding_runs").select("id").eq("template_key", tid);
  let stepsDeleted = 0, stagesUpdated = 0, stagesDeleted = 0;
  for (const r of runs ?? []) {
    // Delete orphan run_steps
    const { data: rs } = await db.from("run_steps").select("step_no").eq("run_id", r.id);
    const orphanSteps = (rs ?? []).map((x) => x.step_no).filter((sn) => !validStepIds.has(sn));
    if (orphanSteps.length) {
      const { error } = await db.from("run_steps").delete().eq("run_id", r.id).in("step_no", orphanSteps);
      if (!error) stepsDeleted += orphanSteps.length;
    }
    // Re-sync run_stages: each stage_no should reflect the new template's stage
    // at index (stage_no - 1).
    const { data: existingStages } = await db.from("run_stages").select("stage_no").eq("run_id", r.id).order("stage_no");
    const validStageNos = new Set(tpl.stages.map((_, i) => i + 1));
    // Delete rows beyond the new template size
    const drop = (existingStages ?? []).map((s) => s.stage_no).filter((n) => !validStageNos.has(n));
    if (drop.length) {
      const { error } = await db.from("run_stages").delete().eq("run_id", r.id).in("stage_no", drop);
      if (!error) stagesDeleted += drop.length;
    }
    // Update remaining rows' name + step_total to match the (possibly shifted) template stage
    for (let i = 0; i < tpl.stages.length; i++) {
      const stage = tpl.stages[i];
      const stage_no = i + 1;
      const { error } = await db.from("run_stages").update({
        name: stage.name,
        step_total: (stage.steps ?? []).length,
      }).eq("run_id", r.id).eq("stage_no", stage_no);
      if (!error) stagesUpdated++;
    }
  }
  REPORT.push({ tpl: tid, runs: runs?.length ?? 0, stepsDeleted, stagesDeleted, stagesUpdated });
}
console.table(REPORT);
