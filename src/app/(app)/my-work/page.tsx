import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRunCards } from "@/lib/data/runs";
import { type RunCardAction } from "@/components/run-card";
import { MyWorkBoard } from "./my-work-board";
import { MyTasksSection, type AdminTaskItem } from "./my-tasks-section";
import { UrgentRunsSection } from "./urgent-runs-section";
import { AmlWorkSection } from "./aml-work-section";
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

const URGENT_TEMPLATES = new Set(["urgent-compliance", "catchup", "compliance-renewal"]);

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

  const allRuns = (await getRunCards(supabase, runIds)).filter(
    (r) => r.status !== "archived" && r.status !== "closed",
  );
  const urgentRuns = allRuns.filter((r) => URGENT_TEMPLATES.has(r.templateKey));
  const runs = allRuns.filter((r) => !URGENT_TEMPLATES.has(r.templateKey));

  // Auto-generated admin tasks owned by this user OR scoped to the viewer's role.
  //   • admin / ops_head → all admin_tasks in the org
  //   • am               → tasks the viewer owns
  //   • team_lead        → tasks for runs the viewer is on the run_team of
  //   • other            → tasks they own only
  let adminTasks: AdminTaskItem[] = [];
  if (memberId || role === "admin" || role === "ops_head") {
    let q = supabase
      .from("admin_tasks")
      .select("id,kind,run_id,client_id,step_id,title,body,status,history,notes,created_at,owner_id");
    if (role === "admin" || role === "ops_head") {
      // no extra filter — sees everything in the org (RLS guards the org boundary)
    } else if (role === "team_lead" && memberId) {
      const { data: teamRows } = await supabase.from("run_team").select("run_id").eq("team_member_id", memberId);
      const teamRunIds = (teamRows ?? []).map((r) => r.run_id);
      // include tasks the viewer owns AND tasks for runs they're on
      if (teamRunIds.length) {
        q = q.or(`owner_id.eq.${memberId},run_id.in.(${teamRunIds.join(",")})`);
      } else {
        q = q.eq("owner_id", memberId);
      }
    } else if (memberId) {
      q = q.eq("owner_id", memberId);
    }
    const { data: rows } = await q.order("created_at", { ascending: false }).limit(200);
    const clientIds = [...new Set((rows ?? []).map((r) => r.client_id).filter(Boolean) as string[])];
    const nameById = new Map<string, string>();
    if (clientIds.length) {
      const { data: cs } = await supabase.from("clients").select("id,name").in("id", clientIds);
      (cs ?? []).forEach((c) => nameById.set(c.id, c.name));
    }
    adminTasks = (rows ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      runId: r.run_id,
      stepId: r.step_id ?? null,
      clientName: r.client_id ? nameById.get(r.client_id) ?? null : null,
      createdAt: r.created_at,
      status: r.status,
      history: Array.isArray(r.history) ? r.history : [],
      notes: r.notes,
    }));
  }

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

  const canScan = role === "admin" || role === "ops_head";

  // AML section: check if the current user is in the AML team (Krishna's subtree) or is admin/ops_head
  let amlClients: { clientId: string; clientName: string; status: string; runId: string | null; driveLink: string | null }[] = [];
  let hasAmlAccess = role === "admin" || role === "ops_head";
  if (!hasAmlAccess && memberId && session.profile.org_id) {
    const adminDb = createAdminClient();
    const { data: allM } = await adminDb.from("team_members").select("id,full_name,reports_to").eq("org_id", session.profile.org_id).eq("active", true);
    const allMems = (allM ?? []) as { id: string; full_name: string; reports_to: string | null }[];
    const krishna = allMems.find((m) => m.full_name.toLowerCase().includes("krishna"));
    if (krishna) {
      const tree = new Set<string>([krishna.id]);
      const q2 = [krishna.id];
      while (q2.length) { const p = q2.shift()!; for (const m of allMems) { if (m.reports_to === p && !tree.has(m.id)) { tree.add(m.id); q2.push(m.id); } } }
      hasAmlAccess = tree.has(memberId);
    }
  }
  if (hasAmlAccess && session.profile.org_id && memberId) {
    const supabaseForAml = await createClient();
    // Only show AML clients assigned specifically to this team member
    const { data: amlRecs } = await supabaseForAml
      .from("aml_records")
      .select("client_id,status")
      .eq("org_id", session.profile.org_id)
      .eq("assigned_to", memberId)
      .not("status", "eq", "completed");
    const pendingClientIds = (amlRecs ?? []).map((r) => r.client_id as string);
    if (pendingClientIds.length) {
      const [{ data: clientRows }, { data: driveRows }, { data: runRows }] = await Promise.all([
        supabaseForAml.from("clients").select("id,name").in("id", pendingClientIds),
        supabaseForAml.from("drive_folders").select("client_id,tree").in("client_id", pendingClientIds),
        supabaseForAml.from("onboarding_runs").select("id,client_id,template_key").in("client_id", pendingClientIds).not("status", "in", "(archived,closed)").order("created_at", { ascending: false }),
      ]);
      const driveMap = new Map((driveRows ?? []).map((d) => [d.client_id as string, ((d.tree as { link?: string } | null)?.link) ?? null]));
      const runMap = new Map<string, string>();
      for (const r of (runRows ?? [])) { if (!runMap.has(r.client_id as string)) runMap.set(r.client_id as string, r.id as string); }
      const amlStatusMap = new Map((amlRecs ?? []).map((r) => [r.client_id as string, r.status as string]));
      amlClients = (clientRows ?? []).map((c) => ({
        clientId: c.id as string, clientName: c.name as string,
        status: amlStatusMap.get(c.id as string) ?? "pending",
        runId: runMap.get(c.id as string) ?? null,
        driveLink: driveMap.get(c.id as string) ?? null,
      }));
    }
  }

  return (
    <div className="scroll">
      <div className="page">
        {(adminTasks.length > 0 || canScan) && (
          <MyTasksSection items={adminTasks} canScan={canScan} />
        )}

        {hasAmlAccess && amlClients.length > 0 && (
          <AmlWorkSection clients={amlClients} />
        )}

        <UrgentRunsSection
          runs={urgentRuns.map((r) => ({
            id: r.id,
            clientName: r.clientName,
            templateName: r.templateName,
            currentStageName: r.currentStageName ?? null,
            currentStage: r.currentStage,
            progress: r.progress,
            target: r.target ?? null,
            sla: r.sla ?? null,
            amName: r.amName ?? null,
          }))}
        />

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
          <MyWorkBoard items={runs.map((r) => ({ run: r, action: actionByRun[r.id] ?? null }))} />
        )}
      </div>
    </div>
  );
}
