import { requireSession } from "@/lib/auth";
import { getAllTemplates } from "@/lib/templates-store";
import { ARCHIVED_TEMPLATE_IDS } from "@/lib/onboarding-templates";
import { TemplatesView } from "./templates-view";

// Client onboarding — master flow. Only the two live templates (Client Onboarding
// · Micro, Catch-up Accounting) show here; everything else is archived (hidden,
// not deleted — see ARCHIVED_TEMPLATE_IDS).
export default async function TemplatesPage() {
  await requireSession();
  const all = await getAllTemplates();
  const templates = all.filter((t) => !ARCHIVED_TEMPLATE_IDS.has(t.id));
  return <TemplatesView templates={templates} />;
}
