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
  assignedTeam: { id: string; name: string; role: string }[];
  amId: string | null;
  /** Full org chart (unscoped) for the AM→TeamLead→Senior→Junior cascade. */
  orgPeople: { id: string; name: string; role: string; reportsTo: string | null }[];
  portalLink: { token: string; email: string | null } | null;
  lastMessageAt: string | null;
  tasks: TaskRow[];
  items: Record<string, { id: string; data: Record<string, unknown>; status: string }[]>;
  playbook: {
    profile: Record<string, unknown>;
    intake: Record<string, unknown> | null;
    coa: { accounts: { code: string; account: string; section: string }[]; signedOff: boolean } | null;
    documents: { id: string; label: string; status: string; storagePath: string | null; reviewNote: string | null }[];
    diagrams: { name: string; nodes: { id: string; label: string; type: string }[] }[];
    team: { role: string; name: string }[];
  };
}

export async function getRunDetail(
  supabase: SupabaseClient,
  runId: string,
  viewer?: { id: string | null; role: string },
): Promise<RunDetail | null> {
  const { data: run } = await supabase
    .from("onboarding_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return null;

  // Round 1 — everything that depends only on `run`, fetched in parallel (was 4 sequential round-trips).
  const [
    { data: client }, { data: stages }, { data: steps },
    { data: srs }, { data: jrs }, { data: aps },
    { data: taskRows }, { data: itemRows }, amRes,
    { data: pbClient }, { data: pbIntake }, { data: pbCoa }, { data: pbDocs }, { data: pbDiag }, { data: pbTeam },
    { data: portalLinkRow }, { data: lastMsgRow },
  ] = await Promise.all([
    supabase.from("clients").select("name").eq("id", run.client_id).maybeSingle(),
    supabase.from("run_stages").select("stage_no,name,status,step_total,step_done").eq("run_id", runId).order("stage_no"),
    supabase.from("run_steps").select("step_no,status,assignee_id,payload").eq("run_id", runId),
    supabase.from("team_members").select("id,full_name").eq("org_id", run.org_id).in("role", ["senior", "team_lead"]).eq("active", true).order("full_name").limit(40),
    supabase.from("team_members").select("id,full_name").eq("org_id", run.org_id).in("role", ["junior", "associate"]).eq("active", true).order("full_name").limit(40),
    supabase.from("team_members").select("id,full_name,role,reports_to").eq("org_id", run.org_id).in("role", ["team_lead", "senior", "junior", "associate", "intern"]).eq("active", true).order("full_name").limit(400),
    supabase.from("tasks").select("id,title,owner_id,owner_kind,client_visible,type,status,service,board_column").eq("run_id", runId).order("sort"),
    supabase.from("run_items").select("id,kind,data,status,sort").eq("run_id", runId).order("sort"),
    run.am_id ? supabase.from("team_members").select("full_name").eq("id", run.am_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("clients").select("industry,entity_type,owner_name,primary_contact_email,vat_registered,ct_registered,revenue_channels,payment_gateways,accounting_software").eq("id", run.client_id).maybeSingle(),
    supabase.from("intake_forms").select("submitted").eq("run_id", runId).maybeSingle(),
    supabase.from("coa_instances").select("accounts,client_signed_off").eq("run_id", runId).maybeSingle(),
    supabase.from("documents").select("id,label,status,storage_path,review_note").eq("run_id", runId).order("created_at"),
    supabase.from("run_diagrams").select("name,nodes").eq("run_id", runId).order("sort"),
    supabase.from("run_team").select("role_in_run,team_members(id,full_name,role)").eq("run_id", runId),
    supabase.from("magic_links").select("token,email").eq("run_id", runId).eq("purpose", "portal").maybeSingle(),
    supabase.from("run_messages").select("created_at").eq("run_id", runId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const amName = (amRes as { data: { full_name?: string } | null } | null)?.data?.full_name ?? null;

  // Round 2 — name lookups that depend on round-1 results, fetched in parallel.
  const assigneeIds = [...new Set((steps ?? []).map((s) => s.assignee_id).filter(Boolean))] as string[];
  const taskOwnerIds = [...new Set((taskRows ?? []).map((t) => t.owner_id).filter(Boolean))] as string[];
  const [{ data: assigneeRows }, { data: ownerRows }] = await Promise.all([
    assigneeIds.length ? supabase.from("team_members").select("id,full_name").in("id", assigneeIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    taskOwnerIds.length ? supabase.from("team_members").select("id,full_name").in("id", taskOwnerIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const nameById: Record<string, string> = {};
  (assigneeRows ?? []).forEach((m) => (nameById[m.id] = m.full_name));
  const taskOwnerName: Record<string, string> = {};
  (ownerRows ?? []).forEach((m) => (taskOwnerName[m.id] = m.full_name));

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

  const items: RunDetail["items"] = {};
  (itemRows ?? []).forEach((r) => {
    (items[r.kind] ||= []).push({ id: r.id, data: (r.data ?? {}) as Record<string, unknown>, status: r.status });
  });

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
  const pbTeamRows = (pbTeam ?? []) as { role_in_run: string; team_members: { id: string; full_name: string; role: string } | { id: string; full_name: string; role: string }[] | null }[];
  const assignedTeam = pbTeamRows
    .map((t) => { const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members; return tm ? { id: tm.id, name: tm.full_name, role: t.role_in_run } : null; })
    .filter((x): x is { id: string; name: string; role: string } => !!x);

  const playbook: RunDetail["playbook"] = {
    profile: pbClient ?? {},
    intake: (pbIntake?.submitted as Record<string, unknown>) ?? null,
    coa: pbCoa ? { accounts: (pbCoa.accounts ?? []) as { code: string; account: string; section: string }[], signedOff: pbCoa.client_signed_off } : null,
    documents: (pbDocs ?? []).map((d) => ({ id: d.id, label: d.label, status: d.status, storagePath: d.storage_path ?? null, reviewNote: d.review_note ?? null })),
    diagrams: (pbDiag ?? []).map((d) => ({ name: d.name, nodes: (d.nodes ?? []) as { id: string; label: string; type: string }[] })),
    team: assignedTeam.map((t) => ({ role: t.role, name: t.name })),
  };

  // Org-chart scoping: a non-admin/ops viewer can only assign people who report
  // to them (directly or indirectly). Admin/Ops Head oversee everyone.
  const apsRows = (aps ?? []) as { id: string; full_name: string; role: string; reports_to: string | null }[];
  let assignablePool = apsRows;
  if (viewer?.id && viewer.role !== "admin" && viewer.role !== "ops_head") {
    const childrenByParent: Record<string, string[]> = {};
    apsRows.forEach((m) => { if (m.reports_to) (childrenByParent[m.reports_to] ||= []).push(m.id); });
    const descendants = new Set<string>();
    const queue = [...(childrenByParent[viewer.id] ?? [])];
    while (queue.length) {
      const id = queue.shift()!;
      if (descendants.has(id)) continue;
      descendants.add(id);
      (childrenByParent[id] ?? []).forEach((c) => queue.push(c));
    }
    const filtered = apsRows.filter((m) => descendants.has(m.id));
    if (filtered.length) assignablePool = filtered; // fall back to full pool if the org chart isn't wired yet
  }

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
    assignPeople: assignablePool.map((m) => ({ id: m.id, name: m.full_name, role: m.role })),
    assignedTeam,
    amId: (run.am_id as string | null) ?? null,
    orgPeople: apsRows.map((m) => ({ id: m.id, name: m.full_name, role: m.role, reportsTo: m.reports_to ?? null })),
    portalLink: portalLinkRow ? { token: portalLinkRow.token as string, email: (portalLinkRow.email as string | null) ?? null } : null,
    lastMessageAt: (lastMsgRow?.created_at as string | undefined) ?? null,
  };
}
