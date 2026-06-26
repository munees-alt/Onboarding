"use client";

import { useState } from "react";
import { IdentityProvider, type Me, type AccessOverrides } from "./identity-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  me,
  accessOverrides,
  children,
}: {
  me: Me;
  accessOverrides?: AccessOverrides;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <IdentityProvider me={me} accessOverrides={accessOverrides}>
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
