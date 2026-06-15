"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { ASSIGN_ROLES, type TemplateStep, type OnbTemplate } from "@/lib/onboarding-templates";
import { fmtDate } from "@/lib/data/runs";
import type { RunDetail } from "@/lib/data/run-detail";
import { completeStep, assignStep, rollbackToStage, dispatchMagicLink, setTaskStatus, toggleTaskVisible, saveDiagrams, saveRunItems, assignTriage, postMessage, saveDocuments, saveIntakePrep, saveDrive, pushToPms, sendClientEmail, type DiagramInput, type RunItemInput, type IntakePrep } from "./actions";
import { createClient } from "@/lib/supabase/client";
import type { TaskRow } from "@/lib/data/run-detail";
import { generateCoa, saveCoa, generateStepText, saveStepText, generateBusinessDescription, analyzeContract, generateCompliance, generateProjects, generateDiagram, type CoaLine, type ContractAnalysis } from "./ai-actions";

const KIND_ICON: Record<string, { icon: string; color: string }> = {
  ai: { icon: "sparkles", color: "var(--purple)" },
  person: { icon: "user", color: "var(--blue)" },
  link: { icon: "link", color: "var(--teal)" },
  doc: { icon: "file-text", color: "var(--ink-2)" },
  check: { icon: "check", color: "var(--green)" },
};
const TABS = [
  { id: "team", label: "Team View", icon: "users" },
  { id: "tasks", label: "Task Board", icon: "kanban" },
  { id: "playbook", label: "Playbook", icon: "book-open" },
  { id: "portal", label: "Client Portal", icon: "external-link" },
] as const;

export function RunView({ detail, template }: { detail: RunDetail; template: OnbTemplate }) {
  const router = useRouter();
  const tpl = template;
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("team");
  const [expanded, setExpanded] = useState<number>(detail.currentStage);
  const [busy, startTransition] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [assignSel, setAssignSel] = useState<Record<string, string>>({});
  const [actStep, setActStep] = useState<TemplateStep | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  if (!tpl) return <div className="page">Template not found.</div>;

  const stepStatus = (id: string) => detail.stepState[id]?.status ?? "pending";
  const stageRow = (no: number) => detail.stages.find((s) => s.stage_no === no);

  const activeStepId = (stageNo: number): string | null => {
    const stage = tpl.stages[stageNo - 1];
    if (!stage) return null;
    const s = stage.steps.find((st) => stepStatus(st.id) !== "complete");
    return s?.id ?? null;
  };

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2400);
  };
  const run = (fn: () => Promise<{ error?: string }>, ok: string) =>
    startTransition(async () => {
      const res = await fn();
      if (res?.error) showToast(res.error);
      else {
        showToast(ok);
        router.refresh();
      }
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* ── Top bar ── */}
      <div style={{ borderBottom: "1px solid var(--border)", background: "#fff", padding: "12px 22px" }}>
        <Link href="/onboarding" style={{ fontSize: 12, color: "var(--ink-3)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Icon name="arrow-left" size={13} /> Back to Onboarding
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 19 }}>{detail.clientName}</h2>
          <span className="pill amber"><span className="dot" /> In Progress</span>
          {detail.amName && <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>AM {detail.amName}</span>}
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Started {fmtDate(detail.startedAt)}</span>
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Target {fmtDate(detail.targetCompletion)}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", minWidth: 160 }}>
            <div className="progress orange" style={{ flex: 1 }}><i style={{ width: `${detail.progress}%` }} /></div>
            <span className="progress-pct">{detail.progress}%</span>
          </div>
          <button className="btn-ghost" onClick={() => setChatOpen(true)}><Icon name="message-square" size={13} /> Chat</button>
          <button className="btn-ghost" style={{ color: "var(--red)" }}><Icon name="ban" size={13} /> Void</button>
          <button className="btn-ghost"><Icon name="settings" size={13} /> Settings</button>
        </div>
        <div className="tabs-row" style={{ marginTop: 10, marginBottom: -12, borderBottom: "none" }}>
          {TABS.map((t) => (
            <button key={t.id} className={"tab-btn" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={t.icon} size={14} /> {t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "team" ? (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", flex: 1, minHeight: 0 }}>
          {/* ── Stage list ── */}
          <aside className="detail-left">
            <div className="steps" style={{ padding: 10 }}>
              <div className="stage-label">{tpl.stages.length} Stages</div>
              {tpl.stages.map((s, i) => {
                const no = i + 1;
                const row = stageRow(no);
                const st = row?.status ?? (no === 1 ? "active" : "upcoming");
                return (
                  <div
                    key={s.id}
                    className={"step" + (expanded === no ? " active" : "")}
                    onClick={() => setExpanded(no)}
                    style={{ alignItems: "center" }}
                  >
                    <span
                      className="indicator"
                      style={{
                        background: st === "complete" ? "var(--green)" : st === "active" ? "var(--orange)" : "#fff",
                        color: st === "upcoming" ? "var(--ink-4)" : "#fff",
                        border: st === "upcoming" ? "1.5px solid var(--border-strong)" : "none",
                        fontSize: 10, fontWeight: 700,
                      }}
                    >
                      {st === "complete" ? <Icon name="check" size={11} /> : no}
                    </span>
                    <div className="body">
                      <div className="title">{s.name}</div>
                      <div className="meta">
                        {row ? `${row.step_done}/${row.step_total}` : `0/${s.steps.length}`}{" "}
                        {st === "complete" ? "Complete" : st === "active" ? "Active" : "Upcoming"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* ── Flow ── */}
          <main className="detail-center">
            <div className="step-header" style={{ marginBottom: 14 }}>
              <div>
                <div className="ttl" style={{ fontSize: 18 }}>Onboarding flow</div>
                <div className="desc">Click any stage to expand its steps.</div>
              </div>
              <span className="stage-badge">{tpl.name}</span>
            </div>

            {tpl.stages.map((stage, i) => {
              const no = i + 1;
              const row = stageRow(no);
              const st = row?.status ?? (no === 1 ? "active" : "upcoming");
              const isOpen = expanded === no;
              const actId = st === "active" ? activeStepId(no) : null;
              return (
                <div
                  key={stage.id}
                  style={{
                    border: st === "active" ? "1.5px solid var(--orange)" : "1px solid var(--border)",
                    borderRadius: 12, background: "#fff", marginBottom: 12, overflow: "hidden",
                  }}
                >
                  <div
                    onClick={() => setExpanded(isOpen ? -1 : no)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer" }}
                  >
                    <span
                      style={{
                        width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", flexShrink: 0,
                        fontSize: 12, fontWeight: 700,
                        background: st === "complete" ? "var(--green)" : st === "active" ? "var(--orange)" : "var(--bg)",
                        color: st === "upcoming" ? "var(--ink-3)" : "#fff",
                      }}
                    >
                      {st === "complete" ? <Icon name="check" size={13} /> : no}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{stage.name}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{stage.desc}</div>
                    </div>
                    {st === "complete" && (
                      <button
                        className="btn-ghost"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); run(() => rollbackToStage(detail.runId, no), `Rolled back to ${stage.name}`); }}
                        style={{ color: "var(--red)" }}
                      >
                        <Icon name="rotate-ccw" size={13} /> Roll back to here
                      </button>
                    )}
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} size={16} />
                  </div>

                  {isOpen && (
                    <div style={{ padding: "0 16px 16px" }}>
                      {stage.steps.map((step) => (
                        <StepBox
                          key={step.id}
                          step={step}
                          assignRole={step.assignRole ?? stage.assignRole ?? null}
                          status={stepStatus(step.id)}
                          isActive={actId === step.id}
                          assignedName={detail.stepState[step.id]?.assignedName ?? null}
                          options={step.act?.role === "Senior" ? detail.seniors : step.act?.role === "Junior" ? detail.juniors : []}
                          sel={assignSel[step.id] ?? ""}
                          onSel={(v) => setAssignSel((m) => ({ ...m, [step.id]: v }))}
                          busy={busy}
                          onOpenAct={() => setActStep(step)}
                          onAssign={(id, name) => run(() => assignStep(detail.runId, step.id, id, name), `Assigned ${name}`)}
                        />
                      ))}
                      {stage.gate && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, padding: "10px 12px", background: "var(--orange-soft)", borderRadius: 10, color: "var(--orange)", fontWeight: 700, fontSize: 12.5 }}>
                          <Icon name="diamond" size={14} /> {stage.gate.label}
                          {stage.gate.sop && <span style={{ fontWeight: 500, color: "var(--ink-3)", fontSize: 12 }}>· {stage.gate.sop}</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </main>
        </div>
      ) : tab === "tasks" ? (
        <div className="scroll"><div className="page"><TaskBoard runId={detail.runId} tasks={detail.tasks} /></div></div>
      ) : tab === "playbook" ? (
        <div className="scroll"><div className="page" style={{ maxWidth: 900 }}><Playbook detail={detail} /></div></div>
      ) : (
        <div className="scroll">
          <div className="page">
            <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "60px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
              Switch to the client&apos;s magic-link portal — dispatch the link from the Send Magic Link stage, then open it from there.
            </div>
          </div>
        </div>
      )}

      {actStep && actStep.act?.type === "coa" && (
        <CoaBuilderModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("COA saved & sent for AM review"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "diagram" && (
        <DiagramBuilderModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Workflow diagrams saved to playbook"); router.refresh(); }}
        />
      )}

      {actStep && (actStep.act?.type === "catchup" || actStep.act?.type === "project" || actStep.act?.type === "calendar") && (
        <ItemsBuilderModal
          runId={detail.runId}
          stepId={actStep.id}
          kind={actStep.act.type === "catchup" ? "catchup" : actStep.act.type === "project" ? "project" : "compliance"}
          existing={detail.items[actStep.act.type === "catchup" ? "catchup" : actStep.act.type === "project" ? "project" : "compliance"] ?? []}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Saved"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "intake" && (
        <IntakeBuilderModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={(msg) => { setActStep(null); showToast(msg); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "drivelink" && (
        <DriveBuilderModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Drive folders created & link shared"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "uploads" && (
        <DocBuilderModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Document list saved"); router.refresh(); }}
        />
      )}

      {actStep && ["agenda", "ai", "mom", "deck"].includes(actStep.act?.type ?? "") && (
        <AiTextModal
          runId={detail.runId}
          stepId={actStep.id}
          actType={actStep.act!.type}
          title={actStep.title}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast(`${actStep.title} — done`); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "triage" && (
        <TriageModal
          runId={detail.runId}
          stepId={actStep.id}
          people={[...detail.seniors, ...detail.juniors]}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Urgent items routed"); router.refresh(); }}
        />
      )}

      {actStep && !["coa", "diagram", "catchup", "project", "calendar", "triage", "agenda", "ai", "mom", "deck", "uploads", "intake", "drivelink"].includes(actStep.act?.type ?? "") && (
        <RunStepModal
          runId={detail.runId}
          step={actStep}
          busy={busy}
          onClose={() => setActStep(null)}
          onConfirm={() => {
            const s = actStep;
            setActStep(null);
            run(() => completeStep(detail.runId, s.id), `${s.title} — done`);
          }}
          onRework={() => {
            const s = actStep;
            const stageNo = tpl.stages.findIndex((st) => st.steps.some((x) => x.id === s.id)) + 1;
            setActStep(null);
            run(() => rollbackToStage(detail.runId, stageNo), "Sent back for rework");
          }}
        />
      )}

      <RunChat runId={detail.runId} open={chatOpen} onClose={() => setChatOpen(false)} />

      {toast && (
        <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>
      )}
    </div>
  );
}

function RunChat({ runId, open, onClose }: { runId: string; open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<{ id: string; author_name: string | null; author_role: string | null; body: string; created_at: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const supabase = createClient();

  const load = async () => {
    const { data } = await supabase.from("run_messages").select("id,author_name,author_role,body,created_at").eq("run_id", runId).order("created_at");
    setMessages(data ?? []);
  };
  useEffect(() => { if (open) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const send = () => {
    if (!text.trim()) return;
    const body = text;
    setText("");
    start(async () => { await postMessage(runId, body); await load(); });
  };

  return (
    <>
      <div className={"drawer-overlay" + (open ? " open" : "")} onClick={onClose} />
      <aside className={"drawer" + (open ? " open" : "")}>
        <div className="hd"><h3>Run chat</h3><button className="icon-btn" onClick={onClose}><Icon name="x" size={16} /></button></div>
        <div className="list">
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--ink-3)", fontSize: 13 }}>No messages yet. Start the thread.</div>
          ) : (
            messages.map((m) => (
              <div key={m.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{m.author_name ?? "Someone"} <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {new Date(m.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
                <div style={{ fontSize: 13, color: "var(--ink-1)", marginTop: 2 }}>{m.body}</div>
              </div>
            ))
          )}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message the team…" style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
          <button className="btn-primary" onClick={send} disabled={busy || !text.trim()}><Icon name="send" size={14} /></button>
        </div>
      </aside>
    </>
  );
}

function RunStepModal({
  runId, step, busy, onClose, onConfirm, onRework,
}: {
  runId: string;
  step: TemplateStep;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRework: () => void;
}) {
  const act = step.act;
  const type = act?.type ?? "confirm";
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState("");
  const [notes, setNotes] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const items = act?.items ?? [];
  const cover = act?.cover ?? [];
  const allItemsDone = items.length > 0 && items.every((_, i) => checked["i" + i]);
  const allCoverDone = cover.length === 0 || cover.every((_, i) => checked["c" + i]);

  const doDispatch = async () => {
    setWorking(true);
    const res = await dispatchMagicLink(runId);
    setWorking(false);
    if (res.url) setLink(res.url);
  };
  const doDrive = () => setLink(`/drive/${runId.slice(0, 8)}`);

  let body: React.ReactNode;
  let canConfirm = true;
  let confirmLabel = act?.btn ?? "Confirm";

  if (type === "checklist") {
    canConfirm = allItemsDone;
    body = (
      <div className="checklist">
        {act?.contract && (
          <div className="dropzone" style={{ marginBottom: 6 }}>
            <Icon name="paperclip" size={16} /> <strong>Attach engagement contract</strong> (optional — auto-detects catch-up backlog)
          </div>
        )}
        {items.map((it, i) => (
          <label key={i} className={"check-row" + (checked["i" + i] ? " checked" : "")}>
            <input type="checkbox" checked={!!checked["i" + i]} onChange={(e) => setChecked((c) => ({ ...c, ["i" + i]: e.target.checked }))} />
            {it}
          </label>
        ))}
      </div>
    );
  } else if (type === "call") {
    canConfirm = allCoverDone && recording.trim().length > 0;
    body = (
      <>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Coverage</div>
        <div className="checklist">
          {cover.map((it, i) => (
            <label key={i} className={"check-row" + (checked["c" + i] ? " checked" : "")}>
              <input type="checkbox" checked={!!checked["c" + i]} onChange={(e) => setChecked((c) => ({ ...c, ["c" + i]: e.target.checked }))} />
              {it}
            </label>
          ))}
        </div>
        <div className="field"><label>Recording link</label><input value={recording} onChange={(e) => setRecording(e.target.value)} placeholder="https://fathom.video/…" /></div>
        <div className="field"><label>Notes {act?.memo ? "/ MoM" : ""}</label><textarea className="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Key points, decisions, action items…" /></div>
      </>
    );
  } else if (type === "approve") {
    body = <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>Sign off as <strong>{act?.role ?? "approver"}</strong>. {act?.rework ? "You can also send this back for rework." : ""}</div>;
  } else if (type === "dispatch") {
    canConfirm = !!link;
    body = (
      <div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 12 }}>Generate the 7-day client magic link and send it to the client's email + Fincore chat.</div>
        {link ? (
          <div className="sop-ref-bar"><Icon name="link" size={14} /> Magic link ready <a href={link} target="_blank" rel="noreferrer">Open portal →</a></div>
        ) : (
          <button className="btn-ai" disabled={working} onClick={doDispatch}><Icon name="send" size={14} /> {working ? "Sending…" : "Dispatch magic link"}</button>
        )}
      </div>
    );
  } else if (type === "drivelink") {
    canConfirm = !!link;
    body = (
      <div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 12 }}>Generate the shareable Drive folder link for this client.</div>
        {link ? <div className="sop-ref-bar"><Icon name="folder" size={14} /> Drive link created <code>{link}</code></div> : <button className="btn-primary" onClick={doDrive}><Icon name="folder-plus" size={14} /> Create & share Drive link</button>}
      </div>
    );
  } else {
    body = (
      <div className="ai-flag" style={{ marginTop: 0 }}>
        <div className="top"><span className="icon-glow"><Icon name="wrench" size={16} /></span><h4>{step.title}</h4></div>
        <div className="body">The full builder for this step is wired in its own part of the build. Confirm to advance the run for now.</div>
      </div>
    );
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>{step.title}</h3>
          {step.note && <div className="sub">{step.note}</div>}
        </div>
        <div className="bd">{body}</div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {type === "approve" && act?.rework && (
            <button className="btn-ghost" style={{ color: "var(--red)" }} onClick={onRework} disabled={busy}>Send back for rework</button>
          )}
          <button className="btn-primary" onClick={onConfirm} disabled={busy || !canConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function CoaBuilderModal({
  runId, stepId, onClose, onDone,
}: {
  runId: string;
  stepId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<"intro" | "loading" | "review">("intro");
  const [lines, setLines] = useState<CoaLine[]>([]);
  const [rationale, setRationale] = useState("");
  const [industry, setIndustry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const generate = async () => {
    setPhase("loading");
    setError(null);
    const res = await generateCoa(runId);
    if (res.error && !res.accounts) {
      setError(res.error);
      setPhase("intro");
      return;
    }
    setLines(res.accounts ?? []);
    setRationale(res.rationale ?? "");
    setIndustry(res.industry ?? "");
    if (res.error) setError(res.error);
    setPhase("review");
  };

  const sections = [...new Set(lines.map((l) => l.section))];

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Build chart of accounts</h3>
          <div className="sub">AI tailors the industry template to this client. Review, toggle accounts, then send to the AM.</div>
        </div>
        <div className="bd" style={{ maxHeight: "62vh" }}>
          {phase === "intro" && (
            <div className="ai-flag" style={{ marginTop: 0 }}>
              <div className="top"><span className="icon-glow"><Icon name="sparkles" size={16} /></span><h4>Generate the COA with AI</h4></div>
              <div className="body">Loads the matching industry chart from the Finanshels workbook, then tailors it to this client&apos;s revenue channels, gateways and VAT status.</div>
              <div className="actions"><button className="btn-ai" onClick={generate}><Icon name="sparkles" size={14} /> Generate with AI</button></div>
              {error && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 10 }}>{error}</div>}
            </div>
          )}
          {phase === "loading" && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--purple)" }}>
              <div className="ai-loading"><span className="d" /><span className="d" /><span className="d" /></div>
              <div style={{ fontSize: 13, marginTop: 10, color: "var(--ink-3)" }}>Tailoring the {industry || "industry"} chart of accounts…</div>
            </div>
          )}
          {phase === "review" && (
            <>
              {rationale && <div className="ai-response"><div className="hdr"><Icon name="sparkles" size={13} /> AI rationale</div>{rationale}</div>}
              {error && <div style={{ fontSize: 12, color: "var(--amber)", margin: "8px 0" }}>{error}</div>}
              {sections.map((sec) => (
                <div key={sec} style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 6 }}>{sec}</div>
                  {lines.map((l, i) => l.section === sec && (
                    <div key={l.code + i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                      <input type="checkbox" checked={l.include} onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} style={{ accentColor: "var(--orange)" }} />
                      <input value={l.code} onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} style={{ fontFamily: "DM Mono, monospace", fontSize: 11, width: 56, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px" }} />
                      <input value={l.account} onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))} style={{ flex: 1, fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }} />
                      <button className="icon-btn" onClick={() => setLines((arr) => arr.filter((_, j) => j !== i))} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button>
                    </div>
                  ))}
                  <button className="add-link" onClick={() => setLines((arr) => [...arr, { code: "", account: "New account", section: sec, include: true }])} style={{ marginTop: 4 }}><Icon name="plus" size={12} /> Add account</button>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          {phase === "review" && (
            <button className="btn-primary" disabled={saving || !lines.some((l) => l.include)} onClick={() => startSave(async () => { const r = await saveCoa(runId, stepId, lines, rationale, industry); if (!r.error) onDone(); })}>
              {saving ? "Saving…" : "Save COA & send for AM review"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepBox({
  step, assignRole, status, isActive, assignedName, options, sel, onSel, busy, onOpenAct, onAssign,
}: {
  step: TemplateStep;
  assignRole: string | null;
  status: string;
  isActive: boolean;
  assignedName: string | null;
  options: { id: string; name: string }[];
  sel: string;
  onSel: (v: string) => void;
  busy: boolean;
  onOpenAct: () => void;
  onAssign: (id: string, name: string) => void;
}) {
  const ki = KIND_ICON[step.kind] ?? KIND_ICON.person;
  const done = status === "complete";
  const isAssign = step.act?.type === "assign";

  return (
    <div
      style={{
        border: isActive ? "1.5px solid var(--orange)" : "1px solid var(--border)",
        borderRadius: 10, padding: 12, marginTop: 8, background: isActive ? "#fff" : "var(--bg-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", flexShrink: 0, background: "rgba(0,0,0,0.04)", color: ki.color }}>
          <Icon name={ki.icon} size={15} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "DM Mono, monospace", fontSize: 11, color: "var(--ink-3)" }}>{step.id}</span>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{step.title}</span>
          </div>
          {step.note && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 3, lineHeight: 1.5 }}>{step.note}</div>}
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
            {step.who.map((w) => (
              <span key={w} className={"pill " + (w === "AI" || w === "System" ? "purple" : w === "Client" ? "teal" : "gray")} style={{ fontSize: 10, padding: "1px 7px" }}>{w}</span>
            ))}
            {assignRole && <span className="pill blue" style={{ fontSize: 10, padding: "1px 7px" }}>{ASSIGN_ROLES.find((r) => r.id === assignRole)?.label ?? assignRole}</span>}
            {step.approval && <span className="pill amber" style={{ fontSize: 10, padding: "1px 7px" }}>Sign-off: {step.approval.by}</span>}
          </div>

          {assignedName && (
            <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--green)", display: "flex", alignItems: "center", gap: 6, background: "var(--green-soft)", padding: "6px 10px", borderRadius: 8 }}>
              <Icon name="check" size={12} /> {step.act?.role ?? "Assigned"}: {assignedName}
            </div>
          )}

          {/* Active-step actions */}
          {isActive && !done && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {isAssign ? (
                <>
                  <select value={sel} onChange={(e) => onSel(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13 }}>
                    <option value="">Select {step.act?.role}…</option>
                    {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                  <button
                    className="btn-primary"
                    disabled={busy || !sel}
                    onClick={() => { const o = options.find((x) => x.id === sel); if (o) onAssign(o.id, o.name); }}
                  >
                    Assign
                  </button>
                </>
              ) : (
                <button className="btn-primary" disabled={busy} onClick={onOpenAct}>
                  {step.act?.btn ?? "Mark done"}
                </button>
              )}
            </div>
          )}
        </div>
        <span style={{ flexShrink: 0, marginTop: 2 }}>
          {done ? (
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--green)", color: "#fff", display: "grid", placeItems: "center" }}><Icon name="check" size={13} /></span>
          ) : isActive ? (
            <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--orange)", color: "#fff", display: "grid", placeItems: "center", fontSize: 11 }}><Icon name="loader" size={12} /></span>
          ) : (
            <span style={{ width: 22, height: 22, borderRadius: "50%", border: "1.5px solid var(--border-strong)" }} />
          )}
        </span>
      </div>
    </div>
  );
}

const TASK_STATUSES = ["not_started", "in_progress", "complete", "needs_input", "blocked"];
const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started", in_progress: "In progress", complete: "Complete",
  needs_input: "Needs input", blocked: "Blocked",
};

function TaskBoard({ runId, tasks }: { runId: string; tasks: TaskRow[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const change = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  return (
    <>
      <div className="section-head"><div><h2 style={{ fontSize: 16 }}>Task board</h2><div className="sub">Replaces the PMS during onboarding. Toggle what the client sees in their portal.</div></div></div>
      <div className="runs-card">
        <table className="runs-table">
          <thead><tr><th>Task</th><th>Owner</th><th>Type</th><th>Due</th><th>Client sees</th><th>Status</th></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>{t.title}</td>
                <td>{t.ownerName ?? "—"}</td>
                <td><span className={"pill " + (t.type === "milestone" ? "purple" : t.type === "client_action" ? "teal" : "gray")} style={{ fontSize: 10 }}>{t.type.replace("_", " ")}</span></td>
                <td>{t.due ?? "—"}</td>
                <td><input type="checkbox" checked={t.clientVisible} disabled={busy} onChange={(e) => change(() => toggleTaskVisible(runId, t.id, e.target.checked))} style={{ accentColor: "var(--orange)" }} /></td>
                <td><select value={t.status} disabled={busy} onChange={(e) => change(() => setTaskStatus(runId, t.id, e.target.value))} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", fontSize: 12.5 }}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}</select></td>
              </tr>
            ))}
            {!tasks.length && <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--ink-3)" }}>No tasks yet — configure the client task board in Stage 2.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

const NODE_TYPES = ["start", "step", "decision", "end"];
const NODE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  start: { bg: "var(--green)", color: "#fff", label: "Start" },
  step: { bg: "var(--blue)", color: "#fff", label: "Step" },
  decision: { bg: "var(--amber)", color: "#fff", label: "Decision" },
  end: { bg: "var(--red)", color: "#fff", label: "End" },
};

function DiagramBuilderModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const [diagrams, setDiagrams] = useState<DiagramInput[]>([{ name: "Monthly Close", nodes: [{ id: "n1", label: "Bank feed imported", type: "start" }, { id: "n2", label: "Junior books transactions", type: "step" }, { id: "n3", label: "Reconciled?", type: "decision" }, { id: "n4", label: "Senior review & close", type: "end" }] }]);
  const [sel, setSel] = useState(0);
  const [saving, start] = useTransition();
  const [aiBrief, setAiBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const d = diagrams[sel];

  const update = (fn: (x: DiagramInput) => DiagramInput) => setDiagrams((arr) => arr.map((x, i) => (i === sel ? fn(x) : x)));
  const aiGen = async () => { setAiBusy(true); const r = await generateDiagram(runId, aiBrief); setAiBusy(false); if (r.nodes?.length) update((x) => ({ ...x, nodes: r.nodes! })); };
  const addNode = () => update((x) => ({ ...x, nodes: [...x.nodes, { id: crypto.randomUUID().slice(0, 8), label: "New step", type: "step" }] }));
  const setNode = (i: number, k: "label" | "type", v: string) => update((x) => ({ ...x, nodes: x.nodes.map((n, j) => (j === i ? { ...n, [k]: v } : n)) }));
  const move = (i: number, dir: number) => update((x) => { const a = [...x.nodes]; const j = i + dir; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, nodes: a }; });
  const delNode = (i: number) => update((x) => ({ ...x, nodes: x.nodes.filter((_, j) => j !== i) }));

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 820, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Build workflow diagrams</h3><div className="sub">Map the delivery / monthly-close process. Saved to the client playbook → Workflows.</div></div>
        <div className="bd" style={{ maxHeight: "66vh" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
            {diagrams.map((dg, i) => (
              <button key={i} className={"tab-pill" + (i === sel ? " active" : "")} onClick={() => setSel(i)}>{dg.name || `Diagram ${i + 1}`}</button>
            ))}
            <button className="tab-pill" onClick={() => { setDiagrams((a) => [...a, { name: `Diagram ${a.length + 1}`, nodes: [] }]); setSel(diagrams.length); }}>+ Add diagram</button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input value={aiBrief} onChange={(e) => setAiBrief(e.target.value)} placeholder="Describe the process in plain language → AI draws it" style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13 }} />
            <button className="btn-ai" disabled={aiBusy || !aiBrief.trim()} onClick={aiGen}><Icon name="sparkles" size={13} /> {aiBusy ? "Drawing…" : "Generate with AI"}</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 16 }}>
            {/* Editor */}
            <div>
              <div className="field"><label>Diagram name</label><input value={d.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} /></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {d.nodes.map((n, i) => (
                  <div key={n.id} className="builder-step">
                    <input type="text" value={n.label} onChange={(e) => setNode(i, "label", e.target.value)} style={{ flex: 1 }} />
                    <select value={n.type} onChange={(e) => setNode(i, "type", e.target.value)}>{NODE_TYPES.map((t) => <option key={t} value={t}>{NODE_STYLE[t].label}</option>)}</select>
                    <button className="icon-btn" onClick={() => move(i, -1)}><Icon name="chevron-up" size={13} /></button>
                    <button className="icon-btn" onClick={() => move(i, 1)}><Icon name="chevron-down" size={13} /></button>
                    <button className="icon-btn" onClick={() => delNode(i)} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button>
                  </div>
                ))}
                <button className="add-link" onClick={addNode}><Icon name="plus" size={12} /> Add node</button>
              </div>
            </div>

            {/* Preview */}
            <div style={{ background: "var(--bg-soft)", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 8 }}>Preview</div>
              {d.nodes.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Add nodes to see the flow.</div>}
              {d.nodes.map((n, i) => {
                const s = NODE_STYLE[n.type];
                return (
                  <div key={n.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 600, padding: "7px 12px", borderRadius: n.type === "decision" ? 4 : 8, transform: n.type === "decision" ? "rotate(0deg)" : "none", maxWidth: 200, textAlign: "center" }}>{n.label}</div>
                    {i < d.nodes.length - 1 && <span style={{ color: "var(--ink-4)" }}><Icon name="arrow-down" size={14} /></span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving || diagrams.every((x) => !x.nodes.length)} onClick={() => start(async () => { const r = await saveDiagrams(runId, stepId, diagrams.filter((x) => x.nodes.length)); if (!r.error) onDone(); })}>
            {saving ? "Saving…" : "Confirm diagrams built"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ITEM_FIELDS: Record<string, { k: string; l: string; opts?: string[] }[]> = {
  catchup: [{ k: "title", l: "Task" }, { k: "owner", l: "Owner" }, { k: "due", l: "Due" }],
  project: [{ k: "name", l: "Project" }, { k: "month", l: "Month" }, { k: "tasks", l: "Tasks (; separated)" }],
  compliance: [{ k: "label", l: "Item" }, { k: "date", l: "Due date" }, { k: "type", l: "Type", opts: ["VAT", "CT", "WPS", "Doc expiry", "Other"] }],
};
const ITEM_TITLE: Record<string, string> = { catchup: "Catch-up board", project: "Internal projects & tasks", compliance: "Compliance calendar" };

function ItemsBuilderModal({
  runId, stepId, kind, existing, onClose, onDone,
}: {
  runId: string; stepId: string; kind: string;
  existing: { id: string; data: Record<string, unknown>; status: string }[];
  onClose: () => void; onDone: () => void;
}) {
  const fields = ITEM_FIELDS[kind];
  const [rows, setRows] = useState<Record<string, string>[]>(existing.length ? existing.map((e) => e.data as Record<string, string>) : [Object.fromEntries(fields.map((f) => [f.k, ""]))]);
  const [saving, start] = useTransition();
  const [aiBusy, setAiBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  // project AI inputs
  const [pStart, setPStart] = useState(""); const [pEnd, setPEnd] = useState(""); const [pCadence, setPCadence] = useState("monthly"); const [pBrief, setPBrief] = useState("");

  const setCell = (i: number, k: string, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const addRow = () => setRows((r) => [...r, Object.fromEntries(fields.map((f) => [f.k, ""]))]);
  const del = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  const aiCompliance = async () => { setAiBusy(true); setInfo(null); const r = await generateCompliance(runId); setAiBusy(false); if (r.error) setInfo(r.error); else if (r.items?.length) setRows(r.items.map((i) => ({ label: i.label, date: i.date, type: i.type }))); };
  const aiProjects = async () => { setAiBusy(true); setInfo(null); const r = await generateProjects(runId, pBrief, pStart, pEnd, pCadence); setAiBusy(false); if (r.error) setInfo(r.error); else if (r.items?.length) setRows(r.items.map((i) => ({ name: i.name, month: i.month, tasks: i.tasks }))); };

  const saveItems = (after?: "email" | "push") => start(async () => {
    const items: RunItemInput[] = rows.filter((r) => Object.values(r).some((v) => v)).map((r) => ({ data: r, status: "open" }));
    const res = await saveRunItems(runId, stepId, kind, items);
    if (res.error) { setInfo(res.error); return; }
    if (after === "email") {
      const body = "Your compliance calendar:\n\n" + rows.map((r) => `• ${r.label} — ${r.type} — ${r.date}`).join("\n");
      const er = await sendClientEmail(runId, "Your Finanshels compliance calendar", body);
      if (er.error) { setInfo("Saved. Email: " + er.error); return; }
    }
    if (after === "push") { const pr = await pushToPms(runId); if (pr.error) { setInfo("Saved. Push: " + pr.error); return; } }
    onDone();
  });

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 700 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>{ITEM_TITLE[kind]}</h3><div className="sub">Generate with AI or add rows manually, then confirm.</div></div>
        <div className="bd" style={{ maxHeight: "64vh" }}>
          {kind === "compliance" && (
            <button className="btn-ai" disabled={aiBusy} onClick={aiCompliance} style={{ marginBottom: 10 }}><Icon name="sparkles" size={13} /> {aiBusy ? "Generating…" : "Generate from client (AI)"}</button>
          )}
          {kind === "project" && (
            <div style={{ background: "var(--bg-soft)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                <input type="month" value={pStart} onChange={(e) => setPStart(e.target.value)} title="Period start" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12.5 }} />
                <input type="month" value={pEnd} onChange={(e) => setPEnd(e.target.value)} title="Period end" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12.5 }} />
                <select value={pCadence} onChange={(e) => setPCadence(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12.5 }}>{["monthly", "weekly", "daily", "quarterly"].map((c) => <option key={c}>{c}</option>)}</select>
              </div>
              <textarea className="notes" value={pBrief} onChange={(e) => setPBrief(e.target.value)} placeholder="In plain language: what should happen each month? (e.g. monthly close, VAT each quarter, payroll by 25th)" style={{ minHeight: 50 }} />
              <button className="btn-ai" disabled={aiBusy || !pStart || !pEnd} onClick={aiProjects} style={{ marginTop: 6 }}><Icon name="sparkles" size={13} /> {aiBusy ? "Generating…" : "Generate projects & tasks (AI)"}</button>
            </div>
          )}
          <table className="runs-table" style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
            <thead><tr>{fields.map((f) => <th key={f.k}>{f.l}</th>)}<th></th></tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {fields.map((f) => (
                    <td key={f.k}>
                      {f.opts ? (
                        <select value={row[f.k] ?? ""} onChange={(e) => setCell(i, f.k, e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5 }}>
                          <option value="">—</option>{f.opts.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input value={row[f.k] ?? ""} onChange={(e) => setCell(i, f.k, e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, width: "100%" }} />
                      )}
                    </td>
                  ))}
                  <td><button className="icon-btn" onClick={() => del(i)} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="add-link" onClick={addRow} style={{ marginTop: 8 }}><Icon name="plus" size={12} /> Add row</button>
          {info && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 8 }}>{info}</div>}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          {kind === "compliance" && <button className="btn-ghost" disabled={saving} onClick={() => saveItems("email")}><Icon name="send" size={13} /> Save & email client</button>}
          {kind === "project" && <button className="btn-ghost" disabled={saving} onClick={() => saveItems("push")}><Icon name="upload" size={13} /> Save & push to PMS</button>}
          <button className="btn-primary" disabled={saving} onClick={() => saveItems()}>{saving ? "Saving…" : "Save & confirm"}</button>
        </div>
      </div>
    </div>
  );
}

function TriageModal({
  runId, stepId, people, onClose, onDone,
}: { runId: string; stepId: string; people: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<{ item: string; memberId: string; severity: string }[]>([{ item: "", memberId: "", severity: "High" }]);
  const [saving, start] = useTransition();
  const set = (i: number, k: string, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Urgent compliance triage</h3><div className="sub">Flag penalty-risk items (CT / VAT / WPS / AML) and route each to a person — it lands in their My Work.</div></div>
        <div className="bd">
          {rows.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input placeholder="Risk item (e.g. CT registration overdue)" value={row.item} onChange={(e) => set(i, "item", e.target.value)} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13 }} />
              <select value={row.severity} onChange={(e) => set(i, "severity", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 8px" }}>{["High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}</select>
              <select value={row.memberId} onChange={(e) => set(i, "memberId", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 8px", maxWidth: 160 }}><option value="">Assign to…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </div>
          ))}
          <button className="add-link" onClick={() => setRows((r) => [...r, { item: "", memberId: "", severity: "High" }])}><Icon name="plus" size={12} /> Add item</button>
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-ghost" disabled={saving} onClick={() => start(async () => { await assignTriage(runId, stepId, []); onDone(); })}>No urgent items</button>
          <button className="btn-primary" disabled={saving} onClick={() => start(async () => { const items = rows.filter((r) => r.item.trim() && r.memberId).map((r) => ({ item: r.item.trim(), memberId: r.memberId, memberName: people.find((p) => p.id === r.memberId)?.name ?? "", severity: r.severity })); const res = await assignTriage(runId, stepId, items); if (!res.error) onDone(); })}>{saving ? "Routing…" : "Assign & confirm"}</button>
        </div>
      </div>
    </div>
  );
}

function AiTextModal({
  runId, stepId, actType, title, onClose, onDone,
}: { runId: string; stepId: string; actType: string; title: string; onClose: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const generate = () => {
    setPhase("loading"); setError(null);
    generateStepText(runId, actType).then((r) => {
      if (r.error) { setError(r.error); setPhase("error"); }
      else { setText(r.text ?? ""); setPhase("ready"); }
    });
  };
  // generate on first open
  useEffect(() => { generate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>{title}</h3><div className="sub">AI draft — review and edit before saving. Powered by your configured model.</div></div>
        <div className="bd" style={{ maxHeight: "62vh" }}>
          {phase === "loading" && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--purple)" }}>
              <div className="ai-loading"><span className="d" /><span className="d" /><span className="d" /></div>
              <div style={{ fontSize: 13, marginTop: 10, color: "var(--ink-3)" }}>Generating…</div>
            </div>
          )}
          {phase === "error" && (
            <div className="ai-flag" style={{ marginTop: 0 }}>
              <div className="top"><span className="icon-glow" style={{ background: "var(--red)" }}><Icon name="alert-triangle" size={16} /></span><h4>Couldn&apos;t generate</h4></div>
              <div className="body" style={{ color: "var(--red)" }}>{error}</div>
              <div className="actions"><button className="btn-soft" onClick={generate}>Try again</button></div>
            </div>
          )}
          {phase === "ready" && (
            <>
              <div className="ai-response" style={{ marginTop: 0 }}><div className="hdr"><Icon name="sparkles" size={13} /> AI draft — editable</div></div>
              <textarea className="notes" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 240, marginTop: 8, fontFamily: "inherit" }} />
              <button className="btn-soft" onClick={generate} style={{ marginTop: 8 }}><Icon name="rotate-ccw" size={13} /> Regenerate</button>
            </>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          {["mom", "ai", "welcome_email", "agenda", "deck"].includes(actType) && (
            <button className="btn-ai" disabled={saving || phase !== "ready" || !text.trim()} onClick={() => startSave(async () => {
              const s = await sendClientEmail(runId, title, text);
              if (s.error) { setError(s.error); setPhase("ready"); return; }
              await saveStepText(runId, stepId, text);
              onDone();
            })}><Icon name="send" size={13} /> Send to client</button>
          )}
          <button className="btn-primary" disabled={saving || phase !== "ready" || !text.trim()} onClick={() => startSave(async () => { const r = await saveStepText(runId, stepId, text); if (!r.error) onDone(); })}>{saving ? "Saving…" : "Save & confirm"}</button>
        </div>
      </div>
    </div>
  );
}

function PlaybookCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Playbook({ detail }: { detail: RunDetail }) {
  const p = detail.playbook;
  const profile = p.profile as Record<string, unknown>;
  const row = (k: string, v: unknown) => (v ? <div key={k} style={{ display: "flex", gap: 8, fontSize: 13, padding: "3px 0" }}><span style={{ color: "var(--ink-3)", minWidth: 150 }}>{k}</span><span>{Array.isArray(v) ? v.join(", ") : String(v)}</span></div> : null);

  return (
    <>
      <div className="section-head"><div><h2 style={{ fontSize: 16 }}>Client playbook</h2><div className="sub">Compiled from CRM, intake, COA, documents, team and workflows.</div></div></div>

      <PlaybookCard title={detail.clientName}>
        {row("Industry", profile.industry)}
        {row("Entity", profile.entity_type)}
        {row("Owner", profile.owner_name)}
        {row("Contact", profile.primary_contact_email)}
        {row("VAT", profile.vat_registered)}
        {row("Corporate Tax", profile.ct_registered)}
        {row("Revenue channels", profile.revenue_channels)}
        {row("Payment gateways", profile.payment_gateways)}
        {row("Accounting software", profile.accounting_software)}
      </PlaybookCard>

      <PlaybookCard title="Assigned team">
        {p.team.length ? p.team.map((t, i) => <div key={i} style={{ fontSize: 13, padding: "3px 0" }}><span style={{ color: "var(--ink-3)", textTransform: "capitalize" }}>{t.role}:</span> <strong>{t.name}</strong></div>) : <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Not assigned yet.</div>}
      </PlaybookCard>

      {p.coa && (
        <PlaybookCard title={`Chart of accounts ${p.coa.signedOff ? "· signed off ✓" : "· draft"}`}>
          {[...new Set(p.coa.accounts.map((a) => a.section))].map((sec) => (
            <div key={sec} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)" }}>{sec}</div>
              {p.coa!.accounts.filter((a) => a.section === sec).map((a, i) => <div key={i} style={{ fontSize: 12.5, padding: "2px 0" }}><span style={{ fontFamily: "DM Mono, monospace", color: "var(--ink-3)", marginRight: 8 }}>{a.code}</span>{a.account}</div>)}
            </div>
          ))}
        </PlaybookCard>
      )}

      <PlaybookCard title={`Documents (${p.documents.filter((d) => d.status === "uploaded").length}/${p.documents.length})`}>
        {p.documents.map((d, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}><Icon name={d.status === "uploaded" ? "check-circle" : "circle"} size={14} style={{ color: d.status === "uploaded" ? "var(--green)" : "var(--ink-4)" }} />{d.label}</div>)}
      </PlaybookCard>

      {p.diagrams.length > 0 && (
        <PlaybookCard title="Workflows">
          {p.diagrams.map((d, i) => <div key={i} style={{ fontSize: 13, padding: "3px 0" }}><Icon name="route" size={13} /> <strong>{d.name}</strong> <span style={{ color: "var(--ink-4)" }}>· {d.nodes.length} steps</span></div>)}
        </PlaybookCard>
      )}

      {p.intake && (
        <PlaybookCard title="Intake form">
          {Object.entries(p.intake).map(([k, v]) => row(k, v))}
        </PlaybookCard>
      )}
    </>
  );
}

function DocBuilderModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const [labels, setLabels] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, start] = useTransition();
  const supabase = createClient();

  useEffect(() => {
    supabase.from("documents").select("label").eq("run_id", runId).order("created_at").then(({ data }) => {
      setLabels((data ?? []).map((d) => d.label));
      setLoaded(true);
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Set the document list</h3><div className="sub">What the client must upload. Shown in their portal checklist.</div></div>
        <div className="bd" style={{ maxHeight: "60vh" }}>
          {!loaded ? <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div> : (
            <>
              {labels.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input value={l} onChange={(e) => setLabels((a) => a.map((x, j) => (j === i ? e.target.value : x)))} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13 }} />
                  <button className="icon-btn" onClick={() => setLabels((a) => a.filter((_, j) => j !== i))} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button>
                </div>
              ))}
              <button className="add-link" onClick={() => setLabels((a) => [...a, ""])}><Icon name="plus" size={12} /> Add document</button>
            </>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => start(async () => { const r = await saveDocuments(runId, stepId, labels); if (!r.error) onDone(); })}>{saving ? "Saving…" : "Save document list"}</button>
        </div>
      </div>
    </div>
  );
}

const UAE_BANKS = ["Emirates NBD", "First Abu Dhabi Bank", "ADCB", "Dubai Islamic Bank", "Mashreq", "RAKBANK", "ADIB", "Commercial Bank of Dubai", "Emirates Islamic", "Sharjah Islamic Bank", "NBF", "Ajman Bank", "Wio Bank", "HSBC UAE", "Citibank"];
const GATEWAYS = ["Telr", "Network International", "Stripe", "PayPal", "Checkout.com", "Amazon Payment Services", "Tap", "Ziina", "Mamo"];
const SOFTWARE = ["Zoho Books", "QuickBooks", "Xero", "Tally", "Odoo", "SAP", "Oracle NetSuite", "Wafeq", "Excel / Spreadsheets", "None / Other"];
const YESNO = ["Yes", "No", "In progress", "Not applicable"];

function IntakeBuilderModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const supabase = createClient();
  const [enabled, setEnabled] = useState(true);
  const [gen, setGen] = useState(false);
  const [saving, start] = useTransition();
  const [f, setF] = useState<IntakePrep>({ enabled: true, description: "", revenue: [], expense: [], banks: [], gateways: [], vat: "", ct: "", wps: "", software: "", painPoints: "", stakeholders: "", reports: "", employees: "" });

  useEffect(() => {
    supabase.from("intake_forms").select("prefilled").eq("run_id", runId).maybeSingle().then(({ data }) => {
      const p = data?.prefilled as IntakePrep | undefined;
      if (p && Object.keys(p).length) { setF((s) => ({ ...s, ...p })); setEnabled(p.enabled ?? true); }
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const set = (k: keyof IntakePrep, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const toggleArr = (k: "banks" | "gateways", v: string) => setF((s) => { const a = new Set(s[k] ?? []); a.has(v) ? a.delete(v) : a.add(v); return { ...s, [k]: [...a] }; });
  const lines = (v?: string[]) => (v ?? []).join("\n");
  const genDesc = async () => { setGen(true); const r = await generateBusinessDescription(runId); setGen(false); if (r.text) set("description", r.text); else if (r.error) set("description", "AI: " + r.error); };

  const Pills = ({ k, list }: { k: "banks" | "gateways"; list: string[] }) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {[...new Set([...list, ...(f[k] ?? [])])].map((b) => (
        <button key={b} type="button" className={"tab-pill" + ((f[k] ?? []).includes(b) ? " active" : "")} onClick={() => toggleArr(k, b)}>{b}</button>
      ))}
      <input placeholder="+ add" onKeyDown={(e) => { if (e.key === "Enter" && e.currentTarget.value.trim()) { toggleArr(k, e.currentTarget.value.trim()); e.currentTarget.value = ""; } }} style={{ border: "1px dashed var(--border-strong)", borderRadius: 999, padding: "4px 10px", fontSize: 12, width: 90 }} />
    </div>
  );
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="field"><label>{label}</label>{children}</div>
  );

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Prepare intake form</h3><div className="sub">AI researches the business; you edit, pick what applies, and the client confirms in their portal.</div></div>
        <div className="bd" style={{ maxHeight: "68vh" }}>
          <div className="radio-row">
            <label className={"radio" + (enabled ? " selected" : "")}><input type="radio" checked={enabled} onChange={() => setEnabled(true)} /><div><div className="r-ttl">Send an intake form</div><div className="r-desc">Client confirms/edits in their portal before the call.</div></div></label>
            <label className={"radio" + (!enabled ? " selected" : "")}><input type="radio" checked={!enabled} onChange={() => setEnabled(false)} /><div><div className="r-ttl">Skip the intake form</div></div></label>
          </div>

          {enabled && (
            <>
              <Field label="Business description (AI — editable)">
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <button className="btn-ai" type="button" disabled={gen} onClick={genDesc}><Icon name="sparkles" size={13} /> {gen ? "Researching…" : "Research with AI"}</button>
                </div>
                <textarea className="notes" value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="What we understood about the client's business…" style={{ minHeight: 90 }} />
              </Field>
              <Field label="Revenue channels (one per line)"><textarea className="notes" value={lines(f.revenue)} onChange={(e) => set("revenue", e.target.value.split("\n").filter(Boolean))} placeholder="In-store sales&#10;Online store&#10;Delivery" /></Field>
              <Field label="Expense channels (one per line)"><textarea className="notes" value={lines(f.expense)} onChange={(e) => set("expense", e.target.value.split("\n").filter(Boolean))} placeholder="Inventory purchases&#10;Rent&#10;Salaries / WPS" /></Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <Field label="VAT registered"><select value={f.vat ?? ""} onChange={(e) => set("vat", e.target.value)}><option value="">—</option>{YESNO.map((y) => <option key={y}>{y}</option>)}</select></Field>
                <Field label="Corporate Tax"><select value={f.ct ?? ""} onChange={(e) => set("ct", e.target.value)}><option value="">—</option>{YESNO.map((y) => <option key={y}>{y}</option>)}</select></Field>
                <Field label="WPS / Payroll"><select value={f.wps ?? ""} onChange={(e) => set("wps", e.target.value)}><option value="">—</option>{YESNO.map((y) => <option key={y}>{y}</option>)}</select></Field>
              </div>
              <Field label="Employee details"><input value={f.employees ?? ""} onChange={(e) => set("employees", e.target.value)} placeholder="e.g. 45 employees, payroll outsourced" /></Field>
              <Field label="Bank accounts"><Pills k="banks" list={UAE_BANKS} /></Field>
              <Field label="Payment gateways"><Pills k="gateways" list={GATEWAYS} /></Field>
              <Field label="Accounting software"><select value={f.software ?? ""} onChange={(e) => set("software", e.target.value)}><option value="">—</option>{SOFTWARE.map((s) => <option key={s}>{s}</option>)}</select></Field>
              <Field label="Pain points"><textarea className="notes" value={f.painPoints ?? ""} onChange={(e) => set("painPoints", e.target.value)} placeholder="What's hurting today?" /></Field>
              <Field label="Stakeholders (who we report to)"><input value={f.stakeholders ?? ""} onChange={(e) => set("stakeholders", e.target.value)} placeholder="e.g. Owner, Finance Manager" /></Field>
              <Field label="Reports the client needs"><input value={f.reports ?? ""} onChange={(e) => set("reports", e.target.value)} placeholder="e.g. Monthly P&L, cash flow, VAT" /></Field>
            </>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => start(async () => {
            const r = await saveIntakePrep(runId, stepId, { ...f, enabled });
            if (!r.error) onDone(enabled ? "Intake form prepared & sent to portal" : "Intake form skipped");
          })}>{saving ? "Saving…" : enabled ? "Prepare & send" : "Skip intake"}</button>
        </div>
      </div>
    </div>
  );
}

function DriveBuilderModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const [contractText, setContractText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [ca, setCa] = useState<ContractAnalysis | null>(null);
  const [saving, startSave] = useTransition();

  const analyze = async () => {
    setAnalyzing(true);
    const r = await analyzeContract(runId, contractText);
    setAnalyzing(false);
    if (r.result) { setCa(r.result); if (r.result.periodStart) setStart(r.result.periodStart); if (r.result.periodEnd) setEnd(r.result.periodEnd); }
  };

  const months = (() => {
    if (!start || !end) return [];
    const [sy, sm] = start.split("-").map(Number); const [ey, em] = end.split("-").map(Number);
    const out: string[] = []; let y = sy, m = sm, g = 0;
    const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    while ((y < ey || (y === ey && m <= em)) && g++ < 120) { out.push(`${MN[m - 1]} ${y}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
  })();

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Create & share Drive folders</h3><div className="sub">Paste the engagement contract — AI reads the service period and builds the Books folders for those months.</div></div>
        <div className="bd" style={{ maxHeight: "66vh" }}>
          <div className="field">
            <label>Engagement contract (paste text — optional)</label>
            <textarea className="notes" value={contractText} onChange={(e) => setContractText(e.target.value)} placeholder="Paste the contract / engagement letter text…" style={{ minHeight: 80 }} />
            <button className="btn-ai" type="button" disabled={analyzing || !contractText.trim()} onClick={analyze} style={{ marginTop: 6, alignSelf: "flex-start" }}><Icon name="sparkles" size={13} /> {analyzing ? "Reading…" : "Analyze contract with AI"}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Service period — start</label><input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div className="field"><label>Service period — end</label><input type="month" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
          {ca && (
            <div className="ai-response" style={{ marginTop: 0 }}>
              <div className="hdr"><Icon name="file-text" size={13} /> Contract breakdown</div>
              {ca.scope && <div style={{ marginBottom: 6 }}><strong>Scope:</strong> {ca.scope}</div>}
              {ca.inclusions?.length ? <div><strong>Included:</strong> {ca.inclusions.join(", ")}</div> : null}
              {ca.exclusions?.length ? <div><strong>Excluded:</strong> {ca.exclusions.join(", ")}</div> : null}
              {ca.paymentTerms && <div><strong>Payment:</strong> {ca.paymentTerms}</div>}
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 6 }}>Folders to create</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
              📁 Company Documents · 📁 Books{months.length ? ` (${months.length} months: ${months[0]} → ${months[months.length - 1]})` : ""} · 📁 Financial Documents · 📁 Cleanup · 📁 Others
            </div>
          </div>
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => startSave(async () => {
            const r = await saveDrive(runId, stepId, { periodStart: start || undefined, periodEnd: end || undefined, contract: ca ? (ca as unknown as Record<string, unknown>) : null });
            if (!r.error) onDone();
          })}>{saving ? "Creating…" : "Create folders & share link"}</button>
        </div>
      </div>
    </div>
  );
}
