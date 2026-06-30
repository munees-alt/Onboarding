import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Weekly AM report cron.
// Schedule: every Monday at 6am UTC (= 10am UAE).
// Creates one admin_tasks row per active AM with kind="am_weekly_report",
// summarising their clients' open / overdue task counts for the week.
// The My Work page surfaces these under Action Items.
// ?force=1 bypasses the Monday check for manual triggers.

const DESCOPED = new Set(["urgent-compliance", "catchup", "compliance-renewal"]);

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const force = new URL(request.url).searchParams.get("force") === "1";
  const isMonday = now.getUTCDay() === 1;
  if (!isMonday && !force) {
    return NextResponse.json({ ok: true, created: 0, note: "not Monday UTC — no-op" });
  }

  const admin = createAdminClient();
  const todayIso = now.toISOString().slice(0, 10);
  const weekLabel = todayIso; // YYYY-MM-DD of this Monday
  let created = 0;

  // 1. Get all orgs
  const { data: orgs } = await admin.from("orgs").select("id");
  if (!orgs?.length) return NextResponse.json({ ok: true, created: 0 });

  for (const org of orgs) {
    const orgId = org.id as string;

    // 2. Fetch active runs for this org
    const { data: runs } = await admin
      .from("onboarding_runs")
      .select("id,client_id,am_id,status,template_key")
      .eq("org_id", orgId)
      .in("status", ["in_progress", "active"]);

    const activeRuns = (runs ?? []).filter((r) => !DESCOPED.has(r.template_key as string));
    if (!activeRuns.length) continue;

    const runIds = activeRuns.map((r) => r.id as string);
    const clientIds = [...new Set(activeRuns.map((r) => r.client_id as string))];

    // 3. Fetch clients and tasks
    const [{ data: clients }, { data: tasks }] = await Promise.all([
      admin.from("clients").select("id,name").in("id", clientIds),
      admin.from("tasks")
        .select("id,run_id,title,status,due_date")
        .in("run_id", runIds),
    ]);

    const clientMap = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));

    // 4. Group runs by AM
    const runsByAm = new Map<string, typeof activeRuns>();
    for (const r of activeRuns) {
      const amId = (r.am_id as string) ?? null;
      if (!amId) continue; // skip unassigned
      (runsByAm.get(amId) ?? (runsByAm.set(amId, []), runsByAm.get(amId)!)).push(r);
    }

    if (!runsByAm.size) continue;

    // 5. Get AM team members
    const amIds = [...runsByAm.keys()];
    const { data: amMembers } = await admin
      .from("team_members")
      .select("id,full_name")
      .in("id", amIds);
    const amMap = new Map((amMembers ?? []).map((m) => [m.id as string, m.full_name as string]));

    // 6. Dedup: skip if we already created a report for this AM this week
    const { data: existing } = await admin
      .from("admin_tasks")
      .select("id,step_id")
      .eq("org_id", orgId)
      .eq("kind", "am_weekly_report")
      .eq("status", "open")
      .gte("created_at", `${weekLabel}T00:00:00Z`);

    const alreadyCreated = new Set((existing ?? []).map((e) => e.step_id as string));

    // 7. Create one admin_task per AM
    for (const [amId, amRuns] of runsByAm) {
      const dedupKey = `am_weekly_${amId}_${weekLabel}`;
      if (alreadyCreated.has(dedupKey)) continue;

      const amName = amMap.get(amId) ?? "AM";
      const amTasks = tasks?.filter((t) => amRuns.some((r) => r.id === t.run_id)) ?? [];
      const openCount = amTasks.filter((t) => t.status !== "complete").length;
      const overdueCount = amTasks.filter((t) => {
        const d = t.due_date as string | null;
        return d && d < todayIso && t.status !== "complete";
      }).length;

      // Build client summary lines
      const clientLines = amRuns.map((r) => {
        const clientName = clientMap.get(r.client_id as string) ?? "Unknown";
        const clientTasks = (tasks ?? []).filter((t) => t.run_id === r.id);
        const open = clientTasks.filter((t) => t.status !== "complete").length;
        const overdue = clientTasks.filter((t) => {
          const d = t.due_date as string | null;
          return d && d < todayIso && t.status !== "complete";
        }).length;
        return `• ${clientName}: ${open} open${overdue ? `, ${overdue} overdue` : ""}`;
      });

      const body = [
        `Week of ${weekLabel}`,
        `${amRuns.length} client${amRuns.length !== 1 ? "s" : ""} · ${openCount} open task${openCount !== 1 ? "s" : ""}${overdueCount ? ` · ${overdueCount} OVERDUE` : ""}`,
        "",
        ...clientLines,
        "",
        `View full report: /am-report`,
      ].join("\n");

      await admin.from("admin_tasks").insert({
        org_id: orgId,
        owner_id: amId,
        kind: "am_weekly_report",
        step_id: dedupKey,
        title: `Weekly task report — ${weekLabel}`,
        body,
        status: "open",
        created_at: now.toISOString(),
      });
      created++;
    }
  }

  return NextResponse.json({ ok: true, created });
}
