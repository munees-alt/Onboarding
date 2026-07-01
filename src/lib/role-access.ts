import "server-only";
import { createAdminClient } from "./supabase/admin";
import { NAV } from "./nav";
import type { NavItem, Role } from "./types";

const ALL_ROLES: Role[] = ["admin", "ops_head", "am", "team_lead", "senior", "junior", "associate", "intern", "other"];

// Canonical department list (platform cleanup, 2026-07) — shown in the Access ·
// By Department tab even before any team member is assigned to them, so the
// Master Admin can pre-configure access instead of waiting for team_members.dept
// to be populated. Team members are still assigned a department in Org Chart.
export const CANONICAL_DEPTS: string[] = [
  "AML",
  "COE",
  "Center of Excellence",
  "Clients and Team Health",
  "Engineering",
  "FinOps and Finance Operations and Onboarding",
  "Management",
  "HR and TA",
  "Marketing",
  "Office Admin and IT",
  "Partnership",
  "Sales",
  "Tax",
  "Tax External",
  "Tax SPC",
];

export interface AccessMatrix {
  /** All nav modules the org might toggle. */
  modules: { id: string; label: string; defaultRoles: Role[] | null }[];
  /** role → navId → true | false (override) or undefined (use default). */
  overrides: Partial<Record<Role, Partial<Record<string, boolean>>>>;
  /** Distinct department names active in the org. */
  depts: string[];
  /** dept → navId → true | false (override) or undefined (use default). */
  deptOverrides: Partial<Record<string, Partial<Record<string, boolean>>>>;
  /** Active team members for user-specific tab. */
  members: { id: string; name: string; dept: string | null }[];
  /** memberId → navId → true | false (override) or undefined (use default). */
  userOverrides: Partial<Record<string, Partial<Record<string, boolean>>>>;
}

export async function getAccessMatrix(orgId: string): Promise<AccessMatrix> {
  const admin = createAdminClient();
  const [
    { data: roleRows },
    { data: deptRows },
    { data: userRows },
    { data: memberRows },
  ] = await Promise.all([
    admin.from("role_overrides").select("role,nav_id,allow").eq("org_id", orgId),
    // These tables may not exist yet if migration 0048 hasn't been applied.
    admin.from("dept_overrides").select("dept,nav_id,allow").eq("org_id", orgId).then((r) => r.error?.code === "42P01" ? { data: [] } : r),
    admin.from("user_nav_overrides").select("member_id,nav_id,allow").eq("org_id", orgId).then((r) => r.error?.code === "42P01" ? { data: [] } : r),
    admin.from("team_members").select("id,full_name,dept").eq("org_id", orgId).eq("active", true).order("full_name"),
  ]);

  const overrides: AccessMatrix["overrides"] = {};
  for (const r of roleRows ?? []) {
    const role = r.role as Role;
    (overrides[role] ??= {})[r.nav_id] = !!r.allow;
  }

  const deptOverrides: AccessMatrix["deptOverrides"] = {};
  for (const r of deptRows ?? []) {
    (deptOverrides[r.dept] ??= {})[r.nav_id] = !!r.allow;
  }

  const userOverrides: AccessMatrix["userOverrides"] = {};
  for (const r of userRows ?? []) {
    (userOverrides[r.member_id] ??= {})[r.nav_id] = !!r.allow;
  }

  const members = (memberRows ?? []).map((m) => ({
    id: m.id as string,
    name: m.full_name as string,
    dept: (m.dept as string | null) ?? null,
  }));

  const depts = [...new Set([...CANONICAL_DEPTS, ...members.map((m) => m.dept).filter(Boolean) as string[]])].sort();

  return {
    modules: NAV.map((n) => ({ id: n.id, label: n.label, defaultRoles: n.roles ?? null })),
    overrides,
    depts,
    deptOverrides,
    members,
    userOverrides,
  };
}

/** Resolves whether `role` can open `navId`. */
export function roleCanOpen(matrix: AccessMatrix, role: Role, item: Pick<NavItem, "id" | "roles">): boolean {
  const override = matrix.overrides[role]?.[item.id];
  if (typeof override === "boolean") return override;
  if (!item.roles) return true;
  return item.roles.includes(role);
}

export const ACCESS_ROLES: Role[] = ["admin", "ops_head", "am", "team_lead", "senior", "junior"];
export const ALL_NAV_ROLES = ALL_ROLES;

/**
 * Resolves whether a specific person can open `navId`, honoring the same
 * priority order the sidebar uses: user override → department override → role
 * override → `fallbackDefault` (whatever the page's own default logic decides,
 * e.g. a reporting-hierarchy check). This is what makes the Access · By
 * Department / By User / By Role settings actually gate the PAGE, not just
 * hide the sidebar link. Master Admin can never be locked out of their own org.
 */
export function resolveNavAccess(
  matrix: AccessMatrix,
  ctx: { role: Role; memberId: string | null; dept: string | null },
  navId: string,
  fallbackDefault: boolean,
): boolean {
  if (ctx.role === "admin") return true;
  const userOverride = ctx.memberId ? matrix.userOverrides[ctx.memberId]?.[navId] : undefined;
  if (typeof userOverride === "boolean") return userOverride;
  const deptOverride = ctx.dept ? matrix.deptOverrides[ctx.dept]?.[navId] : undefined;
  if (typeof deptOverride === "boolean") return deptOverride;
  const roleOverride = matrix.overrides[ctx.role]?.[navId];
  if (typeof roleOverride === "boolean") return roleOverride;
  return fallbackDefault;
}
