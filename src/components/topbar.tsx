"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icon";
import { useIdentity } from "./identity-context";
import { RaiseTicket } from "./raise-ticket";
import { NotificationsBell } from "./notifications-bell";
import { signOutAction } from "@/app/login/actions";
import { setViewAs, clearViewAs } from "@/app/(app)/view-as-actions";

export function Topbar({ onToggle }: { onToggle: () => void }) {
  const { me, isAdmin, orgMembers } = useIdentity();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isImpersonating = !!me.viewingAs;
  const realIsAdmin = isImpersonating ? me.viewingAs!.realRole === "admin" : me.role === "admin";

  const doViewAs = (memberId: string) => {
    startTransition(async () => {
      await setViewAs(memberId);
      router.refresh();
    });
  };

  const doExit = () => {
    startTransition(async () => {
      await clearViewAs();
      router.refresh();
    });
  };

  return (
    <>
      {/* Impersonation banner */}
      {isImpersonating && (
        <div style={{
          background: "#fef3c7", borderBottom: "1px solid #fcd34d",
          padding: "6px 16px", display: "flex", alignItems: "center", gap: 10,
          fontSize: 12.5, color: "#92400e",
        }}>
          <Icon name="eye" size={14} />
          <span>
            Viewing as <strong>{me.name}</strong>
            <span style={{ color: "#b45309", marginLeft: 4 }}>({me.role})</span>
            <span style={{ marginLeft: 6, color: "#b45309" }}>— you are still logged in as {me.viewingAs!.realName}</span>
          </span>
          <button
            onClick={doExit}
            disabled={pending}
            style={{
              marginLeft: "auto", background: "#92400e", color: "#fff",
              border: "none", borderRadius: 6, padding: "3px 10px", fontSize: 12,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <Icon name="x" size={12} /> Exit view
          </button>
        </div>
      )}

      <header className="topbar">
        <button className="icon-btn" onClick={onToggle} aria-label="Toggle sidebar">
          <Icon name="panel-left" size={18} />
        </button>
        <div className="spacer" />

        {/* Person-based View As — only for real admins */}
        {realIsAdmin && orgMembers.length > 0 && (
          <div className="role-switcher" style={{ minWidth: 180 }}>
            <span className="label">View as</span>
            <select
              value={isImpersonating ? me.memberId ?? "" : ""}
              disabled={pending}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) doExit();
                else doViewAs(v);
              }}
            >
              <option value="">— myself (admin) —</option>
              {orgMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.role}
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
    </>
  );
}
