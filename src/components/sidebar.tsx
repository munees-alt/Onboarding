"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { useIdentity } from "./identity-context";
import { visibleNav } from "@/lib/nav";
import type { NavItem } from "@/lib/types";

const GROUP_LABEL: Record<NavItem["group"], string | null> = {
  primary: null,
  more: "More",
  admin: "Admin",
};

export function Sidebar({ expanded }: { expanded: boolean }) {
  const pathname = usePathname();
  const { me, effectiveRole, accessOverrides, deptOverrides, userOverrides, currentUserDept } = useIdentity();

  // Three-tier resolution: user override → dept override → role override → visibleNav default.
  const resolveAccess = (navId: string): boolean | null => {
    const memberId = me.memberId;
    // 1. User-specific override (highest priority)
    if (memberId) {
      const u = userOverrides[memberId]?.[navId];
      if (typeof u === "boolean") return u;
    }
    // 2. Department override
    if (currentUserDept) {
      const d = deptOverrides[currentUserDept]?.[navId];
      if (typeof d === "boolean") return d;
    }
    // 3. Role override
    const r = accessOverrides[effectiveRole]?.[navId];
    if (typeof r === "boolean") return r;
    // 4. Default (let visibleNav decide)
    return null;
  };

  const items = visibleNav(effectiveRole).filter((n) => {
    const resolved = resolveAccess(n.id);
    if (typeof resolved === "boolean") return resolved;
    return true; // visibleNav already applied defaults
  }).concat(
    // Also restore items the default would hide but an override explicitly allows.
    (() => {
      const allNavIds = new Set([
        ...Object.keys(accessOverrides[effectiveRole] ?? {}),
        ...Object.keys(currentUserDept ? (deptOverrides[currentUserDept] ?? {}) : {}),
        ...Object.keys(me.memberId ? (userOverrides[me.memberId] ?? {}) : {}),
      ]);
      return [...allNavIds]
        .filter((navId) => resolveAccess(navId) === true)
        .map((navId) => visibleNav("admin").find((n) => n.id === navId))
        .filter((n): n is NonNullable<typeof n> => !!n && !visibleNav(effectiveRole).some((v) => v.id === n.id));
    })(),
  );

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const groups: NavItem["group"][] = ["primary", "more", "admin"];

  return (
    <aside className={"rail" + (expanded ? "" : " rail-collapsed")}>
      <div className="rail-head">
        <div className="rail-logo">
          <Icon name="gauge" size={20} strokeWidth={2.2} />
        </div>
        {expanded && (
          <div className="rail-title-block">
            <div className="rail-title">Cadence</div>
            <div className="rail-sub">Finanshels</div>
          </div>
        )}
      </div>

      <div style={{ overflowY: "auto", flex: 1, paddingBottom: 8 }}>
        {groups.map((g) => {
          const groupItems = items.filter((n) => n.group === g);
          if (!groupItems.length) return null;
          const label = GROUP_LABEL[g];
          return (
            <div className="rail-section" key={g}>
              {expanded && label && (
                <div className="rail-section-label">{label}</div>
              )}
              {groupItems.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  className={"rail-item" + (isActive(n.href) ? " active" : "")}
                  title={n.label}
                  style={{ textDecoration: "none" }}
                >
                  <Icon name={n.icon} size={16} strokeWidth={1.75} />
                  {expanded && <span className="rail-label">{n.label}</span>}
                  {n.badge && expanded && (
                    <span className={"rail-badge" + (n.badgeKind === "ai" ? " ai" : "")}>
                      {n.badge}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          );
        })}
      </div>

      <div className="rail-foot">
        <div className="avatar" style={{ background: me.color }}>
          {me.initials}
        </div>
        {expanded && (
          <div>
            <div className="name">{me.name}</div>
            <div className="email">{me.email}</div>
          </div>
        )}
      </div>
    </aside>
  );
}
