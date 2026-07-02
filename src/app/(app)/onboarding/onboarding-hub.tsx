"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ARCHIVED_TEMPLATE_IDS, type OnbTemplate } from "@/lib/onboarding-templates";
import type { RunCardData } from "@/lib/data/runs";
import { markSignedAction, deleteRunAction, setClientAm, createComplianceRun } from "../clients/actions";
import { forceCompleteRun, deleteRun as hardDeleteRun } from "./[runId]/actions";
import { forkTemplate, saveTemplateAction } from "../templates/actions";
import { syncLeadsNow } from "../settings/actions";

export type LeadRow = { id: string; name: string; industry: string | null; proposal_id?: string | null; services?: string[] | null; am_id?: string | null; status?: string };
export type AmRow = { id: string; full_name: string; role: string };
export type ComplianceAmRow = { id: string; name: string; role: string; currentLoad: number; maxTasks: number | null; isHead?: boolean; isLead?: boolean };
export type ComplianceClientRow = { id: string; name: string; status: string | null };

const isDone = (s: string) => s === "complete" || s === "closed";

// The two live client-onboarding flows (Micro Team, and legacy Medium Team /
// Medium Enterprise runs still in progress) share the same first 7 stage names —
// that fixed order is the board's column set. Anything outside it (e.g. an old
// Medium Enterprise run, which uses a different stage set) lands in a trailing
// "Other stage" column rather than being silently dropped.
const CANONICAL_STAGES = [
  "Assign Roles",
  "Send Magic Link",
  "Call with Client",
  "COA Prep · Zoho Books",
  "Optional Operations",
  "Project & Tasks — Internal Team",
  "Handover",
];

// A small deterministic color so any AM name gets a stable avatar tint without
// a hardcoded roster.
const AVATAR_HUES = [12, 165, 265, 210, 35, 340, 190];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${AVATAR_HUES[h % AVATAR_HUES.length]}, 62%, 45%)`;
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "—";
}

export function OnboardingHub({ runs: allRuns, templates, leads, ams = [], canDelete = false, isAdmin = false, complianceAms = [], complianceClients = [] }: { runs: RunCardData[]; templates: OnbTemplate[]; leads: LeadRow[]; ams?: AmRow[]; canDelete?: boolean; isAdmin?: boolean; complianceAms?: ComplianceAmRow[]; complianceClients?: ComplianceClientRow[] }) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [fSearch, setFSearch] = useState("");
  const [fAm, setFAm] = useState<string>("all");
  const [fIndustry, setFIndustry] = useState<string>("all");
  const [fTeamLead, setFTeamLead] = useState<string>("all");
  const [fTeamMember, setFTeamMember] = useState<string>("all");
  const [fMonth, setFMonth] = useState<string>("all"); // YYYY-MM
  const [fFrequency, setFFrequency] = useState<string>("all");
  const [leadAmDraft, setLeadAmDraft] = useState<Record<string, string>>({});
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);
  const [confirmComplete, setConfirmComplete] = useState<{ id: string; name: string } | null>(null);
  const [busy, startDel] = useTransition();
  const [busyComplete, startComplete] = useTransition();
  const [syncing, startSync] = useTransition();
  const [signingId, setSigningId] = useState<string | null>(null);
  const [busySign, startSign] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const doSync = () => startSync(async () => {
    const r = await syncLeadsNow();
    if (r.error) { note(r.error); return; }
    const res = r.result;
    note(res ? `Synced — ${res.created} new lead(s) from ${res.scanned} email(s)${res.errors.length ? ` · ${res.errors[0]}` : ""}` : "Synced");
    router.refresh();
  });

  // Onboarding hub = client-onboarding flows only (no category, e.g. Micro/Medium
  // Team). Taxation/Compliance/Audit/Liquidation/Catch-up runs have their own boards.
  const onboardingTemplateIds = new Set(templates.filter((t) => !t.category).map((t) => t.id));

  const matchesFilters = (r: RunCardData) => {
    if (fSearch.trim()) {
      const q = fSearch.trim().toLowerCase();
      if (!r.clientName.toLowerCase().includes(q) && !(r.amName ?? "").toLowerCase().includes(q) && !(r.templateName ?? "").toLowerCase().includes(q)) return false;
    }
    if (fAm !== "all" && r.amName !== fAm) return false;
    if (fIndustry !== "all" && r.industry !== fIndustry) return false;
    if (fTeamLead !== "all" && r.teamLeadName !== fTeamLead) return false;
    if (fTeamMember !== "all" && !(r.teamMembers ?? []).includes(fTeamMember)) return false;
    if (fMonth !== "all" && (r.contractStartDate ?? "").slice(0, 7) !== fMonth) return false;
    if (fFrequency !== "all" && (r.reportFrequency ?? "monthly") !== fFrequency) return false;
    return true;
  };

  const scopedRuns = allRuns.filter((r) => r.status !== "archived" && onboardingTemplateIds.has(r.templateKey) && matchesFilters(r));
  const activeRuns = scopedRuns.filter((r) => !isDone(r.status));
  const doneRuns = scopedRuns.filter((r) => isDone(r.status));

  const openLeads = leads.filter((l) => l.status === "lead");
  // Leads carry no AM/team-lead/month/frequency yet — an active filter on any of
  // those simply hides them, same as an active run that doesn't match.
  const matchesLead = (l: LeadRow) => {
    if (fSearch.trim() && !l.name.toLowerCase().includes(fSearch.trim().toLowerCase())) return false;
    if (fAm !== "all" || fTeamLead !== "all" || fTeamMember !== "all" || fMonth !== "all" || fFrequency !== "all") return false;
    if (fIndustry !== "all" && l.industry !== fIndustry) return false;
    return true;
  };
  const leadCards = openLeads.filter(matchesLead);

  // Dropdown options built from the actual (unfiltered, in-scope) run set.
  const scopeUnfiltered = allRuns.filter((r) => r.status !== "archived" && onboardingTemplateIds.has(r.templateKey));
  const amOptions = [...new Map(scopeUnfiltered.filter((r) => r.amName).map((r) => [r.amName!, r.amName!])).values()].sort();
  const industryOptions = [...new Set([...scopeUnfiltered.map((r) => r.industry), ...openLeads.map((l) => l.industry)].filter(Boolean) as string[])].sort();
  const teamLeadOptions = [...new Map(scopeUnfiltered.filter((r) => r.teamLeadName).map((r) => [r.teamLeadName!, r.teamLeadName!])).values()].sort();
  const teamMemberOptions = [...new Set(scopeUnfiltered.flatMap((r) => r.teamMembers ?? []))].sort();
  const monthOptions = [...new Set(scopeUnfiltered.map((r) => r.contractStartDate?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse();

  const filtersActive = !!fSearch.trim() || fAm !== "all" || fIndustry !== "all" || fTeamLead !== "all" || fTeamMember !== "all" || fMonth !== "all" || fFrequency !== "all";
  const resetFilters = () => { setFSearch(""); setFAm("all"); setFIndustry("all"); setFTeamLead("all"); setFTeamMember("all"); setFMonth("all"); setFFrequency("all"); };

  const statActive = activeRuns.length;
  const statAvg = activeRuns.length ? Math.round(activeRuns.reduce((n, r) => n + r.progress, 0) / activeRuns.length) : 0;
  const statAwaiting = leadCards.length + activeRuns.filter((r) => r.currentStage <= 3).length;

  // Columns: Leads, the 7 canonical stages, an overflow column for any stage
  // name outside that set (only shown if it's actually in use), then Completed.
  const extraStageNames = [...new Set(activeRuns.map((r) => r.currentStageName).filter((n): n is string => !!n && !CANONICAL_STAGES.includes(n)))];
  const stageColumns = [...CANONICAL_STAGES, ...extraStageNames];

  const columns: { id: string; label: string; tone: "lead" | "stage" | "done"; cards: RunCardData[] | LeadRow[] }[] = [
    { id: "leads", label: "Leads", tone: "lead", cards: leadCards },
    ...stageColumns.map((name) => ({ id: name, label: name, tone: "stage" as const, cards: activeRuns.filter((r) => (r.currentStageName ?? "") === name) })),
    { id: "done", label: "Completed", tone: "done" as const, cards: doneRuns },
  ];

  const assignLead = (id: string, amId: string) => {
    setLeadAmDraft((d) => ({ ...d, [id]: amId }));
    startSign(async () => { await setClientAm(id, amId); router.refresh(); });
  };
  const signLead = (lead: LeadRow) => {
    const amId = leadAmDraft[lead.id] || lead.am_id;
    if (!amId) { note("Pick an Account Manager first"); return; }
    setSigningId(lead.id);
    startSign(async () => {
      const r = await markSignedAction(lead.id);
      setSigningId(null);
      if (r.error) { note(r.error); return; }
      note(`${lead.name} — assigned and moved to Assign Roles`);
      router.refresh();
    });
  };

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

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: "none", display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
        <div className="section-head">
          <div>
            <h2>Onboarding</h2>
            <div className="sub">Every signed client — added or synced from PMS. New clients land with the Ops Head to assign an Account Manager, then move stage by stage to go-live.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {isAdmin && (
              <button className="btn-ghost" onClick={doSync} disabled={syncing} title="Pull new onboarding emails from the configured Gmail label and create leads">
                <Icon name="refresh-cw" size={15} /> {syncing ? "Syncing…" : "Sync from email"}
              </button>
            )}
            <button className="btn-primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={15} /> New onboarding</button>
          </div>
        </div>
        {newOpen && <NewOnboardingModal leads={leads} templates={templates} onClose={() => setNewOpen(false)} onStarted={(runId) => router.push(`/onboarding/${runId}`)} />}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,200px))", gap: 10, marginTop: 14 }}>
          <Stat label="Active runs" value={String(statActive)} icon="activity" />
          <Stat label="Avg progress" value={`${statAvg}%`} icon="trending-up" tone="teal" />
          <Stat label="Awaiting client" value={String(statAwaiting)} icon="clock" tone="amber" />
        </div>

        <KanbanFilterBar
          search={fSearch} onSearch={setFSearch}
          am={fAm} onAm={setFAm} amOptions={amOptions}
          industry={fIndustry} onIndustry={setFIndustry} industryOptions={industryOptions}
          teamLead={fTeamLead} onTeamLead={setFTeamLead} teamLeadOptions={teamLeadOptions}
          teamMember={fTeamMember} onTeamMember={setFTeamMember} teamMemberOptions={teamMemberOptions}
          month={fMonth} onMonth={setFMonth} monthOptions={monthOptions}
          frequency={fFrequency} onFrequency={setFFrequency}
          filtersActive={filtersActive} onReset={resetFilters}
        />

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", paddingBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, width: "max-content", alignItems: "flex-start" }}>
            {columns.map((col) => (
              <div key={col.id} style={{ width: col.tone === "lead" ? 208 : 192, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "6px 8px", background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 7, position: "sticky", top: 0, zIndex: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: col.tone === "lead" ? "var(--orange)" : col.tone === "done" ? "var(--green, #16a34a)" : "var(--ink-4)" }} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.label}</span>
                  </div>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--ink-3)", background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>{col.cards.length}</span>
                </div>
                {col.tone === "lead"
                  ? (col.cards as LeadRow[]).map((l) => (
                      <LeadCard
                        key={l.id}
                        lead={l}
                        ams={ams}
                        draftAmId={leadAmDraft[l.id] ?? l.am_id ?? ""}
                        onAssign={(amId) => assignLead(l.id, amId)}
                        onSign={() => signLead(l)}
                        signing={busySign && signingId === l.id}
                      />
                    ))
                  : (col.cards as RunCardData[]).map((r) => (
                      <RunCard
                        key={r.id}
                        run={r}
                        done={col.tone === "done"}
                        canDelete={canDelete}
                        isAdmin={isAdmin}
                        onOpen={() => router.push(`/onboarding/${r.id}`)}
                        onDelete={() => setConfirmDel({ id: r.id, name: r.clientName })}
                        onForceComplete={() => setConfirmComplete({ id: r.id, name: r.clientName })}
                      />
                    ))}
                {col.cards.length === 0 && (
                  <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: "16px 8px", textAlign: "center", fontSize: 10.5, color: "var(--ink-4)" }}>No clients here</div>
                )}
              </div>
            ))}
          </div>
        </div>

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
                <div className="sub">This marks every step as complete for <strong>{confirmComplete.name}</strong> regardless of their current state, and closes the onboarding. The client moves to the Completed column. Use this only when work is genuinely finished but the system hasn&apos;t caught up.</div>
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

function KanbanFilterBar({
  search, onSearch, am, onAm, amOptions, industry, onIndustry, industryOptions, teamLead, onTeamLead, teamLeadOptions, teamMember, onTeamMember, teamMemberOptions, month, onMonth, monthOptions, frequency, onFrequency, filtersActive, onReset,
}: {
  search: string; onSearch: (s: string) => void;
  am: string; onAm: (s: string) => void; amOptions: string[];
  industry: string; onIndustry: (s: string) => void; industryOptions: string[];
  teamLead: string; onTeamLead: (s: string) => void; teamLeadOptions: string[];
  teamMember: string; onTeamMember: (s: string) => void; teamMemberOptions: string[];
  month: string; onMonth: (s: string) => void; monthOptions: string[];
  frequency: string; onFrequency: (s: string) => void;
  filtersActive: boolean; onReset: () => void;
}) {
  const ctrl: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 7, padding: "0 7px", fontSize: 11, background: "#fff", height: 30 };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", margin: "10px 0 8px" }}>
      <div style={{ position: "relative", flex: "0 1 200px", minWidth: 150 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search client, AM, template…"
          style={{ ...ctrl, width: "100%", paddingLeft: 26 }}
        />
        <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", pointerEvents: "none" }}>
          <Icon name="search" size={12} />
        </span>
      </div>
      <select value={am} onChange={(e) => onAm(e.target.value)} style={ctrl} title="Filter by AM">
        <option value="all">All AMs</option>
        {amOptions.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select value={industry} onChange={(e) => onIndustry(e.target.value)} style={ctrl} title="Filter by industry">
        <option value="all">All industries</option>
        {industryOptions.map((i) => <option key={i} value={i}>{i}</option>)}
      </select>
      {teamLeadOptions.length > 0 && (
        <select value={teamLead} onChange={(e) => onTeamLead(e.target.value)} style={ctrl} title="Filter by Team Lead">
          <option value="all">All team leads</option>
          {teamLeadOptions.map((tl) => <option key={tl} value={tl}>{tl}</option>)}
        </select>
      )}
      {teamMemberOptions.length > 0 && (
        <select value={teamMember} onChange={(e) => onTeamMember(e.target.value)} style={ctrl} title="Filter by assigned team member">
          <option value="all">All team members</option>
          {teamMemberOptions.map((tm) => <option key={tm} value={tm}>{tm}</option>)}
        </select>
      )}
      {monthOptions.length > 0 && (
        <select value={month} onChange={(e) => onMonth(e.target.value)} style={ctrl} title="Filter by engagement start month">
          <option value="all">All months started</option>
          {monthOptions.map((m) => <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</option>)}
        </select>
      )}
      <select value={frequency} onChange={(e) => onFrequency(e.target.value)} style={ctrl} title="Filter by report frequency">
        <option value="all">All frequencies</option>
        <option value="monthly">Monthly</option>
        <option value="quarterly">Quarterly</option>
        <option value="annually">Annually</option>
      </select>
      {filtersActive && (
        <button className="btn-ghost" onClick={onReset} style={{ height: 30, fontSize: 11, padding: "0 8px" }}>
          <Icon name="x" size={11} /> Clear
        </button>
      )}
    </div>
  );
}

function LeadCard({ lead, ams, draftAmId, onAssign, onSign, signing }: { lead: LeadRow; ams: AmRow[]; draftAmId: string; onAssign: (amId: string) => void; onSign: () => void; signing: boolean }) {
  return (
    <div className="kb-card" style={{ background: "#fff", border: "1px solid var(--border)", borderLeft: "3px solid var(--orange)", borderRadius: 8, padding: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>{lead.name}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, fontSize: 9.5, color: "var(--ink-3)" }}>
        <span>{lead.industry ?? "—"}</span>
        {lead.proposal_id && <><span style={{ opacity: 0.4 }}>·</span><span>{lead.proposal_id}</span></>}
      </div>
      {lead.services?.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginTop: 6 }}>
          {lead.services.map((s) => <span key={s} style={{ fontSize: 9, fontWeight: 600, color: "var(--ink-2)", background: "var(--bg-soft)", borderRadius: 999, padding: "2px 6px" }}>{s}</span>)}
        </div>
      ) : null}
      <select value={draftAmId} onChange={(e) => onAssign(e.target.value)} style={{ width: "100%", height: 28, marginTop: 6, border: "1px solid var(--border)", borderRadius: 7, background: "#fff", color: "var(--ink-2)", fontSize: 10.5, padding: "0 7px" }}>
        <option value="">— Assign AM —</option>
        {ams.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
      </select>
      <button
        onClick={onSign}
        disabled={!draftAmId || signing}
        style={{
          width: "100%", height: 28, marginTop: 6, borderRadius: 7, border: "none", fontSize: 10.5, fontWeight: 700,
          cursor: draftAmId && !signing ? "pointer" : "not-allowed",
          background: draftAmId ? "var(--orange)" : "var(--bg-soft)", color: draftAmId ? "#fff" : "var(--ink-4)",
        }}
      >
        {signing ? "Signing…" : "Mark signed →"}
      </button>
    </div>
  );
}

function RunCard({ run, done, canDelete, isAdmin, onOpen, onDelete, onForceComplete }: { run: RunCardData; done: boolean; canDelete: boolean; isAdmin: boolean; onOpen: () => void; onDelete: () => void; onForceComplete: () => void }) {
  return (
    <div className="kb-card" onClick={onOpen} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, padding: 8, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 5 }}>
        <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{run.clientName}</div>
        <SlaPill sla={run.sla} days={run.daysToTarget} />
      </div>
      <div style={{ fontSize: 9.5, fontWeight: 600, color: "var(--ink-3)", marginTop: 4 }}>{run.templateName}</div>
      {!done && (
        <div style={{ marginTop: 6 }}>
          <div className="progress orange" style={{ height: 4 }}><i style={{ width: `${run.progress}%` }} /></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 9, color: "var(--ink-3)", fontWeight: 600 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.currentStageName ?? "—"}</span><span>{run.progress}%</span>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
        {run.amName && (
          <div style={{ width: 17, height: 17, borderRadius: 999, background: avatarColor(run.amName), color: "#fff", display: "grid", placeItems: "center", fontSize: 8, fontWeight: 700, flexShrink: 0 }}>{initials(run.amName)}</div>
        )}
        <div style={{ minWidth: 0, lineHeight: 1.15 }}>
          <div style={{ fontSize: 9.5, fontWeight: 600, color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.amName ?? "Unassigned"}</div>
          <div style={{ fontSize: 8.5, color: "var(--ink-4)", whiteSpace: "nowrap" }}>{run.teamLeadName ? `TL · ${run.teamLeadName}` : "—"}</div>
        </div>
        {isAdmin && !done && (
          <button className="icon-btn" style={{ marginLeft: "auto", color: "#15803d", padding: 3 }} title="Force complete" onClick={(e) => { e.stopPropagation(); onForceComplete(); }}>
            <Icon name="check-circle" size={12} />
          </button>
        )}
        {canDelete && (
          <button className="icon-btn" style={{ marginLeft: isAdmin && !done ? 0 : "auto", color: "var(--red)", padding: 3 }} title="Delete run" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Icon name="trash-2" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

function SlaPill({ sla, days }: { sla: "on_track" | "warning" | "breached" | "unknown"; days: number | null }) {
  if (sla === "unknown") return <span style={{ fontSize: 9, color: "var(--ink-3)", flexShrink: 0 }}>—</span>;
  const map = {
    on_track: { color: "green", label: days != null ? `${days}d left` : "On track" },
    warning:  { color: "amber", label: days != null ? `${days}d left` : "At risk" },
    breached: { color: "red",   label: days != null ? `${Math.abs(days)}d over` : "Overdue" },
  } as const;
  const v = map[sla];
  return <span className={"pill " + v.color} style={{ fontSize: 9, whiteSpace: "nowrap", flexShrink: 0, padding: "1px 6px" }}><span className="dot" />{v.label}</span>;
}

function Stat({ label, value, icon, tone }: { label: string; value: string; icon: string; tone?: string }) {
  return (
    <div className={"stat" + (tone ? " " + tone : "")} style={{ padding: "8px 12px" }}>
      <div className="label" style={{ fontSize: 10 }}>{label}</div>
      <div className="value" style={{ fontSize: 17 }}>{value}</div>
      <div className={"badge-ic" + (tone ? "" : " neutral")} style={{ width: 28, height: 28 }}><Icon name={icon} size={14} /></div>
    </div>
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
  const pickable = templates.filter((t) => !ARCHIVED_TEMPLATE_IDS.has(t.id) && !["urgent-compliance", "catchup", "compliance-renewal", "lead-intake"].includes(t.id) && (!t.category || t.category === "Onboarding"));
  const [clientId, setClientId] = useState(leads[0]?.id ?? "");
  const [tplId, setTplId] = useState(pickable.find((t) => t.id === "micro-team")?.id ?? pickable[0]?.id ?? "");
  const [customize, setCustomize] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Start a new onboarding</h3><div className="sub">Pick a signed client and the flow. The run, playbook and client record are created and synced.</div></div>
        <div className="bd">
          {leads.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No leads or signed clients yet. Add one from the Clients page.</div>
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
