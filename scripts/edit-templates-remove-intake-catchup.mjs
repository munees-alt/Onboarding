// Removes from micro-2, micro-team, medium-team:
//   • the "Prepare intake form set (optional)" step (act=intake)
//   • the entire "Catch-up Accounting" stage
// Idempotent.
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const TARGETS = ["micro-2", "micro-team", "medium-team"];
const REPORT = [];

for (const id of TARGETS) {
  const { data: row } = await db.from("onboarding_templates").select("data").eq("id", id).maybeSingle();
  if (!row) { REPORT.push({ tpl: id, status: "not_found" }); continue; }
  const tpl = row.data;
  const before = {
    stages: tpl.stages.length,
    steps: tpl.stages.reduce((n, s) => n + (s.steps?.length ?? 0), 0),
    hadCatchupStage: !!tpl.stages.find((s) => /catch-?up accounting/i.test(s.name ?? "")),
    hadIntakeStep: tpl.stages.some((s) => s.steps?.some((st) => st.act?.type === "intake")),
  };
  // 1) Drop the Catch-up Accounting stage outright
  tpl.stages = tpl.stages.filter((s) => !/catch-?up accounting/i.test(s.name ?? ""));
  // 2) Drop the intake-prep step from every stage
  for (const stage of tpl.stages) {
    if (!stage.steps) continue;
    stage.steps = stage.steps.filter((st) => st.act?.type !== "intake");
  }
  const after = {
    stages: tpl.stages.length,
    steps: tpl.stages.reduce((n, s) => n + (s.steps?.length ?? 0), 0),
  };
  const { error } = await db.from("onboarding_templates").update({ data: tpl }).eq("id", id);
  REPORT.push({ tpl: id, status: error ? `db_err: ${error.message}` : "ok", ...before, ...after });
}

console.table(REPORT);
