"use server";

import { requireSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listSlackChannels, listSlackUsers, postSlackMessage, uploadSlackFile } from "@/lib/slack";
import { cleanDocLabel } from "@/lib/doc-labels";
import { revalidatePath } from "next/cache";

type Run = { org_id: string; client_id: string; clients?: { name?: string } | { name?: string }[] | null };

async function resolveRun(runId: string): Promise<{ orgId: string; clientId: string; clientName: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("onboarding_runs")
    .select("org_id,client_id,clients(name)")
    .eq("id", runId)
    .maybeSingle<Run>();
  if (!data) return null;
  const cl = Array.isArray(data.clients) ? data.clients[0] : data.clients;
  return { orgId: data.org_id, clientId: data.client_id, clientName: cl?.name ?? "the client" };
}

// Channels + workspace users for the composer pickers. Returns empty arrays
// when Slack isn't connected so the UI can render an inline prompt.
export async function loadSlackComposerOptions(runId: string): Promise<{
  connected: boolean;
  channels: Array<{ id: string; name: string; isPrivate: boolean }>;
  users: Array<{ id: string; name: string; real_name: string; email: string | null }>;
}> {
  await requireSession();
  const r = await resolveRun(runId);
  if (!r) return { connected: false, channels: [], users: [] };
  const [channels, users] = await Promise.all([listSlackChannels(r.orgId), listSlackUsers(r.orgId)]);
  return {
    connected: channels.length > 0 || users.length > 0,
    channels: channels.map((c) => ({ id: c.id, name: c.name, isPrivate: c.is_private })),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      real_name: u.profile?.real_name ?? u.real_name ?? u.name,
      email: u.profile?.email ?? null,
    })),
  };
}

// Documents on this run the team might want to attach to the Slack message.
// Returns trade-licence + VAT certificate first (most common for accounting-software
// setup requests), then any other uploaded doc.
export async function listRunAttachableDocs(runId: string): Promise<Array<{
  id: string;
  label: string;
  typeName: string;
  storagePath: string | null;
  isPreferred: boolean;
}>> {
  await requireSession();
  const admin = createAdminClient();
  const { data } = await admin
    .from("documents")
    .select("id,label,storage_path,status")
    .eq("run_id", runId)
    .eq("status", "uploaded")
    .order("uploaded_at", { ascending: false });
  const PREFERRED = new Set(["Trade Licence", "VAT Certificate"]);
  return (data ?? []).map((d) => {
    const typeName = cleanDocLabel(d.label);
    return {
      id: d.id,
      label: d.label,
      typeName,
      storagePath: d.storage_path,
      isPreferred: PREFERRED.has(typeName),
    };
  });
}

// Sends the templated message to Slack with file attachments. Driven from the
// "Confirm accounting software" step composer. Returns ok + error string.
export async function sendSlackSetupRequest(
  runId: string,
  stepId: string,
  input: { channel: string; mentionIds: string[]; message: string; docIds: string[] },
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const r = await resolveRun(runId);
  if (!r) return { ok: false, error: "run_not_found" };

  // Files first so the message lands in the same channel after they're posted.
  const admin = createAdminClient();
  const failed: string[] = [];
  if (input.docIds.length) {
    const { data: docs } = await admin
      .from("documents")
      .select("id,label,storage_path")
      .in("id", input.docIds)
      .eq("run_id", runId);
    for (const d of docs ?? []) {
      if (!d.storage_path) { failed.push(`${d.label} (no file path)`); continue; }
      const { data: signed } = await admin.storage.from("client-docs").createSignedUrl(d.storage_path, 300);
      if (!signed?.signedUrl) { failed.push(`${d.label} (signed url failed)`); continue; }
      const filename = d.storage_path.split("/").pop() ?? `${d.label}.pdf`;
      const up = await uploadSlackFile(r.orgId, { channel: input.channel, fileUrl: signed.signedUrl, filename, title: d.label });
      if (!up.ok) failed.push(`${d.label} (${up.error})`);
    }
  }

  const post = await postSlackMessage(r.orgId, { channel: input.channel, text: input.message, mentions: input.mentionIds });
  if (!post.ok) return { ok: false, error: post.error };

  // Audit + chat trail on the run so this is visible to the team.
  await admin.from("audit_events").insert({
    org_id: r.orgId,
    actor: session.profile.full_name ?? session.profile.email ?? null,
    actor_role: session.profile.role,
    action: "slack.sent_setup_request",
    module: "onboarding",
    resource_ref: runId,
    resource_id: stepId,
    resource_type: "run_step",
    details: { channel: input.channel, mention_count: input.mentionIds.length, doc_count: input.docIds.length, failed },
  });
  await admin.from("run_messages").insert({
    run_id: runId,
    author_name: "System",
    author_role: "system",
    body: `📣 Setup request sent on Slack — channel ${input.channel}, ${input.mentionIds.length} mention(s), ${input.docIds.length} attachment(s)${failed.length ? `; ${failed.length} attachment(s) failed` : ""}.`,
  });
  revalidatePath(`/onboarding/${runId}`);
  return { ok: true, error: failed.length ? `Posted, but ${failed.length} attachment(s) failed: ${failed.join("; ")}` : undefined };
}
