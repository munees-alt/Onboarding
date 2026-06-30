import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { isMasterAdmin } from "@/lib/roles";
import { templateById } from "@/lib/onboarding-templates";
import { ClientPlaybook, type PlaybookData } from "./client-playbook-view";

export default async function ClientPlaybookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: client } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (!client) notFound();

  // Editing the playbook is Master-Admin-only; everyone else gets a read-only view.
  const session = await getSession();
  const canEdit = isMasterAdmin(session?.teamMember?.role ?? session?.profile.role ?? "other");

  // Is Zoho Books connected anywhere in the org? (live client figures come from there)
  const { count: zohoCount } = await supabase
    .from("member_connections")
    .select("id", { count: "exact", head: true })
    .eq("provider", "zoho")
    .eq("connected", true);
  const zohoConnected = (zohoCount ?? 0) > 0;

  // Org-wide extra-field schema (grows as calls surface new facts). Shared by all clients.
  const { data: fieldDefRows } = await supabase
    .from("client_field_defs")
    .select("key,label,sort")
    .eq("org_id", client.org_id)
    .order("sort")
    .order("created_at");
  const fieldDefs = (fieldDefRows ?? []) as { key: string; label: string; sort: number }[];

  // Current portal-access emails (primary + invited teammates) from the client's portal link.
  const { data: portalLink } = await supabase
    .from("magic_links")
    .select("email,alt_emails")
    .eq("client_id", id).eq("purpose", "portal")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const portalAccess = {
    email: (portalLink?.email as string | null) ?? client.primary_contact_email ?? null,
    altEmails: (portalLink?.alt_emails as string[] | null) ?? [],
  };

  // Client Drive folder link (created at client creation), saved meetings + the latest
  // contract analysis (whichever run had it analysed last — the playbook surfaces the
  // engagement scope / inclusions / exclusions / payment / deliverables in their own card).
  const [{ data: driveRow }, { data: meetingRows }, { data: contractRow }, { data: paymentPlanRow }, { data: paymentEntryRows }, { data: clientTeamRows }, { data: amlRow }, { data: adminTaskRows }] = await Promise.all([
    supabase.from("drive_folders").select("tree").eq("client_id", id).maybeSingle(),
    supabase.from("client_meetings").select("id,title,meeting_date,recording_link,notes,summary,source,created_at").eq("client_id", id).order("meeting_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
    supabase.from("run_items")
      .select("data,created_at,onboarding_runs!inner(client_id)")
      .eq("onboarding_runs.client_id", id)
      .eq("kind", "contract")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("client_payment_plans").select("*").eq("client_id", id).maybeSingle(),
    supabase.from("client_payment_entries").select("*").eq("client_id", id).order("due_date"),
    supabase.from("client_team_members").select("id,name,role_label,email,phone,notes,sort_order").eq("client_id", id).order("sort_order"),
    supabase.from("aml_records").select("status,assigned_to,completed_at,notes,signing_link,signing_completed_link").eq("client_id", id).maybeSingle(),
    supabase.from("admin_tasks").select("id,kind,title,body,status,created_at,history").eq("client_id", id).order("created_at", { ascending: false }),
  ]);
  const driveTree = driveRow?.tree as { link?: string; files?: { id: string; name: string; mimeType: string; webViewLink: string; modifiedTime: string | null; size: string | null }[] } | null;
  const driveLink = driveTree?.link ?? null;
  const driveFiles = driveTree?.files ?? [];

  // Resolve AML assigned member name
  let amlAssignedName: string | null = null;
  const amlTyped = amlRow as { status: string; assigned_to: string | null; completed_at: string | null; notes: string | null; signing_link: string | null; signing_completed_link: string | null } | null;
  if (amlTyped?.assigned_to) {
    const { data: memberRow } = await supabase.from("team_members").select("full_name").eq("id", amlTyped.assigned_to).maybeSingle();
    amlAssignedName = (memberRow?.full_name as string | null) ?? null;
  }
  const meetings = (meetingRows ?? []) as PlaybookData["meetings"];
  const contract = (contractRow?.data ?? null) as PlaybookData["contract"];
  const contractAnalysedAt = (contractRow?.created_at ?? null) as string | null;

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
        supabase.from("run_items").select("id,kind,data,status").eq("run_id", runId).order("sort"),
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

  const itemRows = ((items as { data: unknown }).data ?? []) as { id: string; kind: string; data: Record<string, unknown>; status: string }[];
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
    access: byKind("access").map((r) => ({ ...(r.data as Record<string, unknown>), rowId: r.id, _status: r.status })) as PlaybookData["access"],
    diagrams: (((diagrams as { data: unknown }).data ?? []) as { name: string; nodes: { id: string; label: string; type: string }[] }[]),
    documents: (((docs as { data: unknown }).data ?? []) as { label: string; status: string }[]),
    messages: (((messages as { data: unknown }).data ?? []) as PlaybookData["messages"]),
    escalations: (((escalations as { data: unknown }).data ?? []) as PlaybookData["escalations"]),
    zohoConnected,
    fieldDefs,
    portalAccess,
    driveLink,
    driveFiles,
    meetings,
    contract,
    contractAnalysedAt,
    canEdit,
    amlRecord: amlTyped ? {
      status: amlTyped.status,
      assignedToName: amlAssignedName,
      completedAt: amlTyped.completed_at,
      notes: amlTyped.notes,
      signingLink: amlTyped.signing_link,
      signingCompletedLink: amlTyped.signing_completed_link,
    } : null,
    adminTasks: ((adminTaskRows ?? []) as { id: string; kind: string; title: string; body: string | null; status: string; created_at: string; history: { at?: string; action?: string; notes?: string }[] }[]).map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, status: r.status, createdAt: r.created_at, history: Array.isArray(r.history) ? r.history : [] })),
    paymentPlan: (paymentPlanRow as Record<string, unknown> | null) ?? null,
    paymentEntries: ((paymentEntryRows ?? []) as Record<string, unknown>[]),
    clientTeam: ((clientTeamRows ?? []) as { id: string; name: string; role_label: string; email: string | null; phone: string | null; notes: string | null; sort_order: number }[]).map((r) => ({
      id: r.id, name: r.name, roleLabel: r.role_label, email: r.email, phone: r.phone, notes: r.notes, sortOrder: r.sort_order,
    })),
  };

  return <ClientPlaybook data={data} />;
}
