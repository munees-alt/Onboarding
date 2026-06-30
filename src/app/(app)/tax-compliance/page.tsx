import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTaxComplianceClients } from "./actions";
import { TaxComplianceView } from "./tax-compliance-view";

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

export default async function TaxCompliancePage() {
  const session = await getSession();
  if (!session?.profile.org_id) redirect("/login");

  const orgId = session.profile.org_id;
  const admin = createAdminClient();

  // Find Gautam (Tax Head) by title
  const { data: taxHeadRow } = await admin
    .from("team_members")
    .select("id,full_name,title")
    .eq("org_id", orgId)
    .ilike("title", "%head%tax%")
    .maybeSingle();

  const currentMemberId = session.teamMember?.id ?? null;
  const role = session.teamMember?.role ?? session.profile.role;

  // Access: admin / ops_head, Tax Head and his subtree, or anyone with a tax title.
  let hasAccess = role === "admin" || role === "ops_head";
  if (!hasAccess && taxHeadRow && currentMemberId) {
    const subtree = await getSubtreeIds(orgId, taxHeadRow.id);
    hasAccess = subtree.has(currentMemberId);
  }
  if (!hasAccess && currentMemberId) {
    const { data: me } = await admin.from("team_members").select("title").eq("id", currentMemberId).maybeSingle();
    if (me?.title && /tax/i.test(me.title)) hasAccess = true;
  }
  // AM and team_lead can also view (they need to see / request) — read-only unless tax member.
  const canEdit = hasAccess;
  if (!hasAccess && (role === "am" || role === "team_lead")) hasAccess = true;

  if (!hasAccess) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)", fontSize: 14 }}>
        <p style={{ fontWeight: 700, fontSize: 20, color: "var(--ink-1)" }}>Access restricted</p>
        <p>This section is only accessible to the tax team and account managers.</p>
      </div>
    );
  }

  const { clients, error, taxTeam, taxHeadId, taxLeadId } = await getTaxComplianceClients();
  const isMasterAdmin = role === "admin";
  const isHead =
    role === "admin" ||
    role === "ops_head" ||
    (taxHeadId != null && currentMemberId === taxHeadId) ||
    (taxLeadId != null && currentMemberId === taxLeadId);

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "28px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Tax Compliance</h1>
        <span className="pill orange" style={{ fontSize: 11 }}>Tax team</span>
        {isMasterAdmin && <span className="pill" style={{ fontSize: 11, background: "#fef2f2", color: "#dc2626" }}>Admin panel active</span>}
      </div>
      {error && <div className="alert-red">{error}</div>}
      <TaxComplianceView
        clients={clients ?? []}
        canEdit={canEdit}
        isAdmin={isMasterAdmin}
        isHead={isHead}
        taxTeam={taxTeam ?? []}
      />
    </div>
  );
}
