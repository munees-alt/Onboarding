import "server-only";
import { createAdminClient } from "./supabase/admin";
import { NAV } from "./nav";
import type { NavItem, Role } from "./types";

const ALL_ROLES: Role[] = ["admin", "ops_head", "am", "team_lead", "senior", "junior", "associate", "intern", "other"];

export interface AccessMatrix {
  /** All nav modules the org might toggle. */
  modules: { id: string; label: string; defaultRoles: Role[] | null }[];
  /** roles[role][navId] = true | false (override) or undefined (use default). */
  overrides: Partial<Record<Role, Partial<Record<string, boolean>>>>;
}

export async function getAccessMatrix(orgId: string): Promise<AccessMatrix> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("role_overrides")
    .select("role,nav_id,allow")
    .eq("org_id", orgId);
  const overrides: AccessMatrix["overrides"] = {};
  for (const r of data ?? []) {
    const role = r.role as Role;
    (overrides[role] ??= {})[r.nav_id] = !!r.allow;
  }
  return {
    modules: NAV.map((n) => ({ id: n.id, label: n.label, defaultRoles: n.roles ?? null })),
    overrides,
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
