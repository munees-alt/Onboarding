import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAmlClients } from "../clients/actions";
import { AmlView } from "./aml-view";

/** BFS through reports_to to build the set of members under a root member. */
async function getSubtreeIds(orgId: string, rootId: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const { data: all } = await admin.from("team_members").select("id,reports_to").eq("org_id", orgId);
  const members = (all ?? []) as { id: string; reports_to: string | null }[];
  const byManager = new Map<string, string[]>();
  for (const m of members) {
    if (m.reports_to) {
      if (!byManager.has(m.reports_to)) byManager.set(m.reports_to, []);
      byManager.get(m.reports_to)!.push(m.id);
    }
  }
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const child of byManager.get(cur) ?? []) queue.push(child);
  }
  return visited;
}

export default async function AmlPage() {
  const session = await getSession();
  if (!session?.profile.org_id) redirect("/login");

  const orgId = session.profile.org_id;
  const admin = createAdminClient();

  // Find Krishna in the compliance team by name search (case-insensitive)
  const { data: krishnaRow } = await admin
    .from("team_members")
    .select("id,full_name")
    .eq("org_id", orgId)
    .ilike("full_name", "%krishna%")
    .maybeSingle();

  // Current user's team_member record
  const currentMemberId = session.teamMember?.id ?? null;

  // Access: either Krishna herself OR in her reporting subtree
  let hasAccess = false;
  if (krishnaRow) {
    const subtree = await getSubtreeIds(orgId, krishnaRow.id);
    hasAccess = currentMemberId != null && subtree.has(currentMemberId);
  }
  // Also allow admin / ops_head override
  const role = session.teamMember?.role ?? session.profile.role;
  if (role === "admin" || role === "ops_head") hasAccess = true;

  if (!hasAccess) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)", fontSize: 14 }}>
        <p style={{ fontWeight: 700, fontSize: 20, color: "var(--ink-1)" }}>Access restricted</p>
        <p>This section is only accessible to the compliance team.</p>
      </div>
    );
  }

  const { clients, error } = await getAmlClients();
  const isMasterAdmin = role === "admin";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>AML Compliance</h1>
        <span className="pill orange" style={{ fontSize: 11 }}>Compliance team only</span>
        {isMasterAdmin && <span className="pill" style={{ fontSize: 11, background: "#fef2f2", color: "#dc2626" }}>Admin panel active</span>}
      </div>
      {error && <div className="alert-red">{error}</div>}
      <AmlView clients={clients ?? []} canEdit={hasAccess} isAdmin={isMasterAdmin} />
    </div>
  );
}
