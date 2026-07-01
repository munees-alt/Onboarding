import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessMatrix, resolveNavAccess } from "@/lib/role-access";
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

  // Access · By Department / By User / By Role in Settings can explicitly grant or
  // block this module — that always wins over the reporting-hierarchy default above.
  const matrix = await getAccessMatrix(orgId);
  hasAccess = resolveNavAccess(matrix, { role, memberId: currentMemberId, dept: session.teamMember?.dept ?? null }, "aml", hasAccess);

  if (!hasAccess) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)", fontSize: 14 }}>
        <p style={{ fontWeight: 700, fontSize: 20, color: "var(--ink-1)" }}>Access restricted</p>
        <p>This section is only accessible to the compliance team.</p>
      </div>
    );
  }

  const { clients, error, amlTeam } = await getAmlClients();
  const isMasterAdmin = role === "admin";
  const isHead = role === "admin" || role === "ops_head" || (krishnaRow != null && currentMemberId === krishnaRow.id);

  return (
    <div style={{ padding: "22px 28px 0" }}>
      <div className="bk-head">
        <div className="bk-title-row">
          <h1 className="bk-title">AML Compliance</h1>
          <span className="bk-badge">Compliance team only</span>
          {isMasterAdmin && (
            <span className="bk-badge-admin"><span className="bk-dot" />Admin panel active</span>
          )}
        </div>
      </div>
      {error && <div className="alert-red">{error}</div>}
      <AmlView clients={clients ?? []} canEdit={hasAccess} isAdmin={isMasterAdmin} isHead={isHead} amlTeam={amlTeam ?? []} />
    </div>
  );
}
