"use client";

import { useState } from "react";
import { IdentityProvider, type Me } from "./identity-context";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  me,
  children,
}: {
  me: Me;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <IdentityProvider me={me}>
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
