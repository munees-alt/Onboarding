"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Role } from "@/lib/types";

export interface Me {
  role: Role;
  name: string;
  initials: string;
  color: string;
  email: string | null;
  memberId: string | null;
  viewingAs?: { realName: string; realMemberId: string | null; realRole: Role } | null;
}

export interface OrgMember {
  id: string;
  name: string;
  role: string;
  initials: string;
  color: string;
}

/** Master-Admin role-overrides for nav visibility. Shape: { [role]: { [navId]: allow } }. */
export type AccessOverrides = Partial<Record<Role, Partial<Record<string, boolean>>>>;

interface IdentityCtx {
  me: Me;
  effectiveRole: Role;
  setEffectiveRole: (r: Role) => void;
  isAdmin: boolean;
  accessOverrides: AccessOverrides;
  orgMembers: OrgMember[];
}

const Ctx = createContext<IdentityCtx | null>(null);

export function IdentityProvider({
  me,
  accessOverrides = {},
  orgMembers = [],
  children,
}: {
  me: Me;
  accessOverrides?: AccessOverrides;
  orgMembers?: OrgMember[];
  children: React.ReactNode;
}) {
  const isAdmin = me.role === "admin" || me.viewingAs?.realRole === "admin";
  const [viewAs, setViewAs] = useState<Role>(me.role);

  useEffect(() => {
    if (!isAdmin) return;
    const saved = localStorage.getItem("cadence-view-as");
    if (saved) setViewAs(saved as Role);
  }, [isAdmin]);

  const setEffectiveRole = (r: Role) => {
    setViewAs(r);
    if (isAdmin) localStorage.setItem("cadence-view-as", r);
  };

  return (
    <Ctx.Provider
      value={{
        me,
        effectiveRole: isAdmin ? viewAs : me.role,
        setEffectiveRole,
        isAdmin,
        accessOverrides,
        orgMembers,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useIdentity(): IdentityCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useIdentity must be used within IdentityProvider");
  return c;
}
