"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icon";
import {
  saveAmlRecord, deleteClientAction, setClientStatusAction,
  assignAmlMember,
  type ManualClientStatus,
} from "../clients/actions";

type AmlClient = {
  clientId: string; clientName: string; status: string; notes: string | null;
  signingLink: string | null; signingCompletedLink: string | null;
  completedAt: string | null; driveLink: string | null; runId: string | null;
  assignedTo: string | null; assignedToName: string | null;
  teamMembers: { role: string; name: string; email: string | null }[];
};

/** Simplified 4-stage workflow — this is the only thing the Update dropdown
 * writes going forward. Legacy statuses (in_review/link_sent/signed) from
 * before this simplification still group into the Pending column below. */
type BoardStatus = "pending" | "document_created" | "shared_to_client" | "completed";
const ALL_STATUSES: BoardStatus[] = ["pending", "document_created", "shared_to_client", "completed"];

const STATUS_META: Record<BoardStatus, { label: string; accent: string; bg: string; fg: string; empty: string }> = {
  pending: { label: "Pending", accent: "#a8a29e", bg: "#f5f5f4", fg: "#57534e", empty: "No pending items." },
  document_created: { label: "Document created", accent: "#0d9488", bg: "#ccfbf1", fg: "#0f766e", empty: "No documents yet." },
  shared_to_client: { label: "Shared to client", accent: "#2563eb", bg: "#dbeafe", fg: "#1d4ed8", empty: "Nothing shared with a client yet." },
  completed: { label: "Completed", accent: "#16a34a", bg: "#dcfce7", fg: "#15803d", empty: "No completed items yet." },
};

/** Legacy statuses that predate the 4-column simplification fold into Pending. */
function columnFor(status: string): BoardStatus {
  if (status === "document_created" || status === "shared_to_client" || status === "completed") return status;
  return "pending";
}

const AVATAR_COLORS = ["#f97316", "#8b5cf6", "#0ea5e9", "#e11d48", "#14b8a6", "#f59e0b"];
function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

export function AmlView({
  clients, canEdit, isAdmin, isHead, amlTeam,
}: {
  clients: AmlClient[];
  canEdit: boolean;
  isAdmin?: boolean;
  isHead?: boolean;
  amlTeam: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [sort, setSort] = useState<"name" | "assignee">("name");
  const [view, setView] = useState<"board" | "list">("board");

  const [editing, setEditing] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, Partial<AmlClient>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [localClients, setLocalClients] = useState(clients);
  const [adminPanel, setAdminPanel] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [assignPanel, setAssignPanel] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [messageFor, setMessageFor] = useState<AmlClient | null>(null);
  const [teamOpenFor, setTeamOpenFor] = useState<string | null>(null);

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<BoardStatus | null>(null);

  const assigneeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of localClients) if (c.assignedToName) names.add(c.assignedToName);
    for (const m of amlTeam) names.add(m.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [localClients, amlTeam]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = localClients.filter((c) => {
      if (q && !(c.clientName.toLowerCase().includes(q) || (c.assignedToName ?? "").toLowerCase().includes(q))) return false;
      if (assigneeFilter === "__unassigned") { if (c.assignedToName) return false; }
      else if (assigneeFilter !== "all" && c.assignedToName !== assigneeFilter) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "assignee") return (a.assignedToName ?? "").localeCompare(b.assignedToName ?? "") || a.clientName.localeCompare(b.clientName);
      return a.clientName.localeCompare(b.clientName);
    });
    return list;
  }, [localClients, search, assigneeFilter, sort]);

  const columns = ALL_STATUSES.map((key) => ({
    key,
    meta: STATUS_META[key],
    cards: filtered.filter((c) => columnFor(c.status) === key),
  }));

  const stats = ALL_STATUSES.map((key) => ({ key, meta: STATUS_META[key], count: filtered.filter((c) => columnFor(c.status) === key).length }));

  const chips: { label: string; onRemove: () => void }[] = [];
  if (search.trim()) chips.push({ label: `"${search.trim()}"`, onRemove: () => setSearch("") });
  if (assigneeFilter !== "all") chips.push({ label: assigneeFilter === "__unassigned" ? "Unassigned" : assigneeFilter, onRemove: () => setAssigneeFilter("all") });

  function startEdit(c: AmlClient) {
    setEditing(c.clientId);
    setForms((f) => ({ ...f, [c.clientId]: { status: columnFor(c.status), notes: c.notes ?? "", signingLink: c.signingLink ?? "", signingCompletedLink: c.signingCompletedLink ?? "" } }));
  }

  async function doSave(clientId: string) {
    const form = forms[clientId] ?? {};
    setSaving(clientId);
    const res = await saveAmlRecord({
      clientId,
      status: (form.status as string) ?? "pending",
      notes: form.notes ?? null,
      signingLink: form.signingLink ?? null,
      signingCompletedLink: form.signingCompletedLink ?? null,
    });
    setSaving(null);
    if (res.error) { alert(res.error); return; }
    setLocalClients((prev) =>
      prev.map((c) => c.clientId === clientId
        ? { ...c, status: (form.status as string) ?? c.status, notes: (form.notes as string | null) ?? c.notes, signingLink: (form.signingLink as string | null) ?? c.signingLink, signingCompletedLink: (form.signingCompletedLink as string | null) ?? c.signingCompletedLink }
        : c,
      ),
    );
    setEditing(null);
  }

  async function moveStatus(c: AmlClient, status: BoardStatus) {
    if (columnFor(c.status) === status) return;
    const prevStatus = c.status;
    setLocalClients((prev) => prev.map((x) => x.clientId === c.clientId ? { ...x, status } : x));
    const res = await saveAmlRecord({
      clientId: c.clientId, status, notes: c.notes, signingLink: c.signingLink, signingCompletedLink: c.signingCompletedLink,
    });
    if (res.error) {
      setLocalClients((prev) => prev.map((x) => x.clientId === c.clientId ? { ...x, status: prevStatus } : x));
      alert(res.error);
    }
  }

  async function doAssign(clientId: string, memberId: string) {
    setAssignBusy(true);
    const memberName = amlTeam.find((m) => m.id === memberId)?.name ?? memberId;
    const res = await assignAmlMember(clientId, memberId);
    setAssignBusy(false);
    if (res.error) { alert(res.error); return; }
    setLocalClients((prev) => prev.map((c) => c.clientId === clientId ? { ...c, assignedTo: memberId, assignedToName: memberName } : c));
    setAssignPanel(null);
  }

  return (
    <div className="bk-wrap">
      {/* Stat chips */}
      <div className="bk-stats">
        {stats.map((s) => (
          <div className="bk-stat" key={s.key}>
            <span className="bk-stat-dot" style={{ background: s.meta.accent }} />
            <span className="bk-stat-count">{s.count}</span>
            <span className="bk-stat-label">{s.meta.label}</span>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="bk-toolbar">
        <div className="bk-toolbar-row">
          <div className="bk-search">
            <Icon name="search" size={16} />
            <input placeholder="Search clients or assignees…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <label className="bk-select-wrap">
            <select className="bk-select" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
              <option value="all">Assignee · All</option>
              <option value="__unassigned">Unassigned</option>
              {assigneeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <Icon name="chevron-down" size={13} className="bk-select-chev" />
          </label>

          <div className="bk-spacer" />

          <label className="bk-select-wrap">
            <select className="bk-select bk-select-sort" value={sort} onChange={(e) => setSort(e.target.value as "name" | "assignee")}>
              <option value="name">Company A–Z</option>
              <option value="assignee">Assignee A–Z</option>
            </select>
            <Icon name="arrow-up-down" size={14} className="bk-select-sort-icon" />
            <Icon name="chevron-down" size={13} className="bk-select-chev" />
          </label>

          <div className="bk-view-toggle">
            <button className={`bk-view-btn${view === "board" ? " active" : ""}`} onClick={() => setView("board")}>
              <Icon name="layout-grid" size={15} />Board
            </button>
            <button className={`bk-view-btn${view === "list" ? " active" : ""}`} onClick={() => setView("list")}>
              <Icon name="list" size={15} />List
            </button>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="bk-chips">
            <span className="bk-chips-label">Filters:</span>
            {chips.map((chip) => (
              <button key={chip.label} className="bk-chip" onClick={chip.onRemove}>
                {chip.label}
                <Icon name="x" size={13} />
              </button>
            ))}
            <button className="bk-chip-clear" onClick={() => { setSearch(""); setAssigneeFilter("all"); }}>Clear all</button>
          </div>
        )}
      </div>

      {view === "board" ? (
        <div className="bk-board">
          {columns.map((col) => (
            <section
              key={col.key}
              className={`bk-col${dragOverCol === col.key ? " drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); if (dragOverCol !== col.key) setDragOverCol(col.key); }}
              onDragLeave={() => setDragOverCol((v) => (v === col.key ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverCol(null);
                const c = filtered.find((x) => x.clientId === draggedId);
                setDraggedId(null);
                if (c && canEdit) moveStatus(c, col.key);
              }}
            >
              <div className="bk-col-head">
                <span className="bk-col-swatch" style={{ background: col.meta.accent }} />
                <span className="bk-col-label">{col.meta.label}</span>
                <span className="bk-col-count">{col.cards.length}</span>
              </div>
              <div className="bk-col-cards">
                {col.cards.map((c) => (
                  <AmlCard
                    key={c.clientId}
                    c={c}
                    canEdit={canEdit}
                    isAdmin={!!isAdmin}
                    isHead={!!isHead}
                    editing={editing === c.clientId}
                    assigning={assignPanel === c.clientId}
                    adminOpen={adminPanel === c.clientId}
                    teamOpen={teamOpenFor === c.clientId}
                    dragging={draggedId === c.clientId}
                    form={forms[c.clientId] ?? {}}
                    amlTeam={amlTeam}
                    assignBusy={assignBusy}
                    adminBusy={adminBusy}
                    saving={saving === c.clientId}
                    onDragStart={() => setDraggedId(c.clientId)}
                    onDragEnd={() => setDraggedId(null)}
                    onEdit={() => startEdit(c)}
                    onFormChange={(patch) => setForms((f) => ({ ...f, [c.clientId]: { ...f[c.clientId], ...patch } }))}
                    onSave={() => doSave(c.clientId)}
                    onCancelEdit={() => setEditing(null)}
                    onToggleAssign={() => setAssignPanel((v) => (v === c.clientId ? null : c.clientId))}
                    onAssign={(memberId) => doAssign(c.clientId, memberId)}
                    onToggleTeam={() => setTeamOpenFor((v) => (v === c.clientId ? null : c.clientId))}
                    onToggleAdmin={() => setAdminPanel((v) => (v === c.clientId ? null : c.clientId))}
                    onSendMessage={() => setMessageFor(c)}
                    onSetStatus={async (s) => {
                      if (!confirm(`Set ${c.clientName} to "${s}"?`)) return;
                      setAdminBusy(true);
                      await setClientStatusAction(c.clientId, s);
                      setAdminBusy(false);
                      router.refresh();
                    }}
                    onDelete={async () => {
                      if (!confirm(`PERMANENTLY DELETE ${c.clientName} and all their data? This cannot be undone.`)) return;
                      if (!confirm("Are you absolutely sure?")) return;
                      setAdminBusy(true);
                      await deleteClientAction(c.clientId);
                      setLocalClients((prev) => prev.filter((x) => x.clientId !== c.clientId));
                      setAdminBusy(false);
                      setAdminPanel(null);
                    }}
                  />
                ))}
                {col.cards.length === 0 && <div className="bk-col-empty">{col.meta.empty}</div>}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="bk-list-wrap">
          <div className="bk-list">
            <div className="bk-list-head" style={{ gridTemplateColumns: "2.2fr 1fr 1.3fr 1.6fr" }}>
              <span>Client</span><span>Status</span><span>Assignee</span><span>Links</span>
            </div>
            {filtered.map((c) => {
              const meta = STATUS_META[columnFor(c.status)];
              return (
                <div className="bk-list-row" key={c.clientId} style={{ gridTemplateColumns: "2.2fr 1fr 1.3fr 1.6fr" }}>
                  <Link href={`/clients/${c.clientId}`} className="bk-list-cell-name" style={{ textDecoration: "none" }}>{c.clientName}</Link>
                  <span><span className="bk-pill" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span></span>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {c.assignedToName ? (
                      <>
                        <div className="bk-avatar" style={{ width: 20, height: 20, fontSize: 9, background: avatarColor(c.assignedToName) }}>{initials(c.assignedToName)}</div>
                        <span className="bk-list-cell">{c.assignedToName}</span>
                      </>
                    ) : <span className="bk-list-cell" style={{ color: "#f59e0b", fontWeight: 600 }}>Unassigned</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {c.driveLink && <a href={c.driveLink} target="_blank" rel="noreferrer" className="bk-link-chip">Drive</a>}
                    <Link href={`/clients/${c.clientId}`} className="bk-link-chip">Playbook</Link>
                    {c.runId && <Link href={`/onboarding/${c.runId}`} className="bk-link-chip">Run</Link>}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="bk-list-empty">No clients match your filters.</div>}
          </div>
        </div>
      )}

      {messageFor && <AmlMessageModal client={messageFor} onClose={() => setMessageFor(null)} />}
    </div>
  );
}

function AmlCard({
  c, canEdit, isAdmin, isHead: _isHead, editing, assigning, adminOpen, teamOpen, dragging,
  form, amlTeam, assignBusy, adminBusy, saving,
  onDragStart, onDragEnd, onEdit, onFormChange, onSave, onCancelEdit,
  onToggleAssign, onAssign, onToggleTeam, onToggleAdmin, onSendMessage, onSetStatus, onDelete,
}: {
  c: AmlClient; canEdit: boolean; isAdmin: boolean; isHead: boolean;
  editing: boolean; assigning: boolean; adminOpen: boolean; teamOpen: boolean; dragging: boolean;
  form: Partial<AmlClient>; amlTeam: { id: string; name: string }[];
  assignBusy: boolean; adminBusy: boolean; saving: boolean;
  onDragStart: () => void; onDragEnd: () => void;
  onEdit: () => void; onFormChange: (patch: Partial<AmlClient>) => void; onSave: () => void; onCancelEdit: () => void;
  onToggleAssign: () => void; onAssign: (memberId: string) => void;
  onToggleTeam: () => void; onToggleAdmin: () => void; onSendMessage: () => void;
  onSetStatus: (s: ManualClientStatus) => void; onDelete: () => void;
}) {
  const meta = STATUS_META[columnFor(c.status)];
  const secondary = columnFor(c.status) === "pending" ? null : "Send message";

  if (editing) {
    return (
      <article className="bk-card">
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{c.clientName}</div>
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "#78716c" }}>Status
            <select value={(form.status as string) ?? "pending"} onChange={(e) => onFormChange({ status: e.target.value })} style={{ display: "block", width: "100%", marginTop: 4, height: 32, borderRadius: 7, border: "1px solid #e7e5e4", padding: "0 8px", fontSize: 12.5 }}>
              {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "#78716c" }}>Notes
            <input value={form.notes ?? ""} onChange={(e) => onFormChange({ notes: e.target.value })} style={{ display: "block", width: "100%", marginTop: 4, height: 32, borderRadius: 7, border: "1px solid #e7e5e4", padding: "0 8px", fontSize: 12.5 }} />
          </label>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "#78716c" }}>Signing link (send to client)
            <input value={form.signingLink ?? ""} onChange={(e) => onFormChange({ signingLink: e.target.value })} placeholder="https://…" style={{ display: "block", width: "100%", marginTop: 4, height: 32, borderRadius: 7, border: "1px solid #e7e5e4", padding: "0 8px", fontSize: 12.5 }} />
          </label>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: "#78716c" }}>Signing completed link
            <input value={form.signingCompletedLink ?? ""} onChange={(e) => onFormChange({ signingCompletedLink: e.target.value })} placeholder="https://…" style={{ display: "block", width: "100%", marginTop: 4, height: 32, borderRadius: 7, border: "1px solid #e7e5e4", padding: "0 8px", fontSize: 12.5 }} />
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="bk-btn-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={onCancelEdit}>Cancel</button>
        </div>
      </article>
    );
  }

  if (assigning) {
    return (
      <article className="bk-card">
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{c.clientName} — Assign</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {amlTeam.map((m) => (
            <button
              key={m.id}
              disabled={assignBusy}
              onClick={() => onAssign(m.id)}
              className={c.assignedTo === m.id ? "bk-btn-primary" : "bk-link-chip"}
              style={{ cursor: "pointer" }}
            >
              {m.name}
            </button>
          ))}
          {amlTeam.length === 0 && <span style={{ fontSize: 12, color: "#a8a29e" }}>No compliance team members found.</span>}
        </div>
        <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={onToggleAssign}>Cancel</button>
      </article>
    );
  }

  if (adminOpen) {
    return (
      <article className="bk-card">
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{c.clientName} — Admin actions</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {(["active", "hold", "paused", "lead"] as ManualClientStatus[]).map((s) => (
            <button key={s} disabled={adminBusy} className="bk-link-chip" style={{ cursor: "pointer" }} onClick={() => onSetStatus(s)}>Set {s}</button>
          ))}
          <button disabled={adminBusy} className="bk-link-chip" style={{ cursor: "pointer", color: "#dc2626", background: "#fef2f2" }} onClick={onDelete}>
            {adminBusy ? "Working…" : "Delete client"}
          </button>
        </div>
        <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={onToggleAdmin}>Cancel</button>
      </article>
    );
  }

  return (
    <article className={`bk-card${dragging ? " dragging" : ""}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="bk-card-head">
        <Link href={`/clients/${c.clientId}`} className="bk-card-name">{c.clientName}</Link>
        <span className="bk-pill" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span>
      </div>

      {c.notes && <div className="bk-card-note">{c.notes}</div>}

      <div className="bk-card-assignee">
        {c.assignedToName ? (
          <>
            <div className="bk-avatar" style={{ width: 22, height: 22, fontSize: 9.5, background: avatarColor(c.assignedToName) }}>{initials(c.assignedToName)}</div>
            <span className="bk-assignee-name">{c.assignedToName}</span>
          </>
        ) : (
          <span className="bk-assignee-name" style={{ color: "#f59e0b" }}>Unassigned</span>
        )}
        {amlTeam.length > 0 && <button className="bk-reassign" onClick={onToggleAssign}>{c.assignedTo ? "Reassign" : "Assign"}</button>}
      </div>

      <div className="bk-card-links">
        {c.signingLink && <a className="bk-link-chip" href={c.signingLink} target="_blank" rel="noreferrer">Signing link</a>}
        {c.signingCompletedLink && <a className="bk-link-chip" href={c.signingCompletedLink} target="_blank" rel="noreferrer">Completed doc</a>}
        {c.driveLink && <a className="bk-link-chip" href={c.driveLink} target="_blank" rel="noreferrer">Drive</a>}
        <Link className="bk-link-chip" href={`/clients/${c.clientId}`}>Playbook</Link>
        {c.runId && <Link className="bk-link-chip" href={`/onboarding/${c.runId}`}>Run</Link>}
        <div style={{ position: "relative" }}>
          <button className="bk-link-chip" onClick={onToggleTeam}>Team</button>
          {teamOpen && (
            <div style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 50, background: "#fff", border: "1px solid #ececea", borderRadius: 10, padding: "12px 16px", minWidth: 280, boxShadow: "0 10px 32px rgba(28,25,23,.14)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#a8a29e", marginBottom: 8 }}>Assigned team</div>
              {c.teamMembers.length === 0 ? (
                <div style={{ fontSize: 12, color: "#a8a29e" }}>No team assigned yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {c.teamMembers.map((m) => (
                    <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", color: m.role === "AM" ? "#ea580c" : "#a8a29e", background: m.role === "AM" ? "#fff7ed" : "#f5f5f4", padding: "1px 6px", borderRadius: 4, minWidth: 52, textAlign: "center" }}>{m.role}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "#1c1917", flex: 1 }}>{m.name}</span>
                      {m.email && <a href={`mailto:${m.email}`} style={{ fontSize: 11, color: "#2563eb", textDecoration: "none" }}>email</a>}
                    </div>
                  ))}
                </div>
              )}
              <button onClick={onToggleTeam} style={{ marginTop: 8, fontSize: 10.5, color: "#a8a29e", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Close</button>
            </div>
          )}
        </div>
      </div>

      <div className="bk-card-footer">
        {canEdit && <button className="bk-btn-primary" onClick={onEdit}>Update</button>}
        {secondary && <button className="bk-btn-secondary" onClick={onSendMessage}><Icon name="mail" size={11} />{secondary}</button>}
        {isAdmin && <button className="bk-admin-link" onClick={onToggleAdmin}>Admin actions</button>}
      </div>
    </article>
  );
}

function AmlMessageModal({ client, onClose }: { client: AmlClient; onClose: () => void }) {
  const link = client.signingLink ?? "";
  const plainText = `Hi ${client.clientName.split(" ")[0] ?? "there"},

As part of our standard onboarding and compliance process, could you please review and sign our AML (Anti-Money Laundering) document?

You can easily complete the digital signature through this secure link:

🔗 Complete Your AML Sign-off Here: ${link}

It should only take a couple of minutes. Please let us know if you run into any issues or have any questions!`;
  const htmlText = `<p>Hi ${client.clientName.split(" ")[0] ?? "there"},</p>
<p>As part of our standard onboarding and compliance process, could you please review and sign our AML (Anti-Money Laundering) document?</p>
<p>You can easily complete the digital signature through this secure link:</p>
<p>🔗 <a href="${link}">Complete Your AML Sign-off Here</a></p>
<p>It should only take a couple of minutes. Please let us know if you run into any issues or have any questions!</p>`;
  const [copied, setCopied] = useState<"plain" | "html" | null>(null);

  async function copy(kind: "plain" | "html") {
    const value = kind === "plain" ? plainText : htmlText;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      alert("Copy failed — select the text and copy manually.");
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(28,25,23,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 12, maxWidth: 640, width: "100%", maxHeight: "90vh", overflow: "auto", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#1c1917" }}>AML sign-off message</div>
            <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>For {client.clientName}</div>
          </div>
          <button onClick={onClose} className="bk-link-chip">Close</button>
        </div>

        {!link && (
          <div style={{ padding: 12, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, fontSize: 13, color: "#92400e", marginBottom: 16 }}>
            No signing link saved yet. Hit Update on the card and paste the AML signing link first.
          </div>
        )}

        <div style={{ background: "#fafaf9", border: "1px solid #f0efec", borderRadius: 8, padding: 16, fontSize: 13.5, lineHeight: 1.55, color: "#1c1917", whiteSpace: "pre-wrap", marginBottom: 16 }}>
          Hi {client.clientName.split(" ")[0] ?? "there"},
          {"\n\n"}As part of our standard onboarding and compliance process, could you please review and sign our AML (Anti-Money Laundering) document?
          {"\n\n"}You can easily complete the digital signature through this secure link:
          {"\n\n"}🔗 {link ? (
            <a href={link} target="_blank" rel="noreferrer" style={{ color: "#ea580c", fontWeight: 600 }}>
              Complete Your AML Sign-off Here
            </a>
          ) : <span style={{ color: "#a8a29e", fontStyle: "italic" }}>[signing link will appear here]</span>}
          {"\n\n"}It should only take a couple of minutes. Please let us know if you run into any issues or have any questions!
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="bk-btn-primary" disabled={!link} onClick={() => copy("plain")}>
            {copied === "plain" ? "Copied ✓" : "Copy text (WhatsApp / chat)"}
          </button>
          <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} disabled={!link} onClick={() => copy("html")}>
            {copied === "html" ? "Copied ✓" : "Copy as HTML (email)"}
          </button>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="bk-link-chip" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="external-link" size={12} /> Open signing link
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
