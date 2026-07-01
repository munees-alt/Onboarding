"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import {
  saveTaxComplianceRecord, assignTaxMembers, requestToTaxTeam,
  type TaxClientRow, type TaxTeamMember, type TaxStatus, type TaxService, type AwaitingTag,
} from "./actions";

const STATUS_LABEL: Record<TaxStatus, string> = {
  open_item: "Open Item",
  pending: "Pending",
  awaiting: "Awaiting",
  application_submitted: "Application Submitted",
  completed: "Completed",
};
const ALL_STATUSES: TaxStatus[] = ["open_item", "pending", "awaiting", "application_submitted", "completed"];

/** Board/list/pill styling per status — accent for column swatch + stat dot, bg/fg for pills. */
const STATUS_META: Record<TaxStatus, { label: string; accent: string; bg: string; fg: string; empty: string }> = {
  open_item: { label: "Open Item", accent: "#94a3b8", bg: "#f1f5f9", fg: "#475569", empty: "No open items." },
  pending: { label: "Pending", accent: "#f97316", bg: "#ffedd5", fg: "#c2410c", empty: "Nothing pending." },
  awaiting: { label: "Awaiting", accent: "#f59e0b", bg: "#fef3c7", fg: "#92400e", empty: "Nothing awaiting." },
  application_submitted: { label: "Application Submitted", accent: "#3b82f6", bg: "#dbeafe", fg: "#1d4ed8", empty: "No submitted applications." },
  completed: { label: "Completed", accent: "#16a34a", bg: "#dcfce7", fg: "#15803d", empty: "No completed items yet." },
};

const SERVICE_LABEL: Record<TaxService, string> = {
  ct_reg: "CT Reg",
  vat_reg: "VAT Reg",
  ct_fil: "CT Filing",
  vat_fil: "VAT Filing",
};
const SERVICE_COLOR: Record<TaxService, string> = {
  ct_reg: "#7c3aed",
  vat_reg: "#0ea5e9",
  ct_fil: "#a855f7",
  vat_fil: "#06b6d4",
};

const TAG_LABEL: Record<AwaitingTag, string> = {
  fta_dependency: "FTA Dependency",
  team_dependency: "Team Dependency",
  task_dependency: "Task Dependency",
  client_dependency: "Client Dependency",
};
const ALL_TAGS: AwaitingTag[] = ["fta_dependency", "team_dependency", "task_dependency", "client_dependency"];

type SortKey = "name" | "services" | "assignee";

const AVATAR_COLORS = ["#f97316", "#8b5cf6", "#0ea5e9", "#e11d48", "#14b8a6", "#f59e0b"];
function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

export function TaxComplianceView({
  clients, canEdit, isAdmin, isHead, taxTeam,
}: {
  clients: TaxClientRow[];
  canEdit: boolean;
  isAdmin: boolean;
  isHead: boolean;
  taxTeam: TaxTeamMember[];
}) {
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<AwaitingTag | "all">("all");
  const [serviceFilter, setServiceFilter] = useState<TaxService | "all">("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [view, setView] = useState<"board" | "list">("board");
  const [local, setLocal] = useState(clients);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, Partial<TaxClientRow>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [assignSel, setAssignSel] = useState<Record<string, boolean>>({});
  const [assignBusy, setAssignBusy] = useState(false);

  const [requestFor, setRequestFor] = useState<TaxClientRow | null>(null);
  const [requestNote, setRequestNote] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);

  const assigneeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of local) for (const n of c.assignedToNames) names.add(n);
    for (const m of taxTeam) names.add(m.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [local, taxTeam]);

  const filtered = useMemo(() => {
    let list = local.filter((c) => {
      if (search && !c.clientName.toLowerCase().includes(search.toLowerCase())) return false;
      if (serviceFilter !== "all" && !c.services.includes(serviceFilter)) return false;
      if (tagFilter !== "all") {
        // tag filter applies to Awaiting status only
        if (c.status !== "awaiting") return false;
        if (c.awaitingTag !== tagFilter) return false;
      }
      if (assigneeFilter === "__unassigned") { if (c.assignedToNames.length > 0) return false; }
      else if (assigneeFilter !== "all" && !c.assignedToNames.includes(assigneeFilter)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "services") return b.services.length - a.services.length || a.clientName.localeCompare(b.clientName);
      if (sort === "assignee") return (a.assignedToNames[0] ?? "").localeCompare(b.assignedToNames[0] ?? "") || a.clientName.localeCompare(b.clientName);
      return a.clientName.localeCompare(b.clientName);
    });
    return list;
  }, [local, search, tagFilter, serviceFilter, assigneeFilter, sort]);

  const columns = ALL_STATUSES.map((key) => ({
    key,
    meta: STATUS_META[key],
    cards: filtered.filter((c) => c.status === key),
  }));

  const stats = ALL_STATUSES.map((key) => ({ key, meta: STATUS_META[key], count: filtered.filter((c) => c.status === key).length }));

  const chips: { label: string; onRemove: () => void }[] = [];
  if (search.trim()) chips.push({ label: `"${search.trim()}"`, onRemove: () => setSearch("") });
  if (serviceFilter !== "all") chips.push({ label: SERVICE_LABEL[serviceFilter], onRemove: () => setServiceFilter("all") });
  if (tagFilter !== "all") chips.push({ label: TAG_LABEL[tagFilter], onRemove: () => setTagFilter("all") });
  if (assigneeFilter !== "all") chips.push({ label: assigneeFilter === "__unassigned" ? "Unassigned" : assigneeFilter, onRemove: () => setAssigneeFilter("all") });

  function clearAll() {
    setSearch("");
    setServiceFilter("all");
    setTagFilter("all");
    setAssigneeFilter("all");
  }

  function startEdit(c: TaxClientRow) {
    setEditingId(c.clientId);
    setForms((f) => ({
      ...f,
      [c.clientId]: {
        status: c.status,
        services: c.services,
        awaitingTag: c.awaitingTag,
        notes: c.notes ?? "",
        referenceLink: c.referenceLink ?? "",
      },
    }));
  }

  async function doSave(clientId: string) {
    const form = forms[clientId] ?? {};
    setSaving(clientId);
    const res = await saveTaxComplianceRecord({
      clientId,
      status: (form.status as TaxStatus) ?? "open_item",
      services: ((form.services as TaxService[]) ?? []),
      awaitingTag: (form.awaitingTag as AwaitingTag | null) ?? null,
      notes: (form.notes as string | null) ?? null,
      referenceLink: (form.referenceLink as string | null) ?? null,
    });
    setSaving(null);
    if (res.error) { alert(res.error); return; }
    setLocal((prev) => prev.map((c) => c.clientId === clientId ? {
      ...c,
      status: (form.status as TaxStatus) ?? c.status,
      services: (form.services as TaxService[]) ?? c.services,
      awaitingTag: (form.awaitingTag as AwaitingTag | null) ?? null,
      notes: (form.notes as string | null) ?? c.notes,
      referenceLink: (form.referenceLink as string | null) ?? c.referenceLink,
    } : c));
    setEditingId(null);
  }

  function openAssign(c: TaxClientRow) {
    setAssignFor(c.clientId);
    setAssignSel(Object.fromEntries(c.assignedTo.map((id) => [id, true])));
  }

  async function doAssign(clientId: string) {
    setAssignBusy(true);
    const memberIds = Object.entries(assignSel).filter(([, v]) => v).map(([id]) => id);
    const res = await assignTaxMembers(clientId, memberIds);
    setAssignBusy(false);
    if (res.error) { alert(res.error); return; }
    const names = memberIds.map((id) => taxTeam.find((t) => t.id === id)?.name ?? id);
    setLocal((prev) => prev.map((c) => c.clientId === clientId
      ? { ...c, assignedTo: memberIds, assignedToNames: names }
      : c));
    setAssignFor(null);
  }

  async function doRequest() {
    if (!requestFor) return;
    setRequestBusy(true);
    const res = await requestToTaxTeam(requestFor.clientId, requestNote);
    setRequestBusy(false);
    if (res.error) { alert(res.error); return; }
    setRequestFor(null);
    setRequestNote("");
    alert("Request sent to the tax team's action items.");
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
            <input placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <label className="bk-select-wrap">
            <select className="bk-select" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value as TaxService | "all")}>
              <option value="all">Service · All</option>
              {(Object.keys(SERVICE_LABEL) as TaxService[]).map((s) => (
                <option key={s} value={s}>{SERVICE_LABEL[s]}</option>
              ))}
            </select>
            <Icon name="chevron-down" size={13} className="bk-select-chev" />
          </label>

          <label className="bk-select-wrap">
            <select className="bk-select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value as AwaitingTag | "all")}>
              <option value="all">Awaiting tag · All</option>
              {ALL_TAGS.map((t) => <option key={t} value={t}>{TAG_LABEL[t]}</option>)}
            </select>
            <Icon name="chevron-down" size={13} className="bk-select-chev" />
          </label>

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
            <select className="bk-select bk-select-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="name">Company A–Z</option>
              <option value="services">Most services first</option>
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
            <button className="bk-chip-clear" onClick={clearAll}>Clear all</button>
          </div>
        )}
      </div>

      {view === "board" ? (
        <div className="bk-board">
          {columns.map((col) => (
            <section key={col.key} className="bk-col">
              <div className="bk-col-head">
                <span className="bk-col-swatch" style={{ background: col.meta.accent }} />
                <span className="bk-col-label">{col.meta.label}</span>
                <span className="bk-col-count">{col.cards.length}</span>
              </div>
              <div className="bk-col-cards">
                {col.cards.map((c) => (
                  <article className="bk-card" key={c.clientId}>
                    {editingId === c.clientId ? (
                      <TaxEditForm
                        client={c}
                        form={forms[c.clientId] ?? {}}
                        onChange={(patch) => setForms((f) => ({ ...f, [c.clientId]: { ...f[c.clientId], ...patch } }))}
                        onSave={() => doSave(c.clientId)}
                        onCancel={() => setEditingId(null)}
                        saving={saving === c.clientId}
                      />
                    ) : (
                      <TaxCardBody
                        c={c}
                        canEdit={canEdit}
                        isHead={isHead}
                        isAdmin={isAdmin}
                        onEdit={() => startEdit(c)}
                        onAssign={() => openAssign(c)}
                        onRequest={() => { setRequestFor(c); setRequestNote(""); }}
                      />
                    )}
                  </article>
                ))}
                {col.cards.length === 0 && <div className="bk-col-empty">{col.meta.empty}</div>}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="bk-list-wrap">
          <div className="bk-list">
            <div className="bk-list-head" style={{ gridTemplateColumns: "2fr .9fr 1.6fr 1.4fr 1.2fr" }}>
              <span>Client</span><span>Status</span><span>Services</span><span>Assignee</span><span>Reference</span>
            </div>
            {filtered.map((c) => {
              const meta = STATUS_META[c.status];
              return (
                <div className="bk-list-row" key={c.clientId} style={{ gridTemplateColumns: "2fr .9fr 1.6fr 1.4fr 1.2fr" }}>
                  <Link href={`/clients/${c.clientId}`} className="bk-list-cell-name" style={{ textDecoration: "none" }}>{c.clientName}</Link>
                  <span><span className="bk-pill" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span></span>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {c.services.length === 0
                      ? <span className="bk-list-cell">—</span>
                      : c.services.map((s) => (
                        <span key={s} className="bk-pill" style={{ background: `${SERVICE_COLOR[s]}18`, color: SERVICE_COLOR[s], fontSize: 10, padding: "2px 7px" }}>{SERVICE_LABEL[s]}</span>
                      ))}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    {c.assignedToNames.length > 0 ? (
                      <>
                        <div className="bk-avatar" style={{ width: 20, height: 20, fontSize: 9, background: avatarColor(c.assignedToNames[0]) }}>{initials(c.assignedToNames[0])}</div>
                        <span className="bk-list-cell">{c.assignedToNames.join(", ")}</span>
                      </>
                    ) : <span className="bk-list-cell" style={{ color: "#f59e0b", fontWeight: 600 }}>Unassigned</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {c.referenceLink
                      ? <a href={c.referenceLink} target="_blank" rel="noreferrer" className="bk-link-chip">Ref</a>
                      : <span className="bk-list-cell">—</span>}
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="bk-list-empty">No clients match your filters.</div>}
          </div>
        </div>
      )}

      {/* Assign modal */}
      {assignFor && (
        <div
          onClick={() => setAssignFor(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 12, maxWidth: 520, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              Assign tax team members
            </div>
            <div style={{ fontSize: 12, color: "#78716c", marginBottom: 14 }}>
              Pick one or more — they will get an action-item chip in My Work.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {taxTeam.map((m) => (
                <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, padding: "5px 4px", borderRadius: 6, background: assignSel[m.id] ? "#fff7ed" : "transparent" }}>
                  <input
                    type="checkbox"
                    checked={!!assignSel[m.id]}
                    onChange={(e) => setAssignSel((s) => ({ ...s, [m.id]: e.target.checked }))}
                    style={{ accentColor: "#ea580c" }}
                  />
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  {m.title && <span style={{ fontSize: 11, color: "#78716c" }}>· {m.title}</span>}
                </label>
              ))}
              {taxTeam.length === 0 && (
                <div style={{ fontSize: 12, color: "#78716c" }}>No tax team members found.</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={() => setAssignFor(null)} disabled={assignBusy}>Cancel</button>
              <button className="bk-btn-primary" onClick={() => doAssign(assignFor)} disabled={assignBusy}>
                {assignBusy ? "Saving…" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request-to-team modal */}
      {requestFor && (
        <div
          onClick={() => setRequestFor(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 12, maxWidth: 520, width: "100%", padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              Request to tax team — {requestFor.clientName}
            </div>
            <div style={{ fontSize: 12, color: "#78716c", marginBottom: 12 }}>
              Drops as an action item in the assigned tax team members&apos; My Work.
            </div>
            <textarea
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              placeholder="What does the tax team need to do for this client?"
              rows={5}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e7e5e4", fontSize: 13, resize: "vertical", fontFamily: "inherit" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={() => setRequestFor(null)} disabled={requestBusy}>Cancel</button>
              <button className="bk-btn-primary" onClick={doRequest} disabled={requestBusy || !requestNote.trim()}>
                {requestBusy ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaxCardBody({
  c, canEdit, isHead, isAdmin, onEdit, onAssign, onRequest,
}: {
  c: TaxClientRow;
  canEdit: boolean;
  isHead: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onAssign: () => void;
  onRequest: () => void;
}) {
  const [teamOpen, setTeamOpen] = useState(false);
  const meta = STATUS_META[c.status];
  const primaryAssignee = c.assignedToNames[0] ?? null;
  const extraAssignees = c.assignedToNames.length - 1;

  return (
    <>
      <div className="bk-card-head">
        <Link href={`/clients/${c.clientId}`} className="bk-card-name">{c.clientName}</Link>
        <span className="bk-pill" style={{ background: meta.bg, color: meta.fg }}>{meta.label}</span>
      </div>

      {/* Service chips */}
      {c.services.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 9 }}>
          {c.services.map((s) => (
            <span key={s} className="bk-pill" style={{ fontSize: 10, padding: "2px 7px", background: `${SERVICE_COLOR[s]}15`, color: SERVICE_COLOR[s], border: `1px solid ${SERVICE_COLOR[s]}30` }}>
              {SERVICE_LABEL[s]}
            </span>
          ))}
        </div>
      )}

      {/* Awaiting tag */}
      {c.status === "awaiting" && c.awaitingTag && (
        <div style={{ marginTop: 7 }}>
          <span className="bk-pill" style={{ fontSize: 10.5, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
            ⏳ {TAG_LABEL[c.awaitingTag]}
          </span>
        </div>
      )}

      {c.notes && <div className="bk-card-note">{c.notes}</div>}

      {/* Assigned tax members */}
      <div className="bk-card-assignee">
        {primaryAssignee ? (
          <>
            <div className="bk-avatar" style={{ width: 22, height: 22, fontSize: 9.5, background: avatarColor(primaryAssignee) }}>{initials(primaryAssignee)}</div>
            <span className="bk-assignee-name">{primaryAssignee}{extraAssignees > 0 ? ` +${extraAssignees}` : ""}</span>
          </>
        ) : (
          <span className="bk-assignee-name" style={{ color: "#f59e0b" }}>Unassigned</span>
        )}
        {(canEdit || isHead || isAdmin) && (
          <button className="bk-reassign" onClick={onAssign}>{c.assignedTo.length ? "Reassign" : "Assign"}</button>
        )}
      </div>

      {/* Action links */}
      <div className="bk-card-links">
        {c.driveLink && <a className="bk-link-chip" href={c.driveLink} target="_blank" rel="noreferrer">Drive</a>}
        {c.referenceLink && <a className="bk-link-chip" href={c.referenceLink} target="_blank" rel="noreferrer">Ref</a>}
        <Link className="bk-link-chip" href={`/clients/${c.clientId}`}>Playbook</Link>
        {c.runId && <Link className="bk-link-chip" href={`/onboarding/${c.runId}`}>Run</Link>}
        <div style={{ position: "relative" }}>
          <button className="bk-link-chip" onClick={() => setTeamOpen((v) => !v)}>Team</button>
          {teamOpen && (
            <div style={{ position: "absolute", left: 0, top: "calc(100% + 6px)", zIndex: 50, background: "#fff", border: "1px solid #ececea", borderRadius: 10, padding: "12px 16px", minWidth: 280, boxShadow: "0 10px 32px rgba(28,25,23,.14)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#a8a29e", marginBottom: 8 }}>Onboarding team</div>
              {c.teamMembers.length === 0 ? (
                <div style={{ fontSize: 12, color: "#a8a29e" }}>No onboarding team yet.</div>
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
              <button onClick={() => setTeamOpen(false)} style={{ marginTop: 8, fontSize: 10.5, color: "#a8a29e", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Close</button>
            </div>
          )}
        </div>
      </div>

      <div className="bk-card-footer">
        {canEdit && <button className="bk-btn-primary" onClick={onEdit}>Update</button>}
        <button className="bk-btn-secondary" onClick={onRequest} title="Send a note to the assigned tax team members">
          <Icon name="message-square" size={11} />Request to team
        </button>
      </div>
    </>
  );
}

function TaxEditForm({
  client, form, onChange, onSave, onCancel, saving,
}: {
  client: TaxClientRow;
  form: Partial<TaxClientRow>;
  onChange: (patch: Partial<TaxClientRow>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const status = (form.status as TaxStatus) ?? client.status;
  const services = (form.services as TaxService[]) ?? client.services;

  function toggleService(s: TaxService) {
    const next = services.includes(s) ? services.filter((x) => x !== s) : [...services, s];
    onChange({ services: next });
  }

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10, color: "#1c1917" }}>{client.clientName}</div>

      <label style={{ fontSize: 11, color: "#78716c", fontWeight: 600 }}>Status</label>
      <select
        value={status}
        onChange={(e) => onChange({ status: e.target.value as TaxStatus })}
        style={{ display: "block", width: "100%", marginTop: 4, marginBottom: 10, height: 32, borderRadius: 7, border: "1px solid #e7e5e4", padding: "0 8px", fontSize: 12.5, fontFamily: "inherit" }}
      >
        {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>

      <label style={{ fontSize: 11, color: "#78716c", fontWeight: 600 }}>Services applied</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4, marginBottom: 10 }}>
        {(Object.keys(SERVICE_LABEL) as TaxService[]).map((s) => {
          const on = services.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleService(s)}
              style={{
                fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 12,
                background: on ? `${SERVICE_COLOR[s]}20` : "#f5f5f4",
                color: on ? SERVICE_COLOR[s] : "#78716c",
                border: `1px solid ${on ? SERVICE_COLOR[s] : "#e7e5e4"}`,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {SERVICE_LABEL[s]}
            </button>
          );
        })}
      </div>

      {status === "awaiting" && (
        <>
          <label style={{ fontSize: 11, color: "#78716c", fontWeight: 600 }}>Awaiting reason</label>
          <select
            value={(form.awaitingTag as AwaitingTag | null) ?? ""}
            onChange={(e) => onChange({ awaitingTag: (e.target.value || null) as AwaitingTag | null })}
            style={{ display: "block", width: "100%", marginTop: 4, marginBottom: 10, height: 32, borderRadius: 7, border: "1px solid #e7e5e4", padding: "0 8px", fontSize: 12.5, fontFamily: "inherit" }}
          >
            <option value="">— pick a reason —</option>
            {ALL_TAGS.map((t) => <option key={t} value={t}>{TAG_LABEL[t]}</option>)}
          </select>
        </>
      )}

      <label style={{ fontSize: 11, color: "#78716c", fontWeight: 600 }}>Notes</label>
      <textarea
        value={(form.notes as string | null | undefined) ?? ""}
        onChange={(e) => onChange({ notes: e.target.value })}
        rows={2}
        style={{ display: "block", width: "100%", marginTop: 4, marginBottom: 10, padding: "5px 8px", borderRadius: 7, border: "1px solid #e7e5e4", fontSize: 12.5, resize: "vertical", fontFamily: "inherit" }}
      />

      <label style={{ fontSize: 11, color: "#78716c", fontWeight: 600 }}>Reference link (e.g. FTA application URL)</label>
      <input
        value={(form.referenceLink as string | null | undefined) ?? ""}
        onChange={(e) => onChange({ referenceLink: e.target.value })}
        placeholder="https://…"
        style={{ display: "block", width: "100%", marginTop: 4, marginBottom: 12, height: 32, borderRadius: 7, border: "1px solid #e7e5e4", padding: "0 8px", fontSize: 12.5, fontFamily: "inherit" }}
      />

      <div style={{ display: "flex", gap: 8 }}>
        <button className="bk-btn-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button className="bk-btn-secondary" style={{ borderColor: "#e7e5e4", color: "#57534e" }} onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </div>
  );
}
