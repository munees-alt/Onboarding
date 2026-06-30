import { requireSession } from "@/lib/auth";
import { Restricted } from "@/components/restricted";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeamHealthView, type HealthMember } from "./team-health-view";

export default async function TeamHealthPage() {
  const s = await requireSession();
  if (!["admin", "ops_head"].includes(s.profile.role))
    return <Restricted message="Team Health is only visible to the Ops Head and Master Admin." />;

  const supabase = await createClient();
  const admin = createAdminClient();
  const orgId = s.profile.org_id;

  // ── Fetch all active members ───────────────────────────────────────────────
  const { data: members } = await supabase
    .from("team_members")
    .select("id,full_name,title,role,dept,reports_to,avatar_initials,avatar_color")
    .eq("org_id", orgId)
    .eq("active", true)
    .order("full_name");

  // ── Points totals per member ───────────────────────────────────────────────
  const { data: pointsRows } = await admin
    .from("user_points")
    .select("member_id,points")
    .eq("org_id", orgId);

  const pointsMap: Record<string, number> = {};
  for (const r of pointsRows ?? []) {
    pointsMap[r.member_id as string] = (pointsMap[r.member_id as string] ?? 0) + (r.points as number);
  }

  // ── Open admin_tasks per owner ─────────────────────────────────────────────
  const { data: openTasks } = await admin
    .from("admin_tasks")
    .select("id,owner_id,title,last_recreated_at,status")
    .eq("org_id", orgId)
    .eq("status", "open");

  // ── Recent points log (last 20 auto + manual entries) ─────────────────────
  const { data: recentPoints } = await admin
    .from("user_points")
    .select("id,member_id,points,reason,source,created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(30);

  // ── Assemble HealthMember list ─────────────────────────────────────────────
  const tasksByOwner: Record<string, typeof openTasks> = {};
  for (const t of openTasks ?? []) {
    if (!t.owner_id) continue;
    (tasksByOwner[t.owner_id as string] ??= []).push(t);
  }

  const healthMembers: HealthMember[] = (members ?? []).map((m) => {
    const myTasks = tasksByOwner[m.id as string] ?? [];
    const overdueCount = myTasks.filter((t) => t.last_recreated_at != null).length;
    const pts = pointsMap[m.id as string] ?? 0;

    let health: "green" | "yellow" | "red" = "green";
    if (overdueCount >= 2 || pts < -10) health = "red";
    else if (overdueCount === 1 || pts < 0) health = "yellow";

    return {
      id: m.id as string,
      full_name: m.full_name as string,
      title: (m.title as string | null) ?? null,
      role: m.role as string,
      dept: (m.dept as string | null) ?? null,
      reports_to: (m.reports_to as string | null) ?? null,
      avatar_initials: (m.avatar_initials as string | null) ?? null,
      avatar_color: (m.avatar_color as string | null) ?? null,
      points: pts,
      openTasks: myTasks.map((t) => ({
        id: t.id as string,
        title: t.title as string,
        isRecurring: t.last_recreated_at != null,
      })),
      health,
    };
  });

  return (
    <TeamHealthView
      members={healthMembers}
      recentPoints={(recentPoints ?? []) as any}
      isAdmin={s.profile.role === "admin"}
    />
  );
}
