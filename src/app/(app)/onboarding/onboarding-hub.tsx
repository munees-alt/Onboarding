"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { stepCount, type OnbTemplate } from "@/lib/onboarding-templates";
import type { RunCardData } from "@/lib/data/runs";
import { markSignedAction, deleteRunAction, setClientAm, createComplianceRun } from "../clients/actions";
import { forceCompleteRun, deleteRun as hardDeleteRun } from "./[runId]/actions";
import { createTemplateFromText, forkTemplate, saveTemplateAction } from "../templates/actions";
import { syncLeadsNow } from "../settings/actions";

export type LeadRow = { id: string; name: string; industry: string | null; proposal_id?: string | null; services?: string[] | null; am_id?: string | null; status?: string };
export type AmRow = { id: string; full_name: string; role: string };
export type ComplianceAmRow = { id: string; name: string; role: string; currentLoad: number; maxTasks: number | null; isHead?: boolean; isLead?: boolean };
export type ComplianceClientRow = { id: string; name: string; status: string | null };

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { id: "pipeline", label: "Pipeline", icon: "git-branch" },
  { id: "clients", label: "Clients", icon: "users" },
  { id: "done", label: "Done", icon: "check-circle" },
  { id: "templates", label: "Templates", icon: "file-text" },
] as const;

const isDone = (s: string) => s === "complete" || s === "closed";

export function OnboardingHub({ runs: allRuns, templates, leads, ams = [], canDelete = false, isAdmin = false, complianceAms = [], complianceClients = [] }: { runs: RunCardData[]; templates: OnbTemplate[]; leads: LeadRow[]; ams?: AmRow[]; canDelete?: boolean; isAdmin?: boolean; complianceAms?: ComplianceAmRow[]; complianceClients?: ComplianceClientRow[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("dashboard");
  const [newOpen, setNewOpen] = useState(false);
  const [newComplianceOpen, setNewComplianceOpen] = useState(false);
  // Active-runs filters (Dashboard + Clients tabs).
  const [fSearch, setFSearch] = useState("");
  const [fStage, setFStage] = useState<string>("all");
  const [fAm, setFAm] = useState<string>("all");
  const [fTemplate, setFTemplate] = useState<string>("all");
  const [fStatus, setFStatus] = useState<string>("all");
  const [fIndustry, setFIndustry] = useState<string>("all");
  const [fMonth, setFMonth] = useState<string>("all"); // YYYY-MM
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);
  const [confirmComplete, setConfirmComplete] = useState<{ id: string; name: string } | null>(null);
  const [busy, startDel] = useTransition();
  const [busyComplete, startComplete] = useTransition();
  const [syncing, startSync] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };
  const doSync = () => startSync(async () => {
    const r = await syncLeadsNow();
    if (r.error) { note(r.error); return; }
    const res = r.result;
    note(res ? `Synced — ${res.created} new lead(s) from ${res.scanned} email(s)${res.errors.length ? ` · ${res.errors[0]}` : ""}` : "Synced");
    router.refresh();
  });

  // Active onboardings vs completed ones (the Done section).
  const rawRuns = allRuns.filter((r) => !isDone(r.status));
  const doneRuns = allRuns.filter((r) => isDone(r.status));

  // Build dropdown options from the actual run set so filters never offer dead values.
  const stageOptions = [...new Map(rawRuns.map((r) => [`${r.currentStage}|${r.currentStageName ?? ""}`, { value: String(r.currentStage), label: `${r.currentStage}. ${r.currentStageName ?? "—"}` }])).values()].sort((a, b) => Number(a.value) - Number(b.value));
  const amOptions = [...new Map(rawRuns.filter((r) => r.amName).map((r) => [r.amName!, r.amName!])).values()].sort();
  const tplOptions = [...new Map(rawRuns.map((r) => [r.templateName ?? "—", r.templateName ?? "—"])).values()].sort();
  const industryOptions = [...new Set(rawRuns.map((r) => r.industry).filter(Boolean) as string[])].sort();
  const monthOptions = [...new Set(rawRuns.map((r) => r.contractStartDate?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse();

  // Apply filters.
  const runs = rawRuns.filter((r) => {
    if (fSearch.trim()) {
      const q = fSearch.trim().toLowerCase();
      if (!r.clientName.toLowerCase().includes(q) && !(r.amName ?? "").toLowerCase().includes(q) && !(r.templateName ?? "").toLowerCase().includes(q)) return false;
    }
    if (fStage !== "all" && String(r.currentStage) !== fStage) return false;
    if (fAm !== "all" && r.amName !== fAm) return false;
    if (fTemplate !== "all" && r.templateName !== fTemplate) return false;
    if (fStatus !== "all") {
      if (fStatus === "not_started" && r.progress > 0) return false;
      if (fStatus === "in_progress" && (r.progress === 0 || r.progress >= 100)) return false;
      if (fStatus === "awaiting_client" && r.currentStage > 3) return false;
    }
    if (fIndustry !== "all" && r.industry !== fIndustry) return false;
    if (fMonth !== "all" && (r.contractStartDate ?? "").slice(0, 7) !== fMonth) return false;
    return true;
  });
  const filtersActive = !!fSearch.trim() || fStage !== "all" || fAm !== "all" || fTemplate !== "all" || fStatus !== "all" || fIndustry !== "all" || fMonth !== "all";
  const resetFilters = () => { setFSearch(""); setFStage("all"); setFAm("all"); setFTemplate("all"); setFStatus("all"); setFIndustry("all"); setFMonth("all"); };

  const doDeleteRun = () => {
    if (!confirmDel) return;
    startDel(async () => {
      const res = await hardDeleteRun(confirmDel.id);
      setConfirmDel(null);
      if (res.error) { note(res.error); return; }
      router.refresh();
    });
  };

  const doForceComplete = () => {
    if (!confirmComplete) return;
    startComplete(async () => {
      const res = await forceCompleteRun(confirmComplete.id);
      setConfirmComplete(null);
      if (res.error) { note(res.error); return; }
      note(`${confirmComplete.name} marked complete.`);
      router.refresh();
    });
  };

  const avg = runs.length ? Math.round(runs.reduce((n, r) => n + r.progress, 0) / runs.length) : 0;

  return (
    <div className="scroll">
      <div className="page">
        <div className="section-head">
          <div>
            <h2>Onboarding</h2>
            <div className="sub">Every signed client — added or synced from PMS. New clients land with the Ops Head to assign an Account Manager.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {isAdmin && (
              <button className="btn-ghost" onClick={doSync} disabled={syncing} title="Pull new onboarding emails from the configured Gmail label and create leads">
                <Icon name="refresh-cw" size={15} /> {syncing ? "Syncing…" : "Sync from email"}
              </button>
            )}
            <button className="btn-ghost" onClick={() => setNewComplianceOpen(true)} title="Create a CT / VAT / FTA compliance run for an existing client">
              <Icon name="shield-check" size={15} /> New compliance run
            </button>
            <button className="btn-primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={15} /> New onboarding</button>
          </div>
        </div>
        {newOpen && <NewOnboardingModal leads={leads} templates={templates} onClose={() => setNewOpen(false)} onStarted={(runId) => router.push(`/onboarding/${runId}`)} />}
        {newComplianceOpen && (
          <NewComplianceRunModal
            templates={templates.filter((t) => t.category === "Taxation")}
            clients={complianceClients}
            ams={complianceAms}
            onClose={() => setNewComplianceOpen(false)}
            onStarted={(runId) => router.push(`/onboarding/${runId}`)}
          />
        )}

        <div className="tabs-row">
          {TABS.map((t) => (
            <button key={t.id} className={"tab-btn" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={t.icon} size={14} /> {t.label}</span>
            </button>
          ))}
        </div>

        {tab === "dashboard" && (
          <>
            <div className="stats" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
              <Stat label="Active runs" value={String(runs.length)} icon="activity" />
              <Stat label="Avg progress" value={`${avg}%`} icon="trending-up" tone="teal" />
              <Stat label="Awaiting client" value={String(runs.filter((r) => r.currentStage <= 3).length)} icon="clock" tone="amber" />
              <Stat label="Templates" value={String(templates.length)} icon="file-text" tone="purple" />
            </div>
            <div className="section-head" style={{ marginTop: 24, alignItems: "flex-end" }}>
              <div>
                <h2 style={{ fontSize: 16 }}>Active runs</h2>
                <div className="sub" style={{ fontSize: 12 }}>{runs.length} of {rawRuns.length}{filtersActive ? " · filters applied" : ""}</div>
              </div>
            </div>
            <RunFilterBar
              search={fSearch} onSearch={setFSearch}
              stage={fStage} onStage={setFStage} stageOptions={stageOptions}
              am={fAm} onAm={setFAm} amOptions={amOptions}
              template={fTemplate} onTemplate={setFTemplate} tplOptions={tplOptions}
              status={fStatus} onStatus={setFStatus}
              industry={fIndustry} onIndustry={setFIndustry} industryOptions={industryOptions}
              month={fMonth} onMonth={setFMonth} monthOptions={monthOptions}
              filtersActive={filtersActive} onReset={resetFilters}
            />
            {runs.length ? (
              <div className="runs-card" style={{ marginTop: 4 }}>
                <table className="runs-table">
                  <thead><tr><th>Client</th><th>Template</th><th>Current stage</th><th>Progress</th><th>SLA</th><th></th></tr></thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} onClick={() => router.push(`/onboarding/${r.id}`)}>
                        <td><div className="client-cell"><div className="client">{r.clientName}</div><div className="wf">AM {r.amName ?? "—"}</div></div></td>
                        <td>{r.templateName}</td>
                        <td>{r.currentStage}. {r.currentStageName ?? "—"}</td>
                        <td><div className="progress-wrap"><div className="progress orange"><i style={{ width: `${r.progress}%` }} /></div><span className="progress-pct">{r.progress}%</span></div></td>
                        <td><SlaPill sla={r.sla} days={r.daysToTarget} /></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                            <button className="btn-ghost" onClick={() => router.push(`/onboarding/${r.id}`)}>Open <Icon name="arrow-right" size={13} /></button>
                            {canDelete && <button className="icon-btn" style={{ color: "var(--red)" }} aria-label="Delete run" onClick={() => setConfirmDel({ id: r.id, name: r.clientName })}><Icon name="trash-2" size={15} /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty msg="No active onboarding runs." />}
          </>
        )}

        {tab === "pipeline" && <Pipeline runs={runs} leads={leads.filter((l) => l.status === "lead")} ams={ams} canDelete={isAdmin} onDelete={(id, name) => setConfirmDel({ id, name })} />}

        {tab === "clients" && (
          <div className="runs-card" style={{ marginTop: 4 }}>
            <table className="runs-table">
              <thead><tr><th>Client</th><th>Template</th><th>Current stage</th><th>Progress</th><th></th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} onClick={() => router.push(`/onboarding/${r.id}`)}>
                    <td><div className="client-cell"><div className="client">{r.clientName}</div><div className="wf">AM {r.amName ?? "—"}</div></div></td>
                    <td>{r.templateName}</td>
                    <td>{r.currentStage}. {r.currentStageName}</td>
                    <td><div className="progress-wrap"><div className="progress orange"><i style={{ width: `${r.progress}%` }} /></div><span className="progress-pct">{r.progress}%</span></div></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="btn-ghost" onClick={() => router.push(`/onboarding/${r.id}`)}>Open <Icon name="arrow-right" size={13} /></button>
                        {isAdmin && (
                          <>
                            <button className="btn-ghost" style={{ fontSize: 12, color: "#15803d", padding: "3px 8px" }} title="Force complete all steps for this run" onClick={() => setConfirmComplete({ id: r.id, name: r.clientName })}>
                              <Icon name="check-circle" size={13} /> Complete
                            </button>
                            <button className="icon-btn" style={{ color: "var(--red)" }} aria-label="Delete run" onClick={() => setConfirmDel({ id: r.id, name: r.clientName })}><Icon name="trash-2" size={15} /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!runs.length && <tr><td colSpan={5} style={{ textAlign: "center", padding: 40, color: "var(--ink-3)" }}>No onboarding clients.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "done" && (
          <div className="runs-card" style={{ marginTop: 4 }}>
            <table className="runs-table">
              <thead><tr><th>Client</th><th>Template</th><th>Completed</th><th></th></tr></thead>
              <tbody>
                {doneRuns.map((r) => (
                  <tr key={r.id} onClick={() => router.push(`/onboarding/${r.id}`)}>
                    <td><div className="client-cell"><div className="client">{r.clientName}</div><div className="wf">AM {r.amName ?? "—"}</div></div></td>
                    <td>{r.templateName}</td>
                    <td><span className="pill green" style={{ fontSize: 10 }}><span className="dot" /> Completed</span></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn-ghost" onClick={() => router.push(`/onboarding/${r.id}`)}>Open <Icon name="arrow-right" size={13} /></button>
                        {isAdmin && <button className="icon-btn" style={{ color: "var(--red)" }} aria-label="Delete run" onClick={() => setConfirmDel({ id: r.id, name: r.clientName })}><Icon name="trash-2" size={15} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {!doneRuns.length && <tr><td colSpan={4} style={{ textAlign: "center", padding: 40, color: "var(--ink-3)" }}>No completed onboardings yet. They move here automatically when finished.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "templates" && <Templates templates={templates} />}

        {confirmDel && (
          <div className="modal-overlay open" style={{ zIndex: 90 }} onClick={() => !busy && setConfirmDel(null)}>
            <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
              <div className="hd">
                <h3>Delete onboarding run?</h3>
                <div className="sub">This permanently deletes the onboarding run for <strong>{confirmDel.name}</strong> — its stages, steps, tasks and messages. The client record stays. This cannot be undone.</div>
              </div>
              <div className="ft">
                <button className="btn-ghost" onClick={() => setConfirmDel(null)} disabled={busy}>Cancel</button>
                <button className="btn-danger" onClick={doDeleteRun} disabled={busy}>{busy ? "Deleting…" : "Delete run"}</button>
              </div>
            </div>
          </div>
        )}

        {confirmComplete && (
          <div className="modal-overlay open" style={{ zIndex: 90 }} onClick={() => !busyComplete && setConfirmComplete(null)}>
            <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
              <div className="hd">
                <h3>Force complete this run?</h3>
                <div className="sub">This marks every step as complete for <strong>{confirmComplete.name}</strong> regardless of their current state, and closes the onboarding. The client moves to the Done tab. Use this only when work is genuinely finished but the system hasn&apos;t caught up.</div>
              </div>
              <div className="ft">
                <button className="btn-ghost" onClick={() => setConfirmComplete(null)} disabled={busyComplete}>Cancel</button>
                <button className="btn-primary" onClick={doForceComplete} disabled={busyComplete}>{busyComplete ? "Completing…" : "Mark complete"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {toast && <div className="toast show green" style={{ zIndex: 100 }}><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}

function RunFilterBar({
  search, onSearch, stage, onStage, stageOptions, am, onAm, amOptions, template, onTemplate, tplOptions, status, onStatus, industry, onIndustry, industryOptions, month, onMonth, monthOptions, filtersActive, onReset,
}: {
  search: string; onSearch: (s: string) => void;
  stage: string; onStage: (s: string) => void; stageOptions: { value: string; label: string }[];
  am: string; onAm: (s: string) => void; amOptions: string[];
  template: string; onTemplate: (s: string) => void; tplOptions: string[];
  status: string; onStatus: (s: string) => void;
  industry: string; onIndustry: (s: string) => void; industryOptions: string[];
  month: string; onMonth: (s: string) => void; monthOptions: string[];
  filtersActive: boolean; onReset: () => void;
}) {
  const ctrl: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", fontSize: 12.5, background: "#fff", height: 32 };
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 0 14px" }}>
      <div style={{ position: "relative", flex: "1 1 240px", minWidth: 220 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search client, AM, template…"
          style={{ ...ctrl, width: "100%", paddingLeft: 30 }}
        />
        <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none" }}>
          <Icon name="search" size={13} />
        </span>
      </div>
      <select value={stage} onChange={(e) => onStage(e.target.value)} style={ctrl} title="Filter by stage">
        <option value="all">All stages</option>
        {stageOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <select value={am} onChange={(e) => onAm(e.target.value)} style={ctrl} title="Filter by AM">
        <option value="all">All AMs</option>
        {amOptions.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select value={template} onChange={(e) => onTemplate(e.target.value)} style={ctrl} title="Filter by template">
        <option value="all">All templates</option>
        {tplOptions.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={status} onChange={(e) => onStatus(e.target.value)} style={ctrl} title="Filter by status">
        <option value="all">All status</option>
        <option value="not_started">Not started (0%)</option>
        <option value="in_progress">In progress</option>
        <option value="awaiting_client">Awaiting client (stage ≤ 3)</option>
      </select>
      {industryOptions.length > 0 && (
        <select value={industry} onChange={(e) => onIndustry(e.target.value)} style={ctrl} title="Filter by industry">
          <option value="all">All industries</option>
          {industryOptions.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      )}
      {monthOptions.length > 0 && (
        <select value={month} onChange={(e) => onMonth(e.target.value)} style={ctrl} title="Filter by engagement start month">
          <option value="all">All months</option>
          {monthOptions.map((m) => <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</option>)}
        </select>
      )}
      {filtersActive && (
        <button className="btn-ghost" onClick={onReset} style={{ height: 32 }}>
          <Icon name="x" size={12} /> Clear filters
        </button>
      )}
    </div>
  );
}

function SlaPill({ sla, days }: { sla: "on_track" | "warning" | "breached" | "unknown"; days: number | null }) {
  if (sla === "unknown") return <span style={{ fontSize: 11, color: "var(--ink-3)" }}>—</span>;
  const map = {
    on_track: { color: "green", label: days != null ? `${days}d left` : "On track" },
    warning:  { color: "amber", label: days != null ? `${days}d left · at risk` : "At risk" },
    breached: { color: "red",   label: days != null ? `${Math.abs(days)}d over` : "Overdue" },
  } as const;
  const v = map[sla];
  return <span className={"pill " + v.color} style={{ fontSize: 10.5, whiteSpace: "nowrap" }}><span className="dot" />{v.label}</span>;
}

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: string; tone?: string }) {
  return (
    <div className={"stat" + (tone ? " " + tone : "")}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className={"badge-ic" + (tone ? "" : " neutral")}><Icon name={icon} size={15} /></div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "60px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>{msg}</div>;
}

const PIPE_COLS = "minmax(160px, 2fr) minmax(120px, 1.4fr) minmax(150px, 1.6fr) 110px 120px";
const PIPE_COLS_ADMIN = "minmax(160px, 2fr) minmax(120px, 1.4fr) minmax(150px, 1.6fr) 110px 120px 40px";

function Pipeline({ runs, leads, ams, canDelete = false, onDelete }: { runs: RunCardData[]; leads: LeadRow[]; ams: AmRow[]; canDelete?: boolean; onDelete?: (id: string, name: string) => void }) {
  if (!runs.length && !leads.length) return <Empty msg="No leads or onboardings in your pipeline yet." />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* New leads — the first pipeline step is always Assign AM. */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--orange)", marginBottom: 8 }}>New leads · Assign AM · {leads.length}</div>
        {leads.length ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: PIPE_COLS, gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)" }}>
              <span>Company</span><span>Proposal</span><span>Services</span><span>Account Manager</span><span style={{ textAlign: "right" }}>Action</span>
            </div>
            {leads.map((l, i) => <LeadRow key={l.id} lead={l} ams={ams} first={i === 0} />)}
          </div>
        ) : <div style={{ fontSize: 12, color: "var(--ink-4)", padding: "4px 2px" }}>No new leads. They appear here automatically when an onboarding email syncs.</div>}
      </div>

      {/* Active onboardings — compact, with status. */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 8 }}>Active onboardings · {runs.length}</div>
        {runs.length ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "#fff", overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: canDelete ? PIPE_COLS_ADMIN : PIPE_COLS, gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-soft)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)" }}>
              <span>Client</span><span>AM</span><span>Stage</span><span>Status</span><span style={{ textAlign: "right" }}>Progress</span>
              {canDelete && <span></span>}
            </div>
            {runs.map((r, i) => (
              <div key={r.id} style={{ display: "grid", gridTemplateColumns: canDelete ? PIPE_COLS_ADMIN : PIPE_COLS, gap: 12, alignItems: "center", padding: "0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                <Link href={`/onboarding/${r.id}`} className="mywork-row" style={{ display: "grid", gridTemplateColumns: canDelete ? "minmax(160px, 2fr) minmax(120px, 1.4fr) minmax(150px, 1.6fr) 110px 120px" : PIPE_COLS, gap: 12, alignItems: "center", padding: "11px 16px", textDecoration: "none", color: "inherit", gridColumn: canDelete ? "1 / span 5" : "1 / -1" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.clientName}</div>
                    <div style={{ fontSize: 11, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.templateName}</div>
                  </div>
                  <div style={{ minWidth: 0, fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.amName ?? "—"}</div>
                  <div style={{ minWidth: 0, fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={{ color: "var(--ink-3)" }}>St {r.currentStage}/{r.stageCount}</span> · {r.currentStageName ?? "—"}</div>
                  <div style={{ minWidth: 0 }}><StatusPill status={r.status} progress={r.progress} /></div>
                  <div><div className="progress orange"><i style={{ width: `${r.progress}%` }} /></div><div style={{ fontSize: 10.5, color: "var(--ink-3)", marginTop: 3, textAlign: "right" }}>{r.progress}%</div></div>
                </Link>
                {canDelete && (
                  <button className="icon-btn" style={{ color: "var(--red)", padding: "8px" }} aria-label="Delete onboarding" onClick={() => onDelete?.(r.id, r.clientName)} title="Master-Admin: delete this onboarding run"><Icon name="trash-2" size={15} /></button>
                )}
              </div>
            ))}
          </div>
        ) : <div style={{ fontSize: 12, color: "var(--ink-4)", padding: "4px 2px" }}>No active onboardings.</div>}
      </div>
    </div>
  );
}

function StatusPill({ status, progress }: { status: string; progress: number }) {
  const label = status === "complete" || status === "closed" ? "Done" : progress === 0 ? "Not started" : "In progress";
  const done = label === "Done";
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap", background: done ? "var(--bg)" : "var(--orange-soft)", color: done ? "var(--ink-3)" : "var(--orange)", border: "1px solid " + (done ? "var(--border)" : "var(--orange)") }}>{label}</span>;
}

function LeadRow({ lead, ams, first }: { lead: LeadRow; ams: AmRow[]; first: boolean }) {
  const router = useRouter();
  const [amId, setAmId] = useState(lead.am_id ?? "");
  const [busy, start] = useTransition();

  const assign = (id: string) => { setAmId(id); start(async () => { await setClientAm(lead.id, id); router.refresh(); }); };
  const sign = () => start(async () => { const r = await markSignedAction(lead.id); if (!r.error && r.runId) router.push(`/onboarding/${r.runId}`); });

  return (
    <div style={{ display: "grid", gridTemplateColumns: PIPE_COLS, gap: 12, alignItems: "center", padding: "11px 16px", borderTop: first ? "none" : "1px solid var(--border)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.name}</div>
        {lead.industry && <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{lead.industry}</div>}
      </div>
      <div style={{ minWidth: 0, fontSize: 12, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.proposal_id ?? "—"}</div>
      <div style={{ minWidth: 0, fontSize: 11.5, color: "var(--ink-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lead.services?.length ? lead.services.join(" · ") : "—"}</div>
      <div style={{ minWidth: 0 }}>
        <select value={amId} onChange={(e) => assign(e.target.value)} disabled={busy} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}>
          <option value="">— Assign AM —</option>
          {ams.map((a) => <option key={a.id} value={a.id}>{a.full_name} · {a.role}</option>)}
        </select>
      </div>
      <div style={{ textAlign: "right" }}>
        <button className="btn-primary" disabled={busy || !amId} onClick={sign} style={{ fontSize: 11.5, padding: "6px 10px" }}>{busy ? "…" : "Mark signed"}</button>
      </div>
    </div>
  );
}

function Templates({ templates }: { templates: OnbTemplate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [forking, setForking] = useState<string | null>(null);
  const [forkErr, setForkErr] = useState<string | null>(null);

  const generate = () =>
    start(async () => {
      setErr(null);
      const r = await createTemplateFromText(text);
      if (r.error) { setErr(r.error); return; }
      if (r.id) router.push(`/templates/${r.id}`);
    });

  const fork = (id: string) => {
    setForkErr(null);
    setForking(id);
    start(async () => {
      const r = await forkTemplate(id);
      if (r.error) { setForkErr(r.error); setForking(null); return; }
      if (r.id) router.push(`/templates/${r.id}`);
    });
  };

  return (
    <>
      <div className="section-head" style={{ marginTop: 4 }}>
        <div><div className="sub">{templates.length} onboarding templates · all editable · fork any to start from a copy</div></div>
        <button className="btn-primary" onClick={() => { setGenOpen(true); setErr(null); }}>
          <Icon name="sparkles" size={14} /> Create from description
        </button>
      </div>
      {forkErr && <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8, marginTop: 8 }}>{forkErr}</div>}

      {genOpen && (
        <div className="modal-overlay open" onClick={() => !busy && setGenOpen(false)}>
          <div className="modal" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>Create a template from a description</h3>
              <div className="sub">Describe your onboarding process in plain words. AI drafts the stages and steps — real, based on what you write, fully editable after.</div>
            </div>
            <div className="bd">
              <textarea className="notes" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 160 }}
                placeholder={"e.g. When a new VAT client signs, the AM assigns a senior and junior. We collect the trade licence and bank statements, set up the books in Zoho, hold a kickoff call, then run a monthly close with a handover to the delivery team."} />
              {err && <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8 }}>{err}</div>}
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setGenOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn-ai" onClick={generate} disabled={busy || text.trim().length < 20}>
                <Icon name="sparkles" size={14} /> {busy ? "Generating…" : "Generate template"}
              </button>
            </div>
          </div>
        </div>
      )}
      {(() => {
        const ORDER = ["Onboarding", "Accounting", "Taxation", "Auditing"];
        const catOf = (t: OnbTemplate) => t.category || "Onboarding";
        const cats = [...new Set(templates.map(catOf))].sort((a, b) => {
          const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
          return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        });
        return cats.map((cat) => (
          <div key={cat} style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", marginBottom: 10 }}>{cat}</div>
            <div className="tmpl-grid">
              {templates.filter((t) => catOf(t) === cat).map((t) => (
                <div key={t.id} className="tmpl-card" style={{ cursor: "default" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div className="ic"><Icon name={t.id === "medium-enterprise" ? "building-2" : t.id.startsWith("micro") ? "zap" : t.category === "Accounting" ? "calculator" : "users"} size={17} /></div>
                    {t.live && <span className="pill green" style={{ fontSize: 10 }}><span className="dot" /> Live</span>}
                  </div>
                  <h4>{t.name}</h4>
                  <div className="meta" style={{ fontWeight: 600, color: "var(--ink-2)" }}>{t.teamLabel}</div>
                  <div className="meta" style={{ marginTop: 6, lineHeight: 1.5 }}>{t.desc}</div>
                  <div className="ft">
                    <span className="meta">{t.stages.length} stages · {stepCount(t)} steps · {t.usedBy} live run{t.usedBy === 1 ? "" : "s"}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn-ghost" onClick={() => fork(t.id)} disabled={busy && forking === t.id} title="Duplicate this template as a new editable copy">
                        <Icon name="copy" size={13} /> {busy && forking === t.id ? "Forking…" : "Fork"}
                      </button>
                      <button className="btn-ghost" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Hide" : "View"} <Icon name={open === t.id ? "chevron-up" : "chevron-down"} size={13} /></button>
                    </div>
                  </div>
                  {open === t.id && (
                    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      {t.stages.map((s, i) => (
                        <div key={s.id}>
                          <div style={{ fontSize: 12.5, fontWeight: 700 }}>{i + 1}. {s.name}</div>
                          <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                            {s.steps.map((st) => <li key={st.id} style={{ fontSize: 12, color: "var(--ink-3)", margin: "2px 0" }}>{st.title}</li>)}
                          </ul>
                        </div>
                      ))}
                      <div style={{ display: "flex", gap: 8 }}>
                        <Link href={`/templates/${t.id}`} className="btn-ghost" style={{ textDecoration: "none" }}><Icon name="pencil" size={13} /> Edit template</Link>
                        <button className="btn-ghost" onClick={() => fork(t.id)} disabled={busy && forking === t.id}>
                          <Icon name="copy" size={13} /> {busy && forking === t.id ? "Forking…" : "Fork as new"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ));
      })()}
    </>
  );
}

function NewComplianceRunModal({
  templates, clients, ams, onClose, onStarted,
}: {
  templates: OnbTemplate[];
  clients: ComplianceClientRow[];
  ams: ComplianceAmRow[];
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const [clientId, setClientId] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  // Default = first team member (excluding Head + Lead). They're visible in the
  // dropdown for manual override but are NOT auto-cycle targets.
  const defaultAmId = (ams.find((a) => !a.isHead && !a.isLead) ?? ams[0])?.id ?? "";
  const [amId, setAmId] = useState(defaultAmId);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const submit = () => {
    if (!clientId || !templateId) { setMsg("Pick the client and the compliance type."); return; }
    setMsg(null);
    start(async () => {
      const res = await createComplianceRun({ clientId, templateId, amId: amId || null });
      if (res.error) { setMsg(res.error); return; }
      if (res.runId) onStarted(res.runId);
    });
  };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <h3>New compliance run</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.55 }}>
            For CT / VAT registrations, filings and FTA amendments. Auto-routes to the tax team under the Team Lead (Nafila) — least-loaded member with capacity (max 60) is selected by default. Head and Lead stay in the list for manual override but are skipped by the auto-cycle.
          </div>

          <div className="field">
            <label>Client</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— Pick a client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.status && c.status !== "live" ? ` · ${c.status}` : ""}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Compliance type</label>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.length === 0 && <option value="">— No compliance templates loaded —</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {templates.find((t) => t.id === templateId)?.desc && (
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>
                {templates.find((t) => t.id === templateId)?.desc}
              </div>
            )}
          </div>

          <div className="field">
            <label>Assign to AM</label>
            {ams.length === 0 ? (
              <div style={{ background: "var(--bg-soft)", border: "1px dashed var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: "var(--ink-3)" }}>
                No AMs available under the Ops Head. Set the org chart so the Ops Head has direct reports, then come back.
              </div>
            ) : (
              <select value={amId} onChange={(e) => setAmId(e.target.value)}>
                {ams.map((a) => {
                  const cap = a.maxTasks != null ? ` · ${a.currentLoad}/${a.maxTasks}` : ` · load ${a.currentLoad}`;
                  const full = a.maxTasks != null && a.currentLoad >= a.maxTasks;
                  const tag = a.isHead ? " · HEAD (manual only)" : a.isLead ? " · LEAD (manual only)" : "";
                  return (
                    <option key={a.id} value={a.id}>
                      {a.name}{tag}{cap}{full ? " · FULL" : ""}
                    </option>
                  );
                })}
              </select>
            )}
            <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}>
              Ordered by lowest load first. Configure each AM&apos;s max load in Settings → Tax team capacity.
            </div>
          </div>

          {msg && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: "8px 11px", fontSize: 12.5 }}>{msg}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy || !clientId || !templateId}>
            {busy ? "Creating…" : "Create run"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewOnboardingModal({
  leads, templates, onClose, onStarted,
}: {
  leads: { id: string; name: string; industry: string | null }[];
  templates: OnbTemplate[];
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const pickable = templates.filter((t) => !["urgent-compliance", "catchup", "compliance-renewal", "lead-intake"].includes(t.id) && (!t.category || t.category === "Onboarding"));
  const [clientId, setClientId] = useState(leads[0]?.id ?? "");
  const [tplId, setTplId] = useState(pickable.find((t) => t.id === "medium-team")?.id ?? pickable[0]?.id ?? "");
  const [customize, setCustomize] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Start a new onboarding</h3><div className="sub">Pick a signed client and the flow. The run, playbook and client record are created and synced.</div></div>
        <div className="bd">
          {leads.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No leads or signed clients yet. <Link href="/clients" style={{ color: "var(--orange)" }}>Add a client →</Link></div>
          ) : (
            <>
              <div className="field"><label>Client</label>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  {leads.map((l) => <option key={l.id} value={l.id}>{l.name}{l.industry ? ` · ${l.industry}` : ""}</option>)}
                </select>
              </div>
              <div className="field"><label>Template</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {pickable.map((t) => (
                    <label key={t.id} className={"radio" + (tplId === t.id ? " selected" : "")}>
                      <input type="radio" checked={tplId === t.id} onChange={() => setTplId(t.id)} />
                      <div><div className="r-ttl">{t.name} <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {t.stages.length} stages</span></div></div>
                    </label>
                  ))}
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, marginTop: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={customize} onChange={(e) => setCustomize(e.target.checked)} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Customize this template for the client</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>Forks the master template into a client-specific copy first, then runs on the copy. Edits to the copy never touch the master.</div>
                </div>
              </label>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Need a different client? <Link href="/clients" style={{ color: "var(--orange)" }}>Add one →</Link></div>
              {error && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{error}</div>}
            </>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {leads.length > 0 && (
            <button className="btn-primary" disabled={busy || !clientId} onClick={() => start(async () => {
              setError(null);
              let useTplId = tplId;
              if (customize) {
                const clientName = leads.find((l) => l.id === clientId)?.name ?? "Client";
                const f = await forkTemplate(tplId);
                if (f.error || !f.id) { setError(f.error ?? "Fork failed."); return; }
                const tplObj = pickable.find((t) => t.id === tplId);
                const newName = `${tplObj?.name ?? "Template"} — ${clientName}`;
                if (tplObj) {
                  await saveTemplateAction({ ...tplObj, id: f.id, name: newName, usedBy: 0 });
                }
                useTplId = f.id;
              }
              const r = await markSignedAction(clientId, useTplId);
              if (r.error) setError(r.error);
              else if (r.runId) onStarted(r.runId);
            })}>{busy ? "Starting…" : customize ? "Fork & start onboarding" : "Start onboarding"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
