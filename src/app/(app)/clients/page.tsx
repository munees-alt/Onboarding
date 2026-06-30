import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { getAllTemplates } from "@/lib/templates-store";
import { isMasterAdmin } from "@/lib/roles";
import { ClientsTable, type ClientRow, type RunLite, type AmOption, type ClientTeamMap, type ClientGroup } from "./clients-table";

// Internal escalation runs (urgent compliance / catch-up) aren't client-onboarding flows —
// keep them out of the "choose a template" picker.
const INTERNAL_TEMPLATE_IDS = ["urgent-compliance", "catchup"];

export default async function ClientsPage() {
  const session = await getSession();
  const supabase = await createClient();
  const role = session?.teamMember?.role ?? session?.profile.role ?? "other";
  const memberId = session?.teamMember?.id ?? null;
  const seesAll = role === "admin" || role === "ops_head";

  const { data: allClients } = await supabase
    .from("clients")
    .select("id,name,owner_name,industry,entity_type,status,services,primary_contact_email,phone,profile_complete,am_id,custom_code,trade_licence_no,trade_licence_authority,contract_start_date,target_go_live,expected_onboarding_days,proposal_id,group_id")
    .order("created_at", { ascending: true });

  const { data: groups } = await supabase
    .from("client_groups")
    .select("id,name")
    .eq("org_id", session?.profile.org_id ?? "");
  const { data: runs } = await supabase
    .from("onboarding_runs")
    .select("id,client_id,progress,current_stage,status,template_key")
    .neq("template_key", "lead-intake");

  // Intake-sent / intake-submitted status per client — detected via any magic_links
  // row with purpose='intake' (covers both the standalone-intake flow and the
  // dispatch step's portal link in onboarding runs). Submitted status comes from
  // intake_forms.status when present.
  const { data: intakeLinks } = await supabase
    .from("magic_links")
    .select("client_id,run_id")
    .eq("purpose", "intake");
  const intakeRunIds = [...new Set((intakeLinks ?? []).map((l) => l.run_id).filter(Boolean))] as string[];
  const { data: intakeRows } = intakeRunIds.length
    ? await supabase.from("intake_forms").select("client_id,status,submitted_at").in("run_id", intakeRunIds)
    : { data: [] as { client_id: string; status: string; submitted_at: string | null }[] };
  const intakeByClient: Record<string, { sent: boolean; submitted: boolean; submittedAt: string | null }> = {};
  for (const l of intakeLinks ?? []) {
    if (l.client_id) intakeByClient[l.client_id] ??= { sent: true, submitted: false, submittedAt: null };
  }
  for (const f of intakeRows ?? []) {
    if (f.status === "submitted" && f.client_id) {
      intakeByClient[f.client_id] = { sent: true, submitted: true, submittedAt: f.submitted_at };
    }
  }

  // Non-admins/ops only see clients assigned to them: where they're the AM, or
  // they're on a run's team for that client, OR they're assigned as AML reviewer.
  let clients = allClients ?? [];
  if (!seesAll && memberId) {
    const [{ data: teamRuns }, { data: amlAssigned }] = await Promise.all([
      supabase.from("run_team").select("run_id").eq("team_member_id", memberId),
      supabase.from("aml_records").select("client_id").eq("assigned_to", memberId),
    ]);
    const myRunIds = new Set((teamRuns ?? []).map((r) => r.run_id));
    const myClientIds = new Set([
      ...(runs ?? []).filter((r) => myRunIds.has(r.id)).map((r) => r.client_id),
      ...(amlAssigned ?? []).map((r) => r.client_id as string),
    ]);
    clients = clients.filter((c) => c.am_id === memberId || myClientIds.has(c.id));
  } else if (!seesAll) {
    clients = [];
  }
  const { data: members } = await supabase
    .from("team_members")
    .select("id,full_name,role,title")
    .eq("active", true)
    .order("sort");

  const runByClient: Record<string, RunLite> = {};
  (runs ?? []).forEach((r) => {
    runByClient[r.client_id] = r as RunLite;
  });

  // Master-admin view: who's working on each client (Senior + Team Lead from the run team)
  let teamByClient: ClientTeamMap = {};
  if (isMasterAdmin(role) && (runs ?? []).length) {
    const runIds = (runs ?? []).map((r) => r.id);
    const { data: rt } = await supabase
      .from("run_team")
      .select("run_id, role_in_run, team_members(full_name, role)")
      .in("run_id", runIds);
    type RtRow = { run_id: string; role_in_run: string; team_members: { full_name: string; role: string } | { full_name: string; role: string }[] | null };
    const byRun: Record<string, { name: string; role: string; roleInRun: string }[]> = {};
    for (const r of (rt ?? []) as RtRow[]) {
      const tm = Array.isArray(r.team_members) ? r.team_members[0] : r.team_members;
      if (!tm) continue;
      (byRun[r.run_id] ??= []).push({ name: tm.full_name, role: tm.role, roleInRun: r.role_in_run });
    }
    for (const r of runs ?? []) {
      const people = byRun[r.id] ?? [];
      const seniors = people.filter((p) => p.role === "senior" || p.roleInRun === "senior").map((p) => p.name);
      const teamLeads = people.filter((p) => p.role === "team_lead" || p.roleInRun === "team_lead").map((p) => p.name);
      const juniors = people.filter((p) => p.role === "junior" || p.roleInRun === "junior").map((p) => p.name);
      // Only set when this run has team members; don't overwrite a run that already populated the team
      if (seniors.length || teamLeads.length || juniors.length) {
        teamByClient[r.client_id] ??= { seniors, teamLeads, juniors };
      }
    }
  }

  const canDelete = role === "admin" || role === "ops_head";
  const canManageStatus = ["am", "team_lead", "ops_head", "admin"].includes(role);
  const masterAdmin = isMasterAdmin(role);

  // AML assignment status — which clients already have an aml_records entry.
  const { data: amlRows } = await supabase
    .from("aml_records")
    .select("client_id")
    .eq("org_id", session?.profile.org_id ?? "");
  const amlAssignedClientIds = new Set<string>((amlRows ?? []).map((r) => r.client_id as string));

  // Clients with overdue payment entries for the "Overdue Payments" tab.
  const { data: overdueRows } = await supabase
    .from("client_payment_entries")
    .select("client_id")
    .eq("status", "overdue");
  const overdueClientIds = new Set<string>((overdueRows ?? []).map((r) => r.client_id as string));

  // All onboarding templates from the DB (incl. ones created in the editor), minus internal runs.
  const templates = (await getAllTemplates())
    .filter((t) => !INTERNAL_TEMPLATE_IDS.includes(t.id) && (!t.category || t.category === "Onboarding"))
    .map((t) => ({ id: t.id, name: t.name, desc: t.desc, stages: t.stages.length }));

  return (
    <ClientsTable
      clients={(clients ?? []) as ClientRow[]}
      groups={(groups ?? []) as ClientGroup[]}
      runByClient={runByClient}
      teamByClient={teamByClient}
      members={(members ?? []) as AmOption[]}
      templates={templates}
      canDelete={canDelete}
      canManageStatus={canManageStatus}
      masterAdmin={masterAdmin}
      intakeByClient={intakeByClient}
      overdueClientIds={overdueClientIds}
      amlAssignedClientIds={amlAssignedClientIds}
    />
  );
}
