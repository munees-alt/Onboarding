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
const STATUS_COLOR: Record<TaxStatus, string> = {
  open_item: "#94a3b8",
  pending: "var(--orange)",
  awaiting: "#f59e0b",
  application_submitted: "#3b82f6",
  completed: "#16a34a",
};
const STATUS_PANEL_BORDER: Record<TaxStatus, string> = {
  open_item: "var(--border)",
  pending: "#fed7aa",
  awaiting: "#fde68a",
  application_submitted: "#bfdbfe",
  completed: "#bbf7d0",
};
const ALL_STATUSES: TaxStatus[] = ["open_item", "pending", "awaiting", "application_submitted", "completed"];

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

  const searched = useMemo(() => local.filter((c) => {
    if (search && !c.clientName.toLowerCase().includes(search.toLowerCase())) return false;
    if (serviceFilter !== "all" && !c.services.includes(serviceFilter)) return false;
    if (tagFilter !== "all") {
      // tag filter applies to Awaiting status only
      if (c.status !== "awaiting") return false;
      if (c.awaitingTag !== tagFilter) return false;
    }
    return true;
  }), [local, search, tagFilter, serviceFilter]);

  const grouped: Record<TaxStatus, TaxClientRow[]> = {
    open_item: [], pending: [], awaiting: [], application_submitted: [], completed: [],
  };
  for (const c of searched) grouped[c.status]?.push(c);

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
    <>
      {/* Filter bar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 20 }}>
        <input
          placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, width: 240 }}
        />
        <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: "var(--ink-3)" }}>
          Service:
          <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value as TaxService | "all")} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }}>
            <option value="all">All</option>
            {(Object.keys(SERVICE_LABEL) as TaxService[]).map((s) => (
              <option key={s} value={s}>{SERVICE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: "var(--ink-3)" }}>
          Awaiting tag:
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value as AwaitingTag | "all")} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }}>
            <option value="all">All</option>
            {ALL_TAGS.map((t) => <option key={t} value={t}>{TAG_LABEL[t]}</option>)}
          </select>
        </div>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {ALL_STATUSES.map((s) => `${grouped[s].length} ${STATUS_LABEL[s].toLowerCase()}`).join(" · ")}
        </span>
      </div>

      {/* 5-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(260px, 1fr))", gap: 14, alignItems: "start" }}>
        {ALL_STATUSES.map((status) => (
          <div key={status}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-1)" }}>{STATUS_LABEL[status]}</span>
              <span style={{ fontSize: 11, fontWeight: 700, background: `${STATUS_COLOR[status]}18`, color: STATUS_COLOR[status], padding: "2px 8px", borderRadius: 20 }}>
                {grouped[status].length}
              </span>
            </div>
            {grouped[status].length === 0 && (
              <div style={{ padding: "20px 14px", textAlign: "center", color: "var(--ink-3)", fontSize: 12, background: "var(--card)", border: "1px dashed var(--border)", borderRadius: 10 }}>
                None.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {grouped[status].map((c) => (
                <div
                  key={c.clientId}
                  style={{
                    background: "var(--card)",
                    border: `1px solid ${STATUS_PANEL_BORDER[status]}`,
                    borderRadius: 10,
                    padding: "14px 14px",
                  }}
                >
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
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Assign modal */}
      {assignFor && (
        <div
          onClick={() => setAssignFor(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--card)", borderRadius: 12, maxWidth: 520, width: "100%", maxHeight: "85vh", overflow: "auto", padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              Assign tax team members
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 14 }}>
              Pick one or more — they will get an action-item chip in My Work.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {taxTeam.map((m) => (
                <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, padding: "5px 4px", borderRadius: 6, background: assignSel[m.id] ? "var(--orange-soft, #fff7ed)" : "transparent" }}>
                  <input
                    type="checkbox"
                    checked={!!assignSel[m.id]}
                    onChange={(e) => setAssignSel((s) => ({ ...s, [m.id]: e.target.checked }))}
                    style={{ accentColor: "var(--orange)" }}
                  />
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                  {m.title && <span style={{ fontSize: 11, color: "var(--ink-3)" }}>· {m.title}</span>}
                </label>
              ))}
              {taxTeam.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>No tax team members found.</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-ghost" onClick={() => setAssignFor(null)} disabled={assignBusy}>Cancel</button>
              <button className="btn-primary" onClick={() => doAssign(assignFor)} disabled={assignBusy}>
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
            style={{ background: "var(--card)", borderRadius: 12, maxWidth: 520, width: "100%", padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              Request to tax team — {requestFor.clientName}
            </div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>
              Drops as an action item in the assigned tax team members&apos; My Work.
            </div>
            <textarea
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              placeholder="What does the tax team need to do for this client?"
              rows={5}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn-ghost" onClick={() => setRequestFor(null)} disabled={requestBusy}>Cancel</button>
              <button className="btn-primary" onClick={doRequest} disabled={requestBusy || !requestNote.trim()}>
                {requestBusy ? "Sending…" : "Send request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
  return (
    <div>
      <Link href={`/clients/${c.clientId}`} style={{ fontWeight: 700, fontSize: 13.5, color: "var(--ink-1)", textDecoration: "none", lineHeight: 1.3 }}>
        {c.clientName}
      </Link>

      {/* Service chips */}
      {c.services.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
          {c.services.map((s) => (
            <span key={s} style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, background: `${SERVICE_COLOR[s]}15`, color: SERVICE_COLOR[s], border: `1px solid ${SERVICE_COLOR[s]}30` }}>
              {SERVICE_LABEL[s]}
            </span>
          ))}
        </div>
      )}

      {/* Awaiting tag */}
      {c.status === "awaiting" && c.awaitingTag && (
        <div style={{ marginTop: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
            ⏳ {TAG_LABEL[c.awaitingTag]}
          </span>
        </div>
      )}

      {/* Notes */}
      {c.notes && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.4 }}>{c.notes}</div>}

      {/* Assigned tax members */}
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <Icon name="user" size={11} style={{ color: "var(--ink-3)" }} />
        {c.assignedToNames.length === 0 ? (
          <span style={{ fontSize: 11.5, color: "#f59e0b", fontWeight: 600 }}>Unassigned</span>
        ) : (
          c.assignedToNames.map((name) => (
            <span key={name} style={{ fontSize: 11.5, color: "var(--ink-2)", fontWeight: 600 }}>{name}</span>
          ))
        )}
        {(canEdit || isHead || isAdmin) && (
          <button onClick={onAssign} style={{ fontSize: 10.5, color: "#7c3aed", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
            {c.assignedTo.length ? "Reassign" : "Assign"}
          </button>
        )}
      </div>

      {/* Action row */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
        {c.driveLink && (
          <a href={c.driveLink} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 3 }}>
            <Icon name="folder-open" size={11} /> Drive
          </a>
        )}
        {c.referenceLink && (
          <a href={c.referenceLink} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "#3b82f6", display: "flex", alignItems: "center", gap: 3 }}>
            <Icon name="external-link" size={11} /> Ref
          </a>
        )}
        <Link href={`/clients/${c.clientId}`} style={{ fontSize: 11.5, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 3, textDecoration: "none" }}>
          <Icon name="book-open" size={11} /> Playbook
        </Link>
        {c.runId && (
          <Link href={`/onboarding/${c.runId}`} style={{ fontSize: 11.5, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 3, textDecoration: "none" }}>
            <Icon name="file-text" size={11} /> Run
          </Link>
        )}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setTeamOpen((v) => !v)}
            title="View onboarding team"
            style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11.5, color: teamOpen ? "var(--orange)" : "var(--ink-2)", background: teamOpen ? "var(--orange-soft, #fff7ed)" : "none", border: "1px solid " + (teamOpen ? "var(--orange)" : "var(--border)"), borderRadius: 5, cursor: "pointer", padding: "2px 6px" }}
          >
            <Icon name="users" size={11} /> Team
          </button>
          {teamOpen && (
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", minWidth: 240, boxShadow: "0 4px 16px rgba(0,0,0,0.10)" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--ink-3)", marginBottom: 8 }}>Onboarding team</div>
              {c.teamMembers.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>No onboarding team yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {c.teamMembers.map((m) => (
                    <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", color: m.role === "AM" ? "var(--orange)" : "var(--ink-3)", background: m.role === "AM" ? "#fff7ed" : "var(--surface)", padding: "1px 6px", borderRadius: 4, minWidth: 50, textAlign: "center" }}>{m.role}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)", flex: 1 }}>{m.name}</span>
                      {m.email && <a href={`mailto:${m.email}`} style={{ fontSize: 10.5, color: "#3b82f6", textDecoration: "none" }}>email</a>}
                    </div>
                  ))}
                </div>
              )}
              <button onClick={() => setTeamOpen(false)} style={{ marginTop: 8, fontSize: 10, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Close</button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {canEdit && (
          <button className="btn-ghost" style={{ fontSize: 11.5, padding: "3px 9px" }} onClick={onEdit}>Update</button>
        )}
        <button
          onClick={onRequest}
          title="Send a note to the assigned tax team members"
          style={{ fontSize: 11.5, padding: "3px 9px", color: "var(--orange)", background: "var(--orange-soft, #fff7ed)", border: "1px solid var(--orange)", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}
        >
          <Icon name="message-square" size={11} /> Request to team
        </button>
      </div>
    </div>
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
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>{client.clientName}</div>

      <label style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>Status</label>
      <select
        value={status}
        onChange={(e) => onChange({ status: e.target.value as TaxStatus })}
        style={{ display: "block", width: "100%", marginTop: 4, marginBottom: 10, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }}
      >
        {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>

      <label style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>Services applied</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4, marginBottom: 10 }}>
        {(Object.keys(SERVICE_LABEL) as TaxService[]).map((s) => {
          const on = services.includes(s);
          return (
            <button
              key={s}
              onClick={() => toggleService(s)}
              style={{
                fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 12,
                background: on ? `${SERVICE_COLOR[s]}20` : "var(--surface)",
                color: on ? SERVICE_COLOR[s] : "var(--ink-3)",
                border: `1px solid ${on ? SERVICE_COLOR[s] : "var(--border)"}`,
                cursor: "pointer",
              }}
            >
              {SERVICE_LABEL[s]}
            </button>
          );
        })}
      </div>

      {status === "awaiting" && (
        <>
          <label style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>Awaiting reason</label>
          <select
            value={(form.awaitingTag as AwaitingTag | null) ?? ""}
            onChange={(e) => onChange({ awaitingTag: (e.target.value || null) as AwaitingTag | null })}
            style={{ display: "block", width: "100%", marginTop: 4, marginBottom: 10, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }}
          >
            <option value="">— pick a reason —</option>
            {ALL_TAGS.map((t) => <option key={t} value={t}>{TAG_LABEL[t]}</option>)}
          </select>
        </>
      )}

      <label style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>Notes</label>
      <textarea
        value={(form.notes as string | null | undefined) ?? ""}
        onChange={(e) => onChange({ notes: e.target.value })}
        rows={2}
        style={{ display: "block", width: "100%", marginTop: 4, marginBottom: 10, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12, resize: "vertical" }}
      />

      <label style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600 }}>Reference link (e.g. FTA application URL)</label>
      <input
        value={(form.referenceLink as string | null | undefined) ?? ""}
        onChange={(e) => onChange({ referenceLink: e.target.value })}
        placeholder="https://…"
        style={{ display: "block", width: "100%", marginTop: 4, marginBottom: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12 }}
      />

      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button className="btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
