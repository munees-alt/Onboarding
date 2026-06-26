"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { archiveUrgentRun } from "./actions";

type UrgentRun = {
  id: string;
  clientName: string;
  templateName: string;
  currentStageName: string | null;
  currentStage: number;
  progress: number;
  target: string | null;
  sla: string | null;
  amName: string | null;
};

export function UrgentRunsSection({ runs }: { runs: UrgentRun[] }) {
  const [list, setList] = useState(runs);
  const [pending, start] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const doArchive = (id: string) => {
    start(async () => {
      const res = await archiveUrgentRun(id);
      if (res.ok) {
        setList((prev) => prev.filter((r) => r.id !== id));
        setConfirmId(null);
      }
    });
  };

  if (!list.length) return null;

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <h2>Urgent compliance &amp; catch-up</h2>
          <div className="sub">Compliance pushes, renewals and prior-period catch-up runs assigned to you.</div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {list.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, background: "#fff", border: "1px solid var(--border)", borderLeft: "3px solid #b91c1c", borderRadius: 10, padding: "11px 14px" }}>
            <Link href={`/onboarding/${r.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{r.clientName}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{r.templateName} · {r.currentStageName ?? `Stage ${r.currentStage}`} · {r.progress}%</div>
            </Link>
            {r.target && <span style={{ fontSize: 11, color: r.sla === "breached" ? "var(--red)" : r.sla === "warning" ? "var(--amber)" : "var(--ink-3)" }}>Target {r.target}</span>}
            {r.amName && <span style={{ fontSize: 11, color: "var(--ink-3)" }}>AM · {r.amName}</span>}
            {/* Delete / archive button */}
            {confirmId === r.id ? (
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>Archive this run?</span>
                <button className="btn ghost" style={{ fontSize: 11.5, color: "#b91c1c", borderColor: "#b91c1c" }} disabled={pending} onClick={() => doArchive(r.id)}>
                  {pending ? "…" : "Confirm"}
                </button>
                <button className="btn ghost" style={{ fontSize: 11.5 }} onClick={() => setConfirmId(null)}>Cancel</button>
              </div>
            ) : (
              <button
                className="btn ghost"
                style={{ fontSize: 11.5, flexShrink: 0 }}
                title="Archive this run — e.g. client handling it themselves"
                onClick={() => setConfirmId(r.id)}
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
