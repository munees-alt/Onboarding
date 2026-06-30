"use client";

import { useState } from "react";
import { IdentityProvider, type Me, type AccessOverrides, type DeptOverrides, type UserOverrides, type OrgMember } from "./identity-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  me,
  accessOverrides,
  deptOverrides,
  userOverrides,
  currentUserDept,
  orgMembers = [],
  children,
}: {
  me: Me;
  accessOverrides?: AccessOverrides;
  deptOverrides?: DeptOverrides;
  userOverrides?: UserOverrides;
  currentUserDept?: string | null;
  orgMembers?: OrgMember[];
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <IdentityProvider
      me={me}
      accessOverrides={accessOverrides}
      deptOverrides={deptOverrides}
      userOverrides={userOverrides}
      currentUserDept={currentUserDept}
      orgMembers={orgMembers}
    >
      <div className={"app" + (expanded ? " expanded" : "")}>
        <Sidebar expanded={expanded} />
        <div className="main">
          <Topbar onToggle={() => setExpanded((v) => !v)} />
          {children}
        </div>
      </div>
    </IdentityProvider>
  );
}
