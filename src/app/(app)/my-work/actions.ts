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
