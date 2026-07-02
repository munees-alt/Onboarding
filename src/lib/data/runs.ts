import type { SupabaseClient } from "@supabase/supabase-js";
import { templateById } from "@/lib/onboarding-templates";

export type SlaStatus = "on_track" | "warning" | "breached" | "unknown";

export interface RunCardData {
  id: string;
  clientId: string;
  clientName: string;
  templateName: string;
  templateKey: string;
  amName: string | null;
  teamLeadName: string | null;
  /** Full names of everyone on the run team (Team Lead, Seniors, Juniors, AM). Used for the "team member" filter. */
  teamMembers: string[];
  progress: number;
  currentStage: number;
  currentStageName: string | null;
  stageCount: number;
  stagesDone: number;
  target: string | null;
  status: string;
  /** Computed: how the run is tracking against its target_completion. */
  sla: SlaStatus;
  /** Days until target_completion (negative = overdue). null when no target. */
  daysToTarget: number | null;
  industry: string | null;
  contractStartDate: string | null;
  reportFrequency: string | null;
}

/**
 * Derive SLA status from the run's target_completion + progress. No new schema
 * required. "warning" fires inside the last 7 days when progress < 80%;
 * "breached" once today passes the target.
 */
export function computeSla(target: string | null, progress: number, status: string): { sla: SlaStatus; daysToTarget: number | null } {
  if (status === "complete" || status === "closed" || status === "archived") return { sla: "on_track", daysToTarget: null };
  if (!target) return { sla: "unknown", daysToTarget: null };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tgt = new Date(target + "T00:00:00");
  const days = Math.round((tgt.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { sla: "breached", daysToTarget: days };
  if (days <= 7 && progress < 80) return { sla: "warning", daysToTarget: days };
  return { sla: "on_track", daysToTarget: days };
}

/** Enriches onboarding runs with client name, AM name, and stage progress. */
export async function getRunCards(
  supabase: SupabaseClient,
  runIds?: string[],
): Promise<RunCardData[]> {
  let q = supabase
    .from("onboarding_runs")
    .select("id,client_id,am_id,template_key,progress,current_stage,target_completion,status")
    .neq("template_key", "lead-intake");
  if (runIds) {
    if (runIds.length === 0) return [];
    q = q.in("id", runIds);
  }
  const { data: runs } = await q;
  if (!runs?.length) return [];

  const clientIds = [...new Set(runs.map((r) => r.client_id))];
  const amIds = [...new Set(runs.map((r) => r.am_id).filter(Boolean))] as string[];
  const ids = runs.map((r) => r.id);

  const [{ data: clients }, ams, { data: stages }, { data: rt }] = await Promise.all([
    supabase.from("clients").select("id,name,industry,contract_start_date,report_frequency").in("id", clientIds),
    amIds.length
      ? supabase.from("team_members").select("id,full_name").in("id", amIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    supabase.from("run_stages").select("run_id,stage_no,name,status").in("run_id", ids),
    supabase.from("run_team").select("run_id, role_in_run, team_members(full_name, role)").in("run_id", ids),
  ]);

  const clientMap = Object.fromEntries((clients ?? []).map((c) => [c.id, c]));
  const aName = Object.fromEntries(((ams.data ?? []) as { id: string; full_name: string }[]).map((a) => [a.id, a.full_name]));
  const byRun: Record<string, { stage_no: number; name: string; status: string }[]> = {};
  (stages ?? []).forEach((s) => {
    (byRun[s.run_id] ||= []).push(s);
  });

  type RunTeamRow = { run_id: string; role_in_run: string | null; team_members: { full_name: string; role: string } | { full_name: string; role: string }[] | null };
  const teamLeadByRun: Record<string, string> = {};
  const teamMembersByRun: Record<string, string[]> = {};
  for (const r of (rt ?? []) as RunTeamRow[]) {
    const tm = Array.isArray(r.team_members) ? r.team_members[0] : r.team_members;
    if (!tm?.full_name) continue;
    if (tm.role === "team_lead") teamLeadByRun[r.run_id] = tm.full_name;
    // Everyone on the run team except the onboarding partner (Munees is seeded on
    // every run as a fixed default — not a filterable working assignee).
    if (r.role_in_run === "onboarding_partner") continue;
    const list = (teamMembersByRun[r.run_id] ||= []);
    if (!list.includes(tm.full_name)) list.push(tm.full_name);
  }

  return runs.map((r) => {
    const st = (byRun[r.id] ?? []).sort((a, b) => a.stage_no - b.stage_no);
    const cur = st.find((s) => s.stage_no === r.current_stage);
    return {
      id: r.id,
      clientId: r.client_id,
      clientName: clientMap[r.client_id]?.name ?? "Client",
      industry: (clientMap[r.client_id] as { industry?: string | null } | undefined)?.industry ?? null,
      contractStartDate: (clientMap[r.client_id] as { contract_start_date?: string | null } | undefined)?.contract_start_date ?? null,
      reportFrequency: (clientMap[r.client_id] as { report_frequency?: string | null } | undefined)?.report_frequency ?? null,
      templateName: templateById(r.template_key)?.name ?? "Onboarding",
      templateKey: r.template_key,
      amName: r.am_id ? aName[r.am_id] ?? null : null,
      teamLeadName: teamLeadByRun[r.id] ?? null,
      teamMembers: teamMembersByRun[r.id] ?? [],
      progress: r.progress,
      currentStage: r.current_stage,
      currentStageName: cur?.name ?? null,
      stageCount: st.length,
      stagesDone: st.filter((s) => s.status === "complete").length,
      target: r.target_completion,
      status: r.status,
      ...computeSla(r.target_completion, r.progress, r.status),
    };
  });
}

export function fmtDate(d: string | null): string {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
