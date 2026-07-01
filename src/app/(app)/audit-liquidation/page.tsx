import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAccessMatrix, resolveNavAccess } from "@/lib/role-access";
import { getRunCards } from "@/lib/data/runs";
import { templateById } from "@/lib/onboarding-templates";
import { AuditLiquidationView } from "./audit-liquidation-view";

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
  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const child of byManager.get(cur) ?? []) {
      if (!visited.has(child)) { visited.add(child); queue.push(child); }
    }
  }
  return visited;
}

// Audit and Liquidation are now two separate sections. This shared renderer is
// scoped to a single flow ("audit" | "liquidation") and its nav id; the thin
// /audit and /liquidation route files call it. /audit-liquidation redirects here.
export async function renderAuditLiquidationSection(flow: "audit" | "liquidation", navId: string) {
  const templateId = flow === "liquidation" ? "liquidation-workflow" : "audit-workflow";
  const title = flow === "liquidation" ? "Liquidation" : "Audit";
  const session = await getSession();
  if (!session?.profile.org_id) redirect("/login");
  const orgId = session.profile.org_id;
  const role = session.teamMember?.role ?? session.profile.role;
  const currentMemberId = session.teamMember?.id ?? null;
  const admin = createAdminClient();

  // Default access: admin / ops_head, or the Team Lead (Aarju) and her reporting subtree.
  let hasAccess = role === "admin" || role === "ops_head";
  if (!hasAccess && currentMemberId) {
    const { data: aarju } = await admin
      .from("team_members").select("id").eq("org_id", orgId).ilike("full_name", "%aarju%").maybeSingle();
    if (aarju) {
      const subtree = await getSubtreeIds(orgId, aarju.id);
      hasAccess = subtree.has(currentMemberId);
    }
  }
  // Access panel overrides (dept / user / role) always win over the default above.
  const matrix = await getAccessMatrix(orgId);
  hasAccess = resolveNavAccess(matrix, { role, memberId: currentMemberId, dept: session.teamMember?.dept ?? null }, navId, hasAccess);

  if (!hasAccess) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--ink-3)", fontSize: 14 }}>
        <p style={{ fontWeight: 700, fontSize: 20, color: "var(--ink-1)" }}>Access restricted</p>
        <p>This section is only accessible to the {title} team.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: runRows } = await admin
    .from("onboarding_runs")
    .select("id,template_key,status")
    .eq("org_id", orgId)
    .eq("template_key", templateId)
    .not("status", "eq", "archived");
  const runIds = (runRows ?? []).map((r) => r.id as string);
  const cards = runIds.length ? await getRunCards(supabase, runIds) : [];

  const tpl = templateById(templateId);
  const board = {
    flow,
    templateId,
    name: tpl?.name ?? title,
    stages: (tpl?.stages ?? []).map((s, i) => ({ no: i + 1, name: s.name })),
    cards: cards
      .filter((c) => c.templateKey === templateId)
      .map((c) => ({
        id: c.id,
        clientName: c.clientName,
        currentStage: c.currentStage,
        stageCount: c.stageCount,
        progress: c.progress,
        status: c.status,
        amName: c.amName,
        teamLeadName: c.teamLeadName,
      })),
  };

  // Clients that don't yet have an open case, for the "New case" picker.
  const { data: clientRows } = await admin
    .from("clients").select("id,name").eq("org_id", orgId).order("name");
  const clients = (clientRows ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));

  return <AuditLiquidationView boards={[board]} title={title} lockedFlow={flow} clients={clients} canCreate={["admin", "ops_head", "am", "team_lead"].includes(role)} />;
}

export default async function AuditLiquidationPage() {
  redirect("/audit");
}
