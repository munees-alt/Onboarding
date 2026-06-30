"use server";

import { requireSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMasterAdmin } from "@/lib/roles";
import type { Role } from "@/lib/types";

export interface AmReportTask {
  id: string;
  title: string;
  status: string;
  boardColumn: string | null;
  dueDate: string | null;
  ownerName: string | null;
  ownerKind: string | null;
  type: string | null;
  notes: string | null;
  overdue: boolean;
}

export interface AmReportClient {
  clientId: string;
  clientName: string;
  runId: string;
  runStatus: string;
  tasks: AmReportTask[];
  totalTasks: number;
  openTasks: number;
  doneTasks: number;
  overdueTasks: number;
}

export interface ActionItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  clientId: string | null;
  clientName: string | null;
  runId: string | null;
  createdAt: string;
}

export interface PersonNode {
  personId: string;
  name: string;
  email: string | null;
  role: string;
  title: string | null;
  clients: AmReportClient[];
  actionItems: ActionItem[];
  totalClients: number;
  totalTasks: number;
  totalOpen: number;
  totalDone: number;
  totalOverdue: number;
  totalActions: number;
}

export interface TeamLeadNode extends PersonNode {
  teamMembers: PersonNode[];
}

export interface AmReportEntry extends PersonNode {
  teamLeads: TeamLeadNode[];
  // legacy fields kept for the original view (no-op duplicates of PersonNode)
  amId: string;
  amName: string;
  amEmail: string | null;
}

export interface AmReportResult {
  ams: AmReportEntry[];
  generatedAt: string;
  viewerRole: Role | "";
  viewerName: string | null;
  error?: string;
}

const TEAM_MEMBER_ROLES = new Set(["senior", "junior", "associate", "intern"]);

export async function getAmWeeklyReport(): Promise<AmReportResult> {
  const session = await requireSession();
  const role = (session.teamMember?.role ?? session.profile?.role ?? "") as Role;
  const orgId = session.profile?.org_id;
  const viewerName = session.teamMember?.full_name ?? null;
  if (!orgId) return { ams: [], generatedAt: new Date().toISOString(), viewerRole: role, viewerName, error: "Not signed in." };

  const admin = createAdminClient();
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const generatedAt = now.toISOString();
  const myMemberId = session.teamMember?.id ?? null;

  // 1) All active runs (excluding internal templates)
  const { data: runs } = await admin
    .from("onboarding_runs")
    .select("id,client_id,am_id,status,template_key")
    .eq("org_id", orgId)
    .in("status", ["in_progress", "active", "complete"])
    .not("template_key", "in", "(urgent-compliance,catchup,compliance-renewal)");
  if (!runs?.length) return { ams: [], generatedAt, viewerRole: role, viewerName };

  // 2) All team members for this org (we need reports_to to build hierarchy)
  const { data: allMembersRaw } = await admin
    .from("team_members")
    .select("id,full_name,email,role,title,reports_to,active")
    .eq("org_id", orgId);
  const allMembers = (allMembersRaw ?? []) as { id: string; full_name: string; email: string | null; role: string; title: string | null; reports_to: string | null; active: boolean | null }[];
  const memberById = new Map(allMembers.map((m) => [m.id, m]));

  // 3) Compute scope of visible AMs based on viewer
  // - admin / ops_head: all AMs
  // - am: only themselves
  // - team_lead: only the AM they report to (if any)
  // - everyone else: the AM in their chain (if any)
  const allAmIds = new Set<string>();
  for (const r of runs) if (r.am_id) allAmIds.add(r.am_id as string);
  let visibleAmIds: Set<string>;
  if (isMasterAdmin(role) || role === "ops_head") {
    visibleAmIds = allAmIds;
  } else if (role === "am" && myMemberId) {
    visibleAmIds = new Set([myMemberId]);
  } else if (role === "team_lead" && myMemberId) {
    const me = memberById.get(myMemberId);
    const upstream = me?.reports_to ?? null;
    visibleAmIds = upstream ? new Set([upstream]) : new Set();
  } else if (myMemberId) {
    // climb to the nearest am
    let cur: string | null = memberById.get(myMemberId)?.reports_to ?? null;
    let amHit: string | null = null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const m = memberById.get(cur);
      if (!m) break;
      if (m.role === "am") { amHit = m.id; break; }
      cur = m.reports_to;
    }
    visibleAmIds = amHit ? new Set([amHit]) : new Set();
  } else {
    visibleAmIds = new Set();
  }

  // Limit runs to visible AMs' clients
  const visibleRuns = runs.filter((r) => r.am_id && visibleAmIds.has(r.am_id as string));
  if (!visibleRuns.length) return { ams: [], generatedAt, viewerRole: role, viewerName };

  const runIds = visibleRuns.map((r) => r.id as string);
  const clientIds = [...new Set(visibleRuns.map((r) => r.client_id as string))];

  // 4) Pull clients, tasks, run_team, admin_tasks
  const [{ data: clients }, { data: allTasks }, { data: runTeam }] = await Promise.all([
    admin.from("clients").select("id,name").in("id", clientIds),
    admin.from("tasks")
      .select("id,run_id,title,status,board_column,due_date,owner_id,owner_kind,type,notes")
      .in("run_id", runIds)
      .order("sort"),
    admin.from("run_team").select("run_id,team_member_id,role_in_run").in("run_id", runIds),
  ]);

  // Hierarchy under each AM:
  //   - team leads: members with role=team_lead and reports_to = AM.id
  //   - team members under each TL: members with role in {senior,junior,associate,intern} and reports_to = TL.id
  // For action items: pull all open admin_tasks owned by any AM / TL / TM in scope.
  const personIdsInScope = new Set<string>(visibleAmIds);
  const teamLeadsByAm = new Map<string, string[]>();
  const teamMembersByTl = new Map<string, string[]>();
  for (const am of visibleAmIds) {
    const tls = allMembers.filter((m) => m.active !== false && m.role === "team_lead" && m.reports_to === am).map((m) => m.id);
    teamLeadsByAm.set(am, tls);
    for (const tl of tls) {
      personIdsInScope.add(tl);
      const tms = allMembers.filter((m) => m.active !== false && TEAM_MEMBER_ROLES.has(m.role) && m.reports_to === tl).map((m) => m.id);
      teamMembersByTl.set(tl, tms);
      for (const tm of tms) personIdsInScope.add(tm);
    }
  }

  const { data: actionRows } = await admin
    .from("admin_tasks")
    .select("id,owner_id,kind,title,body,client_id,run_id,created_at,status")
    .eq("org_id", orgId)
    .eq("status", "open")
    .in("owner_id", [...personIdsInScope]);

  // ── Build helpers ──
  const clientMap = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));

  const tasksByRun = new Map<string, AmReportTask[]>();
  for (const t of allTasks ?? []) {
    const runId = t.run_id as string;
    const ownerName = t.owner_id ? (memberById.get(t.owner_id as string)?.full_name ?? null) : null;
    const dueDate = (t.due_date as string | null) ?? null;
    const overdue = !!(dueDate && dueDate < todayIso && t.status !== "complete");
    const task: AmReportTask = {
      id: t.id as string,
      title: t.title as string,
      status: (t.status as string) ?? "not_started",
      boardColumn: (t.board_column as string | null) ?? null,
      dueDate,
      ownerName,
      ownerKind: (t.owner_kind as string | null) ?? null,
      type: (t.type as string | null) ?? null,
      notes: (t.notes as string | null) ?? null,
      overdue,
    };
    (tasksByRun.get(runId) ?? (tasksByRun.set(runId, []), tasksByRun.get(runId)!)).push(task);
  }

  // run_team map: which run each person is on
  const runsByMember = new Map<string, Set<string>>();
  for (const rt of runTeam ?? []) {
    const mid = rt.team_member_id as string;
    if (!runsByMember.has(mid)) runsByMember.set(mid, new Set());
    runsByMember.get(mid)!.add(rt.run_id as string);
  }

  function tasksOwnedByPerson(personId: string, runId: string): AmReportTask[] {
    return (tasksByRun.get(runId) ?? []).filter((t) => {
      // member owns the task if owner_id matches OR (they're the AM and owner_id matches)
      const raw = (allTasks ?? []).find((r) => r.id === t.id);
      return raw && raw.owner_id === personId;
    });
  }

  function clientsForPerson(personId: string, mode: "am" | "team"): AmReportClient[] {
    if (mode === "am") {
      // All runs where this person is the AM. Tasks = the whole board.
      return visibleRuns
        .filter((r) => r.am_id === personId)
        .map((r) => {
          const tasks = tasksByRun.get(r.id as string) ?? [];
          return makeClientEntry(r, tasks);
        });
    }
    // mode === "team": runs where this person is on run_team. Tasks = only theirs.
    const personRunIds = runsByMember.get(personId) ?? new Set();
    return [...personRunIds]
      .map((runId) => {
        const r = visibleRuns.find((x) => x.id === runId);
        if (!r) return null;
        const tasks = tasksOwnedByPerson(personId, runId);
        if (tasks.length === 0) {
          // Still surface the client (empty board case) — but only when person is on run_team
          return makeClientEntry(r, []);
        }
        return makeClientEntry(r, tasks);
      })
      .filter((x): x is AmReportClient => !!x);
  }

  function makeClientEntry(r: { id: string; client_id: string; status: string }, tasks: AmReportTask[]): AmReportClient {
    const openTasks = tasks.filter((t) => t.status !== "complete").length;
    const doneTasks = tasks.filter((t) => t.status === "complete").length;
    const overdueTasks = tasks.filter((t) => t.overdue).length;
    return {
      clientId: r.client_id,
      clientName: clientMap.get(r.client_id) ?? "Unknown Client",
      runId: r.id,
      runStatus: r.status,
      tasks,
      totalTasks: tasks.length,
      openTasks,
      doneTasks,
      overdueTasks,
    };
  }

  function actionItemsFor(personId: string): ActionItem[] {
    return (actionRows ?? [])
      .filter((a) => a.owner_id === personId)
      .map((a) => ({
        id: a.id as string,
        kind: a.kind as string,
        title: a.title as string,
        body: (a.body as string | null) ?? null,
        clientId: (a.client_id as string | null) ?? null,
        clientName: a.client_id ? (clientMap.get(a.client_id as string) ?? null) : null,
        runId: (a.run_id as string | null) ?? null,
        createdAt: a.created_at as string,
      }));
  }

  function buildPersonNode(personId: string, mode: "am" | "team"): PersonNode {
    const m = memberById.get(personId);
    const clients = clientsForPerson(personId, mode);
    const totalTasks = clients.reduce((s, c) => s + c.totalTasks, 0);
    const totalOpen = clients.reduce((s, c) => s + c.openTasks, 0);
    const totalDone = clients.reduce((s, c) => s + c.doneTasks, 0);
    const totalOverdue = clients.reduce((s, c) => s + c.overdueTasks, 0);
    const actionItems = actionItemsFor(personId);
    return {
      personId,
      name: m?.full_name ?? "Unknown",
      email: m?.email ?? null,
      role: m?.role ?? "",
      title: m?.title ?? null,
      clients,
      actionItems,
      totalClients: clients.length,
      totalTasks,
      totalOpen,
      totalDone,
      totalOverdue,
      totalActions: actionItems.length,
    };
  }

  // 5) Build AM entries (top level)
  const amEntries: AmReportEntry[] = [];
  for (const amId of visibleAmIds) {
    const amBase = buildPersonNode(amId, "am");
    const teamLeads: TeamLeadNode[] = (teamLeadsByAm.get(amId) ?? []).map((tlId) => {
      const tlBase = buildPersonNode(tlId, "team");
      const teamMembers: PersonNode[] = (teamMembersByTl.get(tlId) ?? []).map((tmId) => buildPersonNode(tmId, "team"));
      return { ...tlBase, teamMembers };
    });
    amEntries.push({
      ...amBase,
      teamLeads,
      // legacy duplicates
      amId,
      amName: amBase.name,
      amEmail: amBase.email,
    });
  }

  amEntries.sort((a, b) => a.name.localeCompare(b.name));

  return { ams: amEntries, generatedAt, viewerRole: role, viewerName };
}
