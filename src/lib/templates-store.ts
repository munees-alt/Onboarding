import "server-only";
import { createAdminClient } from "./supabase/admin";
import { ONB_TEMPLATES, type OnbTemplate } from "./onboarding-templates";

/** Seeds the code templates into the DB if the table is empty. */
export async function seedTemplatesIfEmpty(): Promise<void> {
  const admin = createAdminClient();
  const { count } = await admin.from("onboarding_templates").select("id", { count: "exact", head: true });
  if (count && count > 0) return;
  for (const t of ONB_TEMPLATES) {
    await admin.from("onboarding_templates").upsert(
      { id: t.id, name: t.name, tier: t.tier, color: t.color, data: t },
      { onConflict: "id" },
    );
  }
}

export async function getAllTemplates(): Promise<OnbTemplate[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("onboarding_templates").select("data").order("id");
  if (!data?.length) {
    await seedTemplatesIfEmpty();
    return ONB_TEMPLATES;
  }
  return data.map((r) => r.data as OnbTemplate);
}

export async function getTemplate(id: string): Promise<OnbTemplate | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("onboarding_templates").select("data").eq("id", id).maybeSingle();
  return (data?.data as OnbTemplate) ?? ONB_TEMPLATES.find((t) => t.id === id) ?? null;
}

export async function saveTemplate(t: OnbTemplate): Promise<void> {
  const admin = createAdminClient();
  await admin.from("onboarding_templates").upsert(
    { id: t.id, name: t.name, tier: t.tier, color: t.color, data: t, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
}
