import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Append a compliance item to the one open "Compliance" admin_task chip per
 * (owner, client) — or create the chip if it doesn't exist. Scoping by client
 * (not just owner) keeps one client's compliance lines from bleeding into
 * another's card, and means every role fanned out for the same client shares
 * the same run_id — so closeAdminTask's existing same-run+kind auto-close
 * already cascades the close across all of them for free.
 *
 * Returns `appended` (line added to existing chip) or `created` (new chip).
 * Idempotent on identical lines — if the same line is already in the body it
 * is not duplicated.
 */
export async function upsertConsolidatedComplianceTask(
  admin: SupabaseClient,
  input: {
    orgId: string;
    ownerId: string;
    line: string;          // one-liner describing this compliance item
    clientId?: string | null;
    runId?: string | null;
    stepId?: string | null;
    source?: string;       // e.g. "compliance_alert" | "tax_compliance_new" — recorded in history
  },
): Promise<{ ok: true; mode: "appended" | "created" | "deduped"; taskId: string }> {
  const trimmedLine = input.line.trim();
  if (!trimmedLine) return { ok: true, mode: "deduped", taskId: "" };

  let query = admin
    .from("admin_tasks")
    .select("id,body,history,client_id,run_id")
    .eq("kind", "compliance")
    .eq("owner_id", input.ownerId)
    .eq("status", "open");
  query = input.clientId ? query.eq("client_id", input.clientId) : query.is("client_id", null);
  const { data: existing } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const existingBody: string = (existing.body as string | null) ?? "";
    const lines = existingBody.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.includes(trimmedLine)) {
      return { ok: true, mode: "deduped", taskId: existing.id as string };
    }
    lines.push(trimmedLine);
    const body = lines.map((l) => (l.startsWith("• ") || l.startsWith("- ") ? l : `• ${l}`)).join("\n");
    const title = `Compliance · ${lines.length} item${lines.length === 1 ? "" : "s"}`;
    const priorHistory = Array.isArray(existing.history) ? existing.history : [];
    const history = [...priorHistory, { at: new Date().toISOString(), added: trimmedLine, source: input.source ?? null }];
    await admin
      .from("admin_tasks")
      .update({ title, body, history })
      .eq("id", existing.id);
    return { ok: true, mode: "appended", taskId: existing.id as string };
  }

  const body = `• ${trimmedLine}`;
  const { data: inserted, error } = await admin.from("admin_tasks").insert({
    org_id: input.orgId,
    owner_id: input.ownerId,
    kind: "compliance",
    client_id: input.clientId ?? null,
    run_id: input.runId ?? null,
    step_id: input.stepId ?? null,
    title: "Compliance · 1 item",
    body,
    history: [{ at: new Date().toISOString(), added: trimmedLine, source: input.source ?? null }],
  }).select("id").single();
  if (error) throw error;
  return { ok: true, mode: "created", taskId: inserted.id as string };
}
