import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertConsolidatedComplianceTask } from "@/lib/compliance-tasks";

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
  //   • On/after the due date → add a renewal line to the AM's Compliance action
  //     item (no run, no template — just a task), deduped via data.renewalCreated
  let complianceAlerts = 0;
  let complianceAdminTasks = 0;
  let renewalTasks = 0;
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

  // Resolve & memoise org-level compliance reminder days from followup_config.
  const orgCompReminderDays = new Map<string, number>();
  const getCompReminderDays = async (orgId: string): Promise<number> => {
    if (orgCompReminderDays.has(orgId)) return orgCompReminderDays.get(orgId)!;
    const { data: cfg } = await admin.from("followup_config").select("compliance_reminder_days").eq("org_id", orgId).maybeSingle();
    const d = (cfg as { compliance_reminder_days?: number | null } | null)?.compliance_reminder_days ?? 30;
    orgCompReminderDays.set(orgId, d);
    return d;
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

  // Resolve & memoise the run's team member(s) + Team Lead. Compliance items
  // fan out to Team Member(s) + Team Lead + AM together — Ops Head / Master
  // Admin only see it via the escalation chain if the AM lets it sit.
  const runRosterCache = new Map<string, { members: string[]; teamLead: string | null }>();
  const resolveRunRoster = async (runId: string): Promise<{ members: string[]; teamLead: string | null }> => {
    if (runRosterCache.has(runId)) return runRosterCache.get(runId)!;
    const { data: rows } = await admin.from("run_team").select("team_member_id,role_in_run").eq("run_id", runId);
    const members: string[] = [];
    let teamLead: string | null = null;
    for (const r of rows ?? []) {
      if (r.role_in_run === "team_lead") teamLead = r.team_member_id as string;
      else if (r.role_in_run !== "am") members.push(r.team_member_id as string);
    }
    const roster = { members, teamLead };
    runRosterCache.set(runId, roster);
    return roster;
  };

  for (const row of compRows ?? []) {
    const d = (row.data ?? {}) as { date?: string; label?: string; type?: string; notified?: boolean; renewalCreated?: boolean; reminderDays?: string | number };
    if (!d.date) continue;
    const due = new Date(d.date).getTime();
    if (isNaN(due)) continue;
    const daysToDue = (due - now) / DAY;
    const label = d.label ?? d.type ?? "A filing";
    // Per-row reminder offset falls back to org-level followup_config setting.
    const rowInfo = await resolve(row.run_id);
    const orgDefault = rowInfo ? await getCompReminderDays(rowInfo.org) : 30;
    const reminderDays = Math.max(1, Number(d.reminderDays) > 0 ? Math.floor(Number(d.reminderDays)) : orgDefault);

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

      // ALSO surface to Action Items (My Tasks) — fan out to Team Member(s) +
      // Team Lead + AM together. Consolidated: append to the single open
      // kind=compliance chip per (owner, client); create it only if none exists.
      const infoForAdmin = await resolve(row.run_id);
      if (infoForAdmin) {
        const roster = await resolveRunRoster(row.run_id);
        const ownerIds = Array.from(new Set([...roster.members, roster.teamLead, infoForAdmin.am].filter((v): v is string => !!v)));
        const daysCeil = Math.ceil(daysToDue);
        const lineForChip = `${infoForAdmin.name} · ${label} — due ${d.date} (${daysCeil}d)`;
        for (const ownerId of ownerIds) {
          const res = await upsertConsolidatedComplianceTask(admin, {
            orgId: infoForAdmin.org,
            ownerId,
            line: lineForChip,
            clientId: infoForAdmin.clientId,
            runId: row.run_id,
            source: "compliance_alert",
          });
          if (res.mode === "created" || res.mode === "appended") complianceAdminTasks++;
        }
      }
    }

    // 2) Due date reached → add a renewal line to the Compliance action item (once).
    if (daysToDue <= 0 && !d.renewalCreated) {
      const info = await resolve(row.run_id);
      if (info?.blocked) continue; // don't nag while upstream is blocked
      if (info) {
        const daysOverdue = Math.floor(-daysToDue);
        const roster = await resolveRunRoster(row.run_id);
        const ownerIds = Array.from(new Set([...roster.members, roster.teamLead, info.am].filter((v): v is string => !!v)));
        const lineForChip = `${info.name} · ${label} — overdue by ${daysOverdue}d, renew & update Drive/expiry`;
        for (const ownerId of ownerIds) {
          const res = await upsertConsolidatedComplianceTask(admin, {
            orgId: info.org, ownerId, line: lineForChip, clientId: info.clientId, runId: row.run_id, source: "compliance_renewal",
          });
          if (res.mode === "created" || res.mode === "appended") renewalTasks++;
        }
        if (info.am) {
          await admin.from("notifications").insert({
            org_id: info.org, run_id: row.run_id, recipient_id: info.am, kind: "escalation",
            title: `Renewal due: ${label}`,
            body: `${label} reached its due date (${d.date}). An action item was added to your My Work.`,
          });
        }
        await admin.from("run_items").update({ data: { ...d, renewalCreated: true } }).eq("id", row.id);
      }
    }
  }

  // ── Onboarding stage SLA ──
  //   For every active run, compute days since the current stage started
  //   (the template's targetDays if set, else a flat 10-day fallback so every
  //   stage is covered even without an explicit target). Stage 1 starts at
  //   run.started_at; stage N starts at the latest completed_at of any step in
  //   the previous stage. If days-in-stage > targetDays, notify the AM AND
  //   create a Master Admin action item, once per (run, stage), deduped via
  //   run_items kind 'stage_sla_notified' sort=stage_no.
  const STAGE_SLA_FALLBACK_DAYS = 10;
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
    if (!stage) continue;
    const targetDays = stage.targetDays ?? STAGE_SLA_FALLBACK_DAYS;

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
    if (daysInStage <= targetDays) continue;

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
    const clientName = client?.name ?? "client";
    await admin.from("notifications").insert({
      org_id: run.org_id, run_id: run.id, recipient_id: run.am_id, kind: "escalation",
      title: `Stage SLA breached · ${clientName}`,
      body: `Stage "${stage.name}" has been active ${Math.floor(daysInStage)}d (target ${targetDays}d). Push it forward or update the target.`,
    });
    const stageMasterId = await resolveMaster(run.org_id);
    if (stageMasterId) {
      await admin.from("admin_tasks").insert({
        org_id: run.org_id,
        owner_id: stageMasterId,
        kind: "onboarding_sla",
        run_id: run.id,
        client_id: run.client_id,
        title: `Onboarding SLA crossed · ${clientName}`,
        body: `Stage "${stage.name}" has been active ${Math.floor(daysInStage)}d (target ${targetDays}d), owned by ${run.am_id === stageMasterId ? "you" : "the AM"}. Follow up.`,
      });
    }
    await admin.from("run_items").insert({
      run_id: run.id, client_id: run.client_id, kind: "stage_sla_notified",
      data: { stageId: stage.id, stageNo: run.current_stage, daysInStage: Math.floor(daysInStage), targetDays, at: new Date().toISOString() },
      status: "notified", sort: run.current_stage as number,
    });
    stageBreaches++;
  }

  // ── Team task pending alert ──
  //   For every incomplete team task (owner_kind='team' or client_visible=false)
  //   that has been pending longer than the org's task_pending_sla_days threshold,
  //   surface an admin_task of kind 'task_pending_alert' for the AM of that run.
  //   Deduped per (run_id, task_id) — one alert per task, not per day.
  let taskPendingAlerts = 0;
  const orgPendingSla = new Map<string, number>(); // org_id → sla_days
  const getTaskPendingSla = async (orgId: string): Promise<number> => {
    if (orgPendingSla.has(orgId)) return orgPendingSla.get(orgId)!;
    const { data: cfg } = await admin.from("followup_config").select("task_pending_sla_days").eq("org_id", orgId).maybeSingle();
    const days = (cfg as { task_pending_sla_days?: number | null } | null)?.task_pending_sla_days ?? 3;
    orgPendingSla.set(orgId, days);
    return days;
  };

  const { data: pendingTaskRuns } = await admin
    .from("onboarding_runs")
    .select("id,org_id,am_id,client_id,status,blocked_reason")
    .not("status", "in", "(archived,closed,complete)");

  for (const run of pendingTaskRuns ?? []) {
    if (!run.am_id) continue;
    if ((run as { blocked_reason?: string | null }).blocked_reason) continue;
    const slaDays = await getTaskPendingSla(run.org_id);
    const cutoffTs = new Date(now - slaDays * DAY).toISOString();

    const { data: staleTasks } = await admin
      .from("tasks")
      .select("id,title,created_at")
      .eq("run_id", run.id)
      .neq("status", "complete")
      .eq("client_visible", false)
      .lt("created_at", cutoffTs);

    for (const t of staleTasks ?? []) {
      // Dedupe: skip if an open admin_task of kind task_pending_alert exists for this task
      const { data: existingAlert } = await admin
        .from("admin_tasks")
        .select("id")
        .eq("kind", "task_pending_alert")
        .eq("run_id", run.id)
        .eq("step_id", t.id)
        .eq("status", "open")
        .maybeSingle();
      if (existingAlert) continue;

      const { data: cl } = await admin.from("clients").select("name").eq("id", run.client_id).maybeSingle();
      const clientName = cl?.name ?? "a client";
      const ageDays = Math.floor((now - new Date(t.created_at).getTime()) / DAY);
      await admin.from("admin_tasks").insert({
        org_id: run.org_id,
        owner_id: run.am_id,
        kind: "task_pending_alert",
        run_id: run.id,
        client_id: run.client_id,
        step_id: t.id,
        title: `Team task pending · ${clientName}`,
        body: `"${t.title}" has been pending for ${ageDays} day(s) (threshold: ${slaDays}d). Check the task board.`,
      });
      taskPendingAlerts++;
    }
  }

  // ── AML not added check ──
  //   For every client with status='onboarding' whose onboarding run was
  //   created more than 1 week ago, check if a row exists in aml_records.
  //   If there is NO row at all (client hasn't been pushed into the AML panel),
  //   surface an action item for the master admin + AM.
  let amlUnassigned = 0;
  const AML_DAYS = 7;
  const cutoff = new Date(now - AML_DAYS * DAY).toISOString();

  // Get all signed (onboarding) clients
  const { data: onboardingClients } = await admin
    .from("clients")
    .select("id,name,org_id,am_id")
    .eq("status", "onboarding");

  for (const cl of onboardingClients ?? []) {
    if (!cl.org_id) continue;

    // Find the earliest real (non-lead-intake) onboarding run for this client
    const { data: runRows } = await admin
      .from("onboarding_runs")
      .select("id,created_at,am_id")
      .eq("client_id", cl.id)
      .not("template_key", "eq", "lead-intake")
      .not("status", "in", "(archived,closed)")
      .order("created_at", { ascending: true })
      .limit(1);
    const run = runRows?.[0];
    if (!run) continue;

    // Only flag once 10 days have passed since the run was created (Mark Signed)
    if (run.created_at >= cutoff) continue;

    // Check if the client already has ANY aml_records row
    const { data: amlRow } = await admin
      .from("aml_records")
      .select("id")
      .eq("client_id", cl.id)
      .maybeSingle();
    if (amlRow) continue; // already in AML panel — skip

    // Dedupe: skip if an open admin_task of kind aml_unassigned already exists
    const { data: existing } = await admin
      .from("admin_tasks")
      .select("id")
      .eq("kind", "aml_unassigned")
      .eq("client_id", cl.id)
      .eq("status", "open")
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const amId = run.am_id ?? cl.am_id;
    const masterId = await resolveMaster(cl.org_id);
    const ownerIds = Array.from(new Set([masterId, amId].filter((v): v is string => !!v)));
    for (const ownerId of ownerIds) {
      await admin.from("admin_tasks").insert({
        org_id: cl.org_id,
        owner_id: ownerId,
        kind: "aml_unassigned",
        run_id: run.id,
        client_id: cl.id,
        step_id: null,
        title: `AML not added · ${cl.name}`,
        body: `${cl.name} was signed and onboarding started over ${AML_DAYS} days ago, but they have not been added to the AML Compliance panel yet. Go to AML → add the client.`,
      });
    }
    amlUnassigned++;
  }

  // Team task escalation lives in one place only — the admin-tasks cron's
  // chain-based escalation (Team Member → Team Lead → AM → Ops Head + Master
  // Admin), which is already project-wide across every admin_task kind. A
  // second reports_to-based escalator used to run here too and double-fired
  // escalations for the same task; removed (2026-07-02).

  return NextResponse.json({ ok: true, notified, complianceAlerts, complianceAdminTasks, renewalTasks, stageBreaches, taskPendingAlerts, amlUnassigned, runs: slaRows.length });
}
