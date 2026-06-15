"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";

/** Saves the signed-in member's own Fathom API key. */
export async function saveMyFathomKey(key: string): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.profile.org_id || !session.teamMember?.id) return { error: "No team member linked to your account." };
  if (!key.trim()) return { error: "Paste your Fathom API key." };
  const admin = createAdminClient();
  const { error } = await admin.from("member_connections").upsert(
    {
      org_id: session.profile.org_id,
      team_member_id: session.teamMember.id,
      provider: "fathom",
      connected: true,
      config: { key_enc: encryptSecret(key.trim()) },
    },
    { onConflict: "team_member_id,provider" },
  );
  if (error) return { error: error.message };
  revalidatePath("/connections");
  return { ok: true };
}
