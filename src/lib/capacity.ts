import "server-only";
import { createAdminClient } from "./supabase/admin";

/**
 * Tax-team capacity helper.
 *
 * Pool shown in the urgent-compliance picker / capacity card:
 *   Tax Head (Gautam Sanoj)
 *   + Tax Team Lead (Nafila)
 *   + every active descendant of the Lead in the org chart
 *   + any extras the Master Admin has manually added (tax_team_extras)
 *
 * Auto-routing rule: head and lead are EXCLUDED from auto-cycle — work
 * lands on the lead's team members only, least-loaded first, capped at
 * max_tasks (default 60). Head and lead remain visible for manual override.
 *
 * Current load = open onboarding_runs assigned as am_id (not archived/closed/complete).
 */

export const DEFAULT_TAX_MAX_TASKS = 60;

export interface CapacityRow {
  id: string;
  name: string;
  role: string;
  title: string | null;
  isHead: boolean;
  isLead: boolean;
  isExtra: boolean;
  maxTasks: number | null;
  currentLoad: number;
  /** Lower = better. -1 means no ceiling configured. */
  ratio: number;
}

/** All team_members in the subtree below the given anchor (BFS over reports_to). */
async function descendantsOf(orgId: string, anchorId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: all } = await admin
    .from("team_members")
    .select("id,reports_to")
    .eq("org_id", orgId)
    .eq("active", true);
  const children: Record<string, string[]> = {};
  for (const r of all ?? []) {
    if (r.reports_to) (children[r.reports_to] ??= []).push(r.id);
  }
  const out: string[] = [];
  const queue = [...(children[anchorId] ?? [])];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    (children[id] ?? []).forEach((c) => queue.push(c));
  }
  return out;
}

/**
 * Resolve the Tax Head. Tries (in order):
 *   1) title contains "tax" + ("head" or "lead")
 *   2) dept = "Tax"
 *   3) full_name like "Gautam Sanoj"
 */
export async function findTaxHead(orgId: string): Promise<{ id: string; name: string } | null> {
  const admin = createAdminClient();
  const { data: byTitle } = await admin
    .from("team_members")
    .select("id,full_name,title,dept")
    .eq("org_id", orgId)
    .eq("active", true)
    .or("title.ilike.%head%tax%,title.ilike.%tax%head%,title.ilike.%lead%tax%,title.ilike.%tax%lead%");
  const head = (byTitle ?? [])[0];
  if (head) return { id: head.id, name: head.full_name };

  const { data: byDept } = await admin
    .from("team_members")
    .select("id,full_name")
    .eq("org_id", orgId)
    .eq("active", true)
    .ilike("dept", "tax")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (byDept) return { id: byDept.id, name: byDept.full_name };

  const { data: byName } = await admin
    .from("team_members")
    .select("id,full_name")
    .eq("org_id", orgId)
    .eq("active", true)
    .ilike("full_name", "%gautam%sanoj%")
    .limit(1)
    .maybeSingle();
  if (byName) return { id: byName.id, name: byName.full_name };

  return null;
}

/**
 * Resolve the Tax Team Lead (Nafila). Tries (in order), excluding the head:
 *   1) title contains "tax" + "manager"  (e.g. "Tax Compliance Manager")
 *   2) title contains "compliance" + ("lead" | "manager")
 *   3) full_name like "Nafila"
 *   4) Head's first direct report
 */
export async function findTaxTeamLead(
  orgId: string,
  headId?: string | null,
): Promise<{ id: string; name: string } | null> {
  const admin = createAdminClient();
  const hid = headId ?? (await findTaxHead(orgId))?.id ?? null;

  const skip = hid ? `id.neq.${hid}` : null;

  const tryQuery = async (orFilter: string) => {
    let q = admin
      .from("team_members")
      .select("id,full_name,title,reports_to")
      .eq("org_id", orgId)
      .eq("active", true)
      .or(orFilter);
    if (skip) q = q.neq("id", hid as string);
    const { data } = await q.limit(1);
    return (data ?? [])[0] ?? null;
  };

  const byTaxManager = await tryQuery("title.ilike.%tax%manager%,title.ilike.%manager%tax%");
  if (byTaxManager) return { id: byTaxManager.id, name: byTaxManager.full_name };

  const byCompliance = await tryQuery(
    "title.ilike.%compliance%lead%,title.ilike.%lead%compliance%,title.ilike.%compliance%manager%,title.ilike.%manager%compliance%",
  );
  if (byCompliance) return { id: byCompliance.id, name: byCompliance.full_name };

  const byName = await tryQuery("full_name.ilike.%nafila%");
  if (byName) return { id: byName.id, name: byName.full_name };

  // Last resort: first direct report of the head
  if (hid) {
    const { data: report } = await admin
      .from("team_members")
      .select("id,full_name")
      .eq("org_id", orgId)
      .eq("active", true)
      .eq("reports_to", hid)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (report) return { id: report.id, name: report.full_name };
  }

  return null;
}

/**
 * Returns the tax-team capacity rows: Head + Lead + Lead's descendants + extras.
 * Sorted: Head, then Lead, then under-cap, then lowest load, then name.
 */
export async function getAmCapacityList(orgId: string): Promise<CapacityRow[]> {
  const admin = createAdminClient();
  const head = await findTaxHead(orgId);
  if (!head) return [];
  const lead = await findTaxTeamLead(orgId, head.id);

  const teamIds = lead ? await descendantsOf(orgId, lead.id) : [];
  const { data: extras } = await admin
    .from("tax_team_extras")
    .select("team_member_id")
    .eq("org_id", orgId);
  const extraIds = (extras ?? []).map((r) => r.team_member_id as string);

  const memberIds = [
    ...new Set([
      head.id,
      ...(lead ? [lead.id] : []),
      ...teamIds,
      ...extraIds,
    ]),
  ];
  if (!memberIds.length) return [];

  const { data: members } = await admin
    .from("team_members")
    .select("id,full_name,role,title")
    .in("id", memberIds)
    .eq("active", true);
  const memberById = new Map(((members ?? []) as Array<{ id: string; full_name: string; role: string; title: string | null }>).map((m) => [m.id, m]));

  const { data: caps } = await admin
    .from("am_capacity")
    .select("team_member_id,max_tasks")
    .eq("org_id", orgId)
    .in("team_member_id", memberIds);
  const maxBy: Record<string, number | null> = {};
  for (const r of caps ?? []) maxBy[r.team_member_id] = r.max_tasks ?? null;

  const { data: openRuns } = await admin
    .from("onboarding_runs")
    .select("am_id,status")
    .in("am_id", memberIds)
    .not("status", "in", "(archived,closed,complete)");
  const loadBy: Record<string, number> = {};
  for (const r of openRuns ?? []) if (r.am_id) loadBy[r.am_id] = (loadBy[r.am_id] ?? 0) + 1;

  const extrasSet = new Set(extraIds);
  const leadId = lead?.id ?? null;
  const rows: CapacityRow[] = memberIds.map((id) => {
    const m = memberById.get(id);
    if (!m) return null as unknown as CapacityRow;
    const max = maxBy[id] ?? DEFAULT_TAX_MAX_TASKS;
    const load = loadBy[id] ?? 0;
    const ratio = max && max > 0 ? load / max : -1;
    return {
      id,
      name: m.full_name,
      role: m.role,
      title: m.title,
      isHead: id === head.id,
      isLead: id === leadId,
      isExtra: extrasSet.has(id),
      maxTasks: max,
      currentLoad: load,
      ratio,
    };
  }).filter(Boolean);

  rows.sort((a, b) => {
    if (a.isHead !== b.isHead) return a.isHead ? -1 : 1;            // Head always on top
    if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;            // Lead next
    const aFull = a.maxTasks != null && a.currentLoad >= a.maxTasks ? 1 : 0;
    const bFull = b.maxTasks != null && b.currentLoad >= b.maxTasks ? 1 : 0;
    if (aFull !== bFull) return aFull - bFull;
    if (a.currentLoad !== b.currentLoad) return a.currentLoad - b.currentLoad;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

/**
 * Pick the next member to auto-assign for an urgent-compliance run.
 *
 * Rule: skip the Tax Head AND the Tax Team Lead — auto only lands on the
 * lead's team members. Least-loaded under capacity wins; round-robin on ties.
 * Falls back to the lead, then the head, if no team member exists yet.
 */
export async function suggestNextAm(orgId: string): Promise<CapacityRow | null> {
  const rows = await getAmCapacityList(orgId);
  if (!rows.length) return null;
  const team = rows.filter((r) => !r.isHead && !r.isLead);
  const pool = team.length ? team : rows.filter((r) => !r.isHead).length ? rows.filter((r) => !r.isHead) : rows;
  const under = pool.find((r) => r.maxTasks == null || r.currentLoad < r.maxTasks);
  return under ?? pool[0];
}

// ── ALC team (Accounting & Legal Compliance — catch-up routing) ──────────
// Mirrors the tax-team helpers above. Catch-up routes to the ALC team led
// by Anju. Same shape: head (or lead) + descendants, least-loaded auto-pick.

/** Resolve the ALC team head/lead — defaults to Anju by name, then title-match. */
export async function findAlcHead(orgId: string): Promise<{ id: string; name: string } | null> {
  const admin = createAdminClient();
  // 1) Direct name match (Anju)
  const { data: byName } = await admin
    .from("team_members")
    .select("id,full_name")
    .eq("org_id", orgId)
    .eq("active", true)
    .ilike("full_name", "%anju%")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (byName) return { id: byName.id, name: byName.full_name };

  // 2) Title-match: anything containing "alc" or "catch"
  const { data: byTitle } = await admin
    .from("team_members")
    .select("id,full_name")
    .eq("org_id", orgId)
    .eq("active", true)
    .or("title.ilike.%alc%,title.ilike.%catch-up%,title.ilike.%catchup%")
    .limit(1);
  const head = (byTitle ?? [])[0];
  if (head) return { id: head.id, name: head.full_name };

  return null;
}

/**
 * Pick the next ALC team member to auto-assign for a catch-up run.
 * Defaults to Anju if no team has been wired below her yet.
 */
export async function suggestNextAlc(orgId: string): Promise<{ id: string; name: string; currentLoad: number } | null> {
  const head = await findAlcHead(orgId);
  if (!head) return null;
  const admin = createAdminClient();
  const teamIds = await descendantsOf(orgId, head.id);
  const memberIds = [head.id, ...teamIds];

  const { data: members } = await admin
    .from("team_members")
    .select("id,full_name")
    .in("id", memberIds)
    .eq("active", true);
  const memberById = new Map(((members ?? []) as Array<{ id: string; full_name: string }>).map((m) => [m.id, m]));

  const { data: openRuns } = await admin
    .from("onboarding_runs")
    .select("am_id,status")
    .in("am_id", memberIds)
    .not("status", "in", "(archived,closed,complete)");
  const loadBy: Record<string, number> = {};
  for (const r of openRuns ?? []) if (r.am_id) loadBy[r.am_id] = (loadBy[r.am_id] ?? 0) + 1;

  // Prefer team members (skip the head) sorted by least load; fallback to head.
  const pool = teamIds.length ? teamIds : [head.id];
  const sorted = [...pool].sort((a, b) => (loadBy[a] ?? 0) - (loadBy[b] ?? 0));
  const winnerId = sorted[0];
  const m = memberById.get(winnerId);
  if (!m) return { id: head.id, name: head.name, currentLoad: loadBy[head.id] ?? 0 };
  return { id: winnerId, name: m.full_name, currentLoad: loadBy[winnerId] ?? 0 };
}

/**
 * Generic role-based auto-assign: pick the active team_member with the given
 * `role` and the fewest open onboarding_runs they're a member of. Used by the
 * Assign Roles step to suggest Senior / Junior / Team Lead defaults.
 *
 * "Load" = count of distinct active onboarding_runs the person appears in via
 * run_team (NOT runs where they're am_id) — this lets the same Senior appear
 * on many runs while still surfacing the least-loaded one.
 */
export async function suggestNextByRole(
  orgId: string,
  role: string,
  excludeIds: string[] = [],
): Promise<{ id: string; name: string; currentLoad: number } | null> {
  const admin = createAdminClient();
  const targetRoles = role === "team_lead" ? ["team_lead", "senior"] : [role];
  const { data: members } = await admin
    .from("team_members")
    .select("id,full_name,role")
    .eq("org_id", orgId)
    .eq("active", true)
    .in("role", targetRoles);
  const candidates = ((members ?? []) as Array<{ id: string; full_name: string; role: string }>)
    .filter((m) => !excludeIds.includes(m.id));
  if (!candidates.length) return null;

  const ids = candidates.map((m) => m.id);
  const { data: runMembers } = await admin
    .from("run_team")
    .select("team_member_id,onboarding_runs(status)")
    .in("team_member_id", ids);
  const loadBy: Record<string, number> = {};
  for (const r of (runMembers ?? []) as Array<{
    team_member_id: string;
    onboarding_runs: { status: string } | { status: string }[] | null;
  }>) {
    const run = Array.isArray(r.onboarding_runs) ? r.onboarding_runs[0] : r.onboarding_runs;
    const status = run?.status ?? "";
    if (!status || ["archived", "closed", "complete"].includes(status)) continue;
    loadBy[r.team_member_id] = (loadBy[r.team_member_id] ?? 0) + 1;
  }

  const sorted = [...candidates].sort((a, b) => {
    const la = loadBy[a.id] ?? 0;
    const lb = loadBy[b.id] ?? 0;
    if (la !== lb) return la - lb;
    return a.full_name.localeCompare(b.full_name);
  });
  const w = sorted[0];
  return { id: w.id, name: w.full_name, currentLoad: loadBy[w.id] ?? 0 };
}

/**
 * Org-wide capacity rows for the Master Admin settings view. Returns EVERY
 * active team member (not just the tax sub-tree) so caps can be set anywhere.
 */
export async function getOrgCapacityList(orgId: string): Promise<CapacityRow[]> {
  const admin = createAdminClient();
  const head = await findTaxHead(orgId);
  const lead = head ? await findTaxTeamLead(orgId, head.id) : null;

  const { data: members } = await admin
    .from("team_members")
    .select("id,full_name,role,title")
    .eq("org_id", orgId)
    .eq("active", true);
  const memberRows = (members ?? []) as Array<{ id: string; full_name: string; role: string; title: string | null }>;
  if (!memberRows.length) return [];
  const ids = memberRows.map((m) => m.id);

  const { data: caps } = await admin
    .from("am_capacity")
    .select("team_member_id,max_tasks")
    .eq("org_id", orgId)
    .in("team_member_id", ids);
  const maxBy: Record<string, number | null> = {};
  for (const r of caps ?? []) maxBy[r.team_member_id] = r.max_tasks ?? null;

  const { data: openRuns } = await admin
    .from("onboarding_runs")
    .select("am_id,status")
    .in("am_id", ids)
    .not("status", "in", "(archived,closed,complete)");
  const loadBy: Record<string, number> = {};
  for (const r of openRuns ?? []) if (r.am_id) loadBy[r.am_id] = (loadBy[r.am_id] ?? 0) + 1;

  const { data: extras } = await admin
    .from("tax_team_extras")
    .select("team_member_id")
    .eq("org_id", orgId);
  const extrasSet = new Set((extras ?? []).map((r) => r.team_member_id as string));

  const rows: CapacityRow[] = memberRows.map((m) => {
    const max = maxBy[m.id] ?? null;
    const load = loadBy[m.id] ?? 0;
    const ratio = max && max > 0 ? load / max : -1;
    return {
      id: m.id,
      name: m.full_name,
      role: m.role,
      title: m.title,
      isHead: m.id === head?.id,
      isLead: m.id === lead?.id,
      isExtra: extrasSet.has(m.id),
      maxTasks: max,
      currentLoad: load,
      ratio,
    };
  });

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}
