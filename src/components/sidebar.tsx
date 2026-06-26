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
  const { me, effectiveRole, accessOverrides } = useIdentity();
  const items = visibleNav(effectiveRole).filter((n) => {
    const o = accessOverrides[effectiveRole]?.[n.id];
    if (typeof o === "boolean") return o;
    return true; // visibleNav already applied defaults
  }).concat(
    // Also restore items the default would hide but an override explicitly allows.
    Object.entries(accessOverrides[effectiveRole] ?? {})
      .filter(([, allow]) => allow === true)
      .map(([navId]) => {
        const base = visibleNav("admin").find((n) => n.id === navId);
        return base;
      })
      .filter((n): n is NonNullable<typeof n> => !!n && !visibleNav(effectiveRole).some((v) => v.id === n.id)),
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
