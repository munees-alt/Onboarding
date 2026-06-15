"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { canOpenSettings } from "@/lib/roles";
import { saveTemplate } from "@/lib/templates-store";
import type { OnbTemplate } from "@/lib/onboarding-templates";

export async function saveTemplateAction(t: OnbTemplate): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session || !canOpenSettings(session.profile.role)) return { error: "Not allowed." };
  if (!t?.id) return { error: "Invalid template." };
  try {
    await saveTemplate(t);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Save failed" };
  }
  revalidatePath("/onboarding");
  revalidatePath(`/templates/${t.id}`);
  return {};
}
