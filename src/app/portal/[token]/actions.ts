"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadClientDocToDrive } from "@/lib/google";

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

export async function submitIntake(token: string, data: Record<string, unknown>): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolve(token);
  if (!link?.run_id) return { error: "Link invalid or expired." };
  const admin = createAdminClient();
  const { error } = await admin.from("intake_forms").upsert(
    { run_id: link.run_id, client_id: link.client_id, submitted: data, status: "submitted", submitted_at: new Date().toISOString() },
    { onConflict: "run_id" },
  );
  if (error) return { error: error.message };

  // Sync the structured answers back onto the client record (shows in the playbook "Client Data").
  // The portal sends arrays for multi-value fields; tolerate strings too for older callers.
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : typeof v === "string" ? v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) : [];
  const sw = arr(data.acctSw);
  const patch: Record<string, unknown> = { profile_complete: true };
  if (data.revenue !== undefined) patch.revenue_channels = arr(data.revenue);
  if (data.banks !== undefined) patch.bank_names = arr(data.banks);
  if (data.gateways !== undefined) patch.payment_gateways = arr(data.gateways);
  if (sw.length) patch.accounting_software = sw.join(", ");
  await admin.from("clients").update(patch).eq("id", link.client_id);
  await admin.from("notifications").insert({
    org_id: link.org_id, run_id: link.run_id, kind: "info",
    title: "Client submitted their intake form", body: "The business profile was received via the portal.",
  });
  revalidatePath(`/portal/${token}`);
  return { ok: true };
}

/** Client posts a chat message — lands in the same run thread the team sees (two-way). */
export async function postPortalMessage(token: string, body: string): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolve(token);
  if (!link?.run_id) return { error: "Link invalid or expired." };
  if (!body.trim()) return { error: "Message is empty." };
  const admin = createAdminClient();
  const { data: client } = await admin.from("clients").select("name").eq("id", link.client_id).maybeSingle();
  const { error } = await admin.from("run_messages").insert({
    run_id: link.run_id, author_name: client?.name ?? "Client", author_role: "Client", body: body.trim(),
  });
  if (error) return { error: error.message };
  await admin.from("notifications").insert({
    org_id: link.org_id, run_id: link.run_id, kind: "info",
    title: "New message from your client", body: body.trim().slice(0, 140),
  });
  revalidatePath(`/portal/${token}`);
  return { ok: true };
}

/** Client signs off their onboarding — notifies the team in-app and in the run chat. */
export async function signOffOnboarding(token: string): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolve(token);
  if (!link?.run_id) return { error: "Link invalid or expired." };
  const admin = createAdminClient();
  const { data: client } = await admin.from("clients").select("name").eq("id", link.client_id).maybeSingle();
  const cname = client?.name ?? "The client";
  await admin.from("run_items").delete().eq("run_id", link.run_id).eq("kind", "signoff");
  await admin.from("run_items").insert(
    { run_id: link.run_id, client_id: link.client_id, kind: "signoff", data: { signed: true, at: new Date().toISOString() } },
  );
  await admin.from("run_messages").insert({
    run_id: link.run_id, author_name: "System", author_role: "System",
    body: `${cname} has signed off their onboarding. Everything is confirmed on the client side.`,
  });
  await admin.from("notifications").insert({
    org_id: link.org_id, run_id: link.run_id, kind: "milestone",
    title: "Client signed off their onboarding", body: `${cname} confirmed their setup looks right.`,
  });
  revalidatePath(`/portal/${token}`);
  return { ok: true };
}

/** Real file upload from the client portal → Supabase Storage → marks the document received. */
export async function uploadDocFile(token: string, docId: string, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const link = await resolve(token);
  if (!link?.client_id) return { error: "Link invalid or expired." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  if (file.size > 25 * 1024 * 1024) return { error: "File is larger than 25 MB." };
  const admin = createAdminClient();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const buf = Buffer.from(await file.arrayBuffer());
  const { data: client } = await admin.from("clients").select("name").eq("id", link.client_id).maybeSingle();
  const clientName = client?.name ?? "Client";

  // Prefer the run's connected member's Google Drive (Cadence/<client> folder); fall back to Supabase Storage.
  let storagePath: string | null = null;
  let driveLink: string | null = null;
  if (link.run_id) {
    const { data: rt } = await admin.from("run_team").select("team_member_id").eq("run_id", link.run_id);
    const ids = (rt ?? []).map((r) => r.team_member_id).filter(Boolean);
    if (ids.length) {
      const { data: conn } = await admin.from("member_connections")
        .select("team_member_id")
        .eq("provider", "google").eq("connected", true)
        .in("team_member_id", ids)
        .limit(1);
      const memberId = (conn ?? [])[0]?.team_member_id as string | undefined;
      if (memberId) {
        const r = await uploadClientDocToDrive(memberId, clientName, safe, file.type || "application/octet-stream", buf);
        if (r) driveLink = r.link;
      }
    }
  }
  if (!driveLink) {
    const path = `${link.client_id}/${docId}-${Date.now()}-${safe}`;
    const { error: upErr } = await admin.storage.from("client-docs").upload(path, buf, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });
    if (upErr) return { error: upErr.message };
    storagePath = path;
  }
  const { error } = await admin
    .from("documents")
    .update({ status: "uploaded", uploaded_at: new Date().toISOString(), storage_path: driveLink ?? storagePath })
    .eq("id", docId)
    .eq("client_id", link.client_id);
  if (error) return { error: error.message };
  await admin.from("notifications").insert({
    org_id: link.org_id, run_id: link.run_id, kind: "info",
    title: "Client uploaded a document", body: file.name,
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
