"use client";

import { useEffect } from "react";
import { Icon } from "@/components/icon";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="scroll">
      <div className="page">
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "48px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, maxWidth: 560, margin: "40px auto" }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--red-soft)", color: "var(--red)", display: "grid", placeItems: "center" }}><Icon name="alert-triangle" size={24} /></div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: "var(--ink-2)", background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontFamily: "DM Mono, monospace", wordBreak: "break-word", maxWidth: "100%" }}>
            {error.message || "Unexpected error"}
          </div>
          {error.digest && <div style={{ fontSize: 11, color: "var(--ink-4)" }}>Ref: {error.digest}</div>}
          <button className="btn-primary" onClick={reset}><Icon name="rotate-ccw" size={14} /> Try again</button>
        </div>
      </div>
    </div>
  );
}
