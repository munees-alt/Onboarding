"use client";

import { useState } from "react";
import Link from "next/link";
import { auditAllClients, assignToAmlAction } from "../actions";

type AuditResult = {
  clientId: string; clientName: string; found: string[]; missing: string[];
};

const REQUIRED = ["Trade Licence", "MOA", "EID / Passport", "Incorporation Certificate"] as const;

export function DocAuditView() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<AuditResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "missing" | "complete">("all");
  const [amlBusy, setAmlBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: string; msg: string; color?: string }[]>([]);

  function toast(msg: string, color?: string) {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, color }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }

  async function runAudit() {
    setRunning(true);
    setError(null);
    setResults(null);
    const res = await auditAllClients();
    setRunning(false);
    if (res.error) { setError(res.error); return; }
    setResults(res.results);
  }

  async function assignAml(clientId: string, clientName: string) {
    setAmlBusy(clientId);
    const res = await assignToAmlAction(clientId);
    setAmlBusy(null);
    if (res.error) toast(res.error, "#dc2626");
    else toast(`${clientName} assigned to AML compliance`);
  }

  const complete = results?.filter((r) => r.missing.length === 0) ?? [];
  const withMissing = results?.filter((r) => r.missing.length > 0) ?? [];

  const visible = results
    ? filter === "missing"
      ? withMissing
      : filter === "complete"
        ? complete
        : results
    : null;

  return (
    <div>
      {/* Toasts */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 200, display: "flex", flexDirection: "column", gap: 8 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ background: t.color ?? "#16a34a", color: "#fff", padding: "10px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,.16)" }}>
            {t.msg}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
        <button className="btn-primary" onClick={runAudit} disabled={running}>
          {running ? "Scanning…" : results ? "Re-run scan" : "Run document audit"}
        </button>
        {results && !running && (
          <>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{results.length} signed clients scanned</span>
            <span style={{ fontSize: 13, color: withMissing.length > 0 ? "#dc2626" : "#16a34a", fontWeight: 600 }}>
              {withMissing.length > 0 ? `${withMissing.length} with missing docs` : "All clients complete"}
            </span>
            {complete.length > 0 && (
              <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>· {complete.length} ready for AML</span>
            )}
          </>
        )}
      </div>

      {error && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}

      {running && (
        <div style={{ padding: 32, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
          Scanning Drive and portal documents for all signed clients… this may take a minute.
        </div>
      )}

      {results && !running && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setFilter("all")} style={{ padding: "4px 14px", borderRadius: 20, border: "1px solid var(--border)", fontSize: 12, background: filter === "all" ? "var(--orange)" : "transparent", color: filter === "all" ? "#fff" : "var(--ink-2)", cursor: "pointer" }}>
              All ({results.length})
            </button>
            <button onClick={() => setFilter("complete")} style={{ padding: "4px 14px", borderRadius: 20, border: "1px solid var(--border)", fontSize: 12, background: filter === "complete" ? "#16a34a" : "transparent", color: filter === "complete" ? "#fff" : "var(--ink-2)", cursor: "pointer" }}>
              Complete — all docs ({complete.length})
            </button>
            <button onClick={() => setFilter("missing")} style={{ padding: "4px 14px", borderRadius: 20, border: "1px solid var(--border)", fontSize: 12, background: filter === "missing" ? "#dc2626" : "transparent", color: filter === "missing" ? "#fff" : "var(--ink-2)", cursor: "pointer" }}>
              Missing docs ({withMissing.length})
            </button>
          </div>

          {visible?.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "#16a34a", fontSize: 14, fontWeight: 600 }}>
              {filter === "missing" ? "No clients have missing documents." : "No results for this filter."}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visible?.map((r) => (
              <div
                key={r.clientId}
                style={{
                  background: "var(--card)",
                  border: `1px solid ${r.missing.length > 0 ? "#fca5a5" : "#bbf7d0"}`,
                  borderRadius: 10, padding: "12px 16px",
                  display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <Link href={`/clients/${r.clientId}`} style={{ fontWeight: 700, fontSize: 14, color: "var(--ink-1)", textDecoration: "none" }}>
                      {r.clientName}
                    </Link>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: r.missing.length === 0 ? "#dcfce7" : "#fee2e2", color: r.missing.length === 0 ? "#16a34a" : "#dc2626", fontWeight: 700 }}>
                      {r.missing.length === 0 ? "✓ All docs present" : `${r.missing.length} missing`}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {REQUIRED.map((doc) => {
                      const present = r.found.includes(doc);
                      return (
                        <span key={doc} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: present ? "#dcfce7" : "#fee2e2", color: present ? "#16a34a" : "#dc2626", fontWeight: 600 }}>
                          {present ? "✓" : "✗"} {doc}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  <button
                    className="btn-ghost"
                    disabled={amlBusy === r.clientId}
                    onClick={() => assignAml(r.clientId, r.clientName)}
                    style={{ fontSize: 12, color: "#7c3aed", borderColor: "#c4b5fd", padding: "4px 12px", whiteSpace: "nowrap" }}
                  >
                    {amlBusy === r.clientId ? "Assigning…" : "Assign to AML"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
