"use client";

import { useState } from "react";
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

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", in_review: "In Review", link_sent: "Link Sent", signed: "Signed", document_created: "Document Created", completed: "Completed",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "#94a3b8", in_review: "var(--orange)", link_sent: "#3b82f6", signed: "#8b5cf6", document_created: "#06b6d4", completed: "#16a34a",
};
const ALL_STATUSES = ["pending", "in_review", "document_created", "link_sent", "signed", "completed"] as const;

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
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, Partial<AmlClient>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [localClients, setLocalClients] = useState(clients);
  const [adminPanel, setAdminPanel] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [assignPanel, setAssignPanel] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [messageFor, setMessageFor] = useState<AmlClient | null>(null);

  const ACTIVE_STATUSES = ["pending", "in_review", "link_sent", "signed"];
  const searched = localClients.filter((c) =>
    !search || c.clientName.toLowerCase().includes(search.toLowerCase()),
  );
  const activeClients = searched.filter((c) => ACTIVE_STATUSES.includes(c.status));
  const documentCreatedClients = searched.filter((c) => c.status === "document_created");
  const completedClients = searched.filter((c) => c.status === "completed");
  // legacy: keep visible for compatibility with tab filter if used
  const visible = searched.filter((c) => filter === "all" || c.status === filter);

  function startEdit(c: AmlClient) {
    setEditing(c.clientId);
    setForms((f) => ({ ...f, [c.clientId]: { status: c.status, notes: c.notes ?? "", signingLink: c.signingLink ?? "", signingCompletedLink: c.signingCompletedLink ?? "" } }));
  }

  async function doSave(clientId: string) {
    const form = forms[clientId] ?? {};
    setSaving(clientId);
    const res = await saveAmlRecord({
      clientId,
      status: form.status ?? "pending",
      notes: form.notes ?? null,
      signingLink: form.signingLink ?? null,
      signingCompletedLink: form.signingCompletedLink ?? null,
    });
    setSaving(null);
    if (res.error) { alert(res.error); return; }
    setLocalClients((prev) =>
      prev.map((c) => c.clientId === clientId
        ? { ...c, status: form.status ?? c.status, notes: (form.notes as string | null) ?? c.notes, signingLink: (form.signingLink as string | null) ?? c.signingLink, signingCompletedLink: (form.signingCompletedLink as string | null) ?? c.signingCompletedLink }
        : c,
      ),
    );
    setEditing(null);
  }

  async function doAssign(clientId: string, memberId: string) {
    setAssignBusy(true);
    const memberName = amlTeam.find(m => m.id === memberId)?.name ?? memberId;
    const res = await assignAmlMember(clientId, memberId);
    setAssignBusy(false);
    if (res.error) { alert(res.error); return; }
    setLocalClients((prev) => prev.map((c) => c.clientId === clientId ? { ...c, assignedTo: memberId, assignedToName: memberName } : c));
    setAssignPanel(null);
  }

  const counts = localClients.reduce((acc, c) => { acc[c.status] = (acc[c.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <>
      {/* Search bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
        <input
          placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, width: 240 }}
        />
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {activeClients.length} pending · {documentCreatedClients.length} doc created · {completedClients.length} completed
        </span>
      </div>

      {/* Split layout: three panels side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, alignItems: "start" }}>

        {/* ── Pending / Active panel ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-1)" }}>Pending Items</span>
            <span style={{ fontSize: 11, fontWeight: 700, background: "var(--orange-soft, #fff7ed)", color: "var(--orange)", padding: "2px 8px", borderRadius: 20 }}>
              {activeClients.length}
            </span>
          </div>
          {activeClients.length === 0 && (
            <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 12.5, background: "var(--card)", border: "1px dashed var(--border)", borderRadius: 10 }}>
              No pending AML items.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {activeClients.map((c) => (
          <div key={c.clientId} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 18px" }}>
            {editing === c.clientId ? (
              <AmlEditForm
                clientId={c.clientId}
                clientName={c.clientName}
                form={forms[c.clientId] ?? {}}
                onChange={(patch) => setForms((f) => ({ ...f, [c.clientId]: { ...f[c.clientId], ...patch } }))}
                onSave={() => doSave(c.clientId)}
                onCancel={() => setEditing(null)}
                saving={saving === c.clientId}
                driveLink={c.driveLink}
                runId={c.runId}
              />
            ) : adminPanel === c.clientId ? (
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{c.clientName} — Admin actions</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  {(["active", "hold", "paused", "lead"] as ManualClientStatus[]).map((s) => (
                    <button key={s} className="btn-ghost" disabled={adminBusy} style={{ fontSize: 12 }}
                      onClick={async () => {
                        if (!confirm(`Set ${c.clientName} to "${s}"?`)) return;
                        setAdminBusy(true);
                        await setClientStatusAction(c.clientId, s);
                        setAdminBusy(false);
                        router.refresh();
                      }}>
                      Set {s}
                    </button>
                  ))}
                  <button className="btn-ghost" disabled={adminBusy} style={{ fontSize: 12, color: "#dc2626", borderColor: "#fca5a5" }}
                    onClick={async () => {
                      if (!confirm(`PERMANENTLY DELETE ${c.clientName} and all their data? This cannot be undone.`)) return;
                      if (!confirm("Are you absolutely sure?")) return;
                      setAdminBusy(true);
                      await deleteClientAction(c.clientId);
                      setLocalClients((prev) => prev.filter((x) => x.clientId !== c.clientId));
                      setAdminBusy(false);
                      setAdminPanel(null);
                    }}>
                    {adminBusy ? "Working…" : "Delete client"}
                  </button>
                </div>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setAdminPanel(null)}>Cancel</button>
              </div>
            ) : assignPanel === c.clientId ? (
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{c.clientName} — Assign team member</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                  {amlTeam.map((m) => (
                    <button
                      key={m.id}
                      className={c.assignedTo === m.id ? "btn-primary" : "btn-ghost"}
                      disabled={assignBusy}
                      style={{ fontSize: 13 }}
                      onClick={() => doAssign(c.clientId, m.id)}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setAssignPanel(null)}>Cancel</button>
              </div>
            ) : (
              <div>
                <AmlClientRow
                  c={c}
                  onEdit={() => startEdit(c)}
                  canEdit={canEdit}
                  isHead={!!isHead}
                  onAssign={amlTeam.length > 0 ? () => setAssignPanel(c.clientId) : undefined}
                  onSendMessage={() => setMessageFor(c)}
                />
                {isAdmin && (
                  <button style={{ marginTop: 6, fontSize: 11, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => setAdminPanel(c.clientId)}>
                    Admin actions
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
          </div>
        </div>

        {/* ── Document Created panel ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-1)" }}>Document Created</span>
            <span style={{ fontSize: 11, fontWeight: 700, background: "#cffafe", color: "#0891b2", padding: "2px 8px", borderRadius: 20 }}>
              {documentCreatedClients.length}
            </span>
          </div>
          {documentCreatedClients.length === 0 && (
            <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 12.5, background: "var(--card)", border: "1px dashed var(--border)", borderRadius: 10 }}>
              No documents awaiting completion.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {documentCreatedClients.map((c) => (
              <div key={c.clientId} style={{ background: "var(--card)", border: "1px solid #a5f3fc", borderRadius: 10, padding: "14px 18px" }}>
                {editing === c.clientId ? (
                  <AmlEditForm
                    clientId={c.clientId}
                    clientName={c.clientName}
                    form={forms[c.clientId] ?? {}}
                    onChange={(patch) => setForms((f) => ({ ...f, [c.clientId]: { ...f[c.clientId], ...patch } }))}
                    onSave={() => doSave(c.clientId)}
                    onCancel={() => setEditing(null)}
                    saving={saving === c.clientId}
                    driveLink={c.driveLink}
                    runId={c.runId}
                  />
                ) : assignPanel === c.clientId ? (
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{c.clientName} — Assign team member</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                      {amlTeam.map((m) => (
                        <button key={m.id} className={c.assignedTo === m.id ? "btn-primary" : "btn-ghost"} disabled={assignBusy} style={{ fontSize: 13 }} onClick={() => doAssign(c.clientId, m.id)}>
                          {m.name}
                        </button>
                      ))}
                    </div>
                    <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => setAssignPanel(null)}>Cancel</button>
                  </div>
                ) : (
                  <div>
                    <AmlClientRow
                      c={c}
                      onEdit={() => startEdit(c)}
                      canEdit={canEdit}
                      isHead={!!isHead}
                      onAssign={amlTeam.length > 0 ? () => setAssignPanel(c.clientId) : undefined}
                    />
                    {isAdmin && (
                      <button style={{ marginTop: 6, fontSize: 11, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => setAdminPanel(c.clientId)}>
                        Admin actions
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Completed panel ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-1)" }}>Completed Items</span>
            <span style={{ fontSize: 11, fontWeight: 700, background: "#dcfce7", color: "#16a34a", padding: "2px 8px", borderRadius: 20 }}>
              {completedClients.length}
            </span>
          </div>
          {completedClients.length === 0 && (
            <div style={{ padding: "28px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 12.5, background: "var(--card)", border: "1px dashed var(--border)", borderRadius: 10 }}>
              No completed AML records yet.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {completedClients.map((c) => (
              <div key={c.clientId} style={{ background: "var(--card)", border: "1px solid #bbf7d0", borderRadius: 10, padding: "14px 18px" }}>
                {editing === c.clientId ? (
                  <AmlEditForm
                    clientId={c.clientId}
                    clientName={c.clientName}
                    form={forms[c.clientId] ?? {}}
                    onChange={(patch) => setForms((f) => ({ ...f, [c.clientId]: { ...f[c.clientId], ...patch } }))}
                    onSave={() => doSave(c.clientId)}
                    onCancel={() => setEditing(null)}
                    saving={saving === c.clientId}
                    driveLink={c.driveLink}
                    runId={c.runId}
                  />
                ) : (
                  <div>
                    <AmlClientRow
                      c={c}
                      onEdit={() => startEdit(c)}
                      canEdit={canEdit}
                      isHead={!!isHead}
                      onAssign={amlTeam.length > 0 ? () => setAssignPanel(c.clientId) : undefined}
                    />
                    {isAdmin && (
                      <button style={{ marginTop: 6, fontSize: 11, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                        onClick={() => setAdminPanel(c.clientId)}>
                        Admin actions
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>

      {messageFor && (
        <AmlMessageModal
          client={messageFor}
          onClose={() => setMessageFor(null)}
        />
      )}
    </>
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
      style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--card)", borderRadius: 12, maxWidth: 640, width: "100%", maxHeight: "90vh", overflow: "auto", padding: 24, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "var(--ink-1)" }}>AML sign-off message</div>
            <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>For {client.clientName}</div>
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ fontSize: 12 }}>Close</button>
        </div>

        {!link && (
          <div style={{ padding: 12, background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 8, fontSize: 13, color: "#92400e", marginBottom: 16 }}>
            No signing link saved yet. Hit Update on the card and paste the AML signing link first.
          </div>
        )}

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 16, fontSize: 13.5, lineHeight: 1.55, color: "var(--ink-1)", whiteSpace: "pre-wrap", marginBottom: 16 }}>
          Hi {client.clientName.split(" ")[0] ?? "there"},
          {"\n\n"}As part of our standard onboarding and compliance process, could you please review and sign our AML (Anti-Money Laundering) document?
          {"\n\n"}You can easily complete the digital signature through this secure link:
          {"\n\n"}🔗 {link ? (
            <a href={link} target="_blank" rel="noreferrer" style={{ color: "var(--orange)", fontWeight: 600 }}>
              Complete Your AML Sign-off Here
            </a>
          ) : <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>[signing link will appear here]</span>}
          {"\n\n"}It should only take a couple of minutes. Please let us know if you run into any issues or have any questions!
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-primary"
            disabled={!link}
            onClick={() => copy("plain")}
            style={{ fontSize: 13 }}
          >
            {copied === "plain" ? "Copied ✓" : "Copy text (WhatsApp / chat)"}
          </button>
          <button
            className="btn-ghost"
            disabled={!link}
            onClick={() => copy("html")}
            style={{ fontSize: 13 }}
          >
            {copied === "html" ? "Copied ✓" : "Copy as HTML (email)"}
          </button>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost"
              style={{ fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              <Icon name="external-link" size={12} /> Open signing link
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function AmlClientRow({
  c, onEdit, canEdit, isHead, onAssign, onSendMessage,
}: {
  c: AmlClient; onEdit: () => void; canEdit: boolean; isHead: boolean; onAssign?: () => void; onSendMessage?: () => void;
}) {
  const [teamOpen, setTeamOpen] = useState(false);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <Link href={`/clients/${c.clientId}`} style={{ fontWeight: 700, fontSize: 14, color: "var(--ink-1)", textDecoration: "none" }}>
          {c.clientName}
        </Link>
        {c.notes && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{c.notes}</div>}
        {/* Assigned team member — shown for head */}
        {isHead && (
          <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="user" size={11} style={{ color: "var(--ink-3)" }} />
            {c.assignedToName ? (
              <span style={{ fontSize: 12, color: "var(--ink-2)", fontWeight: 600 }}>{c.assignedToName}</span>
            ) : (
              <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600 }}>Unassigned</span>
            )}
            {onAssign && (
              <button onClick={onAssign} style={{ fontSize: 11, color: "#7c3aed", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                {c.assignedTo ? "Reassign" : "Assign"}
              </button>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: STATUS_COLOR[c.status] ?? "var(--ink-3)", background: `${STATUS_COLOR[c.status]}18`, padding: "3px 10px", borderRadius: 20 }}>
          {STATUS_LABEL[c.status] ?? c.status}
        </span>
        {c.status === "completed" && c.completedAt && (
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>✓ {new Date(c.completedAt).toLocaleDateString()}</span>
        )}
        {c.signingLink && (
          <a href={c.signingLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#3b82f6", display: "flex", alignItems: "center", gap: 4 }}>
            <Icon name="external-link" size={11} /> Signing link
          </a>
        )}
        {c.signingCompletedLink && (
          <a href={c.signingCompletedLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#16a34a", display: "flex", alignItems: "center", gap: 4 }}>
            <Icon name="check-circle" size={11} /> Completed doc
          </a>
        )}
        {c.driveLink && (
          <a href={c.driveLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 4 }}>
            <Icon name="folder-open" size={11} /> Drive
          </a>
        )}
        <Link href={`/clients/${c.clientId}`} style={{ fontSize: 12, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          <Icon name="book-open" size={11} /> Playbook
        </Link>
        {c.runId && (
          <Link href={`/onboarding/${c.runId}`} style={{ fontSize: 12, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
            <Icon name="file-text" size={11} /> Run
          </Link>
        )}
        {/* Team icon — always visible, opens popover */}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setTeamOpen((v) => !v)}
            title="View assigned team"
            style={{
              display: "flex", alignItems: "center", gap: 4, fontSize: 12,
              color: teamOpen ? "var(--orange)" : "var(--ink-2)",
              background: teamOpen ? "var(--orange-soft, #fff7ed)" : "none",
              border: "1px solid " + (teamOpen ? "var(--orange)" : "var(--border)"),
              borderRadius: 6, cursor: "pointer", padding: "3px 8px",
            }}
          >
            <Icon name="users" size={13} /> Team
          </button>
          {teamOpen && (
            <div
              style={{
                position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50,
                background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
                padding: "12px 16px", minWidth: 300, boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 10 }}>
                Assigned Team
              </div>
              {c.teamMembers.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No team assigned yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {c.teamMembers.map((m) => (
                    <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em",
                        color: m.role === "AM" ? "var(--orange)" : "var(--ink-3)",
                        background: m.role === "AM" ? "#fff7ed" : "var(--surface)",
                        padding: "2px 7px", borderRadius: 4, flexShrink: 0, minWidth: 60, textAlign: "center",
                      }}>{m.role}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)", flex: 1 }}>{m.name}</span>
                      {m.email && (
                        <a href={`mailto:${m.email}`} style={{ fontSize: 12, color: "#3b82f6", textDecoration: "none" }}>{m.email}</a>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => setTeamOpen(false)}
                style={{ marginTop: 10, fontSize: 11, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
              >
                Close
              </button>
            </div>
          )}
        </div>
        {c.signingLink && onSendMessage && (
          <button
            onClick={onSendMessage}
            title="Copy the client-ready AML sign-off message"
            style={{ fontSize: 12, padding: "3px 10px", color: "var(--orange)", background: "var(--orange-soft, #fff7ed)", border: "1px solid var(--orange)", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
          >
            <Icon name="mail" size={11} /> Send message
          </button>
        )}
        {canEdit && (
          <button className="btn-ghost" style={{ fontSize: 12, padding: "3px 10px" }} onClick={onEdit}>Update</button>
        )}
      </div>
    </div>
  );
}

function AmlEditForm({ clientId, clientName, form, onChange, onSave, onCancel, saving, driveLink, runId }: {
  clientId: string; clientName: string;
  form: Partial<AmlClient>;
  onChange: (patch: Partial<AmlClient>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  driveLink: string | null;
  runId: string | null;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{clientName}</span>
        {driveLink && <a href={driveLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--ink-2)" }}><Icon name="folder-open" size={12} /> Drive</a>}
        {runId && <Link href={`/onboarding/${runId}`} style={{ fontSize: 12, color: "var(--ink-2)" }}><Icon name="file-text" size={12} /> Run</Link>}
        <Link href={`/clients/${clientId}`} style={{ fontSize: 12, color: "var(--ink-2)", textDecoration: "none" }}><Icon name="book-open" size={12} /> Playbook</Link>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={{ fontSize: 12 }}>Status
          <select value={form.status ?? "pending"} onChange={(e) => onChange({ status: e.target.value })} style={{ display: "block", width: "100%", marginTop: 4 }}>
            {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Notes
          <input value={form.notes ?? ""} onChange={(e) => onChange({ notes: e.target.value })} style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12 }}>Signing link (send to client)
          <input value={form.signingLink ?? ""} onChange={(e) => onChange({ signingLink: e.target.value })} placeholder="https://…" style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12 }}>Signing completed link
          <input value={form.signingCompletedLink ?? ""} onChange={(e) => onChange({ signingCompletedLink: e.target.value })} placeholder="https://…" style={{ display: "block", width: "100%", marginTop: 4 }} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn-primary" onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
