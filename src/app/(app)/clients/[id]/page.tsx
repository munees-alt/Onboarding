import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { templateById } from "@/lib/onboarding-templates";
import { ClientPlaybook, type PlaybookData } from "./client-playbook-view";

export default async function ClientPlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (!client) notFound();

  // Is Zoho Books connected anywhere in the org? (live client figures come from there)
  const { count: zohoCount } = await supabase
    .from("member_connections")
    .select("id", { count: "exact", head: true })
    .eq("provider", "zoho")
    .eq("connected", true);
  const zohoConnected = (zohoCount ?? 0) > 0;

  const { data: runs } = await supabase
    .from("onboarding_runs")
    .select("id,status,progress,current_stage,template_key,started_at,target_completion,created_at")
    .eq("client_id", id)
    .order("created_at", { ascending: false });
  const run = runs?.[0] ?? null;
  const runId = run?.id ?? null;

  const empty = { data: [] as unknown[] };
  const [intake, coa, tasks, items, diagrams, docs, messages, escalations, team] = runId
    ? await Promise.all([
        supabase.from("intake_forms").select("submitted,status").eq("run_id", runId).maybeSingle(),
        supabase.from("coa_instances").select("accounts,ai_rationale,base_industry,client_signed_off").eq("run_id", runId).maybeSingle(),
        supabase.from("tasks").select("title,status,type,owner_kind,client_visible,service").eq("run_id", runId).order("sort"),
        supabase.from("run_items").select("kind,data,status").eq("run_id", runId).order("sort"),
        supabase.from("run_diagrams").select("name,nodes").eq("run_id", runId).order("sort"),
        supabase.from("documents").select("label,status").eq("client_id", id).order("created_at"),
        supabase.from("run_messages").select("author_name,author_role,body,created_at").eq("run_id", runId).order("created_at"),
        supabase.from("notifications").select("title,body,kind,created_at").eq("run_id", runId).in("kind", ["escalation", "milestone"]).order("created_at", { ascending: false }),
        supabase.from("run_team").select("role_in_run,team_members(full_name)").eq("run_id", runId),
      ])
    : [{ data: null }, { data: null }, empty, empty, empty, await supabase.from("documents").select("label,status").eq("client_id", id), empty, empty, empty];

  const teamMap: Record<string, string> = {};
  (((team as { data: unknown }).data ?? []) as { role_in_run: string; team_members: { full_name: string } | { full_name: string }[] | null }[]).forEach((t) => {
    const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members;
    if (tm) teamMap[t.role_in_run] = tm.full_name;
  });

  const itemRows = ((items as { data: unknown }).data ?? []) as { kind: string; data: Record<string, unknown>; status: string }[];
  const byKind = (k: string) => itemRows.filter((r) => r.kind === k);

  const data: PlaybookData = {
    clientId: id,
    name: client.name,
    industry: client.industry,
    entity: client.entity_type,
    status: client.status,
    profile: client,
    am: teamMap.am ?? null,
    senior: teamMap.senior ?? null,
    junior: teamMap.junior ?? null,
    runId,
    templateName: run ? templateById(run.template_key)?.name ?? "Onboarding" : null,
    template: run ? templateById(run.template_key) ?? null : null,
    runs: (runs ?? []).map((r) => ({ id: r.id, status: r.status, progress: r.progress, currentStage: r.current_stage, templateName: templateById(r.template_key)?.name ?? "Onboarding", started: r.started_at, target: r.target_completion })),
    intake: (intake as { data: { submitted: Record<string, string>; status: string } | null }).data ?? null,
    coa: (coa as { data: { accounts: { code: string; account: string; section: string }[]; ai_rationale: string | null; base_industry: string | null; client_signed_off: boolean } | null }).data ?? null,
    tasks: (((tasks as { data: unknown }).data ?? []) as PlaybookData["tasks"]),
    projects: byKind("project").map((r) => r.data),
    compliance: byKind("compliance").map((r) => r.data),
    catchup: byKind("catchup").map((r) => ({ ...r.data, _status: r.status })),
    triage: byKind("triage").map((r) => r.data),
    diagrams: (((diagrams as { data: unknown }).data ?? []) as { name: string; nodes: { id: string; label: string; type: string }[] }[]),
    documents: (((docs as { data: unknown }).data ?? []) as { label: string; status: string }[]),
    messages: (((messages as { data: unknown }).data ?? []) as PlaybookData["messages"]),
    escalations: (((escalations as { data: unknown }).data ?? []) as PlaybookData["escalations"]),
    zohoConnected,
  };

  return <ClientPlaybook data={data} />;
}
