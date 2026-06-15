"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import type { AiFeature, FeatureModel } from "@/lib/ai-config";

async function orgGuard() {
  const session = await getSession();
  if (!session?.profile.org_id) return null;
  if (session.profile.role !== "admin" && session.profile.role !== "ops_head") return null;
  return session.profile.org_id;
}

export async function saveAiKeys(input: {
  openai?: string; anthropic?: string; google?: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Not allowed." };
  const admin = createAdminClient();
  const patch: Record<string, string> = {};
  if (input.openai?.trim()) patch.openai_key_enc = encryptSecret(input.openai.trim());
  if (input.anthropic?.trim()) patch.anthropic_key_enc = encryptSecret(input.anthropic.trim());
  if (input.google?.trim()) patch.google_key_enc = encryptSecret(input.google.trim());
  if (!Object.keys(patch).length) return { ok: true };
  const { error } = await admin.from("ai_settings").upsert({ org_id: orgId, ...patch }, { onConflict: "org_id" });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveFeatureModels(
  models: Partial<Record<AiFeature, FeatureModel>>,
): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { error } = await admin.from("ai_settings").upsert({ org_id: orgId, feature_models: models }, { onConflict: "org_id" });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function saveIntegrations(input: {
  fathomKey?: string; pmsName?: string; pmsKey?: string;
}): Promise<{ error?: string; ok?: boolean }> {
  const orgId = await orgGuard();
  if (!orgId) return { error: "Not allowed." };
  const admin = createAdminClient();
  const patch: Record<string, unknown> = { org_id: orgId };
  if (input.fathomKey?.trim()) patch.fathom_config = { key_enc: encryptSecret(input.fathomKey.trim()) };
  if (input.fathomKey?.trim()) patch.fathom_connected = true;
  if (typeof input.pmsName === "string") patch.pms_name = input.pmsName.trim() || null;
  if (input.pmsKey?.trim()) patch.pms_key_enc = encryptSecret(input.pmsKey.trim());
  const { error } = await admin.from("integration_settings").upsert(patch, { onConflict: "org_id" });
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
