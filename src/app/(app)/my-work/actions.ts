"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Close an auto-generated admin task with the admin's follow-up notes. Saved
// notes are carried into the next auto-recreation by the cron so context
// accumulates across cycles.
export async function closeAdminTask(id: string, notes: string) {
  const session = await requireSession();
  const supabase = await createClient();
  const trimmed = (notes ?? "").trim();
  const { data: row } = await supabase
    .from("admin_tasks")
    .select("history,owner_id,run_id,kind")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { ok: false as const, error: "not_found" };
  if (row.owner_id !== session.teamMember?.id && session.profile.role !== "admin" && session.profile.role !== "ops_head") {
    return { ok: false as const, error: "forbidden" };
  }
  const history = Array.isArray(row.history) ? row.history : [];
  const nextHistory = [...history, { at: new Date().toISOString(), action: "closed", notes: trimmed }];
  await supabase
    .from("admin_tasks")
    .update({ status: "closed", notes: trimmed, closed_at: new Date().toISOString(), history: nextHistory })
    .eq("id", id);

  // Auto-close all escalated copies of the same task (same run + kind) so the
  // chain collapses across all levels when anyone marks it done.
  if (row.run_id && row.kind) {
    const adminDb = createAdminClient();
    await adminDb
      .from("admin_tasks")
      .update({ status: "closed", closed_at: new Date().toISOString(), notes: `Auto-closed: resolved by ${session.teamMember?.id ?? "team"}` })
      .eq("run_id", row.run_id)
      .eq("kind", row.kind)
      .eq("status", "open")
      .neq("id", id);
  }

  revalidatePath("/my-work");
  return { ok: true as const };
}

// Re-open a task by hand (e.g. premature close). Resets closed_at + status.
export async function reopenAdminTask(id: string) {
  const session = await requireSession();
  const supabase = await createClient();
  const { data: row } = await supabase.from("admin_tasks").select("owner_id,history").eq("id", id).maybeSingle();
  if (!row) return { ok: false as const, error: "not_found" };
  if (row.owner_id !== session.teamMember?.id && session.profile.role !== "admin" && session.profile.role !== "ops_head") {
    return { ok: false as const, error: "forbidden" };
  }
  const history = Array.isArray(row.history) ? row.history : [];
  await supabase
    .from("admin_tasks")
    .update({ status: "open", closed_at: null, history: [...history, { at: new Date().toISOString(), action: "reopened" }] })
    .eq("id", id);
  revalidatePath("/my-work");
  return { ok: true as const };
}

// Close multiple admin tasks at once with a shared note (one note applies to each).
export async function bulkCloseAdminTasks(ids: string[], notes: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const supabase = await createClient();
  const trimmed = (notes ?? "").trim();
  const role = session.profile.role;
  const memberId = session.teamMember?.id;

  for (const id of ids) {
    const { data: row } = await supabase.from("admin_tasks").select("history,owner_id").eq("id", id).maybeSingle();
    if (!row) continue;
    if (row.owner_id !== memberId && role !== "admin" && role !== "ops_head") continue;
    const history = Array.isArray(row.history) ? row.history : [];
    const nextHistory = [...history, { at: new Date().toISOString(), action: "bulk_closed", notes: trimmed || undefined }];
    await supabase
      .from("admin_tasks")
      .update({ status: "closed", notes: trimmed || null, closed_at: new Date().toISOString(), history: nextHistory })
      .eq("id", id);
  }
  revalidatePath("/my-work");
  return { ok: true };
}

// Snooze a task until a future date — master admin only. Task disappears from
// the active view and won't be re-created by the cron until the date passes.
export async function snoozeAdminTask(id: string, until: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.profile.role !== "admin") return { ok: false, error: "Master admin only." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("admin_tasks").select("history").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  const history = Array.isArray(row.history) ? row.history : [];
  await supabase
    .from("admin_tasks")
    .update({
      snoozed_until: new Date(until).toISOString(),
      hold_note: note.trim() || null,
      history: [...history, { at: new Date().toISOString(), action: "snoozed", notes: `Until ${until}${note.trim() ? ` — ${note.trim()}` : ""}` }],
    })
    .eq("id", id);
  revalidatePath("/my-work");
  return { ok: true };
}

// Close-with-next-action-date. A team member's request must be approved by their
// manager (team lead); a manager (team_lead+) defers directly. "Defer" = snooze
// the item until the chosen date, when it resurfaces.
export async function requestCloseWithDate(
  taskId: string,
  date: string,
  note: string,
): Promise<{ ok: boolean; mode?: "deferred" | "approval"; error?: string }> {
  const session = await requireSession();
  const supabase = await createClient();
  const admin = createAdminClient();
  const memberId = session.teamMember?.id;
  const role = session.profile.role;
  if (!date) return { ok: false, error: "Pick a next action date." };
  const { data: task } = await supabase
    .from("admin_tasks")
    .select("id,owner_id,org_id,client_id,run_id,title,history")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return { ok: false, error: "not_found" };
  if (task.owner_id !== memberId && role !== "admin" && role !== "ops_head") return { ok: false, error: "forbidden" };
  const trimmed = (note ?? "").trim();
  const iso = new Date(date).toISOString();
  const history = Array.isArray(task.history) ? task.history : [];

  const isManager = role === "admin" || role === "ops_head" || role === "am" || role === "team_lead";
  if (isManager) {
    await supabase.from("admin_tasks").update({
      snoozed_until: iso,
      hold_note: trimmed || null,
      history: [...history, { at: new Date().toISOString(), action: "deferred", notes: `Next action ${date}${trimmed ? ` — ${trimmed}` : ""}` }],
    }).eq("id", taskId);
    revalidatePath("/my-work");
    return { ok: true, mode: "deferred" };
  }

  // Team member → route to their manager as an approval item.
  const { data: me } = await admin.from("team_members").select("full_name,reports_to").eq("id", memberId!).maybeSingle();
  const managerId = (me?.reports_to as string | null) ?? null;
  if (!managerId) return { ok: false, error: "No manager on file to approve this. Ask an admin." };
  await admin.from("admin_tasks").insert({
    org_id: task.org_id,
    owner_id: managerId,
    kind: "close_approval",
    client_id: task.client_id,
    run_id: task.run_id,
    title: `Approve action timeline · ${task.title}`,
    body: `${me?.full_name ?? "A team member"} requests to close this with a next action date of ${date}.${trimmed ? `\nReason: ${trimmed}` : ""}`,
    history: [{
      at: new Date().toISOString(),
      action: "approval_requested",
      approval: { originalTaskId: taskId, originalTitle: task.title, date, note: trimmed, requesterId: memberId, requesterName: me?.full_name ?? null },
    }],
  });
  // Park the original until the date so it leaves the active list while pending.
  await supabase.from("admin_tasks").update({
    snoozed_until: iso,
    hold_note: `Pending team lead approval — next action ${date}${trimmed ? ` — ${trimmed}` : ""}`,
    history: [...history, { at: new Date().toISOString(), action: "approval_requested", notes: `Requested close w/ next action ${date}` }],
  }).eq("id", taskId);
  revalidatePath("/my-work");
  return { ok: true, mode: "approval" };
}

function approvalMeta(history: unknown): { originalTaskId?: string; originalTitle?: string; date?: string; requesterId?: string; requesterName?: string } | null {
  if (!Array.isArray(history)) return null;
  for (const h of history) {
    if (h && typeof h === "object" && "approval" in h) return (h as { approval: Record<string, string> }).approval;
  }
  return null;
}

// Team lead approves a member's deferral: the original stays parked until its
// next-action date; the approval item is closed and the requester notified.
export async function approveCloseRequest(approvalTaskId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const supabase = await createClient();
  const admin = createAdminClient();
  const memberId = session.teamMember?.id;
  const role = session.profile.role;
  const { data: appr } = await supabase.from("admin_tasks").select("owner_id,org_id,history").eq("id", approvalTaskId).maybeSingle();
  if (!appr) return { ok: false, error: "not_found" };
  if (appr.owner_id !== memberId && role !== "admin" && role !== "ops_head") return { ok: false, error: "forbidden" };
  const meta = approvalMeta(appr.history);
  const hist = Array.isArray(appr.history) ? appr.history : [];
  await admin.from("admin_tasks").update({
    status: "closed", closed_at: new Date().toISOString(),
    history: [...hist, { at: new Date().toISOString(), action: "approved" }],
  }).eq("id", approvalTaskId);
  if (meta?.requesterId) {
    await admin.from("notifications").insert({
      org_id: appr.org_id, recipient_id: meta.requesterId, kind: "task_assigned",
      title: "Close approved",
      body: `Your request to defer "${meta.originalTitle ?? "an item"}" to ${meta.date ?? "the chosen date"} was approved.`,
    });
  }
  revalidatePath("/my-work");
  return { ok: true };
}

// Team lead rejects: the original returns to the member's active list now.
export async function disapproveCloseRequest(approvalTaskId: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  const supabase = await createClient();
  const admin = createAdminClient();
  const memberId = session.teamMember?.id;
  const role = session.profile.role;
  const { data: appr } = await supabase.from("admin_tasks").select("owner_id,org_id,history").eq("id", approvalTaskId).maybeSingle();
  if (!appr) return { ok: false, error: "not_found" };
  if (appr.owner_id !== memberId && role !== "admin" && role !== "ops_head") return { ok: false, error: "forbidden" };
  const meta = approvalMeta(appr.history);
  const trimmed = (note ?? "").trim();
  if (meta?.originalTaskId) {
    // Un-park the original so it's actionable again immediately.
    await admin.from("admin_tasks").update({ snoozed_until: null, hold_note: null }).eq("id", meta.originalTaskId);
  }
  const hist = Array.isArray(appr.history) ? appr.history : [];
  await admin.from("admin_tasks").update({
    status: "closed", closed_at: new Date().toISOString(),
    history: [...hist, { at: new Date().toISOString(), action: "disapproved", notes: trimmed || undefined }],
  }).eq("id", approvalTaskId);
  if (meta?.requesterId) {
    await admin.from("notifications").insert({
      org_id: appr.org_id, recipient_id: meta.requesterId, kind: "task_assigned",
      title: "Close not approved",
      body: `Your request to defer "${meta.originalTitle ?? "an item"}" was not approved${trimmed ? `: ${trimmed}` : ""}. Please action it.`,
    });
  }
  revalidatePath("/my-work");
  return { ok: true };
}

// Correct an admin task's title/body — master admin only. Used to override a
// compliance alert the system got wrong (e.g. wrong entity, already handled,
// wrong wording) without deleting the whole item. The correction is recorded
// in history for the audit trail.
export async function editAdminTask(id: string, title: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.profile.role !== "admin") return { ok: false, error: "Master admin only." };
  const supabase = await createClient();
  const t = (title ?? "").trim();
  if (!t) return { ok: false, error: "Title required." };
  const { data: row } = await supabase.from("admin_tasks").select("history,title").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  const history = Array.isArray(row.history) ? row.history : [];
  await supabase
    .from("admin_tasks")
    .update({
      title: t,
      body: (body ?? "").trim() || null,
      history: [...history, { at: new Date().toISOString(), action: "corrected", notes: `Master admin corrected (was: "${row.title ?? ""}")` }],
    })
    .eq("id", id);
  revalidatePath("/my-work");
  return { ok: true };
}

// Hard-delete an admin task — master admin only.
export async function deleteAdminTask(id: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.profile.role !== "admin") return { ok: false, error: "Master admin only." };
  const supabase = await createClient();
  const { error } = await supabase.from("admin_tasks").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/my-work");
  revalidatePath("/", "layout");
  return { ok: true };
}

// Archive an urgent compliance / catch-up run (e.g. client said they'll handle it themselves).
export async function archiveUrgentRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
  if (session.profile.role !== "admin" && session.profile.role !== "ops_head" && session.profile.role !== "am") {
    return { ok: false, error: "Only an AM or above can archive this run." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("onboarding_runs")
    .update({ status: "archived" })
    .eq("id", runId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/my-work");
  return { ok: true };
}

// Manual entry point so the admin can backfill / generate auto-tasks immediately
// instead of waiting for the cron. Calls the same route logic via fetch.
export async function runAutoAdminTaskScan() {
  const session = await requireSession();
  if (session.profile.role !== "admin" && session.profile.role !== "ops_head") {
    return { ok: false as const, error: "forbidden" };
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const headers: Record<string, string> = {};
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  const res = await fetch(`${base}/api/cron/admin-tasks`, { headers, cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { created?: number };
  revalidatePath("/my-work");
  return { ok: true as const, created: j.created ?? 0 };
}
