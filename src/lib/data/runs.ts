import type { SupabaseClient } from "@supabase/supabase-js";
import { templateById } from "@/lib/onboarding-templates";

export interface RunCardData {
  id: string;
  clientId: string;
  clientName: string;
  templateName: string;
  amName: string | null;
  progress: number;
  currentStage: number;
  currentStageName: string | null;
  stageCount: number;
  stagesDone: number;
  target: string | null;
  status: string;
}

/** Enriches onboarding runs with client name, AM name, and stage progress. */
export async function getRunCards(
  supabase: SupabaseClient,
  runIds?: string[],
): Promise<RunCardData[]> {
  let q = supabase
    .from("onboarding_runs")
    .select("id,client_id,am_id,template_key,progress,current_stage,target_completion,status");
  if (runIds) {
    if (runIds.length === 0) return [];
    q = q.in("id", runIds);
  }
  const { data: runs } = await q;
  if (!runs?.length) return [];

  const clientIds = [...new Set(runs.map((r) => r.client_id))];
  const amIds = [...new Set(runs.map((r) => r.am_id).filter(Boolean))] as string[];
  const ids = runs.map((r) => r.id);

  const [{ data: clients }, ams, { data: stages }] = await Promise.all([
    supabase.from("clients").select("id,name").in("id", clientIds),
    amIds.length
      ? supabase.from("team_members").select("id,full_name").in("id", amIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    supabase.from("run_stages").select("run_id,stage_no,name,status").in("run_id", ids),
  ]);

  const cName = Object.fromEntries((clients ?? []).map((c) => [c.id, c.name]));
  const aName = Object.fromEntries(((ams.data ?? []) as { id: string; full_name: string }[]).map((a) => [a.id, a.full_name]));
  const byRun: Record<string, { stage_no: number; name: string; status: string }[]> = {};
  (stages ?? []).forEach((s) => {
    (byRun[s.run_id] ||= []).push(s);
  });

  return runs.map((r) => {
    const st = (byRun[r.id] ?? []).sort((a, b) => a.stage_no - b.stage_no);
    const cur = st.find((s) => s.stage_no === r.current_stage);
    return {
      id: r.id,
      clientId: r.client_id,
      clientName: cName[r.client_id] ?? "Client",
      templateName: templateById(r.template_key)?.name ?? "Onboarding",
      amName: r.am_id ? aName[r.am_id] ?? null : null,
      progress: r.progress,
      currentStage: r.current_stage,
      currentStageName: cur?.name ?? null,
      stageCount: st.length,
      stagesDone: st.filter((s) => s.status === "complete").length,
      target: r.target_completion,
      status: r.status,
    };
  });
}

export function fmtDate(d: string | null): string {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
