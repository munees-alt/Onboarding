"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { RunCard } from "@/components/run-card";
import { stepCount, type OnbTemplate } from "@/lib/onboarding-templates";
import type { RunCardData } from "@/lib/data/runs";
import { markSignedAction, deleteRunAction } from "../clients/actions";
import { createTemplateFromText } from "../templates/actions";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "layout-dashboard" },
  { id: "pipeline", label: "Pipeline", icon: "git-branch" },
  { id: "clients", label: "Clients", icon: "users" },
  { id: "done", label: "Done", icon: "check-circle" },
  { id: "templates", label: "Templates", icon: "file-text" },
] as const;

const isDone = (s: string) => s === "complete" || s === "closed";

export function OnboardingHub({ runs: allRuns, templates, leads, canDelete = false }: { runs: RunCardData[]; templates: OnbTemplate[]; leads: { id: string; name: string; industry: string | null }[]; canDelete?: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("dashboard");
  const [newOpen, setNewOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);
  const [busy, startDel] = useTransition();

  // Active onboardings vs completed ones (the Done section).
  const runs = allRuns.filter((r) => !isDone(r.status));
  const doneRuns = allRuns.filter((r) => isDone(r.status));

  const doDeleteRun = () => {
    if (!confirmDel) return;
    startDel(async () => {
      const res = await deleteRunAction(confirmDel.id);
      setConfirmDel(null);
      if (!res.error) router.refresh();
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
          <button className="btn-primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={15} /> New onboarding</button>
        </div>
        {newOpen && <NewOnboardingModal leads={leads} templates={templates} onClose={() => setNewOpen(false)} onStarted={(runId) => router.push(`/onboarding/${runId}`)} />}

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
            <div className="section-head" style={{ marginTop: 24 }}><div><h2 style={{ fontSize: 16 }}>Active runs</h2></div></div>
            {runs.length ? (
              <div className="mywork-grid">{runs.map((r) => <RunCard key={r.id} run={r} />)}</div>
            ) : <Empty msg="No active onboarding runs." />}
          </>
        )}

        {tab === "pipeline" && <Pipeline runs={runs} />}

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
                      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <button className="btn-ghost" onClick={() => router.push(`/onboarding/${r.id}`)}>Open <Icon name="arrow-right" size={13} /></button>
                        {canDelete && (
                          <button className="icon-btn" style={{ color: "var(--red)" }} aria-label="Delete run" onClick={() => setConfirmDel({ id: r.id, name: r.clientName })}><Icon name="trash-2" size={15} /></button>
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
                        {canDelete && <button className="icon-btn" style={{ color: "var(--red)" }} aria-label="Delete run" onClick={() => setConfirmDel({ id: r.id, name: r.clientName })}><Icon name="trash-2" size={15} /></button>}
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
                <div className="sub">This permanently deletes the onboarding run for {confirmDel.name} — its stages, steps, tasks and messages. The client stays. This cannot be undone.</div>
              </div>
              <div className="ft">
                <button className="btn-ghost" onClick={() => setConfirmDel(null)} disabled={busy}>Cancel</button>
                <button className="btn-danger" onClick={doDeleteRun} disabled={busy}>{busy ? "Deleting…" : "Delete run"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
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

function Pipeline({ runs }: { runs: RunCardData[] }) {
  const cols = new Map<string, RunCardData[]>();
  runs.forEach((r) => {
    const key = `${r.currentStage}. ${r.currentStageName ?? "Stage"}`;
    if (!cols.has(key)) cols.set(key, []);
    cols.get(key)!.push(r);
  });
  const entries = [...cols.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) return <Empty msg="No runs in the pipeline." />;
  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
      {entries.map(([stage, list]) => (
        <div key={stage} style={{ minWidth: 260, flex: "0 0 260px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-3)", padding: "6px 4px 10px" }}>{stage} · {list.length}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{list.map((r) => <RunCard key={r.id} run={r} />)}</div>
        </div>
      ))}
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

  const generate = () =>
    start(async () => {
      setErr(null);
      const r = await createTemplateFromText(text);
      if (r.error) { setErr(r.error); return; }
      if (r.id) router.push(`/templates/${r.id}`);
    });

  return (
    <>
      <div className="section-head" style={{ marginTop: 4 }}>
        <div><div className="sub">{templates.length} onboarding templates · all editable</div></div>
        <button className="btn-primary" onClick={() => { setGenOpen(true); setErr(null); }}>
          <Icon name="sparkles" size={14} /> Create from description
        </button>
      </div>

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
      <div className="tmpl-grid">
        {templates.map((t) => (
          <div key={t.id} className="tmpl-card" style={{ cursor: "default" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div className="ic"><Icon name={t.id === "medium-enterprise" ? "building-2" : t.id === "micro-team" ? "zap" : "users"} size={17} /></div>
              {t.live && <span className="pill green" style={{ fontSize: 10 }}><span className="dot" /> Live</span>}
            </div>
            <h4>{t.name}</h4>
            <div className="meta" style={{ fontWeight: 600, color: "var(--ink-2)" }}>{t.teamLabel}</div>
            <div className="meta" style={{ marginTop: 6, lineHeight: 1.5 }}>{t.desc}</div>
            <div className="ft">
              <span className="meta">{t.stages.length} stages · {stepCount(t)} steps · {t.usedBy} live run{t.usedBy === 1 ? "" : "s"}</span>
              <button className="btn-ghost" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Hide" : "View"} <Icon name={open === t.id ? "chevron-up" : "chevron-down"} size={13} /></button>
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
                <Link href={`/templates/${t.id}`} className="btn-ghost" style={{ alignSelf: "flex-start", textDecoration: "none" }}><Icon name="pencil" size={13} /> Edit template</Link>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
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
  const [clientId, setClientId] = useState(leads[0]?.id ?? "");
  const [tplId, setTplId] = useState(templates.find((t) => t.id === "medium-team")?.id ?? templates[0]?.id ?? "");
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
                  {templates.map((t) => (
                    <label key={t.id} className={"radio" + (tplId === t.id ? " selected" : "")}>
                      <input type="radio" checked={tplId === t.id} onChange={() => setTplId(t.id)} />
                      <div><div className="r-ttl">{t.name} <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {t.stages.length} stages</span></div></div>
                    </label>
                  ))}
                </div>
              </div>
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
              const r = await markSignedAction(clientId, tplId);
              if (r.error) setError(r.error);
              else if (r.runId) onStarted(r.runId);
            })}>{busy ? "Starting…" : "Start onboarding"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
