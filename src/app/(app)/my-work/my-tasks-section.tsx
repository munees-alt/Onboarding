"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { closeAdminTask, reopenAdminTask, runAutoAdminTaskScan, bulkCloseAdminTasks, deleteAdminTask, editAdminTask, requestCloseWithDate, approveCloseRequest, disapproveCloseRequest } from "./actions";

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
  ownerId: string;
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
  compliance: "Compliance",
  close_approval: "Approval",
  onboarding_sla: "Onboarding SLA",
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
  compliance: "#9333ea",
  close_approval: "#7e22ce",
  onboarding_sla: "#b45309",
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

// Kinds grouped into the four "what's pending" buckets shown on the collapsed card.
const COMPLIANCE_KINDS = ["compliance", "compliance_alert", "ct_reg_followup", "vat_reg_followup", "aml_unassigned"];
const DATA_KINDS = ["docs_overdue"];
const ACCESS_KINDS = ["access_overdue"];
function isComplianceKind(kind: string) {
  return COMPLIANCE_KINDS.includes(kind);
}
function bucketOf(kind: string): "compliance" | "data" | "access" | "task" {
  if (COMPLIANCE_KINDS.includes(kind)) return "compliance";
  if (DATA_KINDS.includes(kind)) return "data";
  if (ACCESS_KINDS.includes(kind)) return "access";
  return "task";
}

function stripPrefix(title: string) {
  return title.replace(/^\[Escalated\]\s*/, "").replace(/^\[1 week unresolved\]\s*/, "");
}

// The auto-task body carries the actual pending items as a "• name" bullet list
// (documents, access systems, task titles). Pull those out so the collapsed card
// can show WHAT is pending, not just a count.
function bulletLines(body: string | null): string[] {
  if (!body) return [];
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("•"))
    .map((l) => l.replace(/^•\s*/, "").trim())
    .filter(Boolean);
}

const KIND_DETAIL_FALLBACK: Record<string, string> = {
  ct_reg_followup: "CT registration",
  vat_reg_followup: "VAT registration",
  aml_unassigned: "AML not added",
  zoho_followup: "Zoho setup",
  weekly_update: "Weekly update",
};

// The specific pending item name(s) for one task: bullet list if present,
// else a per-kind label, else the quoted task name or the cleaned title.
function detailNames(t: AdminTaskItem): string[] {
  const bullets = bulletLines(t.body);
  if (bullets.length) return bullets;
  // Escalated compliance alert: the real item is AFTER the "·" in the title
  // ("… – Compliance expiry approaching · VAT Registration for CLIENT"); the
  // due date is in the body ("VAT Registration is due 2026-07-05").
  if (isComplianceKind(t.kind) && t.title.includes("·")) {
    let item = t.title.split("·").slice(1).join("·").replace(/\s+for\s+.+$/i, "").trim();
    const due = t.body?.match(/is due (\d{4}-\d{2}-\d{2})/) ?? t.body?.match(/due (\d{4}-\d{2}-\d{2})/);
    if (item && due) item += ` — due ${due[1]}`;
    if (item) return [item];
  }
  if (KIND_DETAIL_FALLBACK[t.kind]) return [KIND_DETAIL_FALLBACK[t.kind]];
  const quoted = t.body?.match(/"([^"]+)"/) ?? t.title.match(/"([^"]+)"/);
  if (quoted) return [quoted[1]];
  const clean = stripPrefix(t.title).replace(/\s*·.*$/, "").trim();
  return clean ? [clean] : [];
}

type TabKey = "all" | "overdue" | "escalated" | "access" | "documents" | "compliance";

const CATEGORY_META: Record<
  "overdue" | "escalated" | "access" | "documents" | "compliance" | "other",
  { label: string; dot: string; headBg: string; headBorder: string; headText: string; rowBorder: string; accent: string }
> = {
  overdue: { label: "Overdue", dot: "#dc2626", headBg: "#fef2f2", headBorder: "#fecaca", headText: "#dc2626", rowBorder: "#f97316", accent: "#f97316" },
  escalated: { label: "Escalated", dot: "#dc2626", headBg: "#fef2f2", headBorder: "#fecaca", headText: "#dc2626", rowBorder: "#dc2626", accent: "#dc2626" },
  access: { label: "Access", dot: "#16a34a", headBg: "#f0fdf4", headBorder: "#bbf7d0", headText: "#15803d", rowBorder: "#16a34a", accent: "#16a34a" },
  documents: { label: "Documents", dot: "#0f766e", headBg: "#f0fdfa", headBorder: "#99f6e4", headText: "#0f766e", rowBorder: "#0f766e", accent: "#0f766e" },
  compliance: { label: "Compliance", dot: "#9333ea", headBg: "#faf5ff", headBorder: "#e9d5ff", headText: "#7e22ce", rowBorder: "#9333ea", accent: "#9333ea" },
  other: { label: "New", dot: "#78716c", headBg: "#fafaf9", headBorder: "#e7e5e4", headText: "#57534e", rowBorder: "#a8a29e", accent: "#a8a29e" },
};

export function MyTasksSection({
  items,
  canScan,
  canDelete,
  canSnooze,
  viewerId,
  showViewToggle,
}: {
  items: AdminTaskItem[];
  canScan: boolean;
  canDelete?: boolean;
  canSnooze?: boolean;
  /** Current viewer's team_member id — used to filter "My action items". */
  viewerId?: string | null;
  /** Master Admin gets a My action items / Team view split; everyone else sees one list. */
  showViewToggle?: boolean;
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
  const [view, setView] = useState<"mine" | "team">("mine");

  const mineCount = useMemo(() => items.filter((t) => t.status === "open" && t.ownerId === viewerId).length, [items, viewerId]);
  const scopedItems = useMemo(() => {
    if (!showViewToggle) return items;
    return view === "mine" ? items.filter((t) => t.ownerId === viewerId) : items;
  }, [items, showViewToggle, view, viewerId]);

  const now = Date.now();
  const openItems = scopedItems.filter((t) => t.status === "open" && !(t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now));
  const snoozedItems = scopedItems.filter((t) => t.status === "open" && t.snoozedUntil && new Date(t.snoozedUntil).getTime() > now);
  const closedItems = scopedItems.filter((t) => t.status === "closed");
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
  const catCompliance = useMemo(() => searchedOpen.filter((t) => isComplianceKind(t.kind)), [searchedOpen]);

  const tabs: { key: TabKey; label: string; count: number; dot: string | null }[] = [
    { key: "all", label: "All", count: searchedOpen.length, dot: null },
    { key: "overdue", label: "Overdue", count: catOverdue.length, dot: CATEGORY_META.overdue.dot },
    { key: "escalated", label: "Escalated", count: catEscalated.length, dot: CATEGORY_META.escalated.dot },
    { key: "compliance", label: "Compliance", count: catCompliance.length, dot: CATEGORY_META.compliance.dot },
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
      case "compliance": return catCompliance;
      default: return searchedOpen;
    }
  }, [tab, searchedOpen, catOverdue, catEscalated, catAccess, catDocuments, catCompliance]);

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
            {showViewToggle
              ? view === "mine"
                ? "Only what's escalated or assigned directly to you. Escalates to the next level after 2 days unresolved."
                : "Everything open across the org. Close to remove from the chain."
              : "Only your assigned tasks. Escalates to the next level after 2 days unresolved. Close to remove from the chain."}
          </div>
        </div>
        {showViewToggle && (
          <div className="bk-filter-tabs" style={{ marginRight: 8 }}>
            <button className={`bk-filter-tab${view === "mine" ? " active" : ""}`} onClick={() => setView("mine")}>
              My action items {mineCount}
            </button>
            <button className={`bk-filter-tab${view === "team" ? " active" : ""}`} onClick={() => setView("team")}>
              Team view
            </button>
          </div>
        )}
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
  // Collapsed by default — the summary line below gives the gist; click to expand.
  const [open, setOpen] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);

  // Up to 4 category lines shown on the collapsed card, each listing WHAT is
  // pending (the actual access systems / docs / tasks / compliance names).
  const categories = useMemo(() => {
    const g: Record<"access" | "task" | "data" | "compliance", string[]> = { access: [], task: [], data: [], compliance: [] };
    for (const t of group.items) {
      const b = bucketOf(t.kind);
      for (const d of detailNames(t)) g[b].push(d);
    }
    const meta = [
      { key: "access" as const, label: "Access not shared", color: "#16a34a" },
      { key: "task" as const, label: "Tasks pending", color: "#b45309" },
      { key: "data" as const, label: "Docs missing", color: "#0f766e" },
      { key: "compliance" as const, label: "Compliance", color: "#9333ea" },
    ];
    return meta
      .map((m) => ({ ...m, details: [...new Set(g[m.key])] }))
      .filter((m) => m.details.length > 0);
  }, [group.items]);

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
      <div
        className="bk-group-toggle"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen((v) => !v); }}
        style={{
          width: "100%",
          display: "block",
          padding: "11px 14px",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name={open ? "chevron-down" : "chevron-right"} size={14} style={{ flexShrink: 0, color: "#a8a29e" }} />
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              color: "#1c1917",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {group.name}
          </span>
          {escalatedCount > 0 && (
            <span className="bk-chip" style={{ background: "#fef2f2", color: "#dc2626", flexShrink: 0 }}>
              ↑ Escalated{escalatedCount > 1 ? ` ×${escalatedCount}` : ""}
            </span>
          )}
          <span style={{ flex: 1 }} />
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
          <button
            className="bk-btn-secondary"
            style={{ flexShrink: 0, padding: "3px 10px", fontSize: 11 }}
            onClick={(e) => { e.stopPropagation(); setShowCloseModal(true); }}
            title="Close (or close with a next action date) every open item for this client at once"
          >
            Close
          </button>
        </div>
        {!open && categories.length > 0 && (
          <div style={{ marginTop: 6, paddingLeft: 24, display: "grid", gap: 3 }}>
            {categories.map((c) => (
              <div key={c.key} style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 11.5, minWidth: 0 }}>
                <span style={{ color: c.color, fontWeight: 700, flexShrink: 0 }}>{c.label}:</span>
                <span style={{ color: "#57534e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                  {c.details.join(", ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {showCloseModal && (
        <GroupCloseModal
          clientName={group.name}
          categories={categories}
          itemIds={group.items.map((t) => t.id)}
          onClose={() => setShowCloseModal(false)}
        />
      )}
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

// Quick-action popup off the collapsed client card: shows what's pending, then
// Close (note) or Close with a next-action date, applied to every open item
// for this client at once — no need to expand the card first.
function GroupCloseModal({
  clientName,
  categories,
  itemIds,
  onClose,
}: {
  clientName: string;
  categories: { key: string; label: string; color: string; details: string[] }[];
  itemIds: string[];
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"note" | "date">("note");
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [saving, startSaving] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);

  const confirm = () => startSaving(async () => {
    if (mode === "note") {
      const res = await bulkCloseAdminTasks(itemIds, note);
      if (res.ok) onClose(); else setFlash(res.error ?? "Failed.");
      return;
    }
    if (!date) { setFlash("Pick a next action date."); return; }
    const results = await Promise.all(itemIds.map((id) => requestCloseWithDate(id, date, note)));
    const anyApproval = results.some((r) => r.mode === "approval");
    const anyFailed = results.some((r) => !r.ok);
    if (anyFailed) { setFlash("Some items failed — try again."); return; }
    if (anyApproval) { setFlash("Sent for approval."); setTimeout(onClose, 1400); return; }
    onClose();
  });

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, maxWidth: 480, width: "100%", maxHeight: "90vh", overflow: "auto", padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 15.5, color: "#1c1917" }}>Close all — {clientName}</div>
          <button onClick={onClose} className="bk-row-link">×</button>
        </div>
        <div style={{ fontSize: 11.5, color: "#78716c", marginBottom: 14 }}>
          {itemIds.length} open item{itemIds.length === 1 ? "" : "s"} for this client will be closed.
        </div>

        {categories.length > 0 && (
          <div style={{ background: "#fafaf9", border: "1px solid #f0efec", borderRadius: 8, padding: 12, marginBottom: 14, display: "grid", gap: 4 }}>
            {categories.map((c) => (
              <div key={c.key} style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 12, minWidth: 0 }}>
                <span style={{ color: c.color, fontWeight: 700, flexShrink: 0 }}>{c.label}:</span>
                <span style={{ color: "#57534e" }}>{c.details.join(", ")}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setMode("note")}
            style={{ fontFamily: "inherit", cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 6, border: "1px solid #e7e5e4", background: mode === "note" ? "#1c1917" : "#fff", color: mode === "note" ? "#fff" : "#57534e" }}
          >
            Add note &amp; close
          </button>
          <button
            onClick={() => setMode("date")}
            style={{ fontFamily: "inherit", cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 6, border: "1px solid #e7e5e4", background: mode === "date" ? "#1c1917" : "#fff", color: mode === "date" ? "#fff" : "#57534e" }}
          >
            Close with next action date
          </button>
        </div>
        {mode === "date" && (
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 11.5, color: "#57534e", display: "block", marginBottom: 3 }}>Next action date</label>
            <input
              type="date"
              value={date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
              style={{ padding: "5px 9px", border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", width: "100%" }}
            />
          </div>
        )}
        <textarea
          placeholder={mode === "date" ? "Reason / what happens next…" : "Closing note (optional)…"}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ width: "100%", minHeight: 60, padding: 9, border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }}
        />
        {flash && <div style={{ fontSize: 11.5, color: "#dc2626", marginTop: 6 }}>{flash}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="bk-btn-primary" disabled={saving || (mode === "date" && !date)} onClick={confirm}>
            {saving ? "Closing…" : mode === "date" ? `Close ${itemIds.length} with date` : `Close ${itemIds.length} item${itemIds.length === 1 ? "" : "s"}`}
          </button>
          <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={onClose}>Cancel</button>
        </div>
      </div>
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
  const [deleting, startDelete] = useTransition();
  const [confirmDel, setConfirmDel] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editTitle, setEditTitle] = useState(t.title);
  const [editBody, setEditBody] = useState(t.body ?? "");
  const [editSaving, startEdit] = useTransition();
  // Close flow: "note" = add note & close; "date" = close with next action date.
  const [showClose, setShowClose] = useState(false);
  const [closeMode, setCloseMode] = useState<"note" | "date">("note");
  const [closeNote, setCloseNote] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [closeSaving, startClose] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  // Approval flow (close_approval items — team lead approves/disapproves).
  const [showDisapprove, setShowDisapprove] = useState(false);
  const [disNote, setDisNote] = useState("");
  const [apprSaving, startAppr] = useTransition();

  const isApproval = t.kind === "close_approval";
  const isCompliance = isComplianceKind(t.kind);
  const color = KIND_COLOR[t.kind] ?? "#475569";
  const label = KIND_LABEL[t.kind] ?? t.kind;
  const age = ageLabel(t.createdAt);
  const isOpen = t.status === "open";
  const isOverdue = isOpen && isOverdueTask(t);
  const isEscalated = t.title.startsWith("[Escalated]") || t.title.startsWith("[1 week");
  const borderColor = isSnoozed ? "#7e22ce" : isApproval ? "#7e22ce" : isEscalated ? "#dc2626" : isOverdue ? "#f97316" : color;

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

          {isOpen && isApproval ? (
            /* Team lead approves / disapproves a member's deferral request. */
            <>
              <button className="bk-row-link" style={{ color: "#15803d" }} disabled={apprSaving} onClick={() => startAppr(async () => { await approveCloseRequest(t.id); })}>
                Approve
              </button>
              <button className="bk-row-link" style={{ color: "#dc2626" }} onClick={() => setShowDisapprove((v) => !v)}>
                Disapprove
              </button>
            </>
          ) : isOpen ? (
            <>
              <button className="bk-row-link" onClick={() => { setShowClose((v) => !v); setShowEditForm(false); }}>
                {showClose ? "Cancel" : "Close"}
              </button>
              {canSnooze && isCompliance && (
                <button
                  className="bk-row-link"
                  style={{ color: "#7e22ce" }}
                  onClick={() => { setShowEditForm((v) => !v); setShowClose(false); }}
                  title="Master admin: correct this compliance item"
                >
                  Correct
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

      {/* Correct compliance — master admin only. Fix a wrong/misworded compliance alert in place. */}
      {showEditForm && isOpen && (
        <div style={{ marginTop: 10, padding: "12px 14px", background: "#faf5ff", border: "1px solid #c4b5fd", borderRadius: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#7e22ce", marginBottom: 8 }}>
            Correct this compliance item
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <label style={{ fontSize: 11.5, color: "#57534e", display: "block", marginBottom: 3 }}>Title</label>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                style={{ padding: "6px 9px", border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", width: "100%" }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11.5, color: "#57534e", display: "block", marginBottom: 3 }}>Details / correction</label>
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder="e.g. CT already registered on 10 Jun — this alert is wrong; corrected."
                style={{ width: "100%", minHeight: 56, padding: 9, border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="bk-btn-primary"
                style={{ background: "#7e22ce" }}
                disabled={editSaving || !editTitle.trim()}
                onClick={() => startEdit(async () => { const res = await editAdminTask(t.id, editTitle, editBody); if (res.ok) setShowEditForm(false); })}
              >
                {editSaving ? "Saving…" : "Save correction"}
              </button>
              <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={() => setShowEditForm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close panel — add note & close, or close with a next action date. */}
      {showClose && isOpen && (
        <div style={{ marginTop: 10, padding: "12px 14px", background: "#fafaf9", border: "1px solid #e7e5e4", borderRadius: 8 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => setCloseMode("note")}
              style={{ fontFamily: "inherit", cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 6, border: "1px solid #e7e5e4", background: closeMode === "note" ? "#1c1917" : "#fff", color: closeMode === "note" ? "#fff" : "#57534e" }}
            >
              Add note &amp; close
            </button>
            <button
              onClick={() => setCloseMode("date")}
              style={{ fontFamily: "inherit", cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: "5px 11px", borderRadius: 6, border: "1px solid #e7e5e4", background: closeMode === "date" ? "#1c1917" : "#fff", color: closeMode === "date" ? "#fff" : "#57534e" }}
            >
              Close with next action date
            </button>
          </div>
          {closeMode === "date" && (
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11.5, color: "#57534e", display: "block", marginBottom: 3 }}>Next action date</label>
              <input
                type="date"
                value={closeDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setCloseDate(e.target.value)}
                style={{ padding: "5px 9px", border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", width: "100%" }}
              />
            </div>
          )}
          <textarea
            placeholder={closeMode === "date" ? "Reason / what happens next…" : "Closing note (optional)…"}
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
            style={{ width: "100%", minHeight: 52, padding: 9, border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }}
          />
          {flash && <div style={{ fontSize: 11.5, color: "#15803d", marginTop: 6 }}>{flash}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {closeMode === "note" ? (
              <button className="bk-btn-primary" disabled={closeSaving} onClick={() => startClose(async () => { await closeAdminTask(t.id, closeNote); setShowClose(false); })}>
                {closeSaving ? "Closing…" : "Close item"}
              </button>
            ) : (
              <button
                className="bk-btn-primary"
                disabled={closeSaving || !closeDate}
                onClick={() => startClose(async () => {
                  const res = await requestCloseWithDate(t.id, closeDate, closeNote);
                  if (res.ok) {
                    if (res.mode === "approval") { setFlash("Sent to your team lead for approval."); setTimeout(() => setShowClose(false), 1600); }
                    else setShowClose(false);
                  } else setFlash(res.error ?? "Failed.");
                })}
              >
                {closeSaving ? "Saving…" : "Close with date"}
              </button>
            )}
            <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={() => setShowClose(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Disapprove panel — team lead sends the deferral back with a note. */}
      {showDisapprove && isOpen && isApproval && (
        <div style={{ marginTop: 10, padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#dc2626", marginBottom: 8 }}>Disapprove — send back with a note</div>
          <textarea
            placeholder="Why is this not approved? It returns to them to action now."
            value={disNote}
            onChange={(e) => setDisNote(e.target.value)}
            style={{ width: "100%", minHeight: 52, padding: 9, border: "1px solid #e7e5e4", borderRadius: 6, fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="bk-btn-primary" style={{ background: "#dc2626" }} disabled={apprSaving} onClick={() => startAppr(async () => { await disapproveCloseRequest(t.id, disNote); setShowDisapprove(false); })}>
              {apprSaving ? "Saving…" : "Disapprove"}
            </button>
            <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={() => setShowDisapprove(false)}>Cancel</button>
          </div>
        </div>
      )}

    </div>
  );
}
