import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import { getAllTemplates } from "@/lib/templates-store";
import { NewGroupForm } from "./new-group-form";

// Internal escalation templates aren't onboarding flows.
const INTERNAL_TEMPLATE_IDS = ["urgent-compliance", "catchup", "compliance-renewal"];

export const metadata = { title: "Cadence — New client group" };

export default async function NewClientGroupPage() {
  const session = await getSession();
  if (!session?.profile.org_id) return null;

  const supabase = await createClient();
  const { data: members } = await supabase
    .from("team_members")
    .select("id,full_name,role,title")
    .eq("org_id", session.profile.org_id)
    .eq("active", true)
    .order("full_name");

  const allTemplates = await getAllTemplates();
  const templates = allTemplates
    .filter((t) => !INTERNAL_TEMPLATE_IDS.includes(t.id))
    .filter((t) => (t.category ?? "Onboarding") === "Onboarding")
    .map((t) => ({ id: t.id, name: t.name }));

  return (
    <NewGroupForm
      members={(members ?? []).map((m) => ({ id: m.id, full_name: m.full_name, role: m.role, title: m.title }))}
      templates={templates}
    />
  );
}
