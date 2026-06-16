import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { ClientsTable, type ClientRow, type RunLite, type AmOption } from "./clients-table";

export default async function ClientsPage() {
  const session = await getSession();
  const supabase = await createClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("id,name,owner_name,industry,entity_type,status,services,primary_contact_email,profile_complete,am_id")
    .order("created_at", { ascending: true });
  const { data: runs } = await supabase
    .from("onboarding_runs")
    .select("id,client_id,progress,current_stage,status");
  const { data: members } = await supabase
    .from("team_members")
    .select("id,full_name,role,title")
    .eq("active", true)
    .order("sort");

  const runByClient: Record<string, RunLite> = {};
  (runs ?? []).forEach((r) => {
    runByClient[r.client_id] = r as RunLite;
  });

  const role = session?.teamMember?.role ?? session?.profile.role ?? "other";
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
