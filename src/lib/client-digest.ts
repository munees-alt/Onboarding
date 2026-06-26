import "server-only";
import { createAdminClient } from "./supabase/admin";
import { runAi } from "./ai";

/**
 * Build + send a weekly status digest to one client. Server-only — no session
 * required. Used by both the manual playbook button and the daily cron.
 *
 * Returns { ok } on success, { error } if there's no recipient / no sender /
 * Gmail fails.
 */
export async function sendClientWeeklyDigestForOrg(
  orgId: string,
  clientId: string,
): Promise<{ ok?: boolean; sentTo?: string[]; error?: string }> {
  const admin = createAdminClient();

  const { data: client } = await admin
    .from("clients")
    .select("id,name,primary_contact_email,owner_name,am_id,org_id,status")
    .eq("id", clientId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!client) return { error: "Client not found." };

  const { data: run } = await admin
    .from("onboarding_runs")
    .select("id,target_completion,current_stage,progress,status")
    .eq("client_id", clientId)
    .not("status", "in", "(archived,closed,complete)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const tasks = run
    ? (await admin.from("tasks").select("title,status,due_date,owner_kind,notes").eq("run_id", run.id)).data ?? []
    : [];
  const openTasks = tasks.filter((t) => t.status !== "complete");
  const clientTasks = openTasks.filter((t) => t.owner_kind === "client");

  const compliance = run
    ? (await admin.from("run_items").select("data").eq("run_id", run.id).eq("kind", "compliance")).data ?? []
    : [];

  const docs = (await admin.from("documents").select("label,status,received_at").eq("client_id", clientId)).data ?? [];
  const docsPending = docs.filter((d) => d.status !== "uploaded");

  const access = run
    ? (await admin.from("run_items").select("data").eq("run_id", run.id).eq("kind", "access")).data ?? []
    : [];
  const accessPending = access.filter((a) => {
    const d = a.data as { status?: string };
    return d?.status !== "granted";
  });

  const recipients: string[] = [];
  if (client.primary_contact_email) recipients.push(client.primary_contact_email);
  const { data: linkRow } = await admin
    .from("magic_links")
    .select("alt_emails")
    .eq("client_id", clientId)
    .eq("purpose", "portal")
    .maybeSingle();
  if (Array.isArray(linkRow?.alt_emails)) recipients.push(...(linkRow!.alt_emails as string[]));
  const recipientList = [...new Set(recipients.filter(Boolean))];
  if (!recipientList.length) return { error: "No recipient email." };

  const intro = await runAi(orgId, "welcome_email", {
    system: "You write the warm 1-paragraph intro of a weekly client status email from a UAE accounting firm. Output ONLY plain text — no markdown, no asterisks, no greeting line ('Dear X'), no sign-off. 2-3 sentences.",
    prompt: `Write the intro paragraph of this client's Monday digest. Client name: ${client.name}. Contact: ${client.owner_name ?? ""}. Mention that the team is on track / actively working, and tell them what they'll see below (open tasks, pending docs, anything we need from them). Tone: warm, professional, brief.`,
  }).catch(() => "");

  const lines: string[] = [];
  lines.push(`Dear ${client.owner_name ?? client.name},`);
  lines.push("");
  lines.push(intro.trim() || `Here's your weekly update from Finanshels for ${client.name}.`);
  lines.push("");
  if (clientTasks.length) {
    lines.push("TASKS WE NEED FROM YOU");
    for (const t of clientTasks) {
      const due = t.due_date ? ` · due ${t.due_date}` : "";
      lines.push(`- ${t.title}${due}`);
    }
    lines.push("");
  }
  if (docsPending.length) {
    lines.push("DOCUMENTS STILL PENDING");
    for (const d of docsPending) lines.push(`- ${d.label}`);
    lines.push("");
  }
  if (accessPending.length) {
    lines.push("SYSTEM ACCESS WE'RE WAITING ON");
    for (const a of accessPending) {
      const d = a.data as { label?: string };
      lines.push(`- ${d?.label ?? "Access"}`);
    }
    lines.push("");
  }
  if (compliance.length) {
    lines.push("UPCOMING COMPLIANCE");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const items = compliance
      .map((r) => r.data as { label?: string; date?: string })
      .filter((i) => i?.date)
      .map((i) => ({ ...i, daysAway: Math.round((new Date(i.date!).getTime() - today.getTime()) / 86_400_000) }))
      .filter((i) => i.daysAway >= 0 && i.daysAway <= 60)
      .sort((a, b) => a.daysAway - b.daysAway);
    for (const i of items) lines.push(`- ${i.label} — ${i.date} (${i.daysAway}d away)`);
    if (!items.length) lines.push("- All compliance items are over 60 days away or have no firm date yet.");
    lines.push("");
  }
  if (run) {
    lines.push("ONBOARDING PROGRESS");
    lines.push(`- We are on stage ${run.current_stage}, currently ${run.progress}% complete.`);
    if (run.target_completion) lines.push(`- Target go-live: ${run.target_completion}.`);
    lines.push("");
  }
  if (!clientTasks.length && !docsPending.length && !accessPending.length) {
    lines.push("Nothing pending on your side this week. We'll keep you posted as things move.");
    lines.push("");
  }
  lines.push("Reply to this email if you have any questions or need anything else.");
  lines.push("");
  lines.push("Best regards,");
  lines.push("Team Finanshels");
  const body = lines.join("\n");
  const subject = `Your weekly update from Finanshels — ${client.name}`;

  const { sendGmailAs } = await import("./google");
  const { getDriveCapableMemberId } = await import("./google");
  const sender =
    (client.am_id
      ? (await admin.from("member_connections").select("team_member_id").eq("team_member_id", client.am_id).eq("provider", "google").eq("connected", true).maybeSingle()).data?.team_member_id
      : null) ??
    (await getDriveCapableMemberId(orgId));
  if (!sender) return { error: "No Google-connected sender found." };
  for (const to of recipientList) {
    await sendGmailAs(sender as string, to, subject, body).catch(() => null);
  }
  await admin.from("audit_events").insert({
    org_id: orgId,
    actor: "system",
    actor_role: "cron",
    action: "weekly_digest_sent",
    module: "clients",
    resource_ref: `Weekly digest sent to ${recipientList.join(", ")}`,
    resource_id: clientId,
    resource_type: "client",
  });
  return { ok: true, sentTo: recipientList };
}
