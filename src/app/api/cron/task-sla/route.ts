import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily scan: for every run with task-board SLA reminders configured, notify the
// AM about tasks that haven't been started or finished in time. Deduped via
// tasks.sla_notified so the AM isn't pinged repeatedly for the same task.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: slaRows } = await admin.from("run_items").select("run_id,data").eq("kind", "task_sla");
  if (!slaRows?.length) return NextResponse.json({ ok: true, notified: 0, runs: 0 });

  const now = Date.now();
  const DAY = 86_400_000;
  let notified = 0;

  for (const row of slaRows) {
    const cfg = (row.data ?? {}) as { notStartedDays?: number; notCompletedDays?: number };
    const notStartedDays = cfg.notStartedDays ?? 0;
    const notCompletedDays = cfg.notCompletedDays ?? 0;
    if (!notStartedDays && !notCompletedDays) continue;

    const { data: run } = await admin.from("onboarding_runs").select("org_id,am_id,client_id,status").eq("id", row.run_id).maybeSingle();
    if (!run?.am_id || run.status === "complete" || run.status === "closed") continue;
    const { data: client } = await admin.from("clients").select("name").eq("id", run.client_id).maybeSingle();
    const clientName = client?.name ?? "a client";

    const { data: tasks } = await admin.from("tasks").select("id,title,status,created_at,sla_notified").eq("run_id", row.run_id);
    for (const t of tasks ?? []) {
      if (t.status === "complete") continue;
      const ageDays = (now - new Date(t.created_at).getTime()) / DAY;

      // Overdue (not completed in time) — highest priority.
      if (notCompletedDays && ageDays >= notCompletedDays && t.sla_notified !== "overdue") {
        await admin.from("notifications").insert({
          org_id: run.org_id, run_id: row.run_id, recipient_id: run.am_id, kind: "escalation",
          title: `Task overdue · ${clientName}`, body: `"${t.title}" still isn't done after ${Math.floor(ageDays)} day(s).`,
        });
        await admin.from("tasks").update({ sla_notified: "overdue" }).eq("id", t.id);
        notified++;
        continue;
      }
      // Not started in time.
      if (notStartedDays && t.status === "not_started" && ageDays >= notStartedDays && !t.sla_notified) {
        await admin.from("notifications").insert({
          org_id: run.org_id, run_id: row.run_id, recipient_id: run.am_id, kind: "escalation",
          title: `Task not started · ${clientName}`, body: `"${t.title}" hasn't been started after ${Math.floor(ageDays)} day(s).`,
        });
        await admin.from("tasks").update({ sla_notified: "not_started" }).eq("id", t.id);
        notified++;
      }
    }
  }

  // ── Compliance calendar: alert the AM when a filing/renewal is within 14 days ──
  let complianceAlerts = 0;
  const { data: compRows } = await admin.from("run_items").select("id,run_id,data").eq("kind", "compliance");
  const amByRun = new Map<string, { am: string | null; org: string; name: string }>();
  for (const row of compRows ?? []) {
    const d = (row.data ?? {}) as { date?: string; label?: string; type?: string; notified?: boolean };
    if (!d.date || d.notified) continue;
    const due = new Date(d.date).getTime();
    if (isNaN(due)) continue;
    const daysToDue = (due - now) / DAY;
    if (daysToDue > 14 || daysToDue < -1) continue; // only the 14-day window (and just-passed)

    let info = amByRun.get(row.run_id);
    if (!info) {
      const { data: run } = await admin.from("onboarding_runs").select("am_id,org_id,client_id").eq("id", row.run_id).maybeSingle();
      if (!run) continue;
      const { data: cl } = await admin.from("clients").select("name").eq("id", run.client_id).maybeSingle();
      info = { am: run.am_id, org: run.org_id, name: cl?.name ?? "a client" };
      amByRun.set(row.run_id, info);
    }
    if (!info.am) continue;
    await admin.from("notifications").insert({
      org_id: info.org, run_id: row.run_id, recipient_id: info.am, kind: "escalation",
      title: `Compliance due soon · ${info.name}`,
      body: `${d.label ?? d.type ?? "A filing"} is due ${d.date}. Update the file in Drive / file on time.`,
    });
    await admin.from("run_items").update({ data: { ...d, notified: true } }).eq("id", row.id);
    complianceAlerts++;
  }

  return NextResponse.json({ ok: true, notified, complianceAlerts, runs: slaRows.length });
}
