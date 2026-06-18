import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { ClientsTable, type ClientRow, type RunLite, type AmOption } from "./clients-table";

export default async function ClientsPage() {
  const session = await getSession();
  const supabase = await createClient();
  const role = session?.teamMember?.role ?? session?.profile.role ?? "other";
  const memberId = session?.teamMember?.id ?? null;
  const seesAll = role === "admin" || role === "ops_head";

  const { data: allClients } = await supabase
    .from("clients")
    .select("id,name,owner_name,industry,entity_type,status,services,primary_contact_email,profile_complete,am_id")
    .order("created_at", { ascending: true });
  const { data: runs } = await supabase
    .from("onboarding_runs")
    .select("id,client_id,progress,current_stage,status");

  // Non-admins/ops only see clients assigned to them: where they're the AM, or
  // they're on a run's team for that client.
  let clients = allClients ?? [];
  if (!seesAll && memberId) {
    const { data: teamRuns } = await supabase.from("run_team").select("run_id").eq("team_member_id", memberId);
    const myRunIds = new Set((teamRuns ?? []).map((r) => r.run_id));
    const myClientIds = new Set(
      (runs ?? []).filter((r) => myRunIds.has(r.id)).map((r) => r.client_id),
    );
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

  const canDelete = role === "admin" || role === "ops_head";
  const canManageStatus = ["am", "team_lead", "ops_head", "admin"].includes(role);

  return (
    <ClientsTable
      clients={(clients ?? []) as ClientRow[]}
      runByClient={runByClient}
      members={(members ?? []) as AmOption[]}
      canDelete={canDelete}
      canManageStatus={canManageStatus}
    />
  );
}
