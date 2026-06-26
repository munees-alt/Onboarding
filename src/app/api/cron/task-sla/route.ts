import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRunFromTemplate } from "@/lib/runs";

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
  // Task-board SLA reminders (may be empty — the compliance scan below still runs).
  const { data: slaRowsRaw } = await admin.from("run_items").select("run_id,data").eq("kind", "task_sla");
  const slaRows = slaRowsRaw ?? [];

  const now = Date.now();
  const DAY = 86_400_000;
  let notified = 0;

  for (const row of slaRows) {
    const cfg = (row.data ?? {}) as { notStartedDays?: number; notCompletedDays?: number };
    const notStartedDays = cfg.notStartedDays ?? 0;
    const notCompletedDays = cfg.notCompletedDays ?? 0;
    if (!notStartedDays && !notCompletedDays) continue;

    const { data: run } = await admin.from("onboarding_runs").select("org_id,am_id,client_id,status,blocked_reason").eq("id", row.run_id).maybeSingle();
    if (!run?.am_id || run.status === "complete" || run.status === "closed") continue;
    // Blocked runs pause the SLA clock — the AM has flagged that they're
    // waiting on something they can't action (catch-up, client docs, etc.).
    if (run.blocked_reason) continue;
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

  // ── Compliance calendar ──
  //   • 14-day heads-up notification to the AM (deduped via data.notified)
  //   • On/after the due date → auto-create a lightweight RENEWAL run (one task, no config)
  //     in the AM's My Work (deduped via data.renewalCreated)
  let complianceAlerts = 0;
  let complianceAdminTasks = 0;
  let renewalRuns = 0;
  const { data: compRows } = await admin.from("run_items").select("id,run_id,data").eq("kind", "compliance");
  const infoByRun = new Map<string, { am: string | null; org: string; clientId: string; name: string; blocked: boolean } | null>();
  const resolve = async (runId: string) => {
    if (infoByRun.has(runId)) return infoByRun.get(runId)!;
    const { data: run } = await admin.from("onboarding_runs").select("am_id,org_id,client_id,blocked_reason").eq("id", runId).maybeSingle();
    if (!run) { infoByRun.set(runId, null); return null; }
    const { data: cl } = await admin.from("clients").select("name").eq("id", run.client_id).maybeSingle();
    const info = { am: run.am_id, org: run.org_id, clientId: run.client_id, name: cl?.name ?? "a client", blocked: !!run.blocked_reason };
    infoByRun.set(runId, info);
    return info;
  };

  // Resolve & memoise the master admin (team_members.role='admin', active) per org.
  const masterByOrg = new Map<string, string | null>();
  const resolveMaster = async (orgId: string): Promise<string | null> => {
    if (masterByOrg.has(orgId)) return masterByOrg.get(orgId) ?? null;
    const { data } = await admin
      .from("team_members")
      .select("id")
      .eq("org_id", orgId)
      .eq("role", "admin")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const id = data?.id ?? null;
    masterByOrg.set(orgId, id);
    return id;
  };

  for (const row of compRows ?? []) {
    const d = (row.data ?? {}) as { date?: string; label?: string; type?: string; notified?: boolean; renewalCreated?: boolean; reminderDays?: string | number };
    if (!d.date) continue;
    const due = new Date(d.date).getTime();
    if (isNaN(due)) continue;
    const daysToDue = (due - now) / DAY;
    const label = d.label ?? d.type ?? "A filing";
    // Per-row reminder offset (days before the due date). Default 30 — i.e.
    // one month ahead — so the team has a full month to chase the client.
    const reminderDays = Math.max(1, Math.floor(Number(d.reminderDays) || 30));

    // 1) Heads-up while it's within the per-row reminder window.
    if (daysToDue <= reminderDays && daysToDue > 0 && !d.notified) {
      const info = await resolve(row.run_id);
      if (info?.blocked) continue; // run is paused upstream — don't nag the team
      if (info?.am) {
        await admin.from("notifications").insert({
          org_id: info.org, run_id: row.run_id, recipient_id: info.am, kind: "escalation",
          title: `Compliance due soon · ${info.name}`,
          body: `${label} is due ${d.date}. Update the file in Drive / file on time.`,
        });
        await admin.from("run_items").update({ data: { ...d, notified: true } }).eq("id", row.id);
        complianceAlerts++;
      }

      // ALSO surface to Action Items (My Tasks) — fan out to master admin + run AM.
      // Dedupe against any open admin_task with (kind=compliance_alert, run_id, owner_id).
      const infoForAdmin = await resolve(row.run_id);
      if (infoForAdmin) {
        const masterId = await resolveMaster(infoForAdmin.org);
        const ownerIds = Array.from(new Set([masterId, infoForAdmin.am].filter((v): v is string => !!v)));
        for (const ownerId of ownerIds) {
          const { data: existing } = await admin
            .from("admin_tasks")
            .select("id")
            .eq("kind", "compliance_alert")
            .eq("run_id", row.run_id)
            .eq("owner_id", ownerId)
            .eq("status", "open")
            .limit(1)
            .maybeSingle();
          if (existing) continue;
          const daysCeil = Math.ceil(daysToDue);
          const title = `Compliance expiry approaching · ${label} for ${infoForAdmin.name}`;
          const body = `${label} is due ${d.date} (in ${daysCeil} day(s)). Type: ${d.type ?? "compliance"}.`;
          await admin.from("admin_tasks").insert({
            org_id: infoForAdmin.org,
            owner_id: ownerId,
            kind: "compliance_alert",
            run_id: row.run_id,
            client_id: infoForAdmin.clientId,
            step_id: null,
            title,
            body,
          });
          complianceAdminTasks++;
        }
      }
    }

    // 2) Due date reached → create the renewal task (once).
    if (daysToDue <= 0 && !d.renewalCreated) {
      const info = await resolve(row.run_id);
      if (info?.blocked) continue; // don't spawn a renewal task while upstream is blocked
      if (info) {
        const newRunId = await createRunFromTemplate(admin, {
          orgId: info.org, clientId: info.clientId, amId: info.am ?? null,
          templateId: "compliance-renewal", targetCompletion: d.date,
        });
        await admin.from("run_items").insert({ run_id: newRunId, client_id: info.clientId, kind: "renewal_for", data: { label, type: d.type ?? null, date: d.date } });
        if (info.am) {
          await admin.from("notifications").insert({
            org_id: info.org, run_id: newRunId, recipient_id: info.am, kind: "escalation",
            title: `Renewal due: ${label}`,
            body: `${label} reached its due date (${d.date}). A renewal task was created in your My Work.`,
          });
        }
        await admin.from("run_items").update({ data: { ...d, renewalCreated: true } }).eq("id", row.id);
        renewalRuns++;
      }
    }
  }

  // ── Onboarding stage SLA ──
  //   For every active run, if the current stage's targetDays is set on the
  //   template, compute days since stage started. Stage 1 starts at
  //   run.started_at; stage N starts at the latest completed_at of any step in
  //   the previous stage. If days-in-stage > targetDays, notify the AM once
  //   per (run, stage), deduped via run_items kind 'stage_sla_notified'
  //   sort=stage_no.
  let stageBreaches = 0;
  const { getTemplate } = await import("@/lib/templates-store");
  const { data: activeRuns } = await admin
    .from("onboarding_runs")
    .select("id,template_key,org_id,am_id,client_id,started_at,current_stage,status,blocked_reason")
    .not("status", "in", "(archived,closed,complete)");
  for (const run of activeRuns ?? []) {
    if (!run.am_id || !run.template_key) continue;
    // Skip blocked runs — the AM has flagged they're waiting on upstream work.
    if ((run as { blocked_reason?: string | null }).blocked_reason) continue;
    const tpl = await getTemplate(run.template_key);
    const stage = tpl?.stages[(run.current_stage as number) - 1];
    if (!stage || !stage.targetDays) continue;

    let stageStart: number | null = null;
    if (run.current_stage === 1) {
      stageStart = run.started_at ? new Date(run.started_at).getTime() : null;
    } else {
      const prevStageIds = (tpl?.stages.slice(0, (run.current_stage as number) - 1) ?? []).flatMap((s) => s.steps.map((st) => st.id));
      if (prevStageIds.length) {
        const { data: prevSteps } = await admin
          .from("run_steps")
          .select("completed_at")
          .eq("run_id", run.id)
          .in("step_no", prevStageIds)
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .limit(1);
        stageStart = prevSteps?.[0]?.completed_at ? new Date(prevSteps[0].completed_at).getTime() : null;
      }
    }
    if (!stageStart) continue;

    const daysInStage = (now - stageStart) / DAY;
    if (daysInStage <= stage.targetDays) continue;

    const { data: already } = await admin
      .from("run_items")
      .select("id")
      .eq("run_id", run.id)
      .eq("kind", "stage_sla_notified")
      .eq("sort", run.current_stage as number)
      .limit(1)
      .maybeSingle();
    if (already) continue;

    const { data: client } = await admin.from("clients").select("name").eq("id", run.client_id).maybeSingle();
    await admin.from("notifications").insert({
      org_id: run.org_id, run_id: run.id, recipient_id: run.am_id, kind: "escalation",
      title: `Stage SLA breached · ${client?.name ?? "client"}`,
      body: `Stage "${stage.name}" has been active ${Math.floor(daysInStage)}d (target ${stage.targetDays}d). Push it forward or update the target.`,
    });
    await admin.from("run_items").insert({
      run_id: run.id, client_id: run.client_id, kind: "stage_sla_notified",
      data: { stageId: stage.id, stageNo: run.current_stage, daysInStage: Math.floor(daysInStage), targetDays: stage.targetDays, at: new Date().toISOString() },
      status: "notified", sort: run.current_stage as number,
    });
    stageBreaches++;
  }

  return NextResponse.json({ ok: true, notified, complianceAlerts, complianceAdminTasks, renewalRuns, stageBreaches, runs: slaRows.length });
}
