"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { runAi } from "@/lib/ai";
import { createGmailDraftAs, getDriveCapableMemberId } from "@/lib/google";

// Templates that are NOT the client-onboarding flow — excluded when picking
// "which of this client's active runs counts as Onboarding" for the manual
// draft-creation picker. Audit/Liquidation/Catch-up have their own comms.
const ONBOARDING_EXCLUDED_TEMPLATES = new Set([
  "urgent-compliance", "catchup", "compliance-renewal",
  "audit-workflow", "liquidation-workflow", "lead-intake",
]);
const CC_ADDRESS = "accounts@finanshels.com";

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

/** Clients with an active Onboarding-flow run — feeds the "New draft" client picker. */
export async function listOnboardingCandidates(): Promise<{ error?: string; rows?: { clientId: string; clientName: string; runId: string }[] }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const { data: runs, error } = await supabase
    .from("onboarding_runs")
    .select("id,client_id,template_key,status")
    .eq("org_id", g.orgId)
    .not("status", "in", "(complete,closed,archived)");
  if (error) return { error: error.message };
  const eligible = (runs ?? []).filter((r) => !ONBOARDING_EXCLUDED_TEMPLATES.has(r.template_key as string));
  if (!eligible.length) return { rows: [] };
  const clientIds = [...new Set(eligible.map((r) => r.client_id as string))];
  const { data: clients } = await supabase.from("clients").select("id,name").in("id", clientIds);
  const nameById = new Map<string, string>((clients ?? []).map((c) => [c.id as string, c.name as string]));
  return {
    rows: eligible.map((r) => ({
      clientId: r.client_id as string,
      runId: r.id as string,
      clientName: nameById.get(r.client_id as string) ?? "Client",
    })),
  };
}

/** Manually create (or reuse today's) draft for one client's onboarding run, then seed it from the task board. */
export async function createDraftForClient(clientId: string, runId: string): Promise<{ error?: string; id?: string }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from("weekly_client_updates")
    .select("id")
    .eq("org_id", g.orgId).eq("client_id", clientId).eq("run_id", runId).eq("week_of", today)
    .maybeSingle();

  let id = existing?.id as string | undefined;
  if (!id) {
    const { data: inserted, error } = await supabase
      .from("weekly_client_updates")
      .insert({ org_id: g.orgId, client_id: clientId, run_id: runId, week_of: today, status: "draft" })
      .select("id")
      .single();
    if (error) return { error: error.message };
    id = inserted.id as string;
  }

  const r = await regenerateDraft(id);
  if (r.error) return { error: r.error };
  return { id };
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

  // Scope strictly to THIS update's onboarding run — a client can simultaneously have
  // Audit/Liquidation/Catch-up runs going, which have their own comms and must not
  // bleed into the onboarding update. Older rows created before run_id was always set
  // fall back to "every active non-excluded run for this client" (legacy behaviour).
  let runIds: string[];
  if (row.run_id) {
    runIds = [row.run_id as string];
  } else {
    const { data: runs } = await supabase
      .from("onboarding_runs")
      .select("id,template_key,status")
      .eq("client_id", row.client_id)
      .not("status", "in", "(complete,closed,archived)");
    runIds = (runs ?? []).filter((r) => !ONBOARDING_EXCLUDED_TEMPLATES.has(r.template_key as string)).map((r) => r.id as string);
  }
  if (!runIds.length) return { error: "No active onboarding run for this client." };

  // NOTE: tasks has no owner_name column — join team_members on owner_id.
  const { data: taskRows } = await supabase
    .from("tasks")
    .select("id,run_id,title,status,owner_id,owner_kind,due_date,updated_at,notes,client_visible,owner:team_members(full_name)")
    .in("run_id", runIds);
  const tasks = ((taskRows ?? []) as Array<{
    id: string; run_id: string; title: string; status: string;
    owner_id: string | null; owner_kind: string | null; due_date: string | null;
    updated_at: string | null; notes: string | null; client_visible: boolean | null;
    owner: { full_name: string | null } | { full_name: string | null }[] | null;
  }>).map((t) => ({
    ...t,
    owner_name: Array.isArray(t.owner) ? (t.owner[0]?.full_name ?? null) : (t.owner?.full_name ?? null),
  }));

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

Feedback link (only include if present): ${row.feedback_link ?? "(none)"}

============================================================
OUTPUT — STRICT JSON:
{"subject":"...", "email_body":"...", "whatsapp_body":"..."}

============================================================
SUBJECT
Use exactly: "Your Onboarding: Where We Are + What's Next — ${clientName}"

============================================================
EMAIL BODY — FOLLOW THIS TEMPLATE EXACTLY (structure + tone). Fill the blanks ONLY from the task-board data above (completed / in progress / client actions / notes / dates) — do NOT reference documents, intake form, COA sign-off, or system access status; those are not part of this email. Keep section headings verbatim. Omit any sub-bullet that has no data. If "Completed" is empty, write "- (nothing closed out this week yet)".

Hi ${firstName},

Hope you're doing well. Here's a quick update on where we stand with your onboarding${kickoffDate ? ` since we kicked off on ${kickoffDate}` : ""}.

Where we are
Completed:
- <each completed task as a short line; if a per-task note exists, append it as plain prose>

In progress:
- <each in-progress task as ONE sentence. The team's note for that task IS the WHY — incorporate it verbatim or paraphrased. Example: a CT Registration task with note "Tax Team started the process. Require clients support in account creation" becomes "Corporate Tax (CT) Registration: The application is currently in progress. Our Tax Team has started the process, but we require your support in the initial account creation first so we can move forward with the filing.">

Next steps
- <Each client-action task, framed warmly as a request, using its note as context if present.>
- <Onboarding sign-off line if "Sign off onboarding" task is in the data with a due date: "Onboarding Sign-off: Once the [prerequisite] is in place, we will look to officially close out the onboarding phase by the deadline of <due date>.">
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

/**
 * Creates a Gmail DRAFT for this update (does NOT send). To = client, CC = accounts@finanshels.com,
 * from the connected master-admin mailbox — left sitting in Gmail Drafts for manual review/send.
 * The weekly_client_updates row stays "draft"; only a real send (from Gmail) or "Mark sent" closes it out.
 */
export async function createGmailDraft(id: string, to: string, subject: string, body: string): Promise<{ error?: string; ok?: boolean }> {
  const g = await requireMasterAdmin();
  if ("error" in g) return { error: g.error };
  const recipients = to.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  if (!recipients.length) return { error: "Enter at least one valid recipient email." };
  if (!subject.trim()) return { error: "Subject is empty." };
  if (!body.trim()) return { error: "Email body is empty." };
  const sender = await getDriveCapableMemberId(g.orgId);
  if (!sender) return { error: "Connect a Google account first (My Connections) to create the draft." };
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;white-space:pre-wrap;">${body
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
  const res = await createGmailDraftAs(sender, recipients.join(","), [CC_ADDRESS], subject, html, body);
  if (!res.ok) return { error: res.error ?? "Couldn't create the Gmail draft." };
  const supabase = await createClient();
  await supabase.from("weekly_client_updates").update({
    subject, email_body: body, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("org_id", g.orgId);
  revalidatePath(`/weekly-updates/${id}`);
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

