"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { salesUploadFile } from "./actions";

const NAVY = "#082032";
const ORANGE = "#F97316";

type Done = { name: string; ok: boolean; error?: string };

export function SalesUploadView({ token, clientName, valid }: { token: string; clientName: string; valid: boolean }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done[]>([]);

  const upload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      const r = await salesUploadFile(token, fd);
      setDone((d) => [{ name: file.name, ok: !!r.ok, error: r.error }, ...d]);
    }
    setBusy(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FFF7E9", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 16px 48px" }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        {/* Brand bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "22px 4px 18px" }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: NAVY, display: "grid", placeItems: "center", color: ORANGE }}><Icon name="gauge" size={20} strokeWidth={2.2} /></span>
          <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", color: NAVY }}>Finan<span style={{ color: ORANGE }}>shels</span></span>
        </div>

        {!valid ? (
          <div style={{ background: "#fff", borderRadius: 16, padding: "40px 28px", textAlign: "center", border: "1px solid #F0E6D2" }}>
            <Icon name="alert-triangle" size={28} style={{ color: ORANGE }} />
            <div style={{ marginTop: 12, fontSize: 16, fontWeight: 700, color: NAVY }}>This link is invalid or has expired</div>
            <div style={{ marginTop: 6, fontSize: 13.5, color: "#51606E" }}>Please ask the onboarding team for a fresh link.</div>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 16, padding: "26px 26px 30px", border: "1px solid #F0E6D2", boxShadow: "0 16px 50px rgba(8,32,50,0.08)" }}>
            <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em", color: NAVY, margin: 0 }}>Share documents for {clientName}</h1>
            <p style={{ fontSize: 13.5, color: "#51606E", lineHeight: 1.6, marginTop: 8 }}>
              Upload any documents the Sales team already collected for this client. They go straight to the secure client folder and are marked as received, so the onboarding team won&apos;t ask for them again.
            </p>

            <label style={{ display: "block", marginTop: 18, border: "2px dashed " + (busy ? "#D9C7A6" : ORANGE), borderRadius: 14, padding: "34px 20px", textAlign: "center", cursor: busy ? "default" : "pointer", background: "#FFFBF3" }}>
              <input type="file" multiple disabled={busy} style={{ display: "none" }} onChange={(e) => upload(e.target.files)} />
              <Icon name={busy ? "loader" : "upload-cloud"} size={28} style={{ color: ORANGE }} />
              <div style={{ marginTop: 10, fontSize: 14.5, fontWeight: 700, color: NAVY }}>{busy ? "Uploading…" : "Click to choose files"}</div>
              <div style={{ marginTop: 4, fontSize: 12, color: "#8794A0" }}>You can select multiple files · up to 25 MB each</div>
            </label>

            {done.length > 0 && (
              <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                {done.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "8px 12px", borderRadius: 9, background: d.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)", border: "1px solid " + (d.ok ? "#BBE7C6" : "#F2C2C2") }}>
                    <Icon name={d.ok ? "check-circle" : "x-circle"} size={15} style={{ color: d.ok ? "#15803D" : "#DC2626", flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: NAVY }}>{d.name}</span>
                    <span style={{ fontSize: 11.5, color: d.ok ? "#15803D" : "#DC2626" }}>{d.ok ? "Received" : (d.error ?? "Failed")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#8794A0", marginTop: 18 }}>Finanshels — Accounting &amp; Tax, done right.</div>
      </div>
    </div>
  );
}
