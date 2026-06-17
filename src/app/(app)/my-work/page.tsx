import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getRunCards } from "@/lib/data/runs";
import { RunCard, type RunCardAction } from "@/components/run-card";
import { templateById, type TemplateStep } from "@/lib/onboarding-templates";
import { ROLE_LABEL } from "@/lib/roles";
import type { Role } from "@/lib/types";

const RANK: Record<string, number> = { intern: 0, junior: 1, associate: 1, senior: 2, team_lead: 3, am: 4, ops_head: 5, admin: 6 };
const WHO: Record<string, string> = {
  am: "am", "account manager": "am", senior: "senior", "senior accountant": "senior",
  junior: "junior", "junior accountant": "junior", ops: "ops_head", "ops head": "ops_head",
  "ops manager": "ops_head", "team lead": "team_lead", team_lead: "team_lead", intern: "intern",
};
function reqRole(step: TemplateStep): string | null {
  if (step.approval?.by) { const r = WHO[step.approval.by.trim().toLowerCase()]; if (r) return r; }
  for (const w of step.who ?? []) { const r = WHO[String(w).trim().toLowerCase()]; if (r) return r; }
  return step.assignRole ?? null;
}

export default async function MyWorkPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const memberId = session.teamMember?.id;
  const role = session.profile.role;

  let runIds: string[] | undefined;
  if (role === "admin" || role === "ops_head") {
    runIds = undefined; // see everything
  } else if (memberId) {
    const [{ data: teamRows }, { data: amRuns }] = await Promise.all([
      supabase.from("run_team").select("run_id").eq("team_member_id", memberId),
      supabase.from("onboarding_runs").select("id").eq("am_id", memberId),
    ]);
    runIds = [
      ...new Set([
        ...(teamRows ?? []).map((r) => r.run_id),
        ...(amRuns ?? []).map((r) => r.id),
      ]),
    ];
  } else {
    runIds = [];
  }

  const runs = (await getRunCards(supabase, runIds)).filter(
    (r) => r.status !== "archived" && r.status !== "closed",
  );

  // Work out, per run, the specific step this person should do next (or who it's waiting on).
  const ids = runs.map((r) => r.id);
  const actionByRun: Record<string, RunCardAction | null> = {};
  if (ids.length) {
    const [{ data: runRows }, { data: stepRows }] = await Promise.all([
      supabase.from("onboarding_runs").select("id,template_key").in("id", ids),
      supabase.from("run_steps").select("run_id,step_no,status,assignee_id").in("run_id", ids),
    ]);
    const keyById: Record<string, string> = Object.fromEntries((runRows ?? []).map((r) => [r.id, r.template_key]));
    const stepsByRun: Record<string, { step_no: string; status: string; assignee_id: string | null }[]> = {};
    (stepRows ?? []).forEach((s) => { (stepsByRun[s.run_id] ??= []).push(s); });

    for (const id of ids) {
      const tpl = templateById(keyById[id]);
      if (!tpl) { actionByRun[id] = null; continue; }
      const stat: Record<string, string> = {}, asg: Record<string, string | null> = {};
      (stepsByRun[id] ?? []).forEach((s) => { stat[s.step_no] = s.status; asg[s.step_no] = s.assignee_id; });
      const flat: { st: TemplateStep; stageName: string }[] = [];
      tpl.stages.forEach((stage, si) => stage.steps.forEach((st) => flat.push({ st, stageName: `Stage ${si + 1} · ${stage.name}` })));
      const incomplete = flat.filter((x) => stat[x.st.id] !== "complete");
      const mine = memberId
        ? incomplete.find((x) => asg[x.st.id] === memberId || reqRole(x.st) === role)
        : undefined;
      const chosen = mine ?? incomplete[0];
      if (!chosen) { actionByRun[id] = null; continue; }
      const rr = reqRole(chosen.st);
      actionByRun[id] = {
        stepTitle: chosen.st.title,
        stageName: chosen.stageName,
        mine: !!mine,
        waitingRole: rr ? ROLE_LABEL[rr as Role] ?? rr : null,
      };
    }
  }

  return (
    <div className="scroll">
      <div className="page">
        <div className="section-head">
          <div>
            <h2>My Work</h2>
            <div className="sub">
              {role === "admin" || role === "ops_head"
                ? "All active onboarding runs."
                : "Onboarding runs assigned to you."}
            </div>
          </div>
        </div>

        {runs.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "60px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            Nothing assigned to you yet.
          </div>
        ) : (
          <div className="mywork-grid">
            {runs.map((r) => (
              <RunCard key={r.id} run={r} action={actionByRun[r.id]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
