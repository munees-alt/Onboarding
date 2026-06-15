"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { updateTicket } from "./actions";

export interface TicketRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  status: string;
  created_by_name: string | null;
  created_by_role: string | null;
  admin_note: string | null;
  created_at: string;
}

const KIND_PILL: Record<string, string> = { feature: "blue", suggestion: "purple", bug: "red" };
const STATUS_PILL: Record<string, string> = { open: "amber", in_progress: "blue", resolved: "green" };
const TABS = ["All", "Open", "In progress", "Resolved"] as const;

export function TicketsView({ tickets }: { tickets: TicketRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [busy, start] = useTransition();
  const [note, setNote] = useState<Record<string, string>>({});

  const filtered = tickets.filter((t) => tab === "All" || t.status === tab.toLowerCase().replace(" ", "_"));
  const act = (id: string, patch: { status?: string; admin_note?: string }) =>
    start(async () => { await updateTicket(id, patch); router.refresh(); });

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 940 }}>
        <div className="section-head">
          <div><h2>Requests</h2><div className="sub">Feature requests and suggestions raised by the team.</div></div>
          <div className="actions" style={{ display: "flex", gap: 6 }}>
            {TABS.map((t) => <button key={t} className={"tab-pill" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>{t}</button>)}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "60px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>No requests here.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filtered.map((t) => (
              <div key={t.id} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className={"pill " + (KIND_PILL[t.kind] ?? "gray")} style={{ fontSize: 10 }}>{t.kind}</span>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{t.title}</span>
                  <span className={"pill " + (STATUS_PILL[t.status] ?? "gray")} style={{ fontSize: 10, marginLeft: "auto" }}><span className="dot" /> {t.status.replace("_", " ")}</span>
                </div>
                {t.body && <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 8, lineHeight: 1.55 }}>{t.body}</div>}
                <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 8 }}>
                  {t.created_by_name ?? "Someone"}{t.created_by_role ? ` · ${t.created_by_role}` : ""} · {new Date(t.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    placeholder="Add a note (optional)…"
                    defaultValue={t.admin_note ?? ""}
                    onChange={(e) => setNote((n) => ({ ...n, [t.id]: e.target.value }))}
                    style={{ flex: 1, minWidth: 180, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12.5 }}
                  />
                  {t.status !== "in_progress" && t.status !== "resolved" && (
                    <button className="btn-ghost" disabled={busy} onClick={() => act(t.id, { status: "in_progress", admin_note: note[t.id] })}>Start</button>
                  )}
                  {t.status !== "resolved" ? (
                    <button className="btn-primary" disabled={busy} onClick={() => act(t.id, { status: "resolved", admin_note: note[t.id] })}>Resolve</button>
                  ) : (
                    <button className="btn-ghost" disabled={busy} onClick={() => act(t.id, { status: "open", admin_note: note[t.id] })}>Reopen</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
