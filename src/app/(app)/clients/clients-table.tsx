"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ONB_TEMPLATES } from "@/lib/onboarding-templates";
import {
  createClientAction,
  markSignedAction,
  setClientStatusAction,
  deleteClientAction,
  deleteRunAction,
  type NewClientInput,
} from "./actions";

export interface ClientRow {
  id: string;
  name: string;
  owner_name: string | null;
  industry: string | null;
  entity_type: string | null;
  status: "lead" | "signed" | "onboarding" | "active" | "inactive" | "hold" | "paused";
  services: string[] | null;
  primary_contact_email: string | null;
  profile_complete: boolean;
  am_id: string | null;
}
export interface RunLite {
  id: string;
  client_id: string;
  progress: number;
  current_stage: number;
  status: string;
}
export interface AmOption {
  id: string;
  full_name: string;
  role: string;
  title: string | null;
}

const STATUS_PILL: Record<ClientRow["status"], string> = {
  onboarding: "amber",
  active: "green",
  lead: "blue",
  signed: "purple",
  inactive: "gray",
  hold: "amber",
  paused: "gray",
};
const STATUS_LABEL: Record<ClientRow["status"], string> = {
  onboarding: "Onboarding",
  active: "Active",
  lead: "Lead",
  signed: "Signed",
  inactive: "Inactive",
  hold: "On hold",
  paused: "Paused",
};
const TABS = ["All", "Active", "Onboarding", "Lead", "Hold", "Paused", "Inactive"] as const;

const INDUSTRIES = ["Retail", "E-commerce", "SaaS", "Restaurant", "Hospitality", "Trading", "Fintech", "Professional Services", "Holding Company", "Other"];
const ENTITIES = [["mainland", "Mainland"], ["free_zone", "Free Zone"], ["offshore", "Offshore"]];
const SERVICES = ["Bookkeeping", "VAT", "Corporate Tax", "CFO Reports", "Catch-up Accounting", "Payroll"];

const SIGN_STEPS = [
  "Creating onboarding run…",
  "Notifying Ops Manager…",
  "Setting up Drive folder…",
  "Onboarding started",
];

export function ClientsTable({
  clients,
  runByClient,
  members,
  canDelete,
  canManageStatus,
}: {
  clients: ClientRow[];
  runByClient: Record<string, RunLite>;
  members: AmOption[];
  canDelete: boolean;
  canManageStatus: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [picking, setPicking] = useState<{ clientId: string; name: string } | null>(null);
  const [signing, setSigning] = useState<{ name: string; step: number } | null>(null);
  const [toast, setToast] = useState<{ msg: string; kind: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ kind: "client" | "run"; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const showToast = (msg: string, kind = "green") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2600);
  };

  const changeStatus = async (clientId: string, status: "active" | "hold" | "paused" | "lead", label: string) => {
    setMenuFor(null);
    const res = await setClientStatusAction(clientId, status);
    if (res.error) showToast(res.error, "red");
    else {
      showToast(label);
      router.refresh();
    }
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    setBusy(true);
    const res =
      confirmDel.kind === "client"
        ? await deleteClientAction(confirmDel.id)
        : await deleteRunAction(confirmDel.id);
    setBusy(false);
    setConfirmDel(null);
    if (res.error) showToast(res.error, "red");
    else {
      showToast(confirmDel.kind === "client" ? "Client deleted" : "Onboarding run deleted");
      router.refresh();
    }
  };

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const tabOk =
        tab === "All" ? true : c.status === tab.toLowerCase();
      const q = search.trim().toLowerCase();
      const searchOk =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.owner_name ?? "").toLowerCase().includes(q) ||
        (c.industry ?? "").toLowerCase().includes(q);
      return tabOk && searchOk;
    });
  }, [clients, tab, search]);

  const runMarkSigned = async (clientId: string, name: string, templateId: string) => {
    setPicking(null);
    setSigning({ name, step: 0 });
    const timer = setInterval(
      () => setSigning((s) => (s ? { ...s, step: Math.min(s.step + 1, SIGN_STEPS.length - 2) } : s)),
      800,
    );
    const res = await markSignedAction(clientId, templateId);
    clearInterval(timer);
    setSigning((s) => (s ? { ...s, step: SIGN_STEPS.length - 1 } : s));
    setTimeout(() => {
      setSigning(null);
      if (res.runId) {
        showToast(`Onboarding run created for ${name}`);
        router.push(`/onboarding/${res.runId}`);
      } else {
        showToast(res.error ?? "Could not create run", "red");
      }
    }, 800);
  };

  const openClient = (c: ClientRow) => {
    router.push(`/clients/${c.id}`);
  };

  return (
    <div className="scroll">
      <div className="page">
        <div className="section-head">
          <div>
            <h2>Clients</h2>
            <div className="sub">All clients and their onboarding status.</div>
          </div>
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={15} /> Add client
          </button>
        </div>

        <div className="runs-card">
          <div className="head">
            <div className="actions" style={{ gap: 6 }}>
              {TABS.map((t) => (
                <button
                  key={t}
                  className={"tab-pill" + (tab === t ? " active" : "")}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div style={{ position: "relative" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clients…"
                style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 12px 7px 30px", fontSize: 13, width: 220, outline: "none" }}
              />
              <span style={{ position: "absolute", left: 9, top: 8, color: "var(--ink-3)" }}>
                <Icon name="search" size={14} />
              </span>
            </div>
          </div>

          <table className="runs-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Industry</th>
                <th>Services</th>
                <th>Status</th>
                <th>Progress</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--ink-3)" }}>
                    No clients match.
                  </td>
                </tr>
              )}
              {filtered.map((c) => {
                const run = runByClient[c.id];
                return (
                  <tr key={c.id} onClick={() => openClient(c)}>
                    <td>
                      <div className="client-cell">
                        <div className="client" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {c.name}
                          {!c.profile_complete && (
                            <span className="pill amber" style={{ fontSize: 10, padding: "1px 7px" }}>
                              Profile incomplete
                            </span>
                          )}
                        </div>
                        <div className="wf">{c.owner_name ?? "—"}</div>
                      </div>
                    </td>
                    <td>{c.industry ?? "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {(c.services ?? []).slice(0, 3).map((s) => (
                          <span key={s} className="pill gray" style={{ fontSize: 10.5, padding: "2px 8px" }}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span className={"pill " + STATUS_PILL[c.status]}>
                        <span className="dot" /> {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td>
                      {run ? (
                        <div className="progress-wrap">
                          <div className="progress orange">
                            <i style={{ width: `${run.progress}%` }} />
                          </div>
                          <span className="progress-pct">{run.progress}%</span>
                        </div>
                      ) : (
                        <span style={{ color: "var(--ink-4)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                        {run ? (
                          <button className="btn-ghost" onClick={() => router.push(`/onboarding/${run.id}`)}>
                            Open run <Icon name="arrow-right" size={13} />
                          </button>
                        ) : c.status === "lead" || c.status === "signed" ? (
                          <button className="btn-primary" onClick={() => setPicking({ clientId: c.id, name: c.name })}>
                            Mark as Signed
                          </button>
                        ) : null}
                        {(canManageStatus || canDelete) && (
                          <div style={{ position: "relative" }}>
                            <button
                              className="btn-ghost"
                              style={{ padding: "6px 8px" }}
                              onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
                              aria-label="More actions"
                            >
                              <Icon name="more-horizontal" size={16} />
                            </button>
                            {menuFor === c.id && (
                              <>
                                <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setMenuFor(null)} />
                                <div className="menu-pop" style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 41, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 28px rgba(0,0,0,.12)", padding: 6, minWidth: 196, textAlign: "left" }}>
                                  {canManageStatus && (
                                    <>
                                      {c.status !== "hold" && (
                                        <MenuItem icon="pause" label="Put on hold" onClick={() => changeStatus(c.id, "hold", `${c.name} put on hold`)} />
                                      )}
                                      {c.status !== "paused" && (
                                        <MenuItem icon="pause-circle" label="Pause client" onClick={() => changeStatus(c.id, "paused", `${c.name} paused`)} />
                                      )}
                                      {(c.status === "hold" || c.status === "paused" || c.status === "inactive") && (
                                        <MenuItem icon="play" label="Reactivate" onClick={() => changeStatus(c.id, "active", `${c.name} reactivated`)} />
                                      )}
                                    </>
                                  )}
                                  {canDelete && run && (
                                    <MenuItem icon="trash-2" danger label="Delete onboarding run" onClick={() => { setMenuFor(null); setConfirmDel({ kind: "run", id: run.id, name: c.name }); }} />
                                  )}
                                  {canDelete && (
                                    <MenuItem icon="trash-2" danger label="Delete client" onClick={() => { setMenuFor(null); setConfirmDel({ kind: "client", id: c.id, name: c.name }); }} />
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {addOpen && (
        <AddClientModal
          members={members}
          onClose={() => setAddOpen(false)}
          onCreated={(name) => {
            setAddOpen(false);
            showToast(`${name} added as a lead`);
            router.refresh();
          }}
          onMarkSigned={(clientId, name) => {
            setAddOpen(false);
            setPicking({ clientId, name });
          }}
        />
      )}

      {picking && (
        <div className="modal-overlay open" onClick={() => setPicking(null)}>
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>Choose an onboarding template</h3>
              <div className="sub">Pick the flow for {picking.name}. This sets the stages and steps for the run.</div>
            </div>
            <div className="bd">
              {ONB_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className="next-card"
                  onClick={() => runMarkSigned(picking.clientId, picking.name, t.id)}
                >
                  <span style={{ width: 34, height: 34, borderRadius: 8, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <Icon name={t.id === "medium-enterprise" ? "building-2" : t.id === "micro-team" ? "zap" : "users"} size={17} />
                  </span>
                  <span>
                    <span className="ttl">{t.name} <span style={{ color: "var(--ink-4)", fontWeight: 500 }}>· {t.stages.length} stages</span></span>
                    <span className="desc">{t.desc}</span>
                  </span>
                  <Icon name="chevron-right" size={16} />
                </button>
              ))}
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setPicking(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {signing && (
        <div className="modal-overlay open" style={{ zIndex: 80 }}>
          <div className="modal" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>Signing {signing.name}</h3>
              <div className="sub">Setting up the onboarding run…</div>
            </div>
            <div className="bd">
              {SIGN_STEPS.map((label, i) => {
                const done = i < signing.step || signing.step === SIGN_STEPS.length - 1;
                const active = i === signing.step && signing.step < SIGN_STEPS.length - 1;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: done ? "var(--ink-1)" : "var(--ink-3)" }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", background: done ? "var(--green)" : active ? "var(--orange)" : "var(--bg)", color: done || active ? "#fff" : "var(--ink-4)", border: done || active ? "none" : "1.5px solid var(--border-strong)" }}>
                      {done ? <Icon name="check" size={11} /> : active ? "" : ""}
                    </span>
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="modal-overlay open" style={{ zIndex: 90 }} onClick={() => !busy && setConfirmDel(null)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>{confirmDel.kind === "client" ? "Delete client?" : "Delete onboarding run?"}</h3>
              <div className="sub">
                {confirmDel.kind === "client"
                  ? `This permanently deletes ${confirmDel.name} and ALL related onboarding runs, tasks, documents and messages. This cannot be undone.`
                  : `This permanently deletes the onboarding run for ${confirmDel.name} (steps, tasks, messages). The client stays. This cannot be undone.`}
              </div>
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setConfirmDel(null)} disabled={busy}>Cancel</button>
              <button className="btn-danger" onClick={doDelete} disabled={busy}>
                {busy ? "Deleting…" : confirmDel.kind === "client" ? "Delete client" : "Delete run"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={"toast show " + toast.kind}>
          <Icon name="check-circle" size={15} />
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "8px 10px",
        borderRadius: 7,
        fontSize: 13,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        color: danger ? "var(--red)" : "var(--ink-1)",
        textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? "var(--red-soft)" : "var(--bg)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={15} /> {label}
    </button>
  );
}

const ROLE_SHORT: Record<string, string> = {
  admin: "Admin", ops_head: "Ops Head", am: "AM", team_lead: "Team Lead",
  senior: "Senior", junior: "Junior", associate: "Associate", intern: "Intern", other: "Team",
};

function AddClientModal({
  members,
  onClose,
  onCreated,
  onMarkSigned,
}: {
  members: AmOption[];
  onClose: () => void;
  onCreated: (name: string) => void;
  onMarkSigned: (clientId: string, name: string) => void;
}) {
  const [form, setForm] = useState<NewClientInput>({ name: "", services: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof NewClientInput, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const toggleService = (s: string) =>
    setForm((f) => ({
      ...f,
      services: f.services?.includes(s) ? f.services.filter((x) => x !== s) : [...(f.services ?? []), s],
    }));

  const submit = async (markSigned: boolean) => {
    if (!form.name.trim()) return setError("Company name is required.");
    setBusy(true);
    setError(null);
    const res = await createClientAction(form);
    setBusy(false);
    if (res.error) return setError(res.error);
    if (markSigned && res.clientId) onMarkSigned(res.clientId, form.name.trim());
    else onCreated(form.name.trim());
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Add client</h3>
          <div className="sub">In production this comes from CRM. For now, add manually.</div>
        </div>
        <div className="bd">
          <div className="field">
            <label>Company name *</label>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Gulf Retail LLC" />
          </div>
          <div className="field">
            <label>Owner name</label>
            <input value={form.owner_name ?? ""} onChange={(e) => set("owner_name", e.target.value)} placeholder="Ahmed Al-Rashidi" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Industry</label>
              <select value={form.industry ?? ""} onChange={(e) => set("industry", e.target.value)}>
                <option value="">Select…</option>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Entity type</label>
              <select value={form.entity_type ?? ""} onChange={(e) => set("entity_type", e.target.value)}>
                <option value="">Select…</option>
                {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Services signed</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SERVICES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleService(s)}
                  className={"tab-pill" + (form.services?.includes(s) ? " active" : "")}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Account Manager (AM)</label>
            <select value={form.am_id ?? ""} onChange={(e) => set("am_id", e.target.value || undefined)}>
              <option value="">Assign me (default)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name} · {ROLE_SHORT[m.role] ?? m.role}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Target go-live date</label>
              <input type="date" value={form.target_go_live ?? ""} onChange={(e) => set("target_go_live", e.target.value || undefined)} />
            </div>
            <div className="field">
              <label>Expected onboarding (days)</label>
              <input type="number" min={1} value={form.expected_onboarding_days ?? ""} onChange={(e) => set("expected_onboarding_days", e.target.value ? parseInt(e.target.value, 10) : undefined)} placeholder="e.g. 21" />
            </div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: -4 }}>
            Used to set the onboarding deadline and to track timelines for insights later.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Primary contact email</label>
              <input value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="ahmed@gulfretail.ae" />
            </div>
            <div className="field">
              <label>Phone</label>
              <input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="+971 50 …" />
            </div>
          </div>
          {error && <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8 }}>{error}</div>}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-ghost" onClick={() => submit(false)} disabled={busy}>Save as lead</button>
          <button className="btn-primary" onClick={() => submit(true)} disabled={busy}>
            {busy ? "Saving…" : "Mark as Signed"}
          </button>
        </div>
      </div>
    </div>
  );
}
