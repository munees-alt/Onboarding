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

export interface AmReportEntry {
  amId: string;
  amName: string;
  amEmail: string | null;
  clients: AmReportClient[];
  totalClients: number;
  totalTasks: number;
  totalOpen: number;
  totalDone: number;
  totalOverdue: number;
}

export interface AmReportResult {
  ams: AmReportEntry[];
  generatedAt: string;
  error?: string;
}

export async function getAmWeeklyReport(): Promise<AmReportResult> {
  const session = await requireSession();
  const role = (session.teamMember?.role ?? session.profile?.role ?? "") as Role;
  const orgId = session.profile?.org_id;
  if (!orgId) return { ams: [], generatedAt: new Date().toISOString(), error: "Not signed in." };

  const admin = createAdminClient();
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const generatedAt = now.toISOString();

  // Master admin sees all; AM sees only their own
  const myTeamMemberId = session.teamMember?.id ?? null;

  // 1. Fetch all active onboarding runs (in_progress / active) for this org
  const { data: runs } = await admin
    .from("onboarding_runs")
    .select("id,client_id,am_id,status,template_key")
    .eq("org_id", orgId)
    .in("status", ["in_progress", "active", "complete"])
    .not("template_key", "in", "(urgent-compliance,catchup,compliance-renewal)");

  if (!runs?.length) return { ams: [], generatedAt };

  // Filter for non-master-admin: only show their own runs
  const visibleRuns = isMasterAdmin(role)
    ? runs
    : runs.filter((r) => r.am_id === myTeamMemberId);

  if (!visibleRuns.length) return { ams: [], generatedAt };

  const runIds = visibleRuns.map((r) => r.id);
  const clientIds = [...new Set(visibleRuns.map((r) => r.client_id as string))];
  const amIds = [...new Set(visibleRuns.map((r) => r.am_id as string).filter(Boolean))];

  // 2. Fetch clients, AMs, tasks in parallel
  const [{ data: clients }, { data: ams }, { data: allTasks }, { data: teamMembers }] = await Promise.all([
    admin.from("clients").select("id,name").in("id", clientIds),
    admin.from("team_members").select("id,full_name,email").in("id", amIds),
    admin.from("tasks")
      .select("id,run_id,title,status,board_column,due_date,owner_id,owner_kind,type,notes")
      .in("run_id", runIds)
      .order("sort"),
    admin.from("team_members").select("id,full_name").eq("org_id", orgId).eq("active", true),
  ]);

  const clientMap = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const amMap = new Map((ams ?? []).map((a) => [a.id as string, { name: a.full_name as string, email: a.email as string | null }]));
  const memberMap = new Map((teamMembers ?? []).map((m) => [m.id as string, m.full_name as string]));

  // 3. Group tasks by run_id
  const tasksByRun = new Map<string, AmReportTask[]>();
  for (const t of allTasks ?? []) {
    const runId = t.run_id as string;
    const ownerName = t.owner_id ? (memberMap.get(t.owner_id as string) ?? null) : null;
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

  // 4. Group runs by AM
  const runsByAm = new Map<string, typeof visibleRuns>();
  for (const r of visibleRuns) {
    const amId = (r.am_id as string) ?? "__unassigned__";
    (runsByAm.get(amId) ?? (runsByAm.set(amId, []), runsByAm.get(amId)!)).push(r);
  }

  // 5. Build result
  const amEntries: AmReportEntry[] = [];
  for (const [amId, amRuns] of runsByAm) {
    const amInfo = amMap.get(amId);
    const clientList: AmReportClient[] = amRuns.map((r) => {
      const tasks = tasksByRun.get(r.id as string) ?? [];
      const openTasks = tasks.filter((t) => t.status !== "complete").length;
      const doneTasks = tasks.filter((t) => t.status === "complete").length;
      const overdueTasks = tasks.filter((t) => t.overdue).length;
      return {
        clientId: r.client_id as string,
        clientName: clientMap.get(r.client_id as string) ?? "Unknown Client",
        runId: r.id as string,
        runStatus: r.status as string,
        tasks,
        totalTasks: tasks.length,
        openTasks,
        doneTasks,
        overdueTasks,
      };
    });

    const totalTasks = clientList.reduce((s, c) => s + c.totalTasks, 0);
    const totalOpen = clientList.reduce((s, c) => s + c.openTasks, 0);
    const totalDone = clientList.reduce((s, c) => s + c.doneTasks, 0);
    const totalOverdue = clientList.reduce((s, c) => s + c.overdueTasks, 0);

    amEntries.push({
      amId,
      amName: amInfo?.name ?? "Unassigned",
      amEmail: amInfo?.email ?? null,
      clients: clientList,
      totalClients: clientList.length,
      totalTasks,
      totalOpen,
      totalDone,
      totalOverdue,
    });
  }

  // Sort AMs by name
  amEntries.sort((a, b) => a.amName.localeCompare(b.amName));

  return { ams: amEntries, generatedAt };
}
