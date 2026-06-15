import { createClient } from "@/lib/supabase/server";
import { ClientsTable, type ClientRow, type RunLite } from "./clients-table";

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("id,name,owner_name,industry,entity_type,status,services,primary_contact_email,profile_complete")
    .order("created_at", { ascending: true });
  const { data: runs } = await supabase
    .from("onboarding_runs")
    .select("id,client_id,progress,current_stage,status");

  const runByClient: Record<string, RunLite> = {};
  (runs ?? []).forEach((r) => {
    runByClient[r.client_id] = r as RunLite;
  });

  return (
    <ClientsTable clients={(clients ?? []) as ClientRow[]} runByClient={runByClient} />
  );
}
