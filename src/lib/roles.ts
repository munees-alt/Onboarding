import type { Role } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Master Admin",
  ops_head: "Ops Head",
  am: "Account Manager",
  team_lead: "Team Lead",
  senior: "Senior Accountant",
  junior: "Junior Accountant",
  associate: "Associate",
  intern: "Intern",
  other: "Team Member",
};

// Roles an admin can "view as" in the demo/role switcher.
export const SWITCHABLE_ROLES: Role[] = [
  "admin",
  "ops_head",
  "am",
  "team_lead",
  "senior",
  "junior",
];

export const canOpenSettings = (r: Role) => r === "admin" || r === "ops_head";
export const canOpenOrgChart = (r: Role) => r === "admin" || r === "ops_head";
export const canOpenAudit = (r: Role) => r === "admin" || r === "ops_head";
export const canSeeAllRuns = (r: Role) => r === "admin";
/** Master Admin only — gates editing of the client playbook (all other roles are view-only). */
export const isMasterAdmin = (r: Role) => r === "admin";
export const canCreateRun = (r: Role) =>
  r === "admin" || r === "ops_head" || r === "am";
export const canManageCoa = (r: Role) =>
  r === "admin" || r === "ops_head" || r === "am";

/**
 * Who can reveal client-shared login credentials (bank, gateway, accounting
 * software, FTA) in the team Onboarding Portal tab. Senior + Team Lead need this
 * to actually do the day-to-day account work. Junior and intern stay blocked
 * — they shouldn't see raw passwords. Every reveal is audit-logged.
 */
export const canRevealAccessCredentials = (r: Role) =>
  r === "admin" || r === "ops_head" || r === "am" || r === "team_lead" || r === "senior";
export const canAccessOnboarding = (r: Role) =>
  r === "admin" ||
  r === "ops_head" ||
  r === "am" ||
  r === "team_lead" ||
  r === "senior" ||
  r === "junior";
