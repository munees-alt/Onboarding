"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { closeAdminTask, reopenAdminTask, runAutoAdminTaskScan, bulkCloseAdminTasks } from "./actions";

export type AdminTaskItem = {
  id: string;
  kind: "zoho_followup" | "ct_reg_followup" | "vat_reg_followup" | "docs_overdue" | "access_overdue" | "weekly_update" | "compliance_alert" | string;
  title: string;
  body: string | null;
  runId: string | null;
  // step_id holds the weekly_client_updates.id when kind === "weekly_update".
  stepId: string | null;
  clientName: string | null;
  createdAt: string;
  status: "open" | "closed" | string;
  history: Array<{ at?: string; action?: string; notes?: string }>;
  notes: string | null;
};

const KIND_LABEL: Record<string, string> = {
  zoho_followup: "Zoho setup",
  ct_reg_followup: "CT registration",
  vat_reg_followup: "VAT registration",
  docs_overdue: "Documents",
  access_overdue: "Access",
  task_overdue: "Task overdue",
  weekly_update: "Weekly update",
  compliance_alert: "Compliance alert",
};

const KIND_COLOR: Record<string, string> = {
  zoho_followup: "#7e3aaf",
  ct_reg_followup: "#b91c1c",
  vat_reg_followup: "#b45309",
  docs_overdue: "#075985",
  access_overdue: "#15803d",
  task_overdue: "#92400e",
  weekly_update: "#ea580c",
  compliance_alert: "#dc2626",
};

function ageLabel(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtUtc(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function MyTasksSection({ items, canScan }: { items: AdminTaskItem[]; canScan: boolean }) {
  const [filter, setFilter] = useState<"open" | "closed">("open");
  const [pending, start] = useTransition();
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Multi-select state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkSaving, startBulk] = useTransition();

  const shown = items.filter((t) => (filter === "open" ? t.status === "open" : t.status === "closed"));
  const openCount = items.filter((t) => t.status === "open").length;
  const shownOpen = shown.filter((t) => t.status === "open");
  const allOpenSelected = shownOpen.length > 0 && shownOpen.every((t) => selected.has(t.id));

  const toggleItem = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allOpenSelected) {
      setSelected((prev) => { const next = new Set(prev); shownOpen.forEach((t) => next.delete(t.id)); return next; });
    } else {
      setSelected((prev) => { const next = new Set(prev); shownOpen.forEach((t) => next.add(t.id)); return next; });
    }
  };

  const selectedOpen = [...selected].filter((id) => shownOpen.some((t) => t.id === id));

  const doBulkClose = () => {
    if (!selectedOpen.length) return;
    startBulk(async () => {
      const res = await bulkCloseAdminTasks(selectedOpen, bulkNotes);
      if (res.ok) {
        setSelected(new Set());
        setBulkNotes("");
        setFlash(`${selectedOpen.length} item(s) closed.`);
        setTimeout(() => setFlash(null), 3000);
      }
    });
  };

  return (
    <div style={{ marginBottom: 28 }}>
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Action Items
            {openCount > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "var(--orange)", color: "#fff" }}>{openCount}</span>
            )}
          </h2>
          <div className="sub">Auto-created follow-ups and weekly client updates that need your attention. Close with notes to silence the cycle; re-fires if still unresolved.</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="tabs-row" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 3, gap: 2, display: "inline-flex" }}>
            <button className={"tab-pill" + (filter === "open" ? " active" : "")} onClick={() => setFilter("open")}>Open</button>
            <button className={"tab-pill" + (filter === "closed" ? " active" : "")} onClick={() => setFilter("closed")}>Closed</button>
          </div>
          {canScan && (
            <button
              className="btn ghost"
              disabled={scanning}
              onClick={() => {
                setScanning(true);
                runAutoAdminTaskScan().then((res) => {
                  setScanning(false);
                  if (res.ok) setFlash(`${res.created} new task(s) generated.`);
                  else setFlash("Scan failed.");
                  setTimeout(() => setFlash(null), 4000);
                });
              }}
            >
              <Icon name="refresh-cw" size={13} /> {scanning ? "Scanning…" : "Run scan now"}
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div style={{ background: "#ecfdf5", border: "1px solid #34d399", color: "#065f46", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>
          {flash}
        </div>
      )}

      {/* Bulk action bar — appears when ≥1 open item is checked */}
      {filter === "open" && selectedOpen.length > 0 && (
        <div style={{ background: "#fff7ed", border: "1px solid var(--orange)", borderRadius: 10, padding: "12px 14px", marginBottom: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Icon name="check-square" size={15} style={{ color: "var(--orange)" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--orange)" }}>{selectedOpen.length} item{selectedOpen.length === 1 ? "" : "s"} selected</span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Add a shared note and close all selected at once — same note applies to each.</span>
          </div>
          <textarea
            placeholder="Shared note (e.g. 'Discussed on Thursday call — all resolved') — applies to every selected item…"
            value={bulkNotes}
            onChange={(e) => setBulkNotes(e.target.value)}
            style={{ width: "100%", minHeight: 56, padding: 10, border: "1px solid var(--border)", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn primary"
              disabled={bulkSaving}
              onClick={doBulkClose}
            >
              {bulkSaving ? "Closing…" : `Close selected (${selectedOpen.length})`}
            </button>
            <button className="btn ghost" onClick={() => { setSelected(new Set()); setBulkNotes(""); }}>
              Clear selection
            </button>
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "32px 20px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
          {filter === "open" ? "Nothing for you to chase right now." : "No closed tasks in your history."}
        </div>
      ) : (
        <>
          {/* Select-all row — only for open items */}
          {filter === "open" && shownOpen.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", marginBottom: 6, fontSize: 12, color: "var(--ink-3)" }}>
              <input
                type="checkbox"
                checked={allOpenSelected}
                onChange={toggleAll}
                style={{ accentColor: "var(--orange)", cursor: "pointer" }}
              />
              <span style={{ cursor: "pointer" }} onClick={toggleAll}>
                {allOpenSelected ? "Deselect all" : `Select all ${shownOpen.length}`}
              </span>
            </div>
          )}
          <div style={{ display: "grid", gap: 10 }}>
            {shown.map((t) => (
              <AdminTaskCard
                key={t.id}
                t={t}
                pending={pending}
                start={start}
                selected={selected.has(t.id)}
                onToggle={filter === "open" ? () => toggleItem(t.id) : undefined}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AdminTaskCard({
  t, pending, start, selected, onToggle,
}: {
  t: AdminTaskItem;
  pending: boolean;
  start: (cb: () => void) => void;
  selected?: boolean;
  onToggle?: () => void;
}) {
  const [open, setOpen] = useState(t.status === "open");
  const [notes, setNotes] = useState("");
  const color = KIND_COLOR[t.kind] ?? "#475569";
  const label = KIND_LABEL[t.kind] ?? t.kind;
  const priorNotes = t.history.filter((h) => h.notes);

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderLeft: `3px solid ${color}`, borderRadius: 10, padding: "14px 16px", outline: selected ? `2px solid var(--orange)` : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1, minWidth: 0 }}>
          {/* Checkbox for open items */}
          {t.status === "open" && onToggle && (
            <input
              type="checkbox"
              checked={!!selected}
              onChange={onToggle}
              style={{ accentColor: "var(--orange)", cursor: "pointer", marginTop: 3, flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: color, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{ageLabel(t.createdAt)}</span>
              {t.kind === "weekly_update" && t.stepId ? (
                <Link href={`/weekly-updates/${t.stepId}`} style={{ fontSize: 11.5, color: "var(--orange)", textDecoration: "none" }}>
                  Open draft →
                </Link>
              ) : t.runId && (
                <Link href={`/onboarding/${t.runId}`} style={{ fontSize: 11.5, color: "var(--orange)", textDecoration: "none" }}>
                  Open run →
                </Link>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-1)", marginBottom: 4 }}>{t.title}</div>
            {t.body && (
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{t.body}</div>
            )}
          </div>
        </div>
        {t.status === "open" ? (
          <button className="btn ghost" onClick={() => setOpen((v) => !v)} style={{ flexShrink: 0 }}>
            {open ? "Hide" : "Add notes & close"}
          </button>
        ) : (
          <button
            className="btn ghost"
            disabled={pending}
            onClick={() => start(() => { reopenAdminTask(t.id); })}
            style={{ flexShrink: 0 }}
          >
            Re-open
          </button>
        )}
      </div>

      {priorNotes.length > 0 && (
        <details style={{ marginTop: 10, fontSize: 12 }}>
          <summary style={{ cursor: "pointer", color: "var(--ink-3)" }}>Prior notes ({priorNotes.length})</summary>
          <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
            {priorNotes.map((h, i) => (
              <div key={i} style={{ background: "var(--bg-soft)", padding: "8px 10px", borderRadius: 6 }}>
                <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginBottom: 3 }}>{fmtUtc(h.at)} · {h.action}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{h.notes}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {t.status === "open" && open && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <textarea
            placeholder="What did you find / who did you ping / what's next? These notes carry into the next auto re-fire."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ width: "100%", minHeight: 64, padding: 10, border: "1px solid var(--border)", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              className="btn ghost"
              disabled={pending}
              onClick={() => start(() => { closeAdminTask(t.id, ""); })}
            >
              Close (no notes)
            </button>
            <button
              className="btn primary"
              disabled={pending || !notes.trim()}
              onClick={() => start(() => { closeAdminTask(t.id, notes); })}
            >
              Save notes & close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
