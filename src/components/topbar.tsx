"use client";

import { Icon } from "./icon";
import { useIdentity } from "./identity-context";
import { RaiseTicket } from "./raise-ticket";
import { NotificationsBell } from "./notifications-bell";
import { ROLE_LABEL, SWITCHABLE_ROLES } from "@/lib/roles";
import { signOutAction } from "@/app/login/actions";
import type { Role } from "@/lib/types";

export function Topbar({ onToggle }: { onToggle: () => void }) {
  const { me, effectiveRole, setEffectiveRole, isAdmin } = useIdentity();

  return (
    <header className="topbar">
      <button className="icon-btn" onClick={onToggle} aria-label="Toggle sidebar">
        <Icon name="panel-left" size={18} />
      </button>
      <div className="spacer" />

      {isAdmin && (
        <div className="role-switcher">
          <span className="label">View as</span>
          <select
            value={effectiveRole}
            onChange={(e) => setEffectiveRole(e.target.value as Role)}
          >
            {SWITCHABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-down"
            size={14}
            style={{ position: "absolute", right: 10, pointerEvents: "none", color: "var(--ink-3)" }}
          />
        </div>
      )}

      <RaiseTicket />
      <NotificationsBell memberId={me.memberId} />
      <form action={signOutAction}>
        <button className="logout" type="submit">
          <Icon name="log-out" size={16} />
          <span>Logout</span>
        </button>
      </form>
    </header>
  );
}
