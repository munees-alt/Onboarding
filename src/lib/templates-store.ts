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
  // DB templates win (edits persist); add any CODE template whose id isn't in the DB yet,
  // so newly-shipped templates (e.g. Monthly Accounting) appear without a manual reseed.
  const dbTpls = data.map((r) => r.data as OnbTemplate);
  const ids = new Set(dbTpls.map((t) => t.id));
  return [...dbTpls, ...ONB_TEMPLATES.filter((t) => !ids.has(t.id))];
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
