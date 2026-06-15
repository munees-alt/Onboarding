import { createClient } from "@/lib/supabase/server";
import { getRunCards } from "@/lib/data/runs";
import { getAllTemplates } from "@/lib/templates-store";
import { OnboardingHub } from "./onboarding-hub";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const runs = (await getRunCards(supabase)).filter(
    (r) => r.status !== "archived" && r.status !== "closed",
  );
  const templates = await getAllTemplates();
  const { data: leads } = await supabase
    .from("clients")
    .select("id,name,industry")
    .in("status", ["lead", "signed"])
    .order("created_at", { ascending: false });
  return <OnboardingHub runs={runs} templates={templates} leads={leads ?? []} />;
}
