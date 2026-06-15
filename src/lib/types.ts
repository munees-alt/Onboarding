export type Role =
  | "admin"
  | "ops_head"
  | "am"
  | "team_lead"
  | "senior"
  | "junior"
  | "associate"
  | "intern"
  | "other";

export interface TeamMember {
  id: string;
  org_id: string;
  full_name: string;
  email: string | null;
  role: Role;
  title: string | null;
  dept: string | null;
  location: string | null;
  reports_to: string | null;
  avatar_initials: string | null;
  avatar_color: string | null;
  is_demo: boolean;
  active: boolean;
  sort: number;
}

export interface Profile {
  id: string;
  org_id: string | null;
  email: string | null;
  full_name: string | null;
  team_member_id: string | null;
  role: Role;
}

export interface Org {
  id: string;
  name: string;
}

export interface SessionInfo {
  userId: string;
  email: string | null;
  profile: Profile;
  teamMember: TeamMember | null;
  org: Org | null;
}

export interface NavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
  badge?: string;
  badgeKind?: "ai";
  stub?: boolean;
  roles?: Role[]; // if set, only these roles see it
  group: "primary" | "more" | "admin";
}
