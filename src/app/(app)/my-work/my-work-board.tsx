"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { RunCard, type RunCardAction } from "@/components/run-card";
import type { RunCardData } from "@/lib/data/runs";

export function MyWorkBoard({ items }: { items: { run: RunCardData; action: RunCardAction | null }[] }) {
  // Compact by default — onboarding desks can have many active runs at once.
  const [view, setView] = useState<"compact" | "comfortable">("compact");
  useEffect(() => {
    try { const v = localStorage.getItem("cadence-mywork-view"); if (v === "comfortable" || v === "compact") setView(v); } catch {}
  }, []);
  const set = (v: "compact" | "comfortable") => { setView(v); try { localStorage.setItem("cadence-mywork-view", v); } catch {} };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <div className="tabs-row" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 3, gap: 2, display: "inline-flex" }}>
          <button className={"tab-pill" + (view === "compact" ? " active" : "")} onClick={() => set("compact")}><Icon name="list" size={13} /> Compact</button>
          <button className={"tab-pill" + (view === "comfortable" ? " active" : "")} onClick={() => set("comfortable")}><Icon name="layout-grid" size={13} /> Comfortable</button>
        </div>
      </div>
      {view === "compact" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map(({ run, action }) => <RunCard key={run.id} run={run} action={action} compact />)}
        </div>
      ) : (
        <div className="mywork-grid">
          {items.map(({ run, action }) => <RunCard key={run.id} run={run} action={action} />)}
        </div>
      )}
    </>
  );
}
