"use client";

import { useMemo, useState, useTransition } from "react";
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
  task_pending_alert: "Task pending",
  aml_unassigned: "AML not added",
  task_escalation: "Task escalation",
};

const KIND_COLOR: Record<string, string> = {
  zoho_followup: "#7e3aaf",
  ct_reg_followup: "#b91c1c",
  vat_reg_followup: "#b45309",
  docs_overdue: "#0f766e",
  access_overdue: "#16a34a",
  task_overdue: "#92400e",
  weekly_update: "#ea580c",
  compliance_alert: "#dc2626",
  task_pending_alert: "#0369a1",
  aml_unassigned: "#9333ea",
  task_escalation: "#dc2626",
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

function isEscalatedTitle(title: string) {
  return title.startsWith("[Escalated]") || title.startsWith("[1 week");
}

function isOverdueTask(t: AdminTaskItem) {
  return ageMs(t.createdAt) >= DAY_MS;
}

type TabKey = "all" | "overdue" | "escalated" | "access" | "documents";

const CATEGORY_META: Record<
  "overdue" | "escalated" | "access" | "documents" | "other",
  { label: string; dot: string; headBg: string; headBorder: string; headText: string; rowBorder: string; accent: string }
> = {
  overdue: { label: "Overdue", dot: "#dc2626", headBg: "#fef2f2", headBorder: "#fecaca", headText: "#dc2626", rowBorder: "#f97316", accent: "#f97316" },
  escalated: { label: "Escalated", dot: "#dc2626", headBg: "#fef2f2", headBorder: "#fecaca", headText: "#dc2626", rowBorder: "#dc2626", accent: "#dc2626" },
  access: { label: "Access", dot: "#16a34a", headBg: "#f0fdf4", headBorder: "#bbf7d0", headText: "#15803d", rowBorder: "#16a34a", accent: "#16a34a" },
  documents: { label: "Documents", dot: "#0f766e", headBg: "#f0fdfa", headBorder: "#99f6e4", headText: "#0f766e", rowBorder: "#0f766e", accent: "#0f766e" },
  other: { label: "New", dot: "#78716c", headBg: "#fafaf9", headBorder: "#e7e5e4", headText: "#57534e", rowBorder: "#a8a29e", accent: "#a8a29e" },
};

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
  const [tab, setTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");

  const now = Date.now();
  const openItems = items.filter((t) => t.status === "open" && !(t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now));
  const snoozedItems = items.filter((t) => t.status === "open" && t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now);
  const closedItems = items.filter((t) => t.status === "closed");
  const overdue = openItems.filter(isOverdueTask);

  const searchedOpen = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return openItems;
    return openItems.filter((t) => (t.clientName ?? "").toLowerCase().includes(q) || t.title.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItems, search]);

  const catOverdue = useMemo(() => searchedOpen.filter(isOverdueTask), [searchedOpen]);
  const catEscalated = useMemo(() => searchedOpen.filter((t) => isEscalatedTitle(t.title)), [searchedOpen]);
  const catAccess = useMemo(() => searchedOpen.filter((t) => t.kind === "access_overdue"), [searchedOpen]);
  const catDocuments = useMemo(() => searchedOpen.filter((t) => t.kind === "docs_overdue"), [searchedOpen]);

  const tabs: { key: TabKey; label: string; count: number; dot: string | null }[] = [
    { key: "all", label: "All", count: searchedOpen.length, dot: null },
    { key: "overdue", label: "Overdue", count: catOverdue.length, dot: CATEGORY_META.overdue.dot },
    { key: "escalated", label: "Escalated", count: catEscalated.length, dot: CATEGORY_META.escalated.dot },
    { key: "access", label: "Access", count: catAccess.length, dot: CATEGORY_META.access.dot },
    { key: "documents", label: "Documents", count: catDocuments.length, dot: CATEGORY_META.documents.dot },
  ];

  // Same task set the tabs already count above — just picks which one feeds the grouped view below.
  const tabFiltered = useMemo(() => {
    switch (tab) {
      case "overdue": return catOverdue;
      case "escalated": return catEscalated;
      case "access": return catAccess;
      case "documents": return catDocuments;
      default: return searchedOpen;
    }
  }, [tab, searchedOpen, catOverdue, catEscalated, catAccess, catDocuments]);

  // One card per client instead of one row per task — a client with 3 open items
  // used to repeat its name across 3 separate category sections.
  const clientGroups = useMemo(() => {
    const map = new Map<string, { key: string; name: string; items: AdminTaskItem[] }>();
    for (const t of tabFiltered) {
      const key = t.clientName ?? `task:${t.id}`;
      const name = t.clientName ?? t.title.replace(/^\[Escalated\]\s*/, "").replace(/^\[1 week unresolved\]\s*/, "");
      if (!map.has(key)) map.set(key, { key, name, items: [] });
      map.get(key)!.items.push(t);
    }
    const groups = [...map.values()];
    groups.sort((a, b) => {
      const aEsc = a.items.some((t) => isEscalatedTitle(t.title));
      const bEsc = b.items.some((t) => isEscalatedTitle(t.title));
      if (aEsc !== bEsc) return aEsc ? -1 : 1;
      const aOver = a.items.filter(isOverdueTask).length;
      const bOver = b.items.filter(isOverdueTask).length;
      if (aOver !== bOver) return bOver - aOver;
      if (a.items.length !== b.items.length) return b.items.length - a.items.length;
      return a.name.localeCompare(b.name);
    });
    return groups;
  }, [tabFiltered]);

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
    <div className="bk-wrap" style={{ marginBottom: 28 }}>
      {/* Header */}
      <div className="bk-action-head">
        <div>
          <div className="bk-title-row">
            <h2 className="bk-title" style={{ margin: 0 }}>
              Action Items
            </h2>
            {openItems.length > 0 && <span className="bk-count-badge">{openItems.length}</span>}
          </div>
          <div className="bk-subtitle">
            Only your assigned tasks. Escalates to the next level after 2 days unresolved. Close to remove from the chain.
          </div>
        </div>
        {canScan && (
          <button
            className="bk-btn-secondary"
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

      {/* Filter tabs + search */}
      {openItems.length > 0 && (
        <div className="bk-filter-row">
          <div className="bk-filter-tabs">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                className={`bk-filter-tab${tab === tb.key ? " active" : ""}`}
                onClick={() => setTab(tb.key)}
              >
                {tb.dot && <span className="bk-filter-tab-dot" style={{ background: tb.dot }} />}
                {tb.label} {tb.count}
              </button>
            ))}
          </div>
          <div className="bk-spacer" />
          <div className="bk-search">
            <Icon name="search" size={16} />
            <input placeholder="Search tasks or clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      )}

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
              border: "1px solid #e7e5e4",
              borderRadius: 8,
              fontSize: 12.5,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="bk-btn-primary" disabled={bulkSaving} onClick={doBulkClose}>
              {bulkSaving ? "Closing…" : `Close ${selectedOpen.length} items`}
            </button>
            <button
              className="bk-btn-secondary"
              style={{ borderColor: "#e7e5e4", color: "#57534e" }}
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
            border: "1px solid #f0efec",
            borderRadius: 10,
            padding: "32px 20px",
            textAlign: "center",
            color: "#a8a29e",
            fontSize: 13,
          }}
        >
          Nothing assigned to you right now.
        </div>
      ) : clientGroups.length === 0 ? (
        <div
          style={{
            background: "#fff",
            border: "1px solid #f0efec",
            borderRadius: 10,
            padding: "32px 20px",
            textAlign: "center",
            color: "#a8a29e",
            fontSize: 13,
          }}
        >
          No action items match your filters.
        </div>
      ) : (
        clientGroups.map((group) => (
          <ClientGroup
            key={group.key}
            group={group}
            pending={pending}
            start={start}
            selected={selected}
            onToggle={toggleItem}
            onSelectGroup={selectGroup}
            canDelete={canDelete}
            canSnooze={canSnooze}
          />
        ))
      )}

      {/* SNOOZED — on hold until a future date */}
      {snoozedItems.length > 0 && (
        <div style={{ marginTop: 16, marginBottom: 16 }}>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#7e22ce",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
              marginBottom: showSnoozed ? 8 : 0,
              fontFamily: "inherit",
            }}
            onClick={() => setShowSnoozed((v) => !v)}
          >
            <Icon name={showSnoozed ? "chevron-down" : "chevron-right"} size={13} />
            On hold — {snoozedItems.length} item{snoozedItems.length !== 1 ? "s" : ""} (waiting)
          </button>
          {showSnoozed && (
            <div className="bk-action-list" style={{ padding: 0 }}>
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
              color: "#78716c",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
              marginBottom: showClosed ? 8 : 0,
              fontFamily: "inherit",
            }}
            onClick={() => setShowClosed((v) => !v)}
          >
            <Icon name={showClosed ? "chevron-down" : "chevron-right"} size={13} />
            Resolved — {closedItems.length} item{closedItems.length !== 1 ? "s" : ""}
          </button>
          {showClosed && (
            <div className="bk-action-list" style={{ padding: 0 }}>
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

function ClientGroup({
  group,
  pending,
  start,
  selected,
  onToggle,
  onSelectGroup,
  canDelete,
  canSnooze,
}: {
  group: { key: string; name: string; items: AdminTaskItem[] };
  pending: boolean;
  start: (cb: () => void) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectGroup: (items: AdminTaskItem[]) => void;
  canDelete?: boolean;
  canSnooze?: boolean;
}) {
  const escalatedCount = useMemo(() => group.items.filter((t) => isEscalatedTitle(t.title)).length, [group.items]);
  const overdueCount = useMemo(() => group.items.filter(isOverdueTask).length, [group.items]);
  const [open, setOpen] = useState(group.items.length === 1 || escalatedCount > 0);

  const kindCounts = useMemo(() => {
    const m = new Map<string, number>();
    group.items.forEach((t) => m.set(t.kind, (m.get(t.kind) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [group.items]);
  const MAX_CHIPS = 2;
  const visibleKinds = kindCounts.slice(0, MAX_CHIPS);
  const hiddenKindCount = kindCounts.length - visibleKinds.length;

  const oldest = useMemo(
    () => group.items.reduce((max, t) => (ageMs(t.createdAt) > ageMs(max.createdAt) ? t : max), group.items[0]),
    [group.items],
  );
  const allSelected = group.items.every((t) => selected.has(t.id));

  return (
    <div
      className="bk-group"
      style={{
        background: "#fff",
        border: "1px solid #f0efec",
        borderLeft: `3px solid ${escalatedCount ? "#dc2626" : overdueCount ? "#f97316" : "#d6d3d1"}`,
        borderRadius: 10,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      <button
        className="bk-group-toggle"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "11px 14px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={14} style={{ flexShrink: 0, color: "#a8a29e" }} />
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 700,
            color: "#1c1917",
            flexShrink: 0,
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {group.name}
        </span>
        <div style={{ display: "flex", gap: 5, flex: 1, minWidth: 0, overflow: "hidden" }}>
          {escalatedCount > 0 && (
            <span className="bk-chip" style={{ background: "#fef2f2", color: "#dc2626", flexShrink: 0 }}>
              ↑ Escalated{escalatedCount > 1 ? ` ×${escalatedCount}` : ""}
            </span>
          )}
          {visibleKinds.map(([kind, count]) => (
            <span key={kind} className="bk-chip" style={{ background: `${KIND_COLOR[kind] ?? "#475569"}14`, color: KIND_COLOR[kind] ?? "#475569", flexShrink: 0 }}>
              {KIND_LABEL[kind] ?? kind}
              {count > 1 ? ` ×${count}` : ""}
            </span>
          ))}
          {hiddenKindCount > 0 && (
            <span className="bk-chip" style={{ background: "#f5f5f4", color: "#78716c", flexShrink: 0 }}>
              +{hiddenKindCount} more
            </span>
          )}
        </div>
        <span style={{ fontSize: 11, color: overdueCount ? "#ea580c" : "#78716c", fontWeight: 600, flexShrink: 0, whiteSpace: "nowrap" }}>
          {ageLabel(oldest.createdAt)} oldest
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: "#57534e",
            background: "#f5f5f4",
            padding: "2px 8px",
            borderRadius: 999,
            flexShrink: 0,
          }}
        >
          {group.items.length}
        </span>
      </button>
      {open && (
        <div className="bk-action-list" style={{ borderTop: "1px solid #f0efec" }}>
          {group.items.length > 1 && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="bk-action-section-select" style={{ color: "#78716c" }} onClick={() => onSelectGroup(group.items)}>
                {allSelected ? "Selected" : "Select all"}
              </button>
            </div>
          )}
          {group.items.map((t) => (
            <TaskCard
              key={t.id}
              t={t}
              pending={pending}
              start={start}
              selected={selected.has(t.id)}
              onToggle={() => onToggle(t.id)}
              canDelete={canDelete}
              canSnooze={canSnooze}
            />
          ))}
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
  isSnoozed,
}: {
  t: AdminTaskItem;
  pending: boolean;
  start: (cb: () => void) => void;
  selected?: boolean;
  onToggle?: () => void;
  canDelete?: boolean;
  canSnooze?: boolean;
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
  const isOverdue = isOpen && isOverdueTask(t);
  const isEscalated = t.title.startsWith("[Escalated]") || t.title.startsWith("[1 week");
  const borderColor = isSnoozed ? "#7e22ce" : isEscalated ? "#dc2626" : isOverdue ? "#f97316" : color;
  const priorNotes = t.history.filter((h) => h.notes);

  const snoozeUntilDisplay = t.snoozedUntil
    ? new Date(t.snoozedUntil).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  // Extract escalation prefix if present
  const displayTitle = t.title
    .replace(/^\[Escalated\]\s*/, "")
    .replace(/^\[1 week unresolved\]\s*/, "");

  return (
    <div className={`bk-row${selected ? " is-selected" : ""}`} style={{ borderLeftColor: borderColor }}>
      {/* Main row */}
      <div className="bk-row-main">
        {isOpen && onToggle && <input type="checkbox" className="bk-row-check" checked={!!selected} onChange={onToggle} />}

        {/* Escalation badge */}
        {isEscalated && (
          <span className="bk-pill" style={{ background: "#dc2626", color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 9.5, flexShrink: 0 }}>
            ↑ Escalated
          </span>
        )}

        {/* Type badge */}
        <span className="bk-pill" style={{ background: color, color: "#fff", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>
          {label}
        </span>

        {/* Client name — most important */}
        <div className="bk-row-title-wrap">
          <div className="bk-row-name" title={displayTitle}>
            {t.clientName ?? displayTitle}
          </div>
          {t.clientName && <div className="bk-row-sub">{displayTitle}</div>}
        </div>

        {/* Right-aligned action cluster */}
        <div className="bk-row-actions">
          {/* Age */}
          <span className={`bk-row-age${isOverdue ? " is-overdue" : ""}`}>{age}</span>

          {isOpen ? (
            <>
              <button className="bk-row-link" disabled={pending} onClick={() => start(() => { closeAdminTask(t.id, ""); })}>
                Close
              </button>
              <button className="bk-row-link" onClick={() => setExpanded((v) => !v)}>
                {expanded ? "Hide" : "Note"}
              </button>
              {canSnooze && (
                <button
                  className="bk-row-link bk-row-link-hold"
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
                  className="bk-row-open"
                >
                  Open →
                </Link>
              )}
            </>
          ) : (
            <button className="bk-row-link" disabled={pending} onClick={() => start(() => { reopenAdminTask(t.id); })}>
              Re-open
            </button>
          )}

          {canDelete &&
            (confirmDel ? (
              <>
                <button className="bk-row-link" style={{ color: "#dc2626" }} disabled={deleting} onClick={() => startDelete(async () => { await deleteAdminTask(t.id); })}>
                  {deleting ? "…" : "Confirm"}
                </button>
                <button className="bk-row-link" onClick={() => setConfirmDel(false)}>
                  ×
                </button>
              </>
            ) : (
              <button className="bk-row-delete" title="Delete" onClick={() => setConfirmDel(true)}>
                <Icon name="trash-2" size={13} />
              </button>
            ))}
        </div>
      </div>

      {/* Snoozed badge + hold note */}
      {isSnoozed && snoozeUntilDisplay && (
        <div
          style={{
            marginTop: 6,
            paddingLeft: isOpen && onToggle ? 20 : 0,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            flexWrap: "wrap",
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
            <span style={{ fontSize: 11.5, color: "#57534e", fontStyle: "italic" }}>
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
              <label style={{ fontSize: 11.5, color: "#57534e", display: "block", marginBottom: 3 }}>
                Remind me / resurface on
              </label>
              <input
                type="date"
                value={holdDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setHoldDate(e.target.value)}
                style={{
                  padding: "5px 9px",
                  border: "1px solid #e7e5e4",
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  width: "100%",
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: "#57534e", display: "block", marginBottom: 3 }}>
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
                  border: "1px solid #e7e5e4",
                  borderRadius: 6,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="bk-btn-primary"
                style={{ background: "#7e22ce" }}
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
              <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={() => setShowHoldForm(false)}>
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
                color: "#57534e",
                whiteSpace: "pre-wrap",
                marginBottom: 8,
                background: "#fafaf9",
                padding: "8px 10px",
                borderRadius: 6,
              }}
            >
              {t.body}
            </div>
          )}

          {priorNotes.length > 0 && (
            <details style={{ fontSize: 12, marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", color: "#78716c" }}>
                Prior notes ({priorNotes.length})
              </summary>
              <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                {priorNotes.map((h, i) => (
                  <div key={i} style={{ background: "#fafaf9", padding: "6px 8px", borderRadius: 6 }}>
                    <div style={{ fontSize: 10.5, color: "#78716c", marginBottom: 2 }}>
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
                  border: "1px solid #e7e5e4",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button
                  className="bk-btn-secondary"
                  style={{ borderColor: "#e7e5e4", color: "#57534e" }}
                  disabled={pending}
                  onClick={() => start(() => { closeAdminTask(t.id, ""); })}
                >
                  Close (no notes)
                </button>
                <button
                  className="bk-btn-primary"
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
