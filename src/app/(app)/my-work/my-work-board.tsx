"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { RunCard, type RunCardAction } from "@/components/run-card";
import type { RunCardData } from "@/lib/data/runs";

const COMPACT_COLS = "minmax(150px, 2fr) minmax(150px, 1.7fr) minmax(90px, 1fr) 132px 128px";

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
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
          {/* Header row */}
          <div style={{ display: "grid", gridTemplateColumns: COMPACT_COLS, gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)" }}>
            <span>Client</span>
            <span>Stage</span>
            <span>Owner</span>
            <span>Status</span>
            <span style={{ textAlign: "right" }}>Progress</span>
          </div>
          {items.length === 0 && <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>No active runs.</div>}
          {items.map(({ run, action }, i) => (
            <Link key={run.id} href={`/onboarding/${run.id}`} className="mywork-row" style={{ display: "grid", gridTemplateColumns: COMPACT_COLS, gap: 12, alignItems: "center", padding: "11px 16px", borderTop: i === 0 ? "none" : "1px solid var(--border)", textDecoration: "none", color: "inherit" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.clientName}</div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.templateName}</div>
              </div>
              <div style={{ minWidth: 0, fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span style={{ color: "var(--ink-3)" }}>St {run.currentStage}/{run.stageCount}</span> · {run.currentStageName ?? "—"}
              </div>
              <div style={{ minWidth: 0, fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.amName ?? "—"}</div>
              <div style={{ minWidth: 0 }}>
                {action ? (
                  <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap", background: action.mine ? "var(--orange-soft)" : "var(--bg)", color: action.mine ? "var(--orange)" : "var(--ink-3)", border: "1px solid " + (action.mine ? "var(--orange)" : "var(--border)") }}>
                    {action.mine ? "Your step" : `Waiting · ${action.waitingRole ?? "team"}`}
                  </span>
                ) : <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>—</span>}
              </div>
              <div>
                <div className="progress orange"><i style={{ width: `${run.progress}%` }} /></div>
                <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3, textAlign: "right" }}>{run.progress}%</div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mywork-grid">
          {items.map(({ run, action }) => <RunCard key={run.id} run={run} action={action} />)}
        </div>
      )}
    </>
  );
}
