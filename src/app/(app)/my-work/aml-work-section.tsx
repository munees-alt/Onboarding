"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { updateAmlStatus } from "../clients/actions";

type AmlClient = {
  clientId: string; clientName: string; status: string; runId: string | null; driveLink: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", in_review: "In Review", link_sent: "Link Sent", signed: "Signed", completed: "Completed",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "#94a3b8", in_review: "#d97706", link_sent: "#3b82f6", signed: "#8b5cf6", completed: "#16a34a",
};
const ALL_STATUSES = ["pending", "in_review", "link_sent", "signed", "completed"] as const;

export function AmlWorkSection({ clients }: { clients: AmlClient[] }) {
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function changeStatus(clientId: string, newStatus: string) {
    setBusy(clientId);
    await updateAmlStatus(clientId, newStatus);
    setLocalStatuses((prev) => ({ ...prev, [clientId]: newStatus }));
    setBusy(null);
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div className="section-head">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="file-lock" size={16} /> AML Compliance — My Clients
          </h2>
          <div className="sub">AML reviews assigned to you. Update status as you progress.</div>
        </div>
        <Link href="/aml" className="btn-ghost" style={{ fontSize: 12.5, textDecoration: "none" }}>
          Full AML page →
        </Link>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {clients.map((c) => {
          const status = localStatuses[c.clientId] ?? c.status;
          return (
            <div key={c.clientId} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Link href={`/clients/${c.clientId}`} style={{ fontWeight: 700, fontSize: 14, color: "var(--ink-1)", textDecoration: "none" }}>
                    {c.clientName}
                  </Link>
                  <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Link href={`/clients/${c.clientId}`} style={{ fontSize: 12, color: "#7c3aed", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                      <Icon name="book-open" size={12} /> Open Playbook
                    </Link>
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
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[status] ?? "#94a3b8", background: `${STATUS_COLOR[status] ?? "#94a3b8"}18`, padding: "3px 10px", borderRadius: 20 }}>
                    {STATUS_LABEL[status] ?? status}
                  </span>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {ALL_STATUSES.filter(s => s !== status).map((s) => (
                      <button
                        key={s}
                        disabled={busy === c.clientId}
                        onClick={() => changeStatus(c.clientId, s)}
                        style={{
                          fontSize: 11, padding: "2px 8px", borderRadius: 6,
                          border: `1px solid ${STATUS_COLOR[s]}40`,
                          background: "transparent", color: STATUS_COLOR[s],
                          cursor: busy === c.clientId ? "wait" : "pointer",
                          opacity: busy === c.clientId ? 0.5 : 1,
                        }}
                      >
                        → {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
