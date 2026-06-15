"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canOpenSettings } from "@/lib/roles";

export interface TicketInput { kind: string; title: string; body?: string }

/** Anyone signed in can raise a ticket. */
export async function raiseTicket(input: TicketInput): Promise<{ error?: string; ok?: boolean }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  if (!input.title?.trim()) return { error: "A short title is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("tickets").insert({
    org_id: session.profile.org_id,
    created_by_id: session.teamMember?.id ?? null,
    created_by_name: session.teamMember?.full_name ?? session.email,
    created_by_role: session.profile.role,
    kind: input.kind || "feature",
    title: input.title.trim(),
    body: input.body?.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/tickets");
  return { ok: true };
}

/** Admin / Ops Head resolve or update a ticket. */
export async function updateTicket(
  id: string,
  patch: { status?: string; admin_note?: string },
): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session?.profile.org_id || !canOpenSettings(session.profile.role)) return { error: "Not allowed." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("tickets")
    .update({
      ...(patch.status ? { status: patch.status, resolved_at: patch.status === "resolved" ? new Date().toISOString() : null } : {}),
      ...(patch.admin_note !== undefined ? { admin_note: patch.admin_note } : {}),
    })
    .eq("id", id)
    .eq("org_id", session.profile.org_id);
  if (error) return { error: error.message };
  revalidatePath("/tickets");
  return {};
}
