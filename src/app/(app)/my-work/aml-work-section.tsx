"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";

type AmlClient = {
  clientId: string; clientName: string; status: string; runId: string | null; driveLink: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", in_review: "In Review", link_sent: "Link Sent", signed: "Signed",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "#94a3b8", in_review: "#d97706", link_sent: "#3b82f6", signed: "#8b5cf6",
};

export function AmlWorkSection({ clients }: { clients: AmlClient[] }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="section-head">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="file-lock" size={16} /> AML Compliance
          </h2>
          <div className="sub">Clients with pending AML review assigned to your team.</div>
        </div>
        <Link href="/aml" className="btn-ghost" style={{ fontSize: 12.5, textDecoration: "none" }}>
          Open AML page →
        </Link>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {clients.map((c) => (
          <div key={c.clientId} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Link href={`/clients/${c.clientId}`} style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink-1)", textDecoration: "none" }}>{c.clientName}</Link>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: STATUS_COLOR[c.status] ?? "#94a3b8", background: `${STATUS_COLOR[c.status] ?? "#94a3b8"}18`, padding: "3px 10px", borderRadius: 20 }}>
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
              {c.driveLink && (
                <a href={c.driveLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Icon name="folder-open" size={12} /> Drive
                </a>
              )}
              {c.runId && (
                <Link href={`/onboarding/${c.runId}`} style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                  <Icon name="file-text" size={12} /> AML Run
                </Link>
              )}
              <Link href="/aml" style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--ink-2)", textDecoration: "none" }}>
                Update status →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
