"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { RunCard, type RunCardAction } from "@/components/run-card";
import type { RunCardData } from "@/lib/data/runs";

const COMPACT_COLS = "minmax(150px, 2fr) minmax(150px, 1.7fr) minmax(90px, 1fr) 132px 128px";

export function MyWorkBoard({ items }: { items: { run: RunCardData; action: RunCardAction | null }[] }) {
  const [view, setView] = useState<"compact" | "comfortable">("compact");
  const [fSearch, setFSearch] = useState("");
  const [fIndustry, setFIndustry] = useState("all");
  const [fMonth, setFMonth] = useState("all");
  const [fSla, setFSla] = useState("all");

  useEffect(() => {
    try { const v = localStorage.getItem("cadence-mywork-view"); if (v === "comfortable" || v === "compact") setView(v); } catch {}
  }, []);
  const set = (v: "compact" | "comfortable") => { setView(v); try { localStorage.setItem("cadence-mywork-view", v); } catch {} };

  const industryOptions = useMemo(() => [...new Set(items.map((i) => i.run.industry).filter(Boolean) as string[])].sort(), [items]);
  const monthOptions = useMemo(() => [...new Set(items.map((i) => i.run.contractStartDate?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse(), [items]);

  const visible = useMemo(() => {
    return items.filter(({ run }) => {
      const q = fSearch.trim().toLowerCase();
      if (q && !run.clientName.toLowerCase().includes(q) && !(run.amName ?? "").toLowerCase().includes(q)) return false;
      if (fIndustry !== "all" && run.industry !== fIndustry) return false;
      if (fMonth !== "all" && (run.contractStartDate ?? "").slice(0, 7) !== fMonth) return false;
      if (fSla !== "all" && run.sla !== fSla) return false;
      return true;
    });
  }, [items, fSearch, fIndustry, fMonth, fSla]);

  const filtersActive = !!fSearch.trim() || fIndustry !== "all" || fMonth !== "all" || fSla !== "all";
  const resetFilters = () => { setFSearch(""); setFIndustry("all"); setFMonth("all"); setFSla("all"); };

  const ctrl: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", fontSize: 12.5, background: "#fff", height: 32 };

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ position: "relative", flex: "1 1 200px" }}>
          <input value={fSearch} onChange={(e) => setFSearch(e.target.value)} placeholder="Search client…" style={{ ...ctrl, width: "100%", paddingLeft: 28 }} />
          <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none" }}><Icon name="search" size={13} /></span>
        </div>
        {industryOptions.length > 0 && (
          <select value={fIndustry} onChange={(e) => setFIndustry(e.target.value)} style={ctrl}>
            <option value="all">All industries</option>
            {industryOptions.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        )}
        {monthOptions.length > 0 && (
          <select value={fMonth} onChange={(e) => setFMonth(e.target.value)} style={ctrl}>
            <option value="all">All months</option>
            {monthOptions.map((m) => <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</option>)}
          </select>
        )}
        <select value={fSla} onChange={(e) => setFSla(e.target.value)} style={ctrl}>
          <option value="all">All SLA</option>
          <option value="on_track">On track</option>
          <option value="warning">At risk</option>
          <option value="breached">Overdue</option>
        </select>
        {filtersActive && <button className="btn-ghost" onClick={resetFilters} style={{ height: 32 }}><Icon name="x" size={12} /> Clear</button>}
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, padding: 3, gap: 2 }}>
          <button className={"tab-pill" + (view === "compact" ? " active" : "")} onClick={() => set("compact")}><Icon name="list" size={13} /> Compact</button>
          <button className={"tab-pill" + (view === "comfortable" ? " active" : "")} onClick={() => set("comfortable")}><Icon name="layout-grid" size={13} /> Comfortable</button>
        </div>
      </div>
      {view === "compact" ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: COMPACT_COLS, gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)" }}>
            <span>Client</span>
            <span>Stage</span>
            <span>Owner</span>
            <span>Status</span>
            <span style={{ textAlign: "right" }}>Progress</span>
          </div>
          {visible.length === 0 && <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>{filtersActive ? "No runs match the filters." : "No active runs."}</div>}
          {visible.map(({ run, action }, i) => (
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
          {visible.map(({ run, action }) => <RunCard key={run.id} run={run} action={action} />)}
        </div>
      )}
    </>
  );
}
