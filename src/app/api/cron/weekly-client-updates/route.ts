import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Weekly client update generator.
//
// Schedule: runs daily at 5am UTC (= 9am UAE).
// - On Thursday: creates one weekly_client_updates draft per active onboarding
//   client (status NOT IN complete/closed/archived), seeded from the task
//   board + 30-day key dates, and opens an admin_tasks "Send weekly update"
//   row owned by the master admin. The wider My Work page surfaces it under
//   Action Items.
// - On Friday (9am UAE): any draft from "last Thursday" still unsent simply
//   stays as an open admin_tasks row — its age (>24h, kind=weekly_update) is
//   what makes the UI treat it as overdue. No extra escalation column needed.
// - Other days: no-op. Returns ok with created=0.
//
// The linked weekly_client_updates.id is stored in admin_tasks.step_id so the
// UI can deep-link the chip directly to /weekly-updates/<id>.

type ClientRow = { id: string; name: string };
type RunRow = { id: string; org_id: string; client_id: string; status: string };
type TaskRow = {
  id: string;
  run_id: string;
  title: string;
  status: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_kind: string | null;
  due_date: string | null;
  updated_at: string | null;
  notes: string | null;
  client_visible: boolean | null;
};
type AccessItemData = { id?: string; label?: string; systemName?: string; email?: string };
type AccessRunItem = { id: string; run_id: string; status: string | null; data: AccessItemData | null };
type StatusSnapshot = {
  docs: { received: number; total: number };
  access: { shared: number; total: number };
  intake: "submitted" | "awaiting" | "none";
  coa: "signed_off" | "pending" | "none";
};

function startOfThursdayUtc(d: Date): string {
  // Anchor each weekly update to "the most recent Thursday" (UTC). When the
  // cron fires on Thursday, today IS the anchor. The week_of column stores
  // the date string (YYYY-MM-DD) of that Thursday.
  const day = d.getUTCDay(); // 0=Sun .. 4=Thu .. 6=Sat
  const diff = (day - 4 + 7) % 7; // days since Thursday
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return t.toISOString().slice(0, 10);
}

function fmtShort(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const DESCOPED_TEMPLATES = new Set(["urgent-compliance", "catchup", "compliance-renewal"]);

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();
  const isThursday = now.getUTCDay() === 4;
  // Manual triggers may want to force a run even off-day; honour ?force=1.
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (!isThursday && !force) {
    return NextResponse.json({ ok: true, created: 0, note: "not Thursday UTC — no-op" });
  }

  const weekOf = startOfThursdayUtc(now);
  const created: string[] = [];

  // Resolve the master-admin team_member per org (same pattern as admin-tasks cron).
  const { data: orgs } = await admin.from("orgs").select("id,feedback_form_url");
  const ownerByOrg = new Map<string, { id: string; name: string }>();
  const feedbackByOrg = new Map<string, string | null>();
  for (const o of orgs ?? []) {
    feedbackByOrg.set(o.id, (o.feedback_form_url as string | null) ?? null);
    const { data: linked } = await admin
      .from("profiles")
      .select("team_member_id,team_members!inner(id,full_name,role,active,org_id)")
      .eq("role", "admin")
      .eq("team_members.org_id", o.id)
      .eq("team_members.active", true)
      .eq("team_members.role", "admin")
      .order("created_at", { ascending: true })
      .limit(1);
    type LinkedRow = { team_members: { id: string; full_name: string } | { id: string; full_name: string }[] };
    const tm = ((linked as LinkedRow[] | null) ?? [])[0]?.team_members;
    const picked = Array.isArray(tm) ? tm[0] : tm;
    if (picked) {
      ownerByOrg.set(o.id, { id: picked.id, name: picked.full_name });
      continue;
    }
    const { data } = await admin
      .from("team_members")
      .select("id,full_name")
      .eq("org_id", o.id).eq("role", "admin").eq("active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (data) ownerByOrg.set(o.id, { id: data.id, name: data.full_name });
  }

  // For each org → fetch active runs (not complete/closed/archived) and group by client.
  for (const o of orgs ?? []) {
    const orgId = o.id as string;
    const owner = ownerByOrg.get(orgId);
    if (!owner) continue;

    // Active runs (not closed/archived) plus runs completed in the last 60 days
    // — the latter catches clients whose onboarding finished recently and whose
    // team still needs to send a wrap-up update.
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000).toISOString();
    const { data: runRows } = await admin
      .from("onboarding_runs")
      .select("id,org_id,client_id,status,template_key,updated_at")
      .eq("org_id", orgId)
      .not("status", "in", "(closed,archived)");
    const runs: RunRow[] = ((runRows ?? []) as Array<RunRow & { template_key: string; updated_at: string | null }>)
      .filter((r) => !DESCOPED_TEMPLATES.has(r.template_key))
      // For complete runs, only include if updated within last 60 days
      .filter((r) => r.status !== "complete" || (r.updated_at && r.updated_at >= sixtyDaysAgo));
    if (!runs.length) continue;

    // Group runs by client_id.
    const runsByClient = new Map<string, RunRow[]>();
    for (const r of runs) {
      const arr = runsByClient.get(r.client_id) ?? [];
      arr.push(r);
      runsByClient.set(r.client_id, arr);
    }
    const clientIds = [...runsByClient.keys()];
    const { data: clientRows } = await admin
      .from("clients").select("id,name").in("id", clientIds);
    const clientById = new Map<string, ClientRow>();
    (clientRows ?? []).forEach((c) => clientById.set(c.id, c as ClientRow));

    // Pull team_members so we can flag "client" tasks (no team member owner = client action).
    const { data: teamRows } = await admin
      .from("team_members").select("id").eq("org_id", orgId).eq("active", true);
    const teamIds = new Set<string>((teamRows ?? []).map((t) => t.id as string));

    // Last week's row (for newly_completed diffing) keyed by client.
    const prevWeekOf = startOfThursdayUtc(new Date(now.getTime() - 7 * 86_400_000));
    const { data: prevRows } = await admin
      .from("weekly_client_updates")
      .select("client_id,completed_tasks")
      .eq("org_id", orgId).eq("week_of", prevWeekOf);
    const prevCompletedIds = new Map<string, Set<string>>();
    for (const p of (prevRows ?? []) as Array<{ client_id: string; completed_tasks: unknown }>) {
      const arr = Array.isArray(p.completed_tasks) ? (p.completed_tasks as { id?: string }[]) : [];
      prevCompletedIds.set(p.client_id, new Set(arr.map((t) => t.id ?? "").filter(Boolean)));
    }

    for (const [clientId, clientRuns] of runsByClient) {
      const client = clientById.get(clientId);
      if (!client) continue;
      const runIds = clientRuns.map((r) => r.id);

      // Pull tasks across the client's active runs. We deliberately DO NOT
      // restrict to `client_visible=true` here — many teams forget to flag
      // tasks and the weekly update is the place where the master admin
      // decides what to share. The composer + per-task notes already give
      // them the chance to omit anything internal.
      const { data: taskRows } = await admin
        .from("tasks")
        .select("id,run_id,title,status,owner_id,owner_name,owner_kind,due_date,updated_at,notes,client_visible")
        .in("run_id", runIds);
      const tasks: TaskRow[] = (taskRows ?? []) as TaskRow[];

      // All access items across the client's runs (kind='access').
      // We use ALL of them (granted + pending) to compute the status snapshot,
      // and the pending subset gets surfaced as client_action_tasks.
      const { data: accessRows } = await admin
        .from("run_items")
        .select("id,run_id,status,data")
        .in("run_id", runIds)
        .eq("kind", "access");
      const allAccess: AccessRunItem[] = (accessRows ?? []) as AccessRunItem[];
      const accessItems: AccessRunItem[] = allAccess.filter((r) => (r.status ?? "requested") !== "granted");

      // Documents — total count per run (status='uploaded' counts as received).
      const { data: docRows } = await admin
        .from("documents")
        .select("id,status")
        .in("run_id", runIds);
      const docs = (docRows ?? []) as Array<{ id: string; status: string | null }>;
      const docsReceived = docs.filter((d) => d.status === "uploaded").length;
      const docsTotal = docs.length;

      // Intake form — submitted if any row across runs has status='submitted'.
      const { data: intakeRows } = await admin
        .from("intake_forms")
        .select("id,status")
        .in("run_id", runIds);
      const intakeStatus: StatusSnapshot["intake"] =
        (intakeRows ?? []).some((r) => r.status === "submitted") ? "submitted"
        : (intakeRows ?? []).length ? "awaiting"
        : "none";

      // COA sign-off — run_items kind='coa' with data.signedOff or status='signed'.
      const { data: coaRows } = await admin
        .from("run_items")
        .select("id,status,data")
        .in("run_id", runIds)
        .eq("kind", "coa");
      type CoaRow = { id: string; status: string | null; data: { signedOff?: boolean } | null };
      const coaList = (coaRows ?? []) as CoaRow[];
      const coaSignedOff = coaList.some((r) => r.status === "signed" || r.data?.signedOff === true);
      const coaStatus: StatusSnapshot["coa"] = coaList.length ? (coaSignedOff ? "signed_off" : "pending") : "none";

      const statusSnapshot: StatusSnapshot = {
        docs: { received: docsReceived, total: docsTotal },
        access: { shared: allAccess.filter((r) => r.status === "granted").length, total: allAccess.length },
        intake: intakeStatus,
        coa: coaStatus,
      };

      // Auto-seed per_task_notes from tasks.notes — gives the AI prompt the
      // "why" notes the team typed directly on the board, even if the master
      // admin hasn't opened the weekly update yet. Existing notes win on merge
      // (we read the prior row below).
      const taskNotesByCron: Record<string, string> = {};
      for (const t of tasks) {
        if (t.notes && t.notes.trim()) taskNotesByCron[t.id] = t.notes.trim();
      }

      const prevDone = prevCompletedIds.get(clientId) ?? new Set<string>();
      const isClientTask = (t: TaskRow) => {
        if (t.owner_kind === "client") return true;
        const n = (t.owner_name ?? "").toLowerCase();
        if (n.startsWith("client")) return true;
        if (!t.owner_id && !t.owner_name) return false; // unassigned ≠ client
        if (t.owner_id && !teamIds.has(t.owner_id)) return true;
        return false;
      };

      // "Completed this week" = task moved to done since the previous Thursday.
      // `tasks` has no completed_at column, so we use updated_at as the best
      // available signal (rows are touched on every status change).
      const weekStartMs = new Date(weekOf + "T00:00:00Z").getTime() - 7 * 86_400_000;
      const isComplete = (s: string) => s === "complete" || s === "done" || s === "completed";
      const completedThisWeek = (t: TaskRow) => {
        if (!isComplete(t.status)) return false;
        const ts = t.updated_at ? new Date(t.updated_at).getTime() : 0;
        return ts >= weekStartMs;
      };

      const completedTasks = tasks
        .filter(completedThisWeek)
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          owner_name: t.owner_name,
          due_date: t.due_date,
          newly_completed: !prevDone.has(t.id),
        }));
      const inprogressTasks = tasks
        .filter((t) => !isComplete(t.status) && t.status !== "cancelled")
        .filter((t) => !isClientTask(t))
        .map((t) => ({
          id: t.id, title: t.title, status: t.status,
          owner_name: t.owner_name, due_date: t.due_date, newly_completed: false,
        }));
      const clientActionFromTasks = tasks
        .filter((t) => !isComplete(t.status) && t.status !== "cancelled")
        .filter((t) => isClientTask(t))
        .map((t) => ({
          id: t.id, title: t.title, status: t.status,
          owner_name: t.owner_name, due_date: t.due_date, newly_completed: false,
        }));
      const clientActionFromAccess = accessItems.map((a) => {
        const label = a.data?.label ?? a.data?.systemName ?? "Access request";
        const system = a.data?.systemName && a.data.systemName !== a.data?.label ? ` — ${a.data.systemName}` : "";
        return {
          id: `access:${a.id}`,
          title: `Share access: ${label}${system}`,
          status: a.status ?? "requested",
          owner_name: "Client",
          due_date: null,
          newly_completed: false,
        };
      });
      const clientActionTasks = [...clientActionFromTasks, ...clientActionFromAccess];

      // Pre-fill key_dates: upcoming task due_dates in next 30 days, top 5.
      const horizonMs = now.getTime() + 30 * 86_400_000;
      const upcoming = tasks
        .filter((t) => t.due_date && new Date(t.due_date).getTime() > now.getTime() && new Date(t.due_date).getTime() < horizonMs)
        .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
        .slice(0, 5)
        .map((t) => ({ label: t.title, date: t.due_date! }));

      const subject = `Your Onboarding: Where We Are + What's Next — ${client.name}`;
      // Pick a representative run for run_id (first active).
      const primaryRunId = clientRuns[0]?.id ?? null;

      // Merge auto-pulled board notes with any per_task_notes the admin
      // already edited on a prior draft for the same week — admin wins.
      const { data: existingDraft } = await admin
        .from("weekly_client_updates")
        .select("per_task_notes")
        .eq("client_id", clientId).eq("week_of", weekOf).maybeSingle();
      const existingNotes = (existingDraft?.per_task_notes ?? {}) as Record<string, string>;
      const mergedNotes: Record<string, string> = { ...taskNotesByCron };
      for (const [k, v] of Object.entries(existingNotes)) {
        if (typeof v === "string" && v.trim()) mergedNotes[k] = v;
      }

      const { data: upserted, error: upsertErr } = await admin
        .from("weekly_client_updates")
        .upsert(
          {
            org_id: orgId,
            client_id: clientId,
            run_id: primaryRunId,
            week_of: weekOf,
            status: "draft",
            completed_tasks: completedTasks,
            inprogress_tasks: inprogressTasks,
            client_action_tasks: clientActionTasks,
            per_task_notes: mergedNotes,
            status_snapshot: statusSnapshot,
            key_dates: upcoming,
            feedback_link: feedbackByOrg.get(orgId) ?? null,
            subject,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "client_id,week_of" },
        )
        .select("id")
        .maybeSingle();
      const updateId = upserted?.id as string | undefined;
      if (upsertErr) { console.error(`[weekly-updates] upsert failed for client ${clientId}:`, upsertErr.message); continue; }
      if (!updateId) continue;
      created.push(updateId);

      // Open / refresh the admin_tasks chip. Dedupe by (kind, step_id=updateId, owner).
      const { data: existing } = await admin
        .from("admin_tasks")
        .select("id,status")
        .eq("kind", "weekly_update")
        .eq("step_id", updateId)
        .eq("owner_id", owner.id)
        .maybeSingle();
      if (!existing) {
        await admin.from("admin_tasks").insert({
          org_id: orgId,
          owner_id: owner.id,
          kind: "weekly_update",
          run_id: primaryRunId,
          client_id: clientId,
          step_id: updateId,
          title: `Send weekly update — ${client.name}`,
          body: `Draft for week of ${fmtShort(weekOf)} is ready. Review tasks, add per-task notes, compose the email + WhatsApp version, then send.`,
        });
      }
    }
  }

  return NextResponse.json({ ok: true, week_of: weekOf, created: created.length });
}
