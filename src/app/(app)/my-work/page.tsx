import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MyTasksSection, type AdminTaskItem } from "./my-tasks-section";

// My Work is Action Items only. AML Compliance and Tax Compliance have their own
// dedicated nav sections, and onboarding runs already live under Onboarding — so
// this page no longer duplicates either.
export default async function MyWorkPage() {
  const session = await requireSession();
  const supabase = await createClient();
  const memberId = session.teamMember?.id;
  const role = session.profile.role;

  // Visibility: admin / ops_head / AM see everything in the org. Everyone else
  // (team lead, senior, junior, …) sees their OWN items plus everyone in their
  // org-chart subtree (their reports, transitively) — so a Team Lead sees their
  // team members' items, a member sees only their own.
  const seeAll = role === "admin" || role === "ops_head" || role === "am";
  let ownerIds: string[] | null = null; // null = no owner filter (see all)
  if (!seeAll && memberId) {
    const { data: allTm } = await supabase
      .from("team_members")
      .select("id,reports_to")
      .eq("org_id", session.profile.org_id)
      .eq("active", true);
    const children: Record<string, string[]> = {};
    (allTm ?? []).forEach((m) => {
      if (m.reports_to) (children[m.reports_to as string] ??= []).push(m.id as string);
    });
    const ids = new Set<string>([memberId]);
    const queue = [memberId];
    while (queue.length) {
      const p = queue.shift()!;
      for (const child of children[p] ?? []) {
        if (!ids.has(child)) { ids.add(child); queue.push(child); }
      }
    }
    ownerIds = [...ids];
  }

  let adminTasks: AdminTaskItem[] = [];
  if (memberId) {
    let query = supabase
      .from("admin_tasks")
      .select("id,kind,run_id,client_id,step_id,title,body,status,history,notes,created_at,owner_id,snoozed_until,hold_note")
      .eq("org_id", session.profile.org_id)
      .order("created_at", { ascending: false })
      .limit(400);
    if (ownerIds) query = query.in("owner_id", ownerIds);
    const { data: rows } = await query;
    const clientIds = [...new Set((rows ?? []).map((r) => r.client_id).filter(Boolean) as string[])];
    const nameById = new Map<string, string>();
    if (clientIds.length) {
      const { data: cs } = await supabase.from("clients").select("id,name").in("id", clientIds);
      (cs ?? []).forEach((c) => nameById.set(c.id, c.name));
    }
    adminTasks = (rows ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      runId: r.run_id,
      stepId: r.step_id ?? null,
      clientName: r.client_id ? nameById.get(r.client_id) ?? null : null,
      createdAt: r.created_at,
      status: r.status,
      history: Array.isArray(r.history) ? r.history : [],
      notes: r.notes,
      snoozedUntil: r.snoozed_until ?? null,
      holdNote: r.hold_note ?? null,
      ownerId: r.owner_id,
    }));
  }

  const canScan = role === "admin" || role === "ops_head";

  return (
    <div className="scroll">
      <div className="page">
        <MyTasksSection
          items={adminTasks}
          canScan={canScan}
          canDelete={role === "admin"}
          canSnooze={role === "admin"}
          viewerId={memberId}
          showViewToggle={role === "admin"}
        />
      </div>
    </div>
  );
}
