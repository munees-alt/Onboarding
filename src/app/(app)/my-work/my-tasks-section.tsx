"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { closeAdminTask, reopenAdminTask, runAutoAdminTaskScan, bulkCloseAdminTasks, deleteAdminTask, snoozeAdminTask } from "./actions";

export type AdminTaskItem = {
  id: string;
  kind: "zoho_followup" | "ct_reg_followup" | "vat_reg_followup" | "docs_overdue" | "access_overdue" | "weekly_update" | "compliance_alert" | string;
  title: string;
  body: string | null;
  runId: string | null;
  stepId: string | null;
  clientName: string | null;
  createdAt: string;
  status: "open" | "closed" | string;
  history: Array<{ at?: string; action?: string; notes?: string }>;
  notes: string | null;
  snoozedUntil: string | null;
  holdNote: string | null;
};

const KIND_LABEL: Record<string, string> = {
  zoho_followup: "Zoho",
  ct_reg_followup: "CT reg",
  vat_reg_followup: "VAT reg",
  docs_overdue: "Documents",
  access_overdue: "Access",
  task_overdue: "Task overdue",
  weekly_update: "Weekly update",
  compliance_alert: "Compliance",
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

const DAY_MS = 86_400_000;

function ageMs(iso: string) {
  return Date.now() - new Date(iso).getTime();
}

function ageLabel(iso: string) {
  const ms = ageMs(iso);
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function MyTasksSection({
  items,
  canScan,
  canDelete,
  canSnooze,
}: {
  items: AdminTaskItem[];
  canScan: boolean;
  canDelete?: boolean;
  canSnooze?: boolean;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [pending, start] = useTransition();
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkSaving, startBulk] = useTransition();

  const now = Date.now();
  const openItems = items.filter((t) => t.status === "open" && !(t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now));
  const snoozedItems = items.filter((t) => t.status === "open" && t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now);
  const closedItems = items.filter((t) => t.status === "closed");
  const overdue = openItems.filter((t) => ageMs(t.createdAt) >= DAY_MS);
  const today = openItems.filter((t) => ageMs(t.createdAt) < DAY_MS);

  const selectedOpen = [...selected].filter((id) => openItems.some((t) => t.id === id));

  const toggleItem = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectGroup = (group: AdminTaskItem[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      group.forEach((t) => next.add(t.id));
      return next;
    });

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
      {/* Header */}
      <div className="section-head" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Action Items
            {openItems.length > 0 && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: overdue.length > 0 ? "#dc2626" : "var(--orange)",
                  color: "#fff",
                }}
              >
                {openItems.length}
              </span>
            )}
          </h2>
          <div className="sub">
            Only your assigned tasks. Escalates to next level after 2 days unresolved. Close to remove from chain.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {canScan && (
            <button
              className="btn ghost"
              disabled={scanning}
              onClick={() => {
                setScanning(true);
                runAutoAdminTaskScan().then((res) => {
                  setScanning(false);
                  setFlash(res.ok ? `${res.created} new task(s) generated.` : "Scan failed.");
                  setTimeout(() => setFlash(null), 4000);
                });
              }}
            >
              <Icon name="refresh-cw" size={13} /> {scanning ? "Scanning…" : "Run scan"}
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #34d399",
            color: "#065f46",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12.5,
            marginBottom: 10,
          }}
        >
          {flash}
        </div>
      )}

      {/* Bulk action bar */}
      {selectedOpen.length > 0 && (
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid var(--orange)",
            borderRadius: 10,
            padding: "12px 14px",
            marginBottom: 12,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icon name="check-square" size={15} style={{ color: "var(--orange)" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--orange)" }}>
              {selectedOpen.length} selected
            </span>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              Add a shared note and close all at once.
            </span>
          </div>
          <textarea
            placeholder="Shared note (optional) — applies to all selected…"
            value={bulkNotes}
            onChange={(e) => setBulkNotes(e.target.value)}
            style={{
              width: "100%",
              minHeight: 48,
              padding: 10,
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12.5,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={bulkSaving} onClick={doBulkClose}>
              {bulkSaving ? "Closing…" : `Close ${selectedOpen.length} items`}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setSelected(new Set());
                setBulkNotes("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {openItems.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "32px 20px",
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 13,
          }}
        >
          Nothing assigned to you right now.
        </div>
      ) : (
        <>
          {/* OVERDUE — 1+ day old */}
          {overdue.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                  padding: "6px 10px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#dc2626",
                    flexShrink: 0,
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#dc2626",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    flex: 1,
                  }}
                >
                  Overdue — {overdue.length} item{overdue.length !== 1 ? "s" : ""}
                </span>
                <button
                  style={{
                    fontSize: 11,
                    color: "#dc2626",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                  onClick={() => selectGroup(overdue)}
                >
                  Select all
                </button>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {overdue.map((t) => (
                  <TaskCard
                    key={t.id}
                    t={t}
                    pending={pending}
                    start={start}
                    selected={selected.has(t.id)}
                    onToggle={() => toggleItem(t.id)}
                    canDelete={canDelete}
                    canSnooze={canSnooze}
                    isOverdue
                  />
                ))}
              </div>
            </div>
          )}

          {/* TODAY — less than 1 day old */}
          {today.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 8,
                  padding: "6px 10px",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 8,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#f59e0b",
                    flexShrink: 0,
                    display: "inline-block",
                  }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#b45309",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    flex: 1,
                  }}
                >
                  Today — {today.length} item{today.length !== 1 ? "s" : ""}
                </span>
                <button
                  style={{
                    fontSize: 11,
                    color: "#b45309",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    textDecoration: "underline",
                  }}
                  onClick={() => selectGroup(today)}
                >
                  Select all
                </button>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {today.map((t) => (
                  <TaskCard
                    key={t.id}
                    t={t}
                    pending={pending}
                    start={start}
                    selected={selected.has(t.id)}
                    onToggle={() => toggleItem(t.id)}
                    canDelete={canDelete}
                    canSnooze={canSnooze}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* SNOOZED — on hold until a future date */}
      {snoozedItems.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#6b21a8",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
              marginBottom: showSnoozed ? 8 : 0,
            }}
            onClick={() => setShowSnoozed((v) => !v)}
          >
            <Icon name={showSnoozed ? "chevron-down" : "chevron-right"} size={13} />
            On hold — {snoozedItems.length} item{snoozedItems.length !== 1 ? "s" : ""} (waiting)
          </button>
          {showSnoozed && (
            <div style={{ display: "grid", gap: 6 }}>
              {snoozedItems.map((t) => (
                <TaskCard
                  key={t.id}
                  t={t}
                  pending={pending}
                  start={start}
                  canDelete={canDelete}
                  canSnooze={canSnooze}
                  isSnoozed
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* RESOLVED — collapsed by default */}
      {closedItems.length > 0 && (
        <div>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ink-3)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
              marginBottom: showClosed ? 8 : 0,
            }}
            onClick={() => setShowClosed((v) => !v)}
          >
            <Icon name={showClosed ? "chevron-down" : "chevron-right"} size={13} />
            Resolved — {closedItems.length} item{closedItems.length !== 1 ? "s" : ""}
          </button>
          {showClosed && (
            <div style={{ display: "grid", gap: 6 }}>
              {closedItems.slice(0, 30).map((t) => (
                <TaskCard key={t.id} t={t} pending={pending} start={start} canDelete={canDelete} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  t,
  pending,
  start,
  selected,
  onToggle,
  canDelete,
  canSnooze,
  isOverdue,
  isSnoozed,
}: {
  t: AdminTaskItem;
  pending: boolean;
  start: (cb: () => void) => void;
  selected?: boolean;
  onToggle?: () => void;
  canDelete?: boolean;
  canSnooze?: boolean;
  isOverdue?: boolean;
  isSnoozed?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const [deleting, startDelete] = useTransition();
  const [confirmDel, setConfirmDel] = useState(false);
  const [showHoldForm, setShowHoldForm] = useState(false);
  const [holdDate, setHoldDate] = useState("");
  const [holdComment, setHoldComment] = useState(t.holdNote ?? "");
  const [holdSaving, startHold] = useTransition();

  const color = KIND_COLOR[t.kind] ?? "#475569";
  const label = KIND_LABEL[t.kind] ?? t.kind;
  const age = ageLabel(t.createdAt);
  const isOpen = t.status === "open";
  const borderColor = isSnoozed ? "#7e22ce" : isOverdue ? "#dc2626" : color;
  const priorNotes = t.history.filter((h) => h.notes);

  const snoozeUntilDisplay = t.snoozedUntil
    ? new Date(t.snoozedUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  // Extract escalation prefix if present
  const isEscalated = t.title.startsWith("[Escalated]") || t.title.startsWith("[1 week");
  const displayTitle = t.title
    .replace(/^\[Escalated\]\s*/, "")
    .replace(/^\[1 week unresolved\]\s*/, "");

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 10,
        padding: "10px 14px",
        outline: selected ? "2px solid var(--orange)" : undefined,
      }}
    >
      {/* Main row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {isOpen && onToggle && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={onToggle}
            style={{ accentColor: "var(--orange)", cursor: "pointer", flexShrink: 0 }}
          />
        )}

        {/* Escalation badge */}
        {isEscalated && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 999,
              background: "#dc2626",
              color: "#fff",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              flexShrink: 0,
            }}
          >
            ↑ Escalated
          </span>
        )}

        {/* Type badge */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 999,
            background: color,
            color: "#fff",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            flexShrink: 0,
          }}
        >
          {label}
        </span>

        {/* Client name — most important */}
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 700,
            color: "var(--ink-1)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={displayTitle}
        >
          {t.clientName ?? displayTitle}
        </span>

        {/* Age */}
        <span
          style={{
            fontSize: 11,
            color: isOverdue ? "#dc2626" : "var(--ink-3)",
            fontWeight: isOverdue ? 700 : 400,
            flexShrink: 0,
          }}
        >
          {age}
        </span>

        {/* Action buttons */}
        {isOpen ? (
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button
              className="btn ghost"
              style={{ fontSize: 11.5, padding: "3px 10px" }}
              disabled={pending}
              onClick={() => start(() => { closeAdminTask(t.id, ""); })}
            >
              Close
            </button>
            <button
              className="btn ghost"
              style={{ fontSize: 11.5, padding: "3px 10px" }}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide" : "Note"}
            </button>
            {canSnooze && (
              <button
                className="btn ghost"
                style={{ fontSize: 11.5, padding: "3px 10px", color: "#7e22ce", borderColor: "#c4b5fd" }}
                onClick={() => { setShowHoldForm((v) => !v); setExpanded(false); }}
              >
                {isSnoozed ? "Edit hold" : "Hold"}
              </button>
            )}
            {(t.runId || t.stepId) && (
              <Link
                href={
                  t.kind === "weekly_update" && t.stepId
                    ? `/weekly-updates/${t.stepId}`
                    : `/onboarding/${t.runId}`
                }
                style={{
                  fontSize: 11.5,
                  padding: "3px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--orange)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Open →
              </Link>
            )}
          </div>
        ) : (
          <button
            className="btn ghost"
            style={{ fontSize: 11.5, padding: "3px 10px" }}
            disabled={pending}
            onClick={() => start(() => { reopenAdminTask(t.id); })}
          >
            Re-open
          </button>
        )}

        {canDelete &&
          (confirmDel ? (
            <>
              <button
                className="btn ghost"
                style={{ color: "#dc2626", borderColor: "#fca5a5", fontSize: 11 }}
                disabled={deleting}
                onClick={() => startDelete(async () => { await deleteAdminTask(t.id); })}
              >
                {deleting ? "…" : "Confirm"}
              </button>
              <button className="btn ghost" style={{ fontSize: 11 }} onClick={() => setConfirmDel(false)}>
                ×
              </button>
            </>
          ) : (
            <button
              className="icon-btn"
              style={{ color: "#dc2626" }}
              title="Delete"
              onClick={() => setConfirmDel(true)}
            >
              <Icon name="trash-2" size={13} />
            </button>
          ))}
      </div>

      {/* Sub-title (task title when client name is shown separately) */}
      {t.clientName && (
        <div
          style={{
            fontSize: 12,
            color: "var(--ink-2)",
            marginTop: 3,
            paddingLeft: isOpen && onToggle ? 20 : 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayTitle}
        </div>
      )}

      {/* Snoozed badge + hold note */}
      {isSnoozed && snoozeUntilDisplay && (
        <div
          style={{
            marginTop: 6,
            paddingLeft: isOpen && onToggle ? 20 : 0,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#ede9fe",
              color: "#7e22ce",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ⏸ On hold until {snoozeUntilDisplay}
          </span>
          {t.holdNote && (
            <span style={{ fontSize: 11.5, color: "var(--ink-2)", fontStyle: "italic" }}>
              {t.holdNote}
            </span>
          )}
        </div>
      )}

      {/* Hold / snooze form — admin only */}
      {showHoldForm && isOpen && (
        <div
          style={{
            marginTop: 10,
            padding: "12px 14px",
            background: "#faf5ff",
            border: "1px solid #c4b5fd",
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7e22ce", marginBottom: 8 }}>
            Put on hold — next action date
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <label style={{ fontSize: 11.5, color: "var(--ink-2)", display: "block", marginBottom: 3 }}>
                Remind me / resurface on
              </label>
              <input
                type="date"
                value={holdDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setHoldDate(e.target.value)}
                style={{
                  padding: "5px 9px",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  width: "100%",
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: "var(--ink-2)", display: "block", marginBottom: 3 }}>
                Reason / comment
              </label>
              <textarea
                placeholder="e.g. Government needs to confirm before we proceed — follow up on 10 Jul"
                value={holdComment}
                onChange={(e) => setHoldComment(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 56,
                  padding: 9,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn primary"
                style={{ background: "#7e22ce", borderColor: "#7e22ce" }}
                disabled={holdSaving || !holdDate}
                onClick={() =>
                  startHold(async () => {
                    const res = await snoozeAdminTask(t.id, holdDate, holdComment);
                    if (res.ok) setShowHoldForm(false);
                  })
                }
              >
                {holdSaving ? "Saving…" : "Save hold"}
              </button>
              <button className="btn ghost" onClick={() => setShowHoldForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded: body + notes + close form */}
      {expanded && (
        <div style={{ marginTop: 10, paddingLeft: isOpen && onToggle ? 20 : 0 }}>
          {t.body && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
                marginBottom: 8,
                background: "var(--bg-soft)",
                padding: "8px 10px",
                borderRadius: 6,
              }}
            >
              {t.body}
            </div>
          )}

          {priorNotes.length > 0 && (
            <details style={{ fontSize: 12, marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", color: "var(--ink-3)" }}>
                Prior notes ({priorNotes.length})
              </summary>
              <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                {priorNotes.map((h, i) => (
                  <div key={i} style={{ background: "var(--bg-soft)", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 10.5, color: "var(--ink-3)", marginBottom: 2 }}>
                      {h.at ? new Date(h.at).toLocaleDateString() : ""}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{h.notes}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {isOpen && (
            <>
              <textarea
                placeholder="Notes (carry into next re-fire)…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 56,
                  padding: 10,
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
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
                  Save & close
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
