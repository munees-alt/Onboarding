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

  let adminTasks: AdminTaskItem[] = [];
  if (memberId) {
    const { data: rows } = await supabase
      .from("admin_tasks")
      .select("id,kind,run_id,client_id,step_id,title,body,status,history,notes,created_at,owner_id,snoozed_until,hold_note")
      .eq("owner_id", memberId)
      .order("created_at", { ascending: false })
      .limit(200);
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
    }));
  }

  const canScan = role === "admin" || role === "ops_head";

  return (
    <div className="scroll">
      <div className="page">
        <MyTasksSection items={adminTasks} canScan={canScan} canDelete={role === "admin"} canSnooze={role === "admin"} />
      </div>
    </div>
  );
}
