import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { getRunCards } from "@/lib/data/runs";
import { getAllTemplates } from "@/lib/templates-store";
import { getAmCapacityList } from "@/lib/capacity";
import { OnboardingHub } from "./onboarding-hub";

export default async function OnboardingPage() {
  const session = await getSession();
  const role = session?.teamMember?.role ?? session?.profile.role ?? "other";
  const canDelete = role === "admin" || role === "ops_head";
  const isAdmin = role === "admin";
  const seesAll = role === "admin" || role === "ops_head";
  const memberId = session?.teamMember?.id;
  const supabase = await createClient();

  // Role-scope: admin/ops see everything; everyone else sees only the onboardings they're on
  // (run team or the AM) and only the leads assigned to them.
  let runIds: string[] | undefined;
  if (!seesAll) {
    if (memberId) {
      const [{ data: teamRows }, { data: amRuns }] = await Promise.all([
        supabase.from("run_team").select("run_id").eq("team_member_id", memberId),
        supabase.from("onboarding_runs").select("id").eq("am_id", memberId),
      ]);
      runIds = [...new Set([...(teamRows ?? []).map((r) => r.run_id), ...(amRuns ?? []).map((r) => r.id)])];
    } else {
      runIds = [];
    }
  }

  // Urgent compliance / catch-up / renewal runs no longer live in the Onboarding hub —
  // they surface in My Work under "Urgent compliance & catch-up" instead.
  const URGENT_TEMPLATES = new Set(["urgent-compliance", "catchup", "compliance-renewal"]);
  const runs = (await getRunCards(supabase, runIds)).filter((r) => r.status !== "archived" && !URGENT_TEMPLATES.has(r.templateKey));
  const templates = await getAllTemplates();

  let leadQ = supabase
    .from("clients")
    .select("id,name,industry,proposal_id,services,am_id,status")
    .in("status", ["lead", "signed"])
    .order("created_at", { ascending: false });
  if (!seesAll && memberId) leadQ = leadQ.eq("am_id", memberId);
  else if (!seesAll) leadQ = leadQ.eq("am_id", "00000000-0000-0000-0000-000000000000"); // no member → none
  const { data: leads } = await leadQ;

  const { data: ams } = await supabase
    .from("team_members")
    .select("id,full_name,role")
    .in("role", ["am", "team_lead", "ops_head", "admin"])
    .eq("active", true)
    .order("full_name");

  // Capacity-aware AM list for the "+ New compliance run" picker — scoped to AMs
  // under the Ops Head, sorted by lowest current load (under-capacity first).
  const complianceAms = session?.profile.org_id ? await getAmCapacityList(session.profile.org_id) : [];

  // Compliance clients dropdown — every client (any status) for the modal.
  const { data: allClients } = await supabase
    .from("clients")
    .select("id,name,status")
    .order("name");

  return (
    <OnboardingHub
      runs={runs}
      templates={templates}
      leads={leads ?? []}
      ams={ams ?? []}
      canDelete={canDelete}
      isAdmin={isAdmin}
      complianceAms={complianceAms.map((r) => ({ id: r.id, name: r.name, role: r.role, currentLoad: r.currentLoad, maxTasks: r.maxTasks, isHead: r.isHead, isLead: r.isLead }))}
      complianceClients={(allClients ?? []).map((c) => ({ id: c.id, name: c.name, status: c.status }))}
    />
  );
}
