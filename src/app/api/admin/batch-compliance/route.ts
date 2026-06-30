import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAi } from "@/lib/ai";

// Batch: generate compliance calendars for all active onboarding runs that
// don't have one yet. Secured by CRON_SECRET.
// GET /api/admin/batch-compliance — dry run (shows what would be generated)
// POST /api/admin/batch-compliance — actually generates and saves
export async function GET(request: NextRequest) {
  return handler(request, false);
}
export async function POST(request: NextRequest) {
  return handler(request, true);
}

async function handler(request: NextRequest, write: boolean) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find all active (non-complete, non-archived) onboarding runs
  const { data: runs } = await admin
    .from("onboarding_runs")
    .select("id,client_id,org_id,template_key")
    .not("status", "in", "(archived,closed,complete)")
    .not("template_key", "eq", "lead-intake");

  if (!runs?.length) return NextResponse.json({ ok: true, processed: 0, message: "No active runs found." });

  // Find which ones already have a compliance calendar
  const runIds = runs.map((r) => r.id);
  const { data: existing } = await admin
    .from("run_items")
    .select("run_id")
    .in("run_id", runIds)
    .eq("kind", "compliance");
  const existingRunIds = new Set((existing ?? []).map((r) => r.run_id as string));

  // Runs that still need a compliance calendar
  const todo = runs.filter((r) => !existingRunIds.has(r.id));
  if (!todo.length) return NextResponse.json({ ok: true, processed: 0, message: "All active runs already have a compliance calendar." });

  if (!write) {
    // Dry run — just report
    const clientIds = todo.map((r) => r.client_id);
    const { data: clients } = await admin.from("clients").select("id,name").in("id", clientIds);
    const nameById = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
    return NextResponse.json({
      dryRun: true,
      count: todo.length,
      runs: todo.map((r) => ({ runId: r.id, clientName: nameById.get(r.client_id) ?? r.client_id, template: r.template_key })),
    });
  }

  // Generate compliance calendar for each run
  let generated = 0;
  let errors = 0;
  const results: { runId: string; clientName: string; ok: boolean; itemCount?: number; error?: string }[] = [];

  for (const run of todo) {
    try {
      const { data: client } = await admin
        .from("clients")
        .select("name,vat_registered,ct_registered,entity_type,established_year,reg_facts")
        .eq("id", run.client_id)
        .maybeSingle();
      if (!client) { errors++; results.push({ runId: run.id, clientName: run.client_id, ok: false, error: "client not found" }); continue; }

      const reg = (client.reg_facts as { tradeLicenceExpiry?: string; vatFirstFiling?: string; ctFirstFiling?: string } | null) ?? {};

      const prompt =
        `Generate a 12-month UAE compliance calendar as a JSON array. Each item: {"label":"<description>","type":"VAT|CT|WPS|Trade Licence|Other","date":"YYYY-MM-DD","reminderDays":30}.\n` +
        `Rules: VAT quarterly returns due 28 days after each quarter-end; Corporate Tax annual return due 9 months after financial year-end; WPS monthly salary transfer; trade licence + establishment card annual renewals.\n` +
        `Client: ${client.name}; VAT ${client.vat_registered ? "registered" : "not registered"}; CT ${client.ct_registered ? "registered" : "not registered"}; entity ${client.entity_type ?? "n/a"}; established ${(client as { established_year?: number }).established_year ?? "unknown"}.\n` +
        `Trade licence expiry: ${reg.tradeLicenceExpiry ?? "unknown"}. VAT first filing: ${reg.vatFirstFiling ?? "unknown"}. CT first filing: ${reg.ctFirstFiling ?? "unknown"}.\n` +
        `Today is ${new Date().toISOString().split("T")[0]}. Return 6–10 upcoming items. Output ONLY the JSON array, no prose.`;

      const raw = await runAi(run.org_id, "handover_summary", {
        runId: run.id,
        system: "You are a UAE compliance expert. Output ONLY a valid JSON array. No markdown, no prose, no explanation.",
        prompt,
      });

      // Parse the JSON array
      let items: { label: string; type: string; date: string; reminderDays: number }[] = [];
      try {
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) items = JSON.parse(match[0]);
      } catch {
        errors++;
        results.push({ runId: run.id, clientName: client.name, ok: false, error: "JSON parse failed" });
        continue;
      }

      if (!items.length) { errors++; results.push({ runId: run.id, clientName: client.name, ok: false, error: "no items returned" }); continue; }

      // Insert each item as a separate run_items row (same pattern as the UI)
      const rows = items.map((item) => ({
        run_id: run.id,
        client_id: run.client_id,
        kind: "compliance",
        data: { label: item.label, type: item.type, date: item.date, reminderDays: item.reminderDays ?? 30 },
      }));
      await admin.from("run_items").insert(rows);

      generated++;
      results.push({ runId: run.id, clientName: client.name, ok: true, itemCount: items.length });
    } catch (e) {
      errors++;
      results.push({ runId: run.id, clientName: run.client_id, ok: false, error: String(e) });
    }
  }

  return NextResponse.json({ ok: true, generated, errors, total: todo.length, results });
}
