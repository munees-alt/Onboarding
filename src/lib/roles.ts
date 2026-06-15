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
export const canCreateRun = (r: Role) =>
  r === "admin" || r === "ops_head" || r === "am";
export const canAccessOnboarding = (r: Role) =>
  r === "admin" ||
  r === "ops_head" ||
  r === "am" ||
  r === "team_lead" ||
  r === "senior" ||
  r === "junior";
