"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { uploadClientDocToDrive, getDriveCapableMemberId } from "@/lib/google";

/** Validates a sales-upload token (purpose 'sales_upload', not expired). */
async function resolveSales(token: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("magic_links")
    .select("id,client_id,run_id,org_id,expires_at,purpose")
    .eq("token", token)
    .eq("purpose", "sales_upload")
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data;
}

/** Public: returns the client name for the upload page header. */
export async function salesLinkInfo(token: string): Promise<{ error?: string; clientName?: string }> {
  const link = await resolveSales(token);
  if (!link?.client_id) return { error: "This link is invalid or has expired." };
  const admin = createAdminClient();
  const { data: client } = await admin.from("clients").select("name").eq("id", link.client_id).maybeSingle();
  return { clientName: client?.name ?? "the client" };
}

/** Public: uploads a file the Sales team already collected into the client's Drive
 *  folder (falls back to Storage) and records it as a received document. */
export async function salesUploadFile(token: string, formData: FormData): Promise<{ error?: string; ok?: boolean; name?: string }> {
  const link = await resolveSales(token);
  if (!link?.client_id) return { error: "This link is invalid or has expired." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "No file selected." };
  if (file.size > 25 * 1024 * 1024) return { error: "File is larger than 25 MB." };
  const admin = createAdminClient();
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const buf = Buffer.from(await file.arrayBuffer());
  const { data: client } = await admin.from("clients").select("name").eq("id", link.client_id).maybeSingle();
  const clientName = client?.name ?? "Client";

  // Route to the org's Drive (Cadence/<client>); fall back to Supabase Storage.
  let driveLink: string | null = null;
  let storagePath: string | null = null;
  const memberId = await getDriveCapableMemberId(link.org_id, link.run_id);
  if (memberId) {
    const r = await uploadClientDocToDrive(memberId, clientName, safe, file.type || "application/octet-stream", buf);
    if (r) driveLink = r.link;
  }
  if (!driveLink) {
    const path = `${link.client_id}/sales-${Date.now()}-${safe}`;
    const { error: upErr } = await admin.storage.from("client-docs").upload(path, buf, { contentType: file.type || "application/octet-stream", upsert: true });
    if (upErr) return { error: upErr.message };
    storagePath = path;
  }

  // Record it as a received document so it shows everywhere (incl. the deck).
  const { error } = await admin.from("documents").insert({
    run_id: link.run_id, client_id: link.client_id,
    label: file.name, doc_type: "sales_upload", status: "uploaded", required: false,
    uploaded_at: new Date().toISOString(), storage_path: driveLink ?? storagePath,
  });
  if (error) return { error: error.message };
  await admin.from("notifications").insert({
    org_id: link.org_id, run_id: link.run_id, kind: "info",
    title: "Sales team shared a document", body: file.name,
  });
  return { ok: true, name: file.name };
}
