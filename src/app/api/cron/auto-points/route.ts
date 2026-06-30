import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Week key: ISO year + week number → "2026-W26"
function weekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function award(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  memberId: string,
  points: number,
  reason: string,
  source: string,
  refId: string,
  wk: string
) {
  await admin.from("user_points").upsert(
    { org_id: orgId, member_id: memberId, points, reason, awarded_by: null, source, ref_id: refId, week_key: wk },
    { onConflict: "org_id,member_id,source,ref_id,week_key", ignoreDuplicates: true }
  );
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const wk = weekKey();

  // ── Get org ────────────────────────────────────────────────────────────────
  const { data: org } = await admin.from("orgs").select("id").single();
  if (!org) return NextResponse.json({ error: "No org" }, { status: 500 });
  const orgId = org.id as string;

  let awarded = 0;

  // ── 1. +10 per onboarding stage completed on time this week ───────────────
  //    run_steps with completed_at set this week AND completed_at <= sla_due
  const { data: slaSteps } = await admin
    .from("run_steps")
    .select("id, run_id, assigned_to")
    .not("completed_at", "is", null)
    .not("sla_due", "is", null)
    .gte("completed_at", new Date(Date.now() - 7 * 86400000).toISOString());

  for (const step of slaSteps ?? []) {
    if (!step.assigned_to) continue;
    // We can't do column comparison in Supabase client, fetch full row
    const { data: full } = await admin
      .from("run_steps")
      .select("completed_at, sla_due")
      .eq("id", step.id)
      .single();
    if (!full) continue;
    const completedOnTime = full.completed_at && full.sla_due && full.completed_at <= full.sla_due;
    if (!completedOnTime) continue;
    await award(admin, orgId, step.assigned_to as string, 10, "Stage completed on time", "auto_sla", step.id as string, wk);
    awarded++;
  }

  // ── 2. +5 per admin_task closed this week ─────────────────────────────────
  const { data: closedTasks } = await admin
    .from("admin_tasks")
    .select("id, owner_id")
    .eq("org_id", orgId)
    .eq("status", "done")
    .gte("closed_at", new Date(Date.now() - 7 * 86400000).toISOString());

  for (const task of closedTasks ?? []) {
    if (!task.owner_id) continue;
    await award(admin, orgId, task.owner_id as string, 5, "Action item closed", "auto_task", task.id as string, wk);
    awarded++;
  }

  // ── 3. -5 per recurring overdue task (recreated 2+ times) ─────────────────
  //    admin_tasks where last_recreated_at is not null AND it's been recreated
  //    at least twice (we track this via history length or last_recreated_at set twice)
  const { data: overdueTasks } = await admin
    .from("admin_tasks")
    .select("id, owner_id, last_recreated_at")
    .eq("org_id", orgId)
    .eq("status", "open")
    .not("last_recreated_at", "is", null);

  for (const task of overdueTasks ?? []) {
    if (!task.owner_id) continue;
    // Deduct once per week per recurring overdue task
    await award(admin, orgId, task.owner_id as string, -5, "Recurring overdue action item", "auto_overdue", task.id as string, wk);
    awarded++;
  }

  return NextResponse.json({ ok: true, week: wk, awarded });
}

// Allow GET for easy manual trigger from browser (admin only in practice)
export async function GET(req: Request) {
  return POST(req);
}
