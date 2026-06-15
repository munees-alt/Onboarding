"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/** Validates a portal token → returns the magic link row (or null). */
async function resolve(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("magic_links")
    .select("id,client_id,run_id,org_id,expires_at,purpose")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

export async function confirmCoa(token: string): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolve(token);
  if (!link?.run_id) return { error: "Link invalid or expired." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("coa_instances")
    .update({ client_signed_off: true, status: "signed_off", signed_off_at: new Date().toISOString() })
    .eq("run_id", link.run_id);
  if (error) return { error: error.message };
  await admin.from("notifications").insert({
    org_id: link.org_id, run_id: link.run_id, kind: "milestone",
    title: "Client signed off the COA", body: "The client confirmed the chart of accounts.",
  });
  revalidatePath(`/portal/${token}`);
  return { ok: true };
}

export async function commentCoa(token: string, comment: string): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolve(token);
  if (!link?.run_id) return { error: "Link invalid or expired." };
  if (!comment.trim()) return { error: "Comment is empty." };
  const admin = createAdminClient();
  await admin.from("coa_instances").update({ status: "changes_requested" }).eq("run_id", link.run_id);
  await admin.from("notifications").insert({
    org_id: link.org_id, run_id: link.run_id, kind: "info",
    title: "Client commented on the COA", body: comment.trim(),
  });
  revalidatePath(`/portal/${token}`);
  return { ok: true };
}

export async function submitIntake(token: string, data: Record<string, string>): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolve(token);
  if (!link?.run_id) return { error: "Link invalid or expired." };
  const admin = createAdminClient();
  const { error } = await admin.from("intake_forms").upsert(
    { run_id: link.run_id, client_id: link.client_id, submitted: data, status: "submitted", submitted_at: new Date().toISOString() },
    { onConflict: "run_id" },
  );
  if (error) return { error: error.message };

  // Sync the structured answers back onto the client record (shows in the playbook "Client Data").
  const list = (s?: string, sep = "\n") => (s ?? "").split(sep).map((x) => x.trim()).filter(Boolean);
  const patch: Record<string, unknown> = { profile_complete: true };
  if (data.revenue !== undefined) patch.revenue_channels = list(data.revenue);
  if (data.banks !== undefined) patch.bank_names = list(data.banks, ",");
  if (data.gateways !== undefined) patch.payment_gateways = list(data.gateways, ",");
  if (data.software) patch.accounting_software = data.software;
  if (data.vat) patch.vat_registered = data.vat;
  if (data.ct) patch.ct_registered = data.ct;
  await admin.from("clients").update(patch).eq("id", link.client_id);
  await admin.from("notifications").insert({
    org_id: link.org_id, run_id: link.run_id, kind: "info",
    title: "Client submitted their intake form", body: "The business profile was received via the portal.",
  });
  revalidatePath(`/portal/${token}`);
  return { ok: true };
}

export async function uploadDoc(token: string, docId: string): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolve(token);
  if (!link?.client_id) return { error: "Link invalid or expired." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("documents")
    .update({ status: "uploaded", uploaded_at: new Date().toISOString() })
    .eq("id", docId)
    .eq("client_id", link.client_id);
  if (error) return { error: error.message };
  await admin.from("notifications").insert({
    org_id: link.org_id, run_id: link.run_id, kind: "info",
    title: "Client uploaded a document", body: "A document was received via the portal.",
  });
  revalidatePath(`/portal/${token}`);
  return { ok: true };
}
