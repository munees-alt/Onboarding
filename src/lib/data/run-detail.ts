import type { SupabaseClient } from "@supabase/supabase-js";

export interface StepState {
  status: string;
  assigneeId: string | null;
  assignedName: string | null;
  payload: Record<string, unknown>;
}
export interface RunStageRow {
  stage_no: number;
  name: string;
  status: string;
  step_total: number;
  step_done: number;
}
export interface TaskRow {
  id: string;
  title: string;
  ownerName: string | null;
  ownerId: string | null;
  ownerKind: string;
  clientVisible: boolean;
  type: string;
  status: string;
  due: string | null;
  boardColumn: string | null;
}
export interface RunDetail {
  runId: string;
  orgId: string;
  templateId: string;
  status: string;
  progress: number;
  currentStage: number;
  startedAt: string | null;
  targetCompletion: string | null;
  clientId: string;
  clientName: string;
  amName: string | null;
  stages: RunStageRow[];
  stepState: Record<string, StepState>;
  seniors: { id: string; name: string }[];
  juniors: { id: string; name: string }[];
  assignPeople: { id: string; name: string; role: string }[];
  tasks: TaskRow[];
  items: Record<string, { id: string; data: Record<string, unknown>; status: string }[]>;
  playbook: {
    profile: Record<string, unknown>;
    intake: Record<string, unknown> | null;
    coa: { accounts: { code: string; account: string; section: string }[]; signedOff: boolean } | null;
    documents: { label: string; status: string }[];
    diagrams: { name: string; nodes: { id: string; label: string; type: string }[] }[];
    team: { role: string; name: string }[];
  };
}

export async function getRunDetail(
  supabase: SupabaseClient,
  runId: string,
): Promise<RunDetail | null> {
  const { data: run } = await supabase
    .from("onboarding_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return null;

  const [{ data: client }, { data: stages }, { data: steps }] = await Promise.all([
    supabase.from("clients").select("name").eq("id", run.client_id).maybeSingle(),
    supabase.from("run_stages").select("stage_no,name,status,step_total,step_done").eq("run_id", runId).order("stage_no"),
    supabase.from("run_steps").select("step_no,status,assignee_id,payload").eq("run_id", runId),
  ]);

  let amName: string | null = null;
  if (run.am_id) {
    const { data } = await supabase.from("team_members").select("full_name").eq("id", run.am_id).maybeSingle();
    amName = data?.full_name ?? null;
  }

  const assigneeIds = [...new Set((steps ?? []).map((s) => s.assignee_id).filter(Boolean))] as string[];
  const nameById: Record<string, string> = {};
  if (assigneeIds.length) {
    const { data } = await supabase.from("team_members").select("id,full_name").in("id", assigneeIds);
    (data ?? []).forEach((m) => (nameById[m.id] = m.full_name));
  }

  const stepState: Record<string, StepState> = {};
  (steps ?? []).forEach((s) => {
    const payload = (s.payload ?? {}) as Record<string, unknown>;
    stepState[s.step_no] = {
      status: s.status,
      assigneeId: s.assignee_id,
      assignedName: (payload.assigned as string) ?? (s.assignee_id ? nameById[s.assignee_id] ?? null : null),
      payload,
    };
  });

  const [{ data: srs }, { data: jrs }, { data: aps }, { data: taskRows }, { data: itemRows }] = await Promise.all([
    supabase.from("team_members").select("id,full_name").eq("org_id", run.org_id).in("role", ["senior", "team_lead"]).eq("active", true).order("full_name").limit(40),
    supabase.from("team_members").select("id,full_name").eq("org_id", run.org_id).in("role", ["junior", "associate"]).eq("active", true).order("full_name").limit(40),
    supabase.from("team_members").select("id,full_name,role").eq("org_id", run.org_id).in("role", ["team_lead", "senior", "junior", "associate", "intern"]).eq("active", true).order("full_name").limit(200),
    supabase.from("tasks").select("id,title,owner_id,owner_kind,client_visible,type,status,service,board_column").eq("run_id", runId).order("sort"),
    supabase.from("run_items").select("id,kind,data,status,sort").eq("run_id", runId).order("sort"),
  ]);

  const items: RunDetail["items"] = {};
  (itemRows ?? []).forEach((r) => {
    (items[r.kind] ||= []).push({ id: r.id, data: (r.data ?? {}) as Record<string, unknown>, status: r.status });
  });

  const taskOwnerIds = [...new Set((taskRows ?? []).map((t) => t.owner_id).filter(Boolean))] as string[];
  const taskOwnerName: Record<string, string> = {};
  if (taskOwnerIds.length) {
    const { data } = await supabase.from("team_members").select("id,full_name").in("id", taskOwnerIds);
    (data ?? []).forEach((m) => (taskOwnerName[m.id] = m.full_name));
  }
  const tasks: TaskRow[] = (taskRows ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    ownerName: t.owner_kind === "client" ? "Client" : t.owner_id ? taskOwnerName[t.owner_id] ?? null : null,
    ownerId: t.owner_id ?? null,
    ownerKind: t.owner_kind,
    clientVisible: t.client_visible,
    type: t.type,
    status: t.status,
    due: t.service ?? null,
    boardColumn: t.board_column ?? null,
  }));

  const [{ data: pbClient }, { data: pbIntake }, { data: pbCoa }, { data: pbDocs }, { data: pbDiag }, { data: pbTeam }] = await Promise.all([
    supabase.from("clients").select("industry,entity_type,owner_name,primary_contact_email,vat_registered,ct_registered,revenue_channels,payment_gateways,accounting_software").eq("id", run.client_id).maybeSingle(),
    supabase.from("intake_forms").select("submitted").eq("run_id", runId).maybeSingle(),
    supabase.from("coa_instances").select("accounts,client_signed_off").eq("run_id", runId).maybeSingle(),
    supabase.from("documents").select("label,status").eq("run_id", runId).order("created_at"),
    supabase.from("run_diagrams").select("name,nodes").eq("run_id", runId).order("sort"),
    supabase.from("run_team").select("role_in_run,team_members(full_name)").eq("run_id", runId),
  ]);
  const playbook: RunDetail["playbook"] = {
    profile: pbClient ?? {},
    intake: (pbIntake?.submitted as Record<string, unknown>) ?? null,
    coa: pbCoa ? { accounts: (pbCoa.accounts ?? []) as { code: string; account: string; section: string }[], signedOff: pbCoa.client_signed_off } : null,
    documents: (pbDocs ?? []).map((d) => ({ label: d.label, status: d.status })),
    diagrams: (pbDiag ?? []).map((d) => ({ name: d.name, nodes: (d.nodes ?? []) as { id: string; label: string; type: string }[] })),
    team: (pbTeam ?? []).map((t: { role_in_run: string; team_members: { full_name: string } | { full_name: string }[] | null }) => {
      const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members;
      return { role: t.role_in_run, name: tm?.full_name ?? "—" };
    }),
  };

  return {
    tasks,
    items,
    playbook,
    runId: run.id,
    orgId: run.org_id,
    templateId: run.template_key,
    status: run.status,
    progress: run.progress,
    currentStage: run.current_stage,
    startedAt: run.started_at,
    targetCompletion: run.target_completion,
    clientId: run.client_id,
    clientName: client?.name ?? "Client",
    amName,
    stages: (stages ?? []) as RunStageRow[],
    stepState,
    seniors: (srs ?? []).map((m) => ({ id: m.id, name: m.full_name })),
    juniors: (jrs ?? []).map((m) => ({ id: m.id, name: m.full_name })),
    assignPeople: (aps ?? []).map((m) => ({ id: m.id, name: m.full_name, role: m.role })),
  };
}
