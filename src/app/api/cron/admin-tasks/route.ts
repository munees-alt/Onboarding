import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Daily scan that creates / re-creates auto follow-up tasks for the org's
// master admin AND for the run's AM when key onboarding milestones stall.
// Surfaced in /my-work under "My Tasks".
//
//   • zoho_followup     — Zoho Books setup still incomplete > 1 day from run start
//   • ct_reg_followup   — Corporate Tax registration run not closed > 2 days
//   • vat_reg_followup  — VAT registration run not closed > 2 days
//   • docs_overdue      — any required doc still pending > docs_overdue_days
//   • access_overdue    — any access item not confirmed > access_overdue_days
//   • task_overdue      — any task with due_date in the past + task_overdue_days
//
// SLA windows live in followup_config (Master Admin only, /settings). When a
// follow-up note is added to the doc / access item / task, the effective
// deadline becomes max(created_at, followup_note_at) plus max(window,
// note_extension_days) — so adding a note pushes the next auto-task back.

type Kind =
  | "zoho_followup"
  | "ct_reg_followup"
  | "vat_reg_followup"
  | "docs_overdue"
  | "access_overdue"
  | "task_overdue";

// Per-kind fallback window in days when no followup_config row exists.
const DEFAULT_WINDOW_DAYS: Record<Kind, number> = {
  zoho_followup: 1,
  ct_reg_followup: 2,
  vat_reg_followup: 2,
  docs_overdue: 2,
  access_overdue: 2,
  task_overdue: 0,
};

// Templates that explicitly do NOT participate in docs/access overdue scans —
// they are urgent compliance pushes that live in My Work, not Onboarding.
const DESCOPED_TEMPLATES = new Set([
  "urgent-compliance",
  "catchup",
  "compliance-renewal",
]);

// Which step in each onboarding template is the "Zoho Books setup".
const ZOHO_STEP_BY_TEMPLATE: Record<string, string> = {
  medium_team: "t3.3",
  micro_team: "m3.3",
};

type AdminTaskRow = {
  id: string;
  org_id: string;
  owner_id: string;
  kind: string;
  run_id: string | null;
  client_id: string | null;
  step_id: string | null;
  title: string;
  body: string | null;
  status: string;
  notes: string | null;
  history: unknown;
  closed_at: string | null;
};

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = Date.now();
  const DAY = 86_400_000;
  const created: string[] = [];

  // Resolve the master-admin owner per org.
  const { data: orgs } = await admin.from("orgs").select("id");
  const orgIds = (orgs ?? []).map((o) => o.id);
  const ownerByOrg = new Map<string, { id: string; name: string }>();
  for (const orgId of orgIds) {
    const { data: linked } = await admin
      .from("profiles")
      .select("team_member_id,team_members!inner(id,full_name,role,active,org_id)")
      .eq("role", "admin")
      .eq("team_members.org_id", orgId)
      .eq("team_members.active", true)
      .eq("team_members.role", "admin")
      .order("created_at", { ascending: true })
      .limit(1);
    type LinkedRow = { team_members: { id: string; full_name: string } | { id: string; full_name: string }[] };
    const tm = ((linked as LinkedRow[] | null) ?? [])[0]?.team_members;
    const picked = Array.isArray(tm) ? tm[0] : tm;
    if (picked) {
      ownerByOrg.set(orgId, { id: picked.id, name: picked.full_name });
      continue;
    }
    const { data } = await admin
      .from("team_members")
      .select("id,full_name")
      .eq("org_id", orgId)
      .eq("role", "admin")
      .eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) ownerByOrg.set(orgId, { id: data.id, name: data.full_name });
  }
  if (!ownerByOrg.size) {
    return NextResponse.json({ ok: true, note: "no admin owner found in any org", created: 0 });
  }

  // Per-org config (windows in ms + note-extension window in ms).
  const cfgByOrg = new Map<string, { window: Record<Kind, number>; noteExtMs: number }>();
  for (const orgId of orgIds) {
    const { data } = await admin
      .from("followup_config")
      .select("docs_overdue_days,access_overdue_days,task_overdue_days,note_extension_days")
      .eq("org_id", orgId)
      .maybeSingle();
    const docsDays = data?.docs_overdue_days ?? DEFAULT_WINDOW_DAYS.docs_overdue;
    const accessDays = data?.access_overdue_days ?? DEFAULT_WINDOW_DAYS.access_overdue;
    const taskDays = data?.task_overdue_days ?? DEFAULT_WINDOW_DAYS.task_overdue;
    const noteExtDays = data?.note_extension_days ?? 2;
    cfgByOrg.set(orgId, {
      window: {
        zoho_followup: DEFAULT_WINDOW_DAYS.zoho_followup * DAY,
        ct_reg_followup: DEFAULT_WINDOW_DAYS.ct_reg_followup * DAY,
        vat_reg_followup: DEFAULT_WINDOW_DAYS.vat_reg_followup * DAY,
        docs_overdue: docsDays * DAY,
        access_overdue: accessDays * DAY,
        task_overdue: taskDays * DAY,
      },
      noteExtMs: noteExtDays * DAY,
    });
  }
  const winFor = (orgId: string, k: Kind) => (cfgByOrg.get(orgId)?.window[k] ?? DEFAULT_WINDOW_DAYS[k] * DAY);
  const noteExt = (orgId: string) => (cfgByOrg.get(orgId)?.noteExtMs ?? 2 * DAY);

  // Pull existing task rows once for dedupe per (kind, run, owner).
  const { data: openTasksRaw } = await admin
    .from("admin_tasks")
    .select("id,kind,run_id,owner_id,closed_at,status,history,notes,org_id,client_id,step_id,title,body")
    .in("status", ["open", "closed"]);
  const openByKey = new Map<string, AdminTaskRow & { id: string }>();
  const lastClosedByKey = new Map<string, AdminTaskRow & { id: string }>();
  for (const r of (openTasksRaw ?? []) as Array<AdminTaskRow & { id: string }>) {
    const key = `${r.kind}::${r.run_id ?? ""}::${r.owner_id}`;
    if (r.status === "open") openByKey.set(key, r);
    else if (r.status === "closed") {
      const prior = lastClosedByKey.get(key);
      if (!prior || (prior.closed_at && r.closed_at && new Date(r.closed_at) > new Date(prior.closed_at))) {
        lastClosedByKey.set(key, r);
      }
    }
  }

  const insertTask = async (input: {
    org_id: string;
    owner_id: string;
    kind: Kind;
    run_id: string;
    client_id: string | null;
    step_id?: string | null;
    title: string;
    body: string;
  }) => {
    const key = `${input.kind}::${input.run_id}::${input.owner_id}`;
    if (openByKey.has(key)) return; // already open for this owner
    const prior = lastClosedByKey.get(key);
    if (prior?.closed_at) {
      const age = now - new Date(prior.closed_at).getTime();
      if (age < winFor(input.org_id, input.kind)) return; // wait out the window
    }
    const history = Array.isArray(prior?.history) ? prior!.history : [];
    const carry = prior?.notes ? [...history, { at: prior.closed_at, action: "closed_with_notes", notes: prior.notes }] : history;
    const { data } = await admin
      .from("admin_tasks")
      .insert({
        org_id: input.org_id,
        owner_id: input.owner_id,
        kind: input.kind,
        run_id: input.run_id,
        client_id: input.client_id,
        step_id: input.step_id ?? null,
        title: input.title,
        body: input.body,
        history: carry,
        last_recreated_at: prior ? new Date().toISOString() : null,
      })
      .select("id")
      .maybeSingle();
    if (data?.id) {
      created.push(data.id);
      await admin.from("notifications").insert({
        org_id: input.org_id,
        run_id: input.run_id,
        recipient_id: input.owner_id,
        kind: "escalation",
        title: input.title,
        body: input.body.slice(0, 240),
      });
    }
  };

  // Fan a task out to (master admin, run AM) — deduped against the same key.
  const fanOut = async (input: { org_id: string; kind: Kind; run_id: string; client_id: string | null; step_id?: string | null; title: string; body: string; am_id: string | null }) => {
    const masterOwner = ownerByOrg.get(input.org_id);
    if (masterOwner) {
      await insertTask({ ...input, owner_id: masterOwner.id });
    }
    if (input.am_id && input.am_id !== masterOwner?.id) {
      await insertTask({ ...input, owner_id: input.am_id });
    }
  };

  // ── 1) Zoho Books setup followup ──
  // Blocked runs are excluded everywhere — the AM has flagged that work is
  // paused upstream (catch-up incomplete, client docs pending, etc.) and they
  // shouldn't be chased for what isn't their fault.
  const { data: mainRuns } = await admin
    .from("onboarding_runs")
    .select("id,org_id,client_id,template_key,created_at,status,am_id")
    .in("template_key", Object.keys(ZOHO_STEP_BY_TEMPLATE))
    .is("blocked_reason", null);
  for (const r of mainRuns ?? []) {
    if (r.status === "complete" || r.status === "closed" || r.status === "archived") continue;
    const age = now - new Date(r.created_at).getTime();
    if (age < winFor(r.org_id, "zoho_followup")) continue;
    const stepNo = ZOHO_STEP_BY_TEMPLATE[r.template_key];
    const { data: step } = await admin
      .from("run_steps")
      .select("status")
      .eq("run_id", r.id)
      .eq("step_no", stepNo)
      .maybeSingle();
    if (step?.status === "complete") continue;
    const { data: client } = await admin.from("clients").select("name").eq("id", r.client_id).maybeSingle();
    const name = client?.name ?? "the client";
    await fanOut({
      org_id: r.org_id,
      kind: "zoho_followup",
      run_id: r.id,
      client_id: r.client_id,
      step_id: stepNo,
      am_id: r.am_id,
      title: `Follow up on Zoho Books setup · ${name}`,
      body: `Zoho Books setup (step ${stepNo}) hasn't been completed in ${Math.floor(age / DAY)}d. Follow up with the team, add notes here, then close. Re-fires the day after closure if still incomplete.`,
    });
  }

  // ── 2) CT / VAT registration followup ──
  const COMPLIANCE_MAP: Array<{ template: string; kind: Kind; label: string }> = [
    { template: "ct-registration", kind: "ct_reg_followup", label: "CT registration" },
    { template: "vat-registration", kind: "vat_reg_followup", label: "VAT registration" },
  ];
  for (const cfg of COMPLIANCE_MAP) {
    const { data: runs } = await admin
      .from("onboarding_runs")
      .select("id,org_id,client_id,created_at,status,am_id")
      .eq("template_key", cfg.template)
      .is("blocked_reason", null);
    for (const r of runs ?? []) {
      if (r.status === "complete" || r.status === "closed" || r.status === "archived") continue;
      const age = now - new Date(r.created_at).getTime();
      if (age < winFor(r.org_id, cfg.kind)) continue;
      const { data: client } = await admin.from("clients").select("name").eq("id", r.client_id).maybeSingle();
      const name = client?.name ?? "the client";
      await fanOut({
        org_id: r.org_id,
        kind: cfg.kind,
        run_id: r.id,
        client_id: r.client_id,
        am_id: r.am_id,
        title: `Follow up on ${cfg.label} · ${name}`,
        body: `${cfg.label} run is open after ${Math.floor(age / DAY)}d. Ask the team for an update, save notes here, close. Re-fires every 2 days while open.`,
      });
    }
  }

  // ── 3) Docs overdue ── (de-scoped templates excluded; blocked runs excluded)
  const { data: activeRuns } = await admin
    .from("onboarding_runs")
    .select("id,org_id,client_id,status,am_id,template_key")
    .not("status", "in", "(complete,closed,archived)")
    .is("blocked_reason", null);
  const scopedRuns = (activeRuns ?? []).filter((r) => !DESCOPED_TEMPLATES.has(r.template_key));

  for (const r of scopedRuns) {
    const window = winFor(r.org_id, "docs_overdue");
    const noteWin = Math.max(window, noteExt(r.org_id));
    const { data: docs } = await admin
      .from("documents")
      .select("label,status,required,created_at,followup_note_at")
      .eq("run_id", r.id)
      .eq("status", "pending")
      .eq("required", true);
    const overdue = (docs ?? []).filter((d) => {
      const baseCreated = new Date(d.created_at).getTime();
      const noteAt = d.followup_note_at ? new Date(d.followup_note_at).getTime() : 0;
      // Effective deadline: if a note was added, deadline = noteAt + noteWin; otherwise baseCreated + window.
      const deadline = noteAt > 0 ? noteAt + noteWin : baseCreated + window;
      return now > deadline;
    });
    if (!overdue.length) continue;
    const { data: client } = await admin.from("clients").select("name").eq("id", r.client_id).maybeSingle();
    const name = client?.name ?? "the client";
    const list = overdue.map((d) => `• ${d.label}`).join("\n");
    await fanOut({
      org_id: r.org_id,
      kind: "docs_overdue",
      run_id: r.id,
      client_id: r.client_id,
      am_id: r.am_id,
      title: `Documents still missing · ${name} (${overdue.length})`,
      body: `These documents have been pending past SLA:\n${list}\n\nFollow up with the client, add notes, close.`,
    });
  }

  // ── 4) Access not shared ──
  for (const r of scopedRuns) {
    const window = winFor(r.org_id, "access_overdue");
    const noteWin = Math.max(window, noteExt(r.org_id));
    const { data: accessRows } = await admin
      .from("run_items")
      .select("data,created_at,status")
      .eq("run_id", r.id)
      .eq("kind", "access");
    const stale: string[] = [];
    for (const row of accessRows ?? []) {
      const data = (row.data ?? {}) as { items?: Array<{ id: string; label?: string; confirmed?: boolean; enabled?: boolean; followupNoteAt?: string | null }>; label?: string; status?: string; confirmed?: boolean; followupNoteAt?: string | null };
      const baseCreated = new Date(row.created_at).getTime();
      const items = data.items ?? [];
      if (items.length) {
        for (const it of items) {
          if (it.enabled === false || it.confirmed) continue;
          const noteAt = it.followupNoteAt ? new Date(it.followupNoteAt).getTime() : 0;
          const deadline = noteAt > 0 ? noteAt + noteWin : baseCreated + window;
          if (now > deadline) stale.push(it.label ?? it.id);
        }
      } else {
        // Flat shape: each run_items row IS one access item (status/confirmed at top of data).
        const granted = (row as { status?: string }).status === "granted" || data.status === "granted" || data.confirmed;
        if (granted) continue;
        const noteAt = data.followupNoteAt ? new Date(data.followupNoteAt).getTime() : 0;
        const deadline = noteAt > 0 ? noteAt + noteWin : baseCreated + window;
        if (now > deadline) stale.push(data.label ?? "Access");
      }
    }
    if (!stale.length) continue;
    const { data: client } = await admin.from("clients").select("name").eq("id", r.client_id).maybeSingle();
    const name = client?.name ?? "the client";
    const list = stale.slice(0, 12).map((s) => `• ${s}`).join("\n");
    await fanOut({
      org_id: r.org_id,
      kind: "access_overdue",
      run_id: r.id,
      client_id: r.client_id,
      am_id: r.am_id,
      title: `Access still not shared · ${name} (${stale.length})`,
      body: `These systems still aren't accessible past SLA:\n${list}\n\nFollow up with the client / team, add notes, close.`,
    });
  }

  // ── 5) Tasks overdue (any active run, any template) ──
  for (const r of activeRuns ?? []) {
    const window = winFor(r.org_id, "task_overdue");
    const noteWin = Math.max(window, noteExt(r.org_id));
    const { data: tasks } = await admin
      .from("tasks")
      .select("id,title,status,due_date,followup_note_at")
      .eq("run_id", r.id)
      .not("due_date", "is", null)
      .not("status", "in", "(done,complete,completed,cancelled)");
    const overdue = (tasks ?? []).filter((t) => {
      if (!t.due_date) return false;
      const dueMs = new Date(t.due_date).getTime();
      if (isNaN(dueMs)) return false;
      const noteAt = t.followup_note_at ? new Date(t.followup_note_at).getTime() : 0;
      const deadline = noteAt > 0 ? Math.max(dueMs + window, noteAt + noteWin) : dueMs + window;
      return now > deadline;
    });
    if (!overdue.length) continue;
    const { data: client } = await admin.from("clients").select("name").eq("id", r.client_id).maybeSingle();
    const name = client?.name ?? "the client";
    const list = overdue.slice(0, 10).map((t) => `• ${t.title}`).join("\n");
    await fanOut({
      org_id: r.org_id,
      kind: "task_overdue",
      run_id: r.id,
      client_id: r.client_id,
      am_id: r.am_id,
      title: `Tasks past due · ${name} (${overdue.length})`,
      body: `These tasks are past their due date:\n${list}\n\nFollow up with the owner, add notes, close.`,
    });
  }

  // ── 6) Escalation: open tasks > 2 days → next level; > 7 days → master admin ──
  const TWO_DAYS = 2 * DAY;
  const ONE_WEEK = 7 * DAY;

  // Re-use the open tasks we already fetched for dedup.
  const openForEscalation = (openTasksRaw ?? []) as Array<AdminTaskRow & { id: string }>;

  // Load team members once for role-based chain resolution.
  const { data: allMembers } = await admin
    .from("team_members")
    .select("id,full_name,role,org_id,reports_to")
    .eq("active", true);
  const memberById = new Map((allMembers ?? []).map((m) => [m.id, m as { id: string; full_name: string; role: string; org_id: string; reports_to: string | null }]));
  const membersByOrg = new Map<string, { id: string; full_name: string; role: string }[]>();
  for (const m of allMembers ?? []) {
    const list = membersByOrg.get(m.org_id) ?? [];
    list.push(m as { id: string; full_name: string; role: string });
    membersByOrg.set(m.org_id, list);
  }

  // Load run_team membership for runs we've already seen.
  const escalationRunIds = [...new Set(openForEscalation.map((t) => t.run_id).filter(Boolean) as string[])];
  const runMetaById = new Map<string, { am_id: string | null; org_id: string }>();
  if (escalationRunIds.length) {
    const { data: runRows } = await admin
      .from("onboarding_runs")
      .select("id,am_id,org_id")
      .in("id", escalationRunIds);
    for (const r of runRows ?? []) runMetaById.set(r.id, { am_id: r.am_id, org_id: r.org_id });
  }
  const { data: runTeamRows } = await admin
    .from("run_team")
    .select("run_id,team_member_id")
    .in("run_id", escalationRunIds.length ? escalationRunIds : ["__none__"]);
  const teamLeadsByRun = new Map<string, string>();
  for (const r of runTeamRows ?? []) {
    const m = memberById.get(r.team_member_id);
    if (m?.role === "team_lead") teamLeadsByRun.set(r.run_id, r.team_member_id);
  }

  const ROLE_RANK: Record<string, number> = {
    intern: 0, junior: 1, associate: 1, senior: 2,
    team_lead: 3, am: 4, ops_head: 5, admin: 6,
  };

  function findNextOwner(ownerId: string, orgId: string, runId: string | null): { id: string; name: string } | null {
    const owner = memberById.get(ownerId);
    if (!owner) return null;
    const ownerRank = ROLE_RANK[owner.role] ?? 0;
    const orgMembers = membersByOrg.get(orgId) ?? [];

    // team member → team lead on run (or AM if no team lead)
    if (ownerRank <= 2) {
      if (runId) {
        const tlId = teamLeadsByRun.get(runId);
        if (tlId && tlId !== ownerId) {
          const tl = memberById.get(tlId);
          if (tl) return { id: tl.id, name: tl.full_name };
        }
        const run = runMetaById.get(runId);
        if (run?.am_id && run.am_id !== ownerId) {
          const am = memberById.get(run.am_id);
          if (am) return { id: am.id, name: am.full_name };
        }
      }
    }

    // team lead → AM
    if (owner.role === "team_lead" && runId) {
      const run = runMetaById.get(runId);
      if (run?.am_id && run.am_id !== ownerId) {
        const am = memberById.get(run.am_id);
        if (am) return { id: am.id, name: am.full_name };
      }
    }

    // AM → ops_head
    if (owner.role === "am") {
      const ops = orgMembers.find((m) => m.role === "ops_head");
      if (ops && ops.id !== ownerId) return { id: ops.id, name: ops.full_name };
    }

    // ops_head → master admin
    if (owner.role === "ops_head") {
      const master = ownerByOrg.get(orgId);
      if (master && master.id !== ownerId) return master;
    }

    return null; // already at top of chain
  }

  // Track escalations created this run to avoid double-creating for same target.
  const escalatedThisRun = new Set<string>();

  for (const task of openForEscalation) {
    const age = now - new Date(task.created_at).getTime();
    if (age < TWO_DAYS) continue;

    // Week escalation: jump straight to master admin regardless of chain position.
    if (age >= ONE_WEEK) {
      const master = ownerByOrg.get(task.org_id);
      if (master && master.id !== task.owner_id) {
        const esc = `${task.kind}::${task.run_id ?? ""}::${master.id}`;
        if (!escalatedThisRun.has(esc)) {
          escalatedThisRun.add(esc);
          const ownerName = memberById.get(task.owner_id)?.full_name ?? "Team";
          await insertTask({
            org_id: task.org_id,
            owner_id: master.id,
            kind: task.kind as Kind,
            run_id: task.run_id ?? "",
            client_id: task.client_id,
            step_id: task.step_id,
            title: `[1 week unresolved] ${ownerName} – ${task.title.replace(/^\[.*?\]\s*/, "")}`,
            body: `Open for ${Math.floor(age / DAY)} days with no resolution. Originally assigned to ${ownerName}.\n\n${task.body ?? ""}`,
          });
        }
      }
      continue;
    }

    // Normal 2-day escalation to next person in chain.
    const next = findNextOwner(task.owner_id, task.org_id, task.run_id);
    if (!next) continue;
    const esc = `${task.kind}::${task.run_id ?? ""}::${next.id}`;
    if (escalatedThisRun.has(esc)) continue;
    escalatedThisRun.add(esc);
    const ownerName = memberById.get(task.owner_id)?.full_name ?? "Team";
    await insertTask({
      org_id: task.org_id,
      owner_id: next.id,
      kind: task.kind as Kind,
      run_id: task.run_id ?? "",
      client_id: task.client_id,
      step_id: task.step_id,
      title: `[Escalated] ${ownerName} – ${task.title.replace(/^\[.*?\]\s*/, "")}`,
      body: `Unresolved for ${Math.floor(age / DAY)} days by ${ownerName}. Needs your attention.\n\n${task.body ?? ""}`,
    });
  }

  // ── 7) Compliance deadline alert — 1 month before due date ──
  // Fires to team member + team lead + AM simultaneously on the same day.
  // Queries client_compliance table for upcoming VAT/CT/document deadlines.
  // NOTE: Requires a `client_compliance` table with columns:
  //   id, org_id, client_id, kind (text), label (text), due_date (date), run_id (nullable)
  // Once that table exists, uncomment the block below.
  //
  // const ONE_MONTH = 30 * DAY;
  // const { data: compRows } = await admin
  //   .from("client_compliance")
  //   .select("id,org_id,client_id,kind,label,due_date,run_id")
  //   .not("due_date", "is", null);
  // for (const c of compRows ?? []) {
  //   const dueMs = new Date(c.due_date).getTime();
  //   const remaining = dueMs - now;
  //   if (remaining < 0 || remaining > ONE_MONTH) continue; // only fire in the final month
  //   const { data: client } = await admin.from("clients").select("name").eq("id", c.client_id).maybeSingle();
  //   const name = client?.name ?? "the client";
  //   const daysLeft = Math.ceil(remaining / DAY);
  //   const title = `Compliance due in ${daysLeft}d · ${name} · ${c.label}`;
  //   const body = `${c.label} is due on ${c.due_date}. Ensure all filings/documents are in order.`;
  //   // Team member, team lead, and AM all get notified on the same day (no escalation for compliance).
  //   if (c.run_id) {
  //     const run = runMetaById.get(c.run_id) ?? (await admin.from("onboarding_runs").select("am_id,org_id").eq("id", c.run_id).maybeSingle()).data;
  //     const teamIds = (await admin.from("run_team").select("team_member_id").eq("run_id", c.run_id)).data ?? [];
  //     const targets = new Set<string>();
  //     if (run?.am_id) targets.add(run.am_id);
  //     for (const t of teamIds) targets.add(t.team_member_id);
  //     const master = ownerByOrg.get(c.org_id);
  //     if (master) targets.add(master.id);
  //     for (const ownerId of targets) {
  //       await insertTask({ org_id: c.org_id, owner_id: ownerId, kind: "compliance_alert" as Kind, run_id: c.run_id, client_id: c.client_id, title, body });
  //     }
  //   }
  // }

  return NextResponse.json({ ok: true, created: created.length, ids: created });
}
