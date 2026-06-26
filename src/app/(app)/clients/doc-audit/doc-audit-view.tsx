"use client";

import { useState } from "react";
import Link from "next/link";
import { auditAllClients } from "../actions";

type AuditResult = { clientId: string; clientName: string; found: string[]; missing: string[] };

const REQUIRED = ["Trade Licence", "MOA", "EID / Passport", "Incorporation Certificate"] as const;

export function DocAuditView() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<AuditResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "missing">("missing");

  async function runAudit() {
    setRunning(true);
    setError(null);
    setResults(null);
    const res = await auditAllClients();
    setRunning(false);
    if (res.error) { setError(res.error); return; }
    setResults(res.results);
  }

  const visible = results
    ? filter === "missing"
      ? results.filter((r) => r.missing.length > 0)
      : results
    : null;

  const totalMissing = results?.filter((r) => r.missing.length > 0).length ?? 0;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
        <button className="btn-primary" onClick={runAudit} disabled={running}>
          {running ? "Scanning…" : results ? "Re-run scan" : "Run document audit"}
        </button>
        {results && !running && (
          <>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{results.length} clients scanned</span>
            <span style={{ fontSize: 13, color: totalMissing > 0 ? "#dc2626" : "#16a34a", fontWeight: 600 }}>
              {totalMissing > 0 ? `${totalMissing} with missing docs` : "All clients complete"}
            </span>
          </>
        )}
      </div>

      {error && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#dc2626", marginBottom: 16 }}>{error}</div>}

      {running && (
        <div style={{ padding: 32, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
          Scanning Drive and portal documents for all clients… this may take a minute.
        </div>
      )}

      {results && !running && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => setFilter("missing")} style={{ padding: "4px 14px", borderRadius: 20, border: "1px solid var(--border)", fontSize: 12, background: filter === "missing" ? "#dc2626" : "transparent", color: filter === "missing" ? "#fff" : "var(--ink-2)", cursor: "pointer" }}>
              Missing only ({totalMissing})
            </button>
            <button onClick={() => setFilter("all")} style={{ padding: "4px 14px", borderRadius: 20, border: "1px solid var(--border)", fontSize: 12, background: filter === "all" ? "var(--orange)" : "transparent", color: filter === "all" ? "#fff" : "var(--ink-2)", cursor: "pointer" }}>
              All ({results.length})
            </button>
          </div>

          {visible?.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "#16a34a", fontSize: 14, fontWeight: 600 }}>
              All clients have the required documents.
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visible?.map((r) => (
              <div key={r.clientId} style={{ background: "var(--card)", border: `1px solid ${r.missing.length > 0 ? "#fca5a5" : "var(--border)"}`, borderRadius: 10, padding: "12px 16px", display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start" }}>
                <div>
                  <Link href={`/clients/${r.clientId}`} style={{ fontWeight: 700, fontSize: 14, color: "var(--ink-1)", textDecoration: "none" }}>{r.clientName}</Link>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
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
                <div style={{ fontSize: 12, color: r.missing.length > 0 ? "#dc2626" : "#16a34a", fontWeight: 700, whiteSpace: "nowrap" }}>
                  {r.missing.length > 0 ? `${r.missing.length} missing` : "Complete"}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
