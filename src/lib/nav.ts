import type { NavItem, Role } from "./types";

// Cadence navigation. `stub: true` → "Coming soon" placeholder (Templates, SOP,
// Run, Process Intel, All Runs). Everything else is fully built.
export const NAV: NavItem[] = [
  { id: "my-work", label: "My Work", icon: "inbox", href: "/my-work", group: "primary" },
  { id: "onboarding", label: "Onboarding", icon: "user-plus", href: "/onboarding", group: "primary",
    roles: ["admin", "ops_head", "am", "team_lead", "senior", "junior"] },
  { id: "clients", label: "Clients", icon: "users", href: "/clients", group: "primary" },
  { id: "connections", label: "My Connections", icon: "plug", href: "/connections", group: "primary" },

  { id: "all-runs", label: "All Runs", icon: "radar", href: "/all-runs", group: "more", stub: true, roles: ["admin"] },
  { id: "process-intel", label: "Process Intel", icon: "brain-circuit", href: "/process-intel", group: "more", stub: true, badge: "AI", badgeKind: "ai" },
  { id: "templates", label: "Templates", icon: "file-text", href: "/templates", group: "more", stub: true },
  { id: "sop", label: "SOP Library", icon: "book-open", href: "/sop", group: "more" },
  { id: "create-run", label: "Create Run", icon: "plus-circle", href: "/create-run", group: "more", stub: true, roles: ["admin", "ops_head", "am"] },

  { id: "org-chart", label: "Org Chart", icon: "network", href: "/org-chart", group: "admin", roles: ["admin", "ops_head"] },
  { id: "tickets", label: "Requests", icon: "lightbulb", href: "/tickets", group: "admin", roles: ["admin", "ops_head"] },
  { id: "audit-log", label: "Audit Log", icon: "shield-check", href: "/audit-log", group: "admin", roles: ["admin", "ops_head"] },
  { id: "settings", label: "Settings", icon: "settings", href: "/settings", group: "admin", roles: ["admin", "ops_head"] },
];

export function visibleNav(role: Role): NavItem[] {
  return NAV.filter((n) => !n.roles || n.roles.includes(role));
}
