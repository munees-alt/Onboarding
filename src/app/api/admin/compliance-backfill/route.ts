import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTemplate } from "@/lib/templates-store";
import { _generateComplianceFromDocsImpl } from "@/app/(app)/onboarding/[runId]/ai-actions";

// One-off admin batch: for every non-archived onboarding run, analyse the
// client's documents, build the compliance calendar and complete the
// "Create compliance calendar" step. CRON_SECRET-gated (not a public action).
// Paginated with ?offset&limit so each call stays inside the function timeout.
export const maxDuration = 60;

function reminderFromExpiry(expiry?: string): string {
  if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return "";
  const d = new Date(expiry + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

// Minimal recompute (stage counts + run progress/status + client-active), mirroring
// recompute() in the run actions but with the admin client and no notifications.
async function recomputeAdmin(admin: ReturnType<typeof createAdminClient>, runId: string, templateKey: string) {
  const tpl = await getTemplate(templateKey);
  if (!tpl) return;
  const { data: steps } = await admin.from("run_steps").select("step_no,status").eq("run_id", runId);
  const status: Record<string, string> = {};
  (steps ?? []).forEach((s: { step_no: string; status: string }) => (status[s.step_no] = s.status));
  let requiredDone = 0, requiredTotal = 0, activeFound = false, activeStage = tpl.stages.length;
  for (let i = 0; i < tpl.stages.length; i++) {
    const stage = tpl.stages[i];
    const done = stage.steps.filter((st) => status[st.id] === "complete").length;
    if (!stage.optional) { requiredDone += done; requiredTotal += stage.steps.length; }
    let stStatus: string;
    if (done >= stage.steps.length) stStatus = "complete";
    else if (!stage.optional && !activeFound) { stStatus = "active"; activeFound = true; activeStage = i + 1; }
    else stStatus = "upcoming";
    await admin.from("run_stages").update({ status: stStatus, step_done: done }).eq("run_id", runId).eq("stage_no", i + 1);
  }
  const progress = requiredTotal ? Math.round((requiredDone / requiredTotal) * 100) : 0;
  const allDone = requiredDone >= requiredTotal;
  await admin.from("onboarding_runs").update({ current_stage: activeStage, progress, status: allDone ? "complete" : "in_progress" }).eq("id", runId);
  if (allDone) {
    const { data: r } = await admin.from("onboarding_runs").select("client_id").eq("id", runId).maybeSingle();
    if (r?.client_id) await admin.from("clients").update({ status: "active" }).eq("id", r.client_id);
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(5, Math.max(1, parseInt(url.searchParams.get("limit") ?? "3", 10) || 3));

  const admin = createAdminClient();
  const { data: runs } = await admin
    .from("onboarding_runs")
    .select("id,org_id,client_id,template_key,status")
    .not("status", "eq", "archived")
    .order("created_at", { ascending: true });
  const all = runs ?? [];
  const slice = all.slice(offset, offset + limit);

  const results: Record<string, unknown>[] = [];
  for (const run of slice) {
    const { data: client } = await admin.from("clients").select("name").eq("id", run.client_id).maybeSingle();
    const name = client?.name ?? String(run.client_id);
    try {
      const tpl = await getTemplate(run.template_key);
      const step = (tpl?.stages ?? []).flatMap((s) => s.steps).find((st) => st.act?.type === "calendar");
      if (!step) { results.push({ client: name, runId: run.id, outcome: "skipped — no compliance-calendar step" }); continue; }

      const r = await _generateComplianceFromDocsImpl(run.org_id, run.id);
      if (r.error) { results.push({ client: name, runId: run.id, outcome: `error: ${r.error}`, failed: true }); continue; }
      const items = r.items ?? [];

      await admin.from("run_items").delete().eq("run_id", run.id).eq("kind", "compliance");
      if (items.length) {
        await admin.from("run_items").insert(items.map((i) => ({
          run_id: run.id, client_id: run.client_id, kind: "compliance",
          data: { label: i.label, date: i.date, type: i.type, reminderDays: i.reminderDays ?? 30, reminderDate: reminderFromExpiry(i.date) },
          status: "open",
        })));
      }
      await admin.from("run_steps").update({ status: "complete", completed_at: new Date().toISOString() }).eq("run_id", run.id).eq("step_no", step.id);
      await recomputeAdmin(admin, run.id, run.template_key);

      results.push({
        client: name, runId: run.id,
        outcome: items.length ? `done — ${items.length} calendar item(s)` : "done — NO details captured",
        empty: items.length === 0, scanned: r.scanned ?? 0,
      });
    } catch (e) {
      results.push({ client: name, runId: run.id, outcome: `error: ${e instanceof Error ? e.message : String(e)}`, failed: true });
    }
  }

  const nextOffset = offset + limit < all.length ? offset + limit : null;
  return NextResponse.json({ total: all.length, offset, limit, processed: slice.length, nextOffset, results });
}
