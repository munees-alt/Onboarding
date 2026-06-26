"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { runAi } from "@/lib/ai";
import { sendGmailAs, getDriveCapableMemberId } from "@/lib/google";

// NOTE: this is a "use server" module — only async exports allowed. Interfaces
// are type-only (erased at compile time) so the WeeklyUpdate / KeyDate / TaskItem
// shapes below are fine here.

export interface TaskItem {
  id: string;
  title: string;
  status: string;
  owner_name: string | null;
  due_date: string | null;
  newly_completed?: boolean;
}
export interface KeyDate { label: string; date: string }
export interface StatusSnapshot {
  docs: { received: number; total: number };
  access: { shared: number; total: number };
  intake: "submitted" | "awaiting" | "none";
  coa: "signed_off" | "pending" | "none";
}

export interface WeeklyUpdateRow {
  id: string;
  org_id: string;
  client_id: string;
  run_id: string | null;
  week_of: string;
  status: "draft" | "sent" | "skipped";
  completed_tasks: TaskItem[];
  inprogress_tasks: TaskItem[];
  client_action_tasks: TaskItem[];
  per_task_notes: Record<string, string>;
  extra_client_actions: string | null;
  key_dates: KeyDate[];
  status_snapshot: StatusSnapshot | null;
  feedback_link: string | null;
  subject: string | null;
  email_body: string | null;
  whatsapp_body: string | null;
  sent_at: string | null;
  sent_via: string | null;
  sent_to: string | null;
  clientName?: string;
  clientEmail?: string | null;
}

async function requireMasterAdmin(): Promise<{ error: string } | { orgId: string; userName: string; userEmail: string }> {
  const session = await getSession();
  if (!session?.profile.org_id) return { error: "Not signed in." };
  const role = session.teamMember?.role ?? session.profile.role;
  if (role !== "admin") return { error: "Master Admin only." };
  return {
    orgId: session.profile.org_id,
    userName: session.teamMember?.full_name ?? session.profile.full_name ?? session.email ?? "Master Admin",
    userEmail: session.email ?? "",
  };
}

export async function listWeeklyUpdates(): Promise<{ error?: string; rows?: WeeklyUpdateRow[] }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  // last 5 weeks (this Thu + 4 prior).
  const fromDate = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("weekly_client_updates")
    .select("*")
    .eq("org_id", g.orgId)
    .gte("week_of", fromDate)
    .order("week_of", { ascending: false })
    .order("status", { ascending: true });
  if (error) return { error: error.message };
  const rows = (data ?? []) as WeeklyUpdateRow[];
  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const nameById = new Map<string, string>();
  if (clientIds.length) {
    const { data: cs } = await supabase.from("clients").select("id,name").in("id", clientIds);
    (cs ?? []).forEach((c) => nameById.set(c.id, c.name));
  }
  return { rows: rows.map((r) => ({ ...r, clientName: nameById.get(r.client_id) ?? "Client" })) };
}

export async function getWeeklyUpdate(id: string): Promise<{ error?: string; row?: WeeklyUpdateRow }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weekly_client_updates")
    .select("*")
    .eq("id", id)
    .eq("org_id", g.orgId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Not found." };
  const { data: client } = await supabase
    .from("clients")
    .select("name,primary_contact_email")
    .eq("id", data.client_id)
    .maybeSingle();
  return {
    row: {
      ...(data as WeeklyUpdateRow),
      clientName: client?.name ?? "Client",
      clientEmail: client?.primary_contact_email ?? null,
    },
  };
}

export async function regenerateDraft(id: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("weekly_client_updates")
    .select("id,run_id,client_id,completed_tasks")
    .eq("id", id).eq("org_id", g.orgId).maybeSingle();
  if (!row) return { error: "Not found." };

  // Pull every active run for this client (mirrors the cron logic).
  const { data: runs } = await supabase
    .from("onboarding_runs")
    .select("id,template_key,status")
    .eq("client_id", row.client_id)
    .not("status", "in", "(complete,closed,archived)");
  const descoped = new Set(["urgent-compliance", "catchup", "compliance-renewal"]);
  const runIds = (runs ?? []).filter((r) => !descoped.has(r.template_key)).map((r) => r.id);
  if (!runIds.length) return { error: "No active onboarding runs for this client." };

  const { data: taskRows } = await supabase
    .from("tasks")
    .select("id,run_id,title,status,owner_id,owner_name,owner_kind,due_date,updated_at,notes,client_visible")
    .in("run_id", runIds);
  const tasks = (taskRows ?? []) as Array<{
    id: string; run_id: string; title: string; status: string;
    owner_id: string | null; owner_name: string | null; owner_kind: string | null;
    due_date: string | null; updated_at: string | null; notes: string | null; client_visible: boolean | null;
  }>;

  const { data: accessRows } = await supabase
    .from("run_items")
    .select("id,run_id,status,data")
    .in("run_id", runIds)
    .eq("kind", "access");
  const allAccess = (accessRows ?? []) as Array<{ id: string; run_id: string; status: string | null; data: { id?: string; label?: string; systemName?: string } | null }>;
  const accessItems = allAccess.filter((r) => (r.status ?? "requested") !== "granted");

  const { data: docRows } = await supabase
    .from("documents").select("id,status").in("run_id", runIds);
  const docs = (docRows ?? []) as Array<{ id: string; status: string | null }>;
  const docsReceived = docs.filter((d) => d.status === "uploaded").length;
  const docsTotal = docs.length;

  const { data: intakeRows } = await supabase
    .from("intake_forms").select("id,status").in("run_id", runIds);
  const intakeStatus: StatusSnapshot["intake"] =
    (intakeRows ?? []).some((r) => r.status === "submitted") ? "submitted"
    : (intakeRows ?? []).length ? "awaiting"
    : "none";

  const { data: coaRows } = await supabase
    .from("run_items").select("id,status,data").in("run_id", runIds).eq("kind", "coa");
  type CoaRow = { id: string; status: string | null; data: { signedOff?: boolean } | null };
  const coaList = (coaRows ?? []) as CoaRow[];
  const coaSignedOff = coaList.some((r) => r.status === "signed" || r.data?.signedOff === true);
  const coaStatus: StatusSnapshot["coa"] = coaList.length ? (coaSignedOff ? "signed_off" : "pending") : "none";

  const status_snapshot: StatusSnapshot = {
    docs: { received: docsReceived, total: docsTotal },
    access: { shared: allAccess.filter((r) => r.status === "granted").length, total: allAccess.length },
    intake: intakeStatus,
    coa: coaStatus,
  };

  // Auto-prefill per_task_notes from tasks.notes; existing notes from the
  // current row win on merge (don't clobber what the admin wrote).
  const taskNotesByBoard: Record<string, string> = {};
  for (const t of tasks) {
    if (t.notes && t.notes.trim()) taskNotesByBoard[t.id] = t.notes.trim();
  }
  const { data: existing } = await supabase
    .from("weekly_client_updates").select("per_task_notes").eq("id", id).maybeSingle();
  const existingNotes = (existing?.per_task_notes ?? {}) as Record<string, string>;
  const mergedNotes: Record<string, string> = { ...taskNotesByBoard };
  for (const [k, v] of Object.entries(existingNotes)) {
    if (typeof v === "string" && v.trim()) mergedNotes[k] = v;
  }

  const { data: teamRows } = await supabase.from("team_members").select("id").eq("org_id", g.orgId).eq("active", true);
  const teamIds = new Set<string>((teamRows ?? []).map((t) => t.id as string));

  const priorDone = new Set<string>(
    (Array.isArray(row.completed_tasks) ? (row.completed_tasks as { id?: string }[]) : [])
      .map((t) => t.id ?? "").filter(Boolean),
  );
  const isClientTask = (t: { owner_id: string | null; owner_name: string | null; owner_kind: string | null }) => {
    if (t.owner_kind === "client") return true;
    const n = (t.owner_name ?? "").toLowerCase();
    if (n.startsWith("client")) return true;
    if (!t.owner_id && !t.owner_name) return false;
    if (t.owner_id && !teamIds.has(t.owner_id)) return true;
    return false;
  };

  // This-week cutoff = the Thursday anchor of THIS update (week_of) minus 7d.
  // Falls back to "last 7 days from now" if week_of is missing.
  const { data: weekOfRow } = await supabase.from("weekly_client_updates").select("week_of").eq("id", id).maybeSingle();
  const weekOfIso = (weekOfRow?.week_of as string | undefined) ?? new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const weekStartMs = new Date(weekOfIso + "T00:00:00Z").getTime() - 7 * 86_400_000;
  const isComplete = (s: string) => s === "complete" || s === "done" || s === "completed";
  const completedThisWeek = (t: { status: string; updated_at: string | null }) => {
    if (!isComplete(t.status)) return false;
    const ts = t.updated_at ? new Date(t.updated_at).getTime() : 0;
    return ts >= weekStartMs;
  };

  const completed_tasks = tasks
    .filter(completedThisWeek)
    .map((t) => ({ id: t.id, title: t.title, status: t.status, owner_name: t.owner_name, due_date: t.due_date, newly_completed: !priorDone.has(t.id) }));
  const inprogress_tasks = tasks
    .filter((t) => !isComplete(t.status) && t.status !== "cancelled")
    .filter((t) => !isClientTask(t))
    .map((t) => ({ id: t.id, title: t.title, status: t.status, owner_name: t.owner_name, due_date: t.due_date }));
  const clientActionFromTasks = tasks
    .filter((t) => !isComplete(t.status) && t.status !== "cancelled")
    .filter((t) => isClientTask(t))
    .map((t) => ({ id: t.id, title: t.title, status: t.status, owner_name: t.owner_name, due_date: t.due_date }));
  const clientActionFromAccess = accessItems.map((a) => {
    const label = a.data?.label ?? a.data?.systemName ?? "Access request";
    const system = a.data?.systemName && a.data.systemName !== a.data?.label ? ` — ${a.data.systemName}` : "";
    return {
      id: `access:${a.id}`,
      title: `Share access: ${label}${system}`,
      status: a.status ?? "requested",
      owner_name: "Client",
      due_date: null,
    };
  });
  const client_action_tasks = [...clientActionFromTasks, ...clientActionFromAccess];

  const now = Date.now();
  const horizonMs = now + 30 * 86_400_000;
  const upcoming = tasks
    .filter((t) => t.due_date && new Date(t.due_date).getTime() > now && new Date(t.due_date).getTime() < horizonMs)
    .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
    .slice(0, 5)
    .map((t) => ({ label: t.title, date: t.due_date! }));

  const { error } = await supabase
    .from("weekly_client_updates")
    .update({
      completed_tasks, inprogress_tasks, client_action_tasks,
      per_task_notes: mergedNotes,
      status_snapshot,
      key_dates: upcoming, updated_at: new Date().toISOString(),
    })
    .eq("id", id).eq("org_id", g.orgId);
  if (error) return { error: error.message };
  revalidatePath(`/weekly-updates/${id}`);
  revalidatePath("/weekly-updates");
  return { ok: true };
}

export async function saveUpdate(
  id: string,
  fields: Partial<Pick<WeeklyUpdateRow, "per_task_notes" | "extra_client_actions" | "key_dates" | "feedback_link" | "subject" | "email_body" | "whatsapp_body">>,
): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (fields.per_task_notes !== undefined) patch.per_task_notes = fields.per_task_notes;
  if (fields.extra_client_actions !== undefined) patch.extra_client_actions = fields.extra_client_actions;
  if (fields.key_dates !== undefined) patch.key_dates = fields.key_dates;
  if (fields.feedback_link !== undefined) patch.feedback_link = fields.feedback_link;
  if (fields.subject !== undefined) patch.subject = fields.subject;
  if (fields.email_body !== undefined) patch.email_body = fields.email_body;
  if (fields.whatsapp_body !== undefined) patch.whatsapp_body = fields.whatsapp_body;
  const { error } = await supabase.from("weekly_client_updates").update(patch).eq("id", id).eq("org_id", g.orgId);
  if (error) return { error: error.message };
  revalidatePath(`/weekly-updates/${id}`);
  return { ok: true };
}

export async function composeDraft(id: string): Promise<{ error?: string; ok?: boolean; subject?: string; email_body?: string; whatsapp_body?: string }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const { data: row } = await supabase.from("weekly_client_updates").select("*").eq("id", id).eq("org_id", g.orgId).maybeSingle();
  if (!row) return { error: "Not found." };
  const { data: org } = await supabase.from("orgs").select("name").eq("id", g.orgId).maybeSingle();
  const { data: client } = await supabase.from("clients").select("name,primary_contact_name").eq("id", row.client_id).maybeSingle();
  const firstName = ((client?.primary_contact_name ?? client?.name ?? "there") as string).split(/\s+/)[0];

  // Pull onboarding kickoff date for the "since we kicked off on …" line.
  let kickoffDate = "";
  if (row.run_id) {
    const { data: run } = await supabase.from("onboarding_runs").select("created_at").eq("id", row.run_id).maybeSingle();
    if (run?.created_at) {
      const d = new Date(run.created_at as string);
      kickoffDate = d.toLocaleDateString("en-GB", { day: "numeric", month: "long" }); // e.g. "19 June"
    }
  }

  const notes = (row.per_task_notes ?? {}) as Record<string, string>;
  const fmtList = (arr: { id: string; title: string; owner_name: string | null; due_date: string | null; newly_completed?: boolean }[]) =>
    arr.length ? arr.map((t) => {
      const n = notes[t.id]?.trim();
      const own = t.owner_name ? ` (owner: ${t.owner_name})` : "";
      const due = t.due_date ? ` (due ${t.due_date})` : "";
      const flag = t.newly_completed ? " [newly completed]" : "";
      return `- ${t.title}${own}${due}${flag}${n ? ` — note: ${n}` : ""}`;
    }).join("\n") : "- (none)";
  const fmtDates = (arr: { label: string; date: string }[]) =>
    arr.length ? arr.map((d) => `- ${d.date}: ${d.label}`).join("\n") : "- (none)";

  const clientActions = [
    fmtList(row.client_action_tasks ?? []),
    (row.extra_client_actions ?? "").trim() ? `Additional asks:\n${row.extra_client_actions}` : "",
  ].filter(Boolean).join("\n\n");

  const clientName = client?.name ?? "the client";
  const firmName = org?.name ?? "Finanshels";
  const senderName = g.userName ?? "the team";

  // Portal status snapshot — formatted as plain facts the AI must weave in.
  const snap = (row.status_snapshot ?? {}) as Partial<StatusSnapshot>;
  const docsLine = snap.docs && snap.docs.total > 0
    ? (snap.docs.received >= snap.docs.total
        ? `Intake Form & Documents: All requested documents received (${snap.docs.received}/${snap.docs.total} collected).`
        : `Documents: ${snap.docs.received} of ${snap.docs.total} requested documents received — ${snap.docs.total - snap.docs.received} still pending.`)
    : null;
  const intakeLine = snap.intake === "submitted" ? "Intake form: Submitted."
    : snap.intake === "awaiting" ? "Intake form: Sent — awaiting client submission."
    : null;
  const coaLine = snap.coa === "signed_off" ? "COA sign-off: Signed off by client."
    : snap.coa === "pending" ? "COA sign-off: Pending — Chart of Accounts will be shared for review and approval."
    : null;
  const accessLine = snap.access && snap.access.total > 0
    ? (snap.access.shared >= snap.access.total
        ? `Access: All ${snap.access.total} requested systems shared.`
        : `Access: ${snap.access.shared} of ${snap.access.total} systems shared — ${snap.access.total - snap.access.shared} still pending.`)
    : null;
  const portalStatusBlock = [docsLine, intakeLine, coaLine, accessLine].filter(Boolean).join("\n");

  const prompt =
`Compose this week's onboarding update for ${clientName}.

DATA TO USE (do not invent anything beyond this):

Client first name: ${firstName}
Client full name: ${clientName}
Kickoff date: ${kickoffDate || "(not available)"}
Sender: ${senderName} (${g.userEmail}) — ${firmName}

Completed task-board items (this week):
${fmtList(row.completed_tasks ?? [])}

In progress (team notes are the "why" — weave them in so the line reads as intentional, not late):
${fmtList(row.inprogress_tasks ?? [])}

Client actions / pending access (use these to ask the client warmly):
${clientActions || "- (none)"}

Upcoming dates (deliveries, data requests, deadlines):
${fmtDates(row.key_dates ?? [])}

Portal status (use these as facts in Completed / In progress / Next steps as appropriate):
${portalStatusBlock || "- (no portal data)"}

Feedback link (only include if present): ${row.feedback_link ?? "(none)"}

============================================================
OUTPUT — STRICT JSON:
{"subject":"...", "email_body":"...", "whatsapp_body":"..."}

============================================================
SUBJECT
Use exactly: "Your Onboarding: Where We Are + What's Next — ${clientName}"

============================================================
EMAIL BODY — FOLLOW THIS TEMPLATE EXACTLY (structure + tone). Fill the blanks from the data above. Keep section headings verbatim. Use the portal-status lines as FACTS — e.g. if "Intake Form & Documents: All requested documents received (4/4 collected)", surface that as ONE Completed bullet: "Intake Form & Documents: All submitted and received (4/4 documents collected)." If documents are still pending, list it instead under Next steps as a client ask. Omit any sub-bullet that has no data. If "Completed" is empty, write "- (nothing closed out this week yet)".

Hi ${firstName},

Hope you're doing well. Here's a quick update on where we stand with your onboarding${kickoffDate ? ` since we kicked off on ${kickoffDate}` : ""}.

Where we are
Completed:
- <each completed task as a short line; if a per-task note exists, append it as plain prose. ADD a single line for "Intake Form & Documents" when the portal-status shows all docs received + intake submitted; for "Setup Zoho" or other system tasks, phrase as "Setup Zoho: Account creation is complete.">

In progress:
- <each in-progress task as ONE sentence. The team's note for that task IS the WHY — incorporate it verbatim or paraphrased. Example: a CT Registration task with note "Tax Team started the process. Require clients support in account creation" becomes "Corporate Tax (CT) Registration: The application is currently in progress. Our Tax Team has started the process, but we require your support in the initial account creation first so we can move forward with the filing.">

Next steps
- <Client actions first, framed warmly as a request. Use the portal-status access/docs lines if anything is pending: "Bank & payment gateway access: We haven't received access yet — connecting this would be a great help so we can process your transactions accurately.">
- <COA sign-off line if portal-status shows COA pending: "COA Sign-off: This is currently pending. We will be sharing the Chart of Accounts with you shortly for your review and approval.">
- <Onboarding sign-off line if "Sign off onboarding" task is in the data with a due date: "Onboarding Sign-off: Once the [prerequisite, e.g. CT account] is created and the COA is approved, we will look to officially close out the onboarding phase by the deadline of <due date>.">
- <First delivery date if in upcoming dates: "First delivery: Your first set of deliverables will be ready on <date>.">
- <Data request dates if in upcoming dates.>

A quick favour
We'd really value 1 minute of your feedback on how the onboarding has gone so far — the communication from the team, the process, and your experience with the onboarding portal:
${row.feedback_link ?? "<feedback link>"}

Thank you for your time through this process — looking forward to getting everything fully aligned!

Best Regards,
Team ${firmName}

============================================================
WHATSAPP BODY — FOLLOW THIS TEMPLATE EXACTLY. Casual, emoji-friendly, ~6-8 short lines. Match the example exactly in shape:

Hi ${firstName}, quick onboarding update 👋
I've just shared a detailed update over email as well, but in short:
• <pick the 1-2 most important in-progress items with a one-clause WHY from their notes — e.g. "CT registration — application submitted, awaiting approval">
• <next most important, especially Zoho-style intentional holds — e.g. "Zoho Books — we're setting this up at month-end so you get the full free trial month and save on cost">
One thing from your side: <combine the client-action items into one warm ask ending with 🙏 — e.g. "we haven't received access to your bank and payment gateway yet — if we could connect and resolve that, it'd be a great help 🙏">

Also: <first delivery date if available>, and <data request line if available>.
And if you get a minute, we'd love your quick feedback on how onboarding went (${row.feedback_link ?? "<feedback link>"})

Thanks so much — excited to get started!

============================================================
RULES
- Do NOT invent any task, date, or action that isn't in the data above.
- If a section has no data, OMIT IT cleanly — don't write placeholders.
- The "WHY" framing on in-progress items is critical: turn dry status into intentional brand voice (free trial, compliance priority, sequencing rationale) ONLY when the team note explains it. If no note, keep it factual.
- Tone: confident, warm, factual. UAE business English. No buzzwords. Short paragraphs.
- Output strict JSON only, no markdown fences, no preamble.`;

  let out: string;
  try {
    out = await runAi(g.orgId, "handover_summary", {
      system: "You write client-facing onboarding updates for a UAE accounting firm. Follow the user-provided template EXACTLY — same headings, same shape, same tone. Fill blanks from data. Never invent tasks, dates, or actions. Turn dry status lines into intentional brand voice by weaving in the team's per-task notes as the 'why' (e.g. free trial timing, compliance sequencing) — but only when a note explains it. Output strict JSON only: {\"subject\":\"...\",\"email_body\":\"...\",\"whatsapp_body\":\"...\"}.",
      prompt,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI failed." };
  }

  // Best-effort JSON parse. The model occasionally wraps with ```json — strip fences.
  const cleaned = out.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: { subject?: string; email_body?: string; whatsapp_body?: string } = {};
  try { parsed = JSON.parse(cleaned); }
  catch {
    // Fallback: dump the whole text into email_body.
    parsed = { subject: row.subject ?? "Weekly update", email_body: out, whatsapp_body: "" };
  }
  const subject = (parsed.subject ?? row.subject ?? "").trim();
  const email_body = (parsed.email_body ?? "").trim();
  const whatsapp_body = (parsed.whatsapp_body ?? "").trim();

  await supabase.from("weekly_client_updates")
    .update({ subject, email_body, whatsapp_body, updated_at: new Date().toISOString() })
    .eq("id", id).eq("org_id", g.orgId);
  revalidatePath(`/weekly-updates/${id}`);
  return { ok: true, subject, email_body, whatsapp_body };
}

async function closeLinkedAdminTask(updateId: string, action: string, note: string | null) {
  const admin = createAdminClient();
  const { data: t } = await admin.from("admin_tasks").select("id,history,notes").eq("kind", "weekly_update").eq("step_id", updateId).maybeSingle();
  if (!t) return;
  const history = Array.isArray(t.history) ? t.history : [];
  await admin.from("admin_tasks").update({
    status: "closed",
    closed_at: new Date().toISOString(),
    notes: note ?? t.notes,
    history: [...history, { at: new Date().toISOString(), action, notes: note ?? null }],
  }).eq("id", t.id);
}

export async function sendEmail(id: string, to: string, subject: string, body: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const recipients = to.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  if (!recipients.length) return { error: "Enter at least one valid recipient email." };
  if (!subject.trim()) return { error: "Subject is empty." };
  if (!body.trim()) return { error: "Email body is empty." };
  const sender = await getDriveCapableMemberId(g.orgId);
  if (!sender) return { error: "Connect a Google account first (My Connections) to send the email." };
  const res = await sendGmailAs(sender, recipients.join(","), subject, body);
  if (!res.ok) return { error: res.error ?? "Couldn't send the email." };
  const supabase = await createClient();
  await supabase.from("weekly_client_updates").update({
    status: "sent", sent_at: new Date().toISOString(), sent_via: "email",
    sent_to: recipients.join(","), subject, email_body: body, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("org_id", g.orgId);
  await closeLinkedAdminTask(id, "sent_email", `Sent to ${recipients.join(",")}`);
  revalidatePath(`/weekly-updates/${id}`);
  revalidatePath("/weekly-updates");
  revalidatePath("/my-work");
  return { ok: true };
}

export async function markSent(
  id: string,
  channel: "whatsapp" | "email" | "call" | "manual" | "other" = "whatsapp",
  to?: string,
  note?: string,
): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const { error } = await supabase.from("weekly_client_updates").update({
    status: "sent", sent_at: new Date().toISOString(), sent_via: channel,
    sent_to: to ?? null, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("org_id", g.orgId);
  if (error) return { error: error.message };
  const detail = [to ? `to ${to}` : null, note?.trim() || null].filter(Boolean).join(" — ");
  await closeLinkedAdminTask(id, `sent_${channel}`, `Sent via ${channel}${detail ? ` (${detail})` : ""}`);
  revalidatePath(`/weekly-updates/${id}`);
  revalidatePath("/weekly-updates");
  revalidatePath("/my-work");
  return { ok: true };
}

export async function skipUpdate(id: string, reason: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const { error } = await supabase.from("weekly_client_updates").update({
    status: "skipped", updated_at: new Date().toISOString(),
  }).eq("id", id).eq("org_id", g.orgId);
  if (error) return { error: error.message };
  await closeLinkedAdminTask(id, "skipped", reason || null);
  revalidatePath(`/weekly-updates/${id}`);
  revalidatePath("/weekly-updates");
  revalidatePath("/my-work");
  return { ok: true };
}

export async function setFeedbackFormUrl(url: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const trimmed = url.trim() || null;
  const { error } = await supabase.from("orgs").update({ feedback_form_url: trimmed }).eq("id", g.orgId);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}

export async function runWeeklyScanNow(): Promise<{ ok: boolean; error?: string; created?: number }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { ok: false, error: g.error };
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const headers: Record<string, string> = {};
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  // force=1 lets the admin trigger this any day of the week.
  const res = await fetch(`${base}/api/cron/weekly-client-updates?force=1`, { headers, cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { created?: number };
  revalidatePath("/weekly-updates");
  return { ok: true, created: j.created ?? 0 };
}
