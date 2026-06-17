"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { useIdentity } from "@/components/identity-context";
import { ASSIGN_ROLES, type TemplateStep, type OnbTemplate } from "@/lib/onboarding-templates";
import { fmtDate } from "@/lib/data/runs";
import type { RunDetail } from "@/lib/data/run-detail";
import { completeStep, assignStepMembers, rollbackToStage, dispatchMagicLink, setTaskStatus, toggleTaskVisible, saveDiagrams, saveRunItems, assignTriage, postMessage, saveDocuments, saveIntakePrep, saveDrive, sendClientEmail, addTask, updateTask, deleteTask, nudgeTeam, saveBoardColumns, saveCallNotes, saveTaskSla, attachTaskFile, notifyClientOnTask, uploadContractFile, type DiagramInput, type RunItemInput, type IntakePrep } from "./actions";

const DEFAULT_BOARD_COLUMNS = ["To do", "In progress", "Review", "Done"];

// Step-permission model: everyone SEES all steps; you can ACT on a step at your
// role or below (higher roles can edit everyone under them; juniors can't edit
// above). Steps with no owning role (System/AI) are open to all. Mirrors the
// server-side guardStepRole so the UI matches what the server will accept.
const STEP_ROLE_RANK: Record<string, number> = { intern: 0, junior: 1, associate: 1, senior: 2, team_lead: 3, am: 4, ops_head: 5, admin: 6 };
const WHO_ROLE: Record<string, string> = {
  am: "am", "account manager": "am",
  senior: "senior", "senior accountant": "senior",
  junior: "junior", "junior accountant": "junior",
  ops: "ops_head", "ops head": "ops_head", "ops manager": "ops_head",
  "team lead": "team_lead", team_lead: "team_lead", teamlead: "team_lead",
  intern: "intern",
};
function stepRequiredRole(step: TemplateStep): string | null {
  if (step.approval?.by) { const r = WHO_ROLE[step.approval.by.trim().toLowerCase()]; if (r) return r; }
  for (const w of step.who ?? []) { const r = WHO_ROLE[w.trim().toLowerCase()]; if (r) return r; }
  if (step.assignRole) return step.assignRole;
  if (step.act?.role) { const r = WHO_ROLE[step.act.role.trim().toLowerCase()]; if (r) return r; }
  return null;
}
function canEditStep(myRole: string, step: TemplateStep): boolean {
  const req = stepRequiredRole(step);
  if (!req) return true;
  return (STEP_ROLE_RANK[myRole] ?? 0) >= (STEP_ROLE_RANK[req] ?? 99);
}
const ROLE_NICE: Record<string, string> = { am: "Account Manager", senior: "Senior", junior: "Junior", team_lead: "Team Lead", ops_head: "Ops", intern: "Intern" };
import { createClient } from "@/lib/supabase/client";
import type { TaskRow } from "@/lib/data/run-detail";
import { generateCoa, saveCoa, generateStepText, saveStepText, generateBusinessDescription, analyzeContract, generateCompliance, generateRecurringTasks, generateDiagram, generateDeck, saveDeck, type CoaLine, type ContractAnalysis, type DeckData } from "./ai-actions";

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
  const [actStep, setActStep] = useState<TemplateStep | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [taskStepPending, setTaskStepPending] = useState<string | null>(null);
  const [chatUnread, setChatUnread] = useState(false);
  const { effectiveRole } = useIdentity();

  useEffect(() => {
    if (chatOpen || !detail.lastMessageAt) { setChatUnread(false); return; }
    try {
      const read = localStorage.getItem(`cadence-chat-read-${detail.runId}`);
      setChatUnread(!read || new Date(read).getTime() < new Date(detail.lastMessageAt).getTime());
    } catch { setChatUnread(false); }
  }, [detail.lastMessageAt, detail.runId, chatOpen]);

  if (!tpl) return <div className="page">Template not found.</div>;

  // People who can own a task (seniors+team-leads and juniors+associates are already merged in detail).
  const taskOwners = [...detail.seniors, ...detail.juniors];

  // Opening a step's action: the task-board step jumps to the board instead of a modal.
  const openAct = (step: TemplateStep) => {
    if (step.act?.type === "taskboard") {
      setTaskStepPending(step.id);
      setTab("tasks");
    } else {
      setActStep(step);
    }
  };

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
          <button className="btn-ghost" style={{ position: "relative" }} onClick={() => setChatOpen(true)}>
            <Icon name="message-square" size={13} /> Chat
            {chatUnread && <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "var(--red)", border: "1.5px solid #fff" }} />}
          </button>
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
                          canEdit={canEditStep(effectiveRole, step)}
                          assignedName={detail.stepState[step.id]?.assignedName ?? null}
                          people={detail.assignPeople}
                          busy={busy}
                          onOpenAct={() => openAct(step)}
                          onAssignMembers={(members) => run(() => assignStepMembers(detail.runId, step.id, members), members.length ? `Assigned ${members.length} ${members.length === 1 ? "person" : "people"}` : "Step skipped")}
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
        <div className="scroll"><div className="page"><TaskBoard
          runId={detail.runId}
          tasks={detail.tasks}
          owners={taskOwners}
          columns={(() => { const c = detail.items["board_columns"]?.[0]?.data?.columns; return Array.isArray(c) && c.length ? (c as string[]) : DEFAULT_BOARD_COLUMNS; })()}
          sla={(detail.items["task_sla"]?.[0]?.data as { notStartedDays?: number; notCompletedDays?: number } | undefined) ?? null}
          confirmStepId={taskStepPending}
          onOpenChat={() => setChatOpen(true)}
          onConfirmStep={() => {
            const id = taskStepPending;
            setTaskStepPending(null);
            setTab("team");
            if (id) run(() => completeStep(detail.runId, id), "Task board confirmed — step complete");
          }}
        /></div></div>
      ) : tab === "playbook" ? (
        <div className="scroll"><div className="page" style={{ maxWidth: 900 }}><Playbook detail={detail} /></div></div>
      ) : (
        <div className="scroll"><div className="page" style={{ maxWidth: 900 }}>
          <ClientPortalTab detail={detail} onOpenChat={() => setChatOpen(true)} />
        </div></div>
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

      {actStep && actStep.act?.type === "deck" && (
        <DeckModal
          runId={detail.runId}
          onClose={() => setActStep(null)}
          onDone={() => { const s = actStep; setActStep(null); showToast("Onboarding deck saved"); run(() => completeStep(detail.runId, s.id), `${s.title} — done`); }}
        />
      )}

      {actStep && ["agenda", "ai", "mom"].includes(actStep.act?.type ?? "") && (
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
          onSaveCall={(recording, notes) => {
            const s = actStep;
            setActStep(null);
            run(() => saveCallNotes(detail.runId, s.id, recording, notes), `${s.title} — saved`);
          }}
          onRework={() => {
            const s = actStep;
            const stageNo = tpl.stages.findIndex((st) => st.steps.some((x) => x.id === s.id)) + 1;
            setActStep(null);
            run(() => rollbackToStage(detail.runId, stageNo), "Sent back for rework");
          }}
        />
      )}

      <RunChat runId={detail.runId} open={chatOpen} onClose={() => setChatOpen(false)} tasks={detail.tasks} />

      {toast && (
        <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>
      )}
    </div>
  );
}

function RunChat({ runId, open, onClose, tasks = [] }: { runId: string; open: boolean; onClose: () => void; tasks?: { title: string }[] }) {
  const [messages, setMessages] = useState<{ id: string; author_name: string | null; author_role: string | null; body: string; created_at: string; task_ref: string | null }[]>([]);
  const [text, setText] = useState("");
  const [taskRef, setTaskRef] = useState("");
  const [busy, start] = useTransition();
  const supabase = createClient();

  const load = async () => {
    const { data } = await supabase.from("run_messages").select("id,author_name,author_role,body,created_at,task_ref").eq("run_id", runId).order("created_at");
    setMessages(data ?? []);
  };
  useEffect(() => {
    if (open) {
      load();
      try { localStorage.setItem(`cadence-chat-read-${runId}`, new Date().toISOString()); } catch {}
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [open]);

  const send = () => {
    if (!text.trim()) return;
    const body = text; const ref = taskRef || null;
    setText("");
    start(async () => { await postMessage(runId, body, ref); await load(); try { localStorage.setItem(`cadence-chat-read-${runId}`, new Date().toISOString()); } catch {} });
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
                <div style={{ fontSize: 12, fontWeight: 700 }}>{m.author_name ?? "Someone"} <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {m.author_role === "Client" ? "Client · " : ""}{new Date(m.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
                {m.task_ref && <span className="pill blue" style={{ fontSize: 10, padding: "1px 7px", marginTop: 3, display: "inline-flex" }}><Icon name="tag" size={10} /> {m.task_ref}</span>}
                <div style={{ fontSize: 13, color: "var(--ink-1)", marginTop: 2 }}>{m.body}</div>
              </div>
            ))
          )}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
          {tasks.length > 0 && (
            <select value={taskRef} onChange={(e) => setTaskRef(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 9px", fontSize: 12.5 }}>
              <option value="">Tag a task (optional)…</option>
              {tasks.map((t, i) => <option key={i} value={t.title}>{t.title}</option>)}
            </select>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message the team…" style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
            <button className="btn-primary" onClick={send} disabled={busy || !text.trim()}><Icon name="send" size={14} /></button>
          </div>
        </div>
      </aside>
    </>
  );
}

function RunStepModal({
  runId, step, busy, onClose, onConfirm, onSaveCall, onRework,
}: {
  runId: string;
  step: TemplateStep;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onSaveCall?: (recording: string, notes: string) => void;
  onRework: () => void;
}) {
  const act = step.act;
  const type = act?.type ?? "confirm";
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState("");
  const [notes, setNotes] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [items, setItems] = useState<string[]>(act?.items ?? []);
  const [cover, setCover] = useState<string[]>(act?.cover ?? []);

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
          <div key={i} className={"check-row" + (checked["i" + i] ? " checked" : "")} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={!!checked["i" + i]} onChange={(e) => setChecked((c) => ({ ...c, ["i" + i]: e.target.checked }))} />
            <input value={it} onChange={(e) => setItems((a) => a.map((x, j) => (j === i ? e.target.value : x)))} style={{ flex: 1, border: "1px solid transparent", borderRadius: 6, padding: "3px 6px", fontSize: 13, background: "transparent" }} onFocus={(e) => (e.currentTarget.style.borderColor = "var(--border)")} onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")} />
            <button className="icon-btn" onClick={() => { setItems((a) => a.filter((_, j) => j !== i)); setChecked((c) => { const n = { ...c }; delete n["i" + i]; return n; }); }} style={{ color: "var(--red)" }} aria-label="Delete item"><Icon name="x" size={13} /></button>
          </div>
        ))}
        <button className="add-link" onClick={() => setItems((a) => [...a, "New item"])} style={{ marginTop: 4 }}><Icon name="plus" size={12} /> Add item</button>
      </div>
    );
  } else if (type === "call") {
    canConfirm = allCoverDone && recording.trim().length > 0;
    body = (
      <>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Coverage — add, edit or remove points</div>
        <div className="checklist">
          {cover.map((it, i) => (
            <div key={i} className={"check-row" + (checked["c" + i] ? " checked" : "")} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={!!checked["c" + i]} onChange={(e) => setChecked((c) => ({ ...c, ["c" + i]: e.target.checked }))} />
              <input value={it} onChange={(e) => setCover((a) => a.map((x, j) => (j === i ? e.target.value : x)))} style={{ flex: 1, border: "1px solid transparent", borderRadius: 6, padding: "3px 6px", fontSize: 13, background: "transparent" }} onFocus={(e) => (e.currentTarget.style.borderColor = "var(--border)")} onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")} />
              <button className="icon-btn" onClick={() => { setCover((a) => a.filter((_, j) => j !== i)); setChecked((c) => { const n = { ...c }; delete n["c" + i]; return n; }); }} style={{ color: "var(--red)" }} aria-label="Delete point"><Icon name="x" size={13} /></button>
            </div>
          ))}
          <button className="add-link" onClick={() => setCover((a) => [...a, "New discussion point"])} style={{ marginTop: 4 }}><Icon name="plus" size={12} /> Add point</button>
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
          <button className="btn-primary" onClick={type === "call" && onSaveCall ? () => onSaveCall(recording, notes) : onConfirm} disabled={busy || !canConfirm}>{confirmLabel}</button>
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

const ROLE_LBL: Record<string, string> = { team_lead: "Team Lead", senior: "Senior", junior: "Junior", associate: "Associate", intern: "Intern", am: "AM", ops_head: "Ops" };
const ROLE_ORDER = ["team_lead", "senior", "junior", "associate", "intern"];

function AssignPicker({
  people, primaryRole, optional, busy, onAssign,
}: {
  people: { id: string; name: string; role: string }[];
  primaryRole?: string;
  optional: boolean;
  busy: boolean;
  onAssign: (members: { id: string; name: string; role: string }[]) => void;
}) {
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const primary = (primaryRole ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  const sorted = [...people].sort((a, b) => {
    const ap = a.role === primary ? 0 : 1, bp = b.role === primary ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ar = ROLE_ORDER.indexOf(a.role), br = ROLE_ORDER.indexOf(b.role);
    if (ar !== br) return (ar < 0 ? 99 : ar) - (br < 0 ? 99 : br);
    return a.name.localeCompare(b.name);
  });
  const filtered = q ? sorted.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())) : sorted;
  const chosen = people.filter((p) => sel[p.id]);
  const count = chosen.length;
  return (
    <div style={{ width: "100%", maxWidth: 470, border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "#fff" }}>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
        Assign {primaryRole ? <strong>{primaryRole}</strong> : "people"} — pick one or more.{optional ? " Optional." : ""}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 12.5, marginBottom: 8 }} />
      <div style={{ maxHeight: 190, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {filtered.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-3)", padding: 8 }}>No matching people.</div>}
        {filtered.map((p) => (
          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", borderRadius: 7, cursor: "pointer", fontSize: 13, background: sel[p.id] ? "var(--bg)" : "transparent" }}>
            <input type="checkbox" checked={!!sel[p.id]} onChange={(e) => setSel((s) => ({ ...s, [p.id]: e.target.checked }))} style={{ accentColor: "var(--orange)" }} />
            <span style={{ flex: 1 }}>{p.name}</span>
            <span className="pill gray" style={{ fontSize: 10, padding: "1px 7px" }}>{ROLE_LBL[p.role] ?? p.role}</span>
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button className="btn-primary" disabled={busy || count === 0} onClick={() => onAssign(chosen.map((c) => ({ id: c.id, name: c.name, role: c.role })))}>
          Assign{count ? ` ${count}` : ""}
        </button>
        {optional && <button className="btn-ghost" disabled={busy} onClick={() => onAssign([])}>Skip (optional)</button>}
      </div>
    </div>
  );
}

function StepBox({
  step, assignRole, status, isActive, canEdit, assignedName, people, busy, onOpenAct, onAssignMembers,
}: {
  step: TemplateStep;
  assignRole: string | null;
  status: string;
  isActive: boolean;
  canEdit: boolean;
  assignedName: string | null;
  people: { id: string; name: string; role: string }[];
  busy: boolean;
  onOpenAct: () => void;
  onAssignMembers: (members: { id: string; name: string; role: string }[]) => void;
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

          {/* Actions: any incomplete step the current role may edit (own + below),
              regardless of whether earlier steps are done. */}
          {!done && canEdit && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {isAssign ? (
                <AssignPicker
                  people={people}
                  primaryRole={step.act?.role}
                  optional={!!step.act?.optional}
                  busy={busy}
                  onAssign={onAssignMembers}
                />
              ) : (
                <button className="btn-primary" disabled={busy} onClick={onOpenAct}>
                  {step.act?.btn ?? "Mark done"}
                </button>
              )}
            </div>
          )}
          {!done && !canEdit && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="lock" size={12} /> {stepRequiredRole(step) ? `${ROLE_NICE[stepRequiredRole(step)!] ?? stepRequiredRole(step)}'s step — view only` : "View only"}
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

function ClientPortalTab({ detail, onOpenChat }: { detail: RunDetail; onOpenChat: () => void }) {
  const [copied, setCopied] = useState(false);
  const visible = detail.tasks.filter((t) => t.clientVisible);
  const cols = (detail.items["board_columns"]?.[0]?.data?.columns as string[] | undefined) ?? null;
  const link = detail.portalLink;
  const docs = detail.playbook.documents;
  const docReceived = docs.filter((d) => d.status === "uploaded").length;
  const intakeSubmitted = !!detail.playbook.intake;
  const coaSignedOff = !!detail.playbook.coa?.signedOff;

  const groups: { label: string; items: typeof visible }[] = cols && cols.length
    ? cols.map((c) => ({ label: c, items: visible.filter((t) => (t.boardColumn && cols.includes(t.boardColumn) ? t.boardColumn : cols[0]) === c) }))
    : [
        { label: "Needs client input", items: visible.filter((t) => t.status === "needs_input") },
        { label: "In progress", items: visible.filter((t) => t.status === "in_progress" || t.status === "not_started") },
        { label: "Done", items: visible.filter((t) => t.status === "complete") },
      ];

  const copyLink = () => {
    if (!link) return;
    const url = `${window.location.origin}/portal/${link.token}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <div className="section-head">
        <div>
          <h2 style={{ fontSize: 16 }}>Client portal — live mirror</h2>
          <div className="sub">Exactly what {detail.clientName} sees, and what they&apos;ve done. Updates here in real time.</div>
        </div>
        <button className="btn-ghost" onClick={onOpenChat}><Icon name="message-square" size={13} /> Open chat</button>
      </div>

      {/* Access */}
      <div className="runs-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center" }}><Icon name="lock" size={15} /></span>
          {link ? (
            <>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Secure link active</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Opens only with a code sent to <strong>{link.email ?? "the client email"}</strong></div>
              </div>
              <button className="btn-ghost" onClick={copyLink}><Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy link"}</button>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Portal link not dispatched yet — send it from the <strong>Send Magic Link</strong> stage.</div>
          )}
        </div>
      </div>

      {/* Progress chips */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <MirrorChip icon="file-text" label="Documents" value={`${docReceived}/${docs.length} received`} done={docs.length > 0 && docReceived === docs.length} />
        <MirrorChip icon="clipboard-list" label="Intake form" value={intakeSubmitted ? "Submitted" : "Awaiting client"} done={intakeSubmitted} />
        <MirrorChip icon="check-circle" label="COA sign-off" value={coaSignedOff ? "Signed off" : "Pending"} done={coaSignedOff} />
      </div>

      {/* Client-visible board */}
      <div className="runs-card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Task board the client sees</div>
        {visible.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>No client-visible tasks yet. On the Task Board, tick &quot;Client sees&quot; to share a task here.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(groups.length, 4)}, 1fr)`, gap: 10 }}>
            {groups.map((g) => (
              <div key={g.label} style={{ background: "var(--bg-soft)", borderRadius: 10, padding: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)", marginBottom: 8 }}>{g.label} · {g.items.length}</div>
                {g.items.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-4)" }}>—</div>}
                {g.items.map((t, i) => (
                  <div key={i} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, marginBottom: 6 }}>{t.title}</div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Documents */}
      {docs.length > 0 && (
        <div className="runs-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Documents</div>
          {docs.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 13 }}>
              <span style={{ color: d.status === "uploaded" ? "var(--green)" : "var(--ink-4)" }}><Icon name={d.status === "uploaded" ? "check-circle" : "circle"} size={14} /></span>
              <span style={{ flex: 1 }}>{d.label}</span>
              <span className={"pill " + (d.status === "uploaded" ? "green" : "gray")} style={{ fontSize: 10 }}>{d.status === "uploaded" ? "Received" : "Pending"}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MirrorChip({ icon, label, value, done }: { icon: string; label: string; value: string; done: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}><Icon name={icon} size={12} /> {label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: done ? "var(--green)" : "var(--ink-1)" }}>{value}</div>
    </div>
  );
}

const TASK_STATUSES = ["not_started", "in_progress", "complete", "needs_input", "blocked"];
const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started", in_progress: "In progress", complete: "Complete",
  needs_input: "Needs input", blocked: "Blocked",
};

const TASK_TYPES = ["internal", "client_action", "milestone"];
const TASK_TYPE_LABEL: Record<string, string> = { internal: "Internal", client_action: "Client action", milestone: "Milestone" };
const inputStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5, width: "100%" };

function TaskBoard({
  runId, tasks, owners, columns, sla, confirmStepId, onConfirmStep, onOpenChat,
}: {
  runId: string;
  tasks: TaskRow[];
  owners: { id: string; name: string }[];
  columns: string[];
  sla: { notStartedDays?: number; notCompletedDays?: number } | null;
  confirmStepId: string | null;
  onConfirmStep: () => void;
  onOpenChat: () => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudgeMsg, setNudgeMsg] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [colMgr, setColMgr] = useState<string[] | null>(null); // non-null = modal open with draft
  const [slaOpen, setSlaOpen] = useState(false);
  const [taskFilter, setTaskFilter] = useState<"all" | "active" | "done">("all");
  const [chatTask, setChatTask] = useState<string | null>(null); // per-task chat modal
  const shownTasks = tasks.filter((t) => taskFilter === "all" ? true : taskFilter === "done" ? t.status === "complete" : t.status !== "complete");
  const [slaStart, setSlaStart] = useState(String(sla?.notStartedDays ?? 1));
  const [slaDone, setSlaDone] = useState(String(sla?.notCompletedDays ?? 7));

  const change = (fn: () => Promise<{ error?: string }>) =>
    start(async () => { const r = await fn(); if (r?.error) { setToast(r.error); setTimeout(() => setToast(null), 2400); } router.refresh(); });

  const titleOf = (t: TaskRow) => (titles[t.id] !== undefined ? titles[t.id] : t.title);

  const sendNudge = () =>
    start(async () => {
      const r = await nudgeTeam(runId, nudgeMsg);
      setNudgeOpen(false); setNudgeMsg("");
      setToast(r.error ? r.error : `Team nudged${r.notified ? ` (${r.notified})` : ""}`);
      setTimeout(() => setToast(null), 2400);
      router.refresh();
    });

  return (
    <>
      <div className="section-head">
        <div>
          <h2 style={{ fontSize: 16 }}>Task board</h2>
          <div className="sub">Replaces the PMS during onboarding. Add, edit and delete tasks; toggle what the client sees.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-ghost" onClick={onOpenChat}><Icon name="message-square" size={13} /> Chat</button>
          <button className="btn-ghost" onClick={() => setNudgeOpen(true)}><Icon name="bell" size={13} /> Nudge team</button>
          <button className="btn-ghost" onClick={() => setColMgr([...columns])}><Icon name="columns" size={13} /> Manage columns</button>
          <button className="btn-ghost" onClick={() => setSlaOpen(true)}><Icon name="bell-ring" size={13} /> Reminders</button>
          <button className="btn-primary" disabled={busy} onClick={() => change(() => addTask(runId, { title: "New task", boardColumn: columns[0] }))}>
            <Icon name="plus" size={14} /> Add task
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Show:</span>
        {([["all", "All"], ["active", "Relevant (open)"], ["done", "Completed"]] as const).map(([k, l]) => (
          <button key={k} className={"tab-pill" + (taskFilter === k ? " active" : "")} onClick={() => setTaskFilter(k)}>
            {l} · {k === "all" ? tasks.length : k === "done" ? tasks.filter((t) => t.status === "complete").length : tasks.filter((t) => t.status !== "complete").length}
          </button>
        ))}
      </div>

      <div className="runs-card">
        <table className="runs-table">
          <thead><tr><th style={{ minWidth: 200 }}>Task</th><th>Owner</th><th>Column</th><th>Type</th><th>Due</th><th>Client sees</th><th>Status</th><th>Chat</th><th></th></tr></thead>
          <tbody>
            {shownTasks.map((t) => (
              <tr key={t.id}>
                <td>
                  <input
                    value={titleOf(t)}
                    disabled={busy}
                    onChange={(e) => setTitles((m) => ({ ...m, [t.id]: e.target.value }))}
                    onBlur={() => { if (titleOf(t).trim() && titleOf(t) !== t.title) change(() => updateTask(runId, t.id, { title: titleOf(t) })); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    style={{ ...inputStyle, fontWeight: 600 }}
                  />
                </td>
                <td>
                  <select
                    value={t.ownerKind === "client" ? "client" : t.ownerId ?? ""}
                    disabled={busy}
                    onChange={(e) => { const v = e.target.value; change(() => updateTask(runId, t.id, v === "client" ? { ownerKind: "client" } : { ownerKind: "team", ownerId: v || null })); }}
                    style={{ ...inputStyle, minWidth: 130 }}
                  >
                    <option value="">Unassigned</option>
                    <option value="client">Client</option>
                    {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    value={t.boardColumn && columns.includes(t.boardColumn) ? t.boardColumn : columns[0]}
                    disabled={busy}
                    onChange={(e) => change(() => updateTask(runId, t.id, { boardColumn: e.target.value }))}
                    style={{ ...inputStyle, minWidth: 110 }}
                  >
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td>
                  <select value={t.type} disabled={busy} onChange={(e) => change(() => updateTask(runId, t.id, { type: e.target.value }))} style={inputStyle}>
                    {TASK_TYPES.map((s) => <option key={s} value={s}>{TASK_TYPE_LABEL[s]}</option>)}
                  </select>
                </td>
                <td>
                  <input
                    defaultValue={t.due ?? ""}
                    disabled={busy}
                    placeholder="e.g. Day 4"
                    onBlur={(e) => { if ((e.target.value || "") !== (t.due ?? "")) change(() => updateTask(runId, t.id, { due: e.target.value })); }}
                    style={{ ...inputStyle, width: 90 }}
                  />
                </td>
                <td><input type="checkbox" checked={t.clientVisible} disabled={busy} onChange={(e) => change(() => toggleTaskVisible(runId, t.id, e.target.checked))} style={{ accentColor: "var(--orange)" }} /></td>
                <td>
                  <select value={t.status} disabled={busy} onChange={(e) => change(() => setTaskStatus(runId, t.id, e.target.value))} style={inputStyle}>
                    {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                  </select>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <button className="icon-btn" disabled={busy} title="Open task chat" onClick={() => setChatTask(t.title)} aria-label="Task chat"><Icon name="message-square" size={14} /></button>
                    {(t.status === "needs_input" || t.status === "blocked") && (
                      <button className="icon-btn" disabled={busy} title="Notify the client this needs their input" onClick={() => change(() => notifyClientOnTask(runId, t.title))} style={{ color: "var(--orange)" }} aria-label="Notify client"><Icon name="at-sign" size={14} /></button>
                    )}
                  </div>
                </td>
                <td>
                  <button className="icon-btn" disabled={busy} onClick={() => change(() => deleteTask(runId, t.id))} style={{ color: "var(--red)" }} aria-label="Delete task"><Icon name="trash-2" size={14} /></button>
                </td>
              </tr>
            ))}
            {!shownTasks.length && <tr><td colSpan={9} style={{ textAlign: "center", padding: 40, color: "var(--ink-3)" }}>{tasks.length ? "No tasks match this filter." : "No tasks yet — click “Add task”."}</td></tr>}
          </tbody>
        </table>
      </div>

      {confirmStepId && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14, gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Done setting the board?</span>
          <button className="btn-primary" disabled={busy} onClick={onConfirmStep}><Icon name="check" size={14} /> Save &amp; confirm step</button>
        </div>
      )}

      {colMgr !== null && (
        <div className="modal-overlay open" onClick={() => setColMgr(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd"><h3>Manage board columns</h3><div className="sub">Add, rename or remove the columns. Tasks in a removed column move to the first column.</div></div>
            <div className="bd" style={{ maxHeight: "56vh" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {colMgr.map((col, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: "var(--ink-4)", fontSize: 12, width: 18 }}>{i + 1}</span>
                    <input value={col} onChange={(e) => setColMgr((cs) => cs!.map((c, j) => (j === i ? e.target.value : c)))} style={{ ...inputStyle, flex: 1 }} />
                    <button className="icon-btn" disabled={colMgr.length <= 1} onClick={() => setColMgr((cs) => cs!.filter((_, j) => j !== i))} style={{ color: "var(--red)" }} aria-label="Remove column"><Icon name="trash-2" size={14} /></button>
                  </div>
                ))}
              </div>
              <button className="add-link" onClick={() => setColMgr((cs) => [...cs!, "New column"])} style={{ marginTop: 10 }}><Icon name="plus" size={12} /> Add column</button>
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setColMgr(null)} disabled={busy}>Cancel</button>
              <button className="btn-primary" disabled={busy || !colMgr.some((c) => c.trim())} onClick={() => { const cols = colMgr; setColMgr(null); change(() => saveBoardColumns(runId, cols)); }}>Save columns</button>
            </div>
          </div>
        </div>
      )}

      {slaOpen && (
        <div className="modal-overlay open" onClick={() => setSlaOpen(false)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd"><h3>Task reminders</h3><div className="sub">Automatically notify the AM when a task stalls. Set 0 to turn a reminder off. Checked once a day.</div></div>
            <div className="bd">
              <div className="field">
                <label>Notify AM if a task is not started after (days)</label>
                <input type="number" min={0} value={slaStart} onChange={(e) => setSlaStart(e.target.value)} />
              </div>
              <div className="field">
                <label>Notify AM if a task is not completed after (days)</label>
                <input type="number" min={0} value={slaDone} onChange={(e) => setSlaDone(e.target.value)} />
              </div>
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setSlaOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn-primary" disabled={busy} onClick={() => { const a = parseInt(slaStart, 10) || 0, b = parseInt(slaDone, 10) || 0; setSlaOpen(false); change(() => saveTaskSla(runId, a, b)); }}>Save reminders</button>
            </div>
          </div>
        </div>
      )}

      {nudgeOpen && (
        <div className="modal-overlay open" onClick={() => setNudgeOpen(false)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd"><h3>Nudge the team</h3><div className="sub">Posts to the run chat and notifies task owners + the AM.</div></div>
            <div className="bd">
              <div className="field"><label>Message</label>
                <textarea className="notes" value={nudgeMsg} onChange={(e) => setNudgeMsg(e.target.value)} placeholder="e.g. Please move your tasks forward today — client is waiting." />
              </div>
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setNudgeOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={sendNudge} disabled={busy}>Send nudge</button>
            </div>
          </div>
        </div>
      )}

      {chatTask && <TeamTaskChat runId={runId} task={chatTask} onClose={() => setChatTask(null)} />}

      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </>
  );
}

/* Per-task chat (team side) — the same run thread, filtered to one task, with file attach. */
function TeamTaskChat({ runId, task, onClose }: { runId: string; task: string; onClose: () => void }) {
  const [messages, setMessages] = useState<{ id: string; author_name: string | null; author_role: string | null; body: string; created_at: string }[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  const load = async () => {
    const { data } = await supabase.from("run_messages").select("id,author_name,author_role,body,created_at").eq("run_id", runId).eq("task_ref", task).order("created_at");
    setMessages(data ?? []);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [task]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    await postMessage(runId, body, task);
    await load();
  };
  const attach = async (files: FileList) => {
    setBusy(true);
    for (const file of Array.from(files)) { const fd = new FormData(); fd.append("file", file); await attachTaskFile(runId, task, fd); }
    setBusy(false);
    await load();
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>{task}</h3><div className="sub">Task thread — shared with the client if this task is client-visible. Attachments save to the client&apos;s Drive.</div></div>
        <div className="bd" style={{ maxHeight: "56vh" }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "var(--ink-3)", fontSize: 13 }}>No messages on this task yet.</div>
          ) : messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{m.author_name ?? "Someone"} <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {m.author_role === "Client" ? "Client · " : ""}{new Date(m.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
              <div style={{ fontSize: 13, color: "var(--ink-1)", marginTop: 2, wordBreak: "break-word" }}>{m.body}</div>
            </div>
          ))}
        </div>
        <div className="ft" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Message about this task…" style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
            <button className="btn-primary" onClick={send} disabled={busy || !text.trim()}><Icon name="send" size={14} /></button>
          </div>
          <label className="btn-ghost" style={{ cursor: busy ? "default" : "pointer", justifyContent: "center" }}>
            <Icon name="paperclip" size={13} /> {busy ? "Attaching…" : "Attach documents"}
            <input type="file" hidden multiple disabled={busy} onChange={(e) => { const f = e.target.files; if (f && f.length) attach(f); e.target.value = ""; }} />
          </label>
        </div>
      </div>
    </div>
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
  project: [{ k: "task", l: "Task" }, { k: "cadence", l: "Cadence" }, { k: "when", l: "When" }],
  compliance: [{ k: "label", l: "Item" }, { k: "date", l: "Due date" }, { k: "type", l: "Type", opts: ["VAT", "CT", "WPS", "Doc expiry", "Other"] }],
};
const CADENCES = ["daily", "weekly", "biweekly", "monthly"];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ITEM_TITLE: Record<string, string> = { catchup: "Catch-up board", project: "Internal projects & tasks", compliance: "Compliance calendar" };

function ItemsBuilderModal({
  runId, stepId, kind, existing, onClose, onDone,
}: {
  runId: string; stepId: string; kind: string;
  existing: { id: string; data: Record<string, unknown>; status: string }[];
  onClose: () => void; onDone: () => void;
}) {
  const fields = ITEM_FIELDS[kind];
  const blankRow = () => kind === "project" ? { task: "", cadence: "monthly", when: "" } : Object.fromEntries(fields.map((f) => [f.k, ""]));
  const [rows, setRows] = useState<Record<string, string>[]>(existing.length ? existing.map((e) => e.data as Record<string, string>) : [blankRow()]);
  const [saving, start] = useTransition();
  const [aiBusy, setAiBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [pBrief, setPBrief] = useState(""); // project AI: plain-language task list

  const setCell = (i: number, k: string, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const addRow = () => setRows((r) => [...r, blankRow()]);
  const del = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  const aiCompliance = async () => { setAiBusy(true); setInfo(null); const r = await generateCompliance(runId); setAiBusy(false); if (r.error) setInfo(r.error); else if (r.items?.length) setRows(r.items.map((i) => ({ label: i.label, date: i.date, type: i.type }))); };
  const aiRecurring = async () => { setAiBusy(true); setInfo(null); const r = await generateRecurringTasks(runId, pBrief); setAiBusy(false); if (r.error) setInfo(r.error); else if (r.items?.length) setRows(r.items.map((i) => ({ task: i.task, cadence: CADENCES.includes(i.cadence) ? i.cadence : "monthly", when: i.when }))); };

  const saveItems = (after?: "email") => start(async () => {
    const items: RunItemInput[] = rows.filter((r) => Object.values(r).some((v) => v)).map((r) => ({ data: r, status: "open" }));
    const res = await saveRunItems(runId, stepId, kind, items);
    if (res.error) { setInfo(res.error); return; }
    if (after === "email") {
      const body = "Your compliance calendar:\n\n" + rows.map((r) => `• ${r.label} — ${r.type} — ${r.date}`).join("\n");
      const er = await sendClientEmail(runId, "Your Finanshels compliance calendar", body);
      if (er.error) { setInfo("Saved. Email: " + er.error); return; }
    }
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
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Describe the recurring tasks (optional AI)</div>
              <textarea className="notes" value={pBrief} onChange={(e) => setPBrief(e.target.value)} placeholder="e.g. Document request monthly 5th, bills & sales booking daily, salary processing monthly 25th, weekly sync meeting with client Thursday" style={{ minHeight: 56 }} />
              <button className="btn-ai" disabled={aiBusy || !pBrief.trim()} onClick={aiRecurring} style={{ marginTop: 6 }}><Icon name="sparkles" size={13} /> {aiBusy ? "Reading…" : "Generate tasks with AI"}</button>
            </div>
          )}
          {kind === "project" ? (
            <table className="runs-table" style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
              <thead><tr><th style={{ minWidth: 200 }}>Task</th><th>Cadence</th><th>When</th><th></th></tr></thead>
              <tbody>
                {rows.map((row, i) => {
                  const cad = row.cadence || "monthly";
                  return (
                    <tr key={i}>
                      <td><input value={row.task ?? ""} onChange={(e) => setCell(i, "task", e.target.value)} placeholder="Task name" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, width: "100%" }} /></td>
                      <td>
                        <select value={cad} onChange={(e) => { setCell(i, "cadence", e.target.value); setCell(i, "when", ""); }} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5 }}>
                          {CADENCES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                        </select>
                      </td>
                      <td>
                        {cad === "daily" ? (
                          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>Every day</span>
                        ) : cad === "monthly" ? (
                          <select value={row.when ?? ""} onChange={(e) => setCell(i, "when", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5 }}>
                            <option value="">Which date…</option>
                            {Array.from({ length: 31 }, (_, d) => `${d + 1}`).map((d) => <option key={d} value={d}>{d}</option>)}
                            <option value="Last day">Last day</option>
                          </select>
                        ) : (
                          <select value={row.when ?? ""} onChange={(e) => setCell(i, "when", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5 }}>
                            <option value="">Which day…</option>
                            {WEEKDAYS.map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                        )}
                      </td>
                      <td><button className="icon-btn" onClick={() => del(i)} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
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
          )}
          <button className="add-link" onClick={addRow} style={{ marginTop: 8 }}><Icon name="plus" size={12} /> Add row</button>
          {info && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 8 }}>{info}</div>}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          {kind === "compliance" && <button className="btn-ghost" disabled={saving} onClick={() => saveItems("email")}><Icon name="send" size={13} /> Save & email client</button>}
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

const DECK_PHASES = [
  { n: "01", t: "Kickoff & Discovery", d: "Understanding your business model and financial structure." },
  { n: "02", t: "Compliance Review", d: "CT, VAT and WPS aligned to UAE law." },
  { n: "03", t: "Software Setup", d: "Configuring and optimising your accounting platform." },
  { n: "04", t: "Secure Data", d: "Organising and securing your financial documents." },
  { n: "05", t: "Communication & Go-Live", d: "Channels set, full operations launched." },
];
const DECK_DOCS = ["Trade licence", "MOA & AOA", "Owner passports & Emirates IDs", "CT registration", "VAT certificate (if any)", "Prior financial statements", "Bank statements", "Commercial contracts"];

function deckSlide(d: DeckData, idx: number): React.ReactNode {
  const wu = d.whatWeUnderstood;
  switch (idx) {
    case 0:
      return (
        <div className="fsdeck-slide fsdeck-cover">
          <div className="fsdeck-cover-glow" />
          <div className="fsdeck-cover-body">
            <div className="fsdeck-eyebrow orange">Welcome to Finanshels</div>
            <h1 className="fsdeck-cover-title">Welcome,<br /><span className="o">{d.clientName}</span></h1>
            <div className="fsdeck-cover-mission">{d.mission}</div>
          </div>
          <div className="fsdeck-cover-foot">Finanshels Onboarding · Your partner in financial growth</div>
        </div>
      );
    case 1:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Agenda</div><h2 className="fsdeck-h2">Today&apos;s Agenda</h2></div></div>
          <div className="fsdeck-grid2">
            {d.agenda.map((a, i) => (
              <div key={i} className="fsdeck-card"><div className="fsdeck-card-label">{a.num} · {a.label}</div><div className="fsdeck-card-val">{a.desc}</div></div>
            ))}
          </div>
        </div>
      );
    case 2:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Roadmap</div><h2 className="fsdeck-h2">Your Onboarding Roadmap</h2></div></div>
          <div className="fsdeck-roadmap">{DECK_PHASES.map((p) => (
            <div key={p.n} className="fsdeck-phase"><div className="fsdeck-phase-n">{p.n}</div><div className="fsdeck-phase-t">{p.t}</div><div className="fsdeck-phase-d">{p.d}</div></div>
          ))}</div>
        </div>
      );
    case 3:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Phase 1 · Discovery</div><h2 className="fsdeck-h2">What We Understood</h2><div className="fsdeck-sub">Please confirm this is right.</div></div></div>
          <div className="fsdeck-grid2">{(wu.points ?? []).slice(0, 4).map((p, i) => (
            <div key={i} className="fsdeck-card"><div className="fsdeck-card-label">{p.icon} {p.title}</div><div className="fsdeck-card-val">{p.desc}</div></div>
          ))}</div>
          <div className="fsdeck-understood"><div className="fsdeck-understood-k">✦ What we understood — please confirm</div><div className="fsdeck-understood-v">{wu.summary}</div>
            <div className="fsdeck-services" style={{ marginTop: 8 }}>{(wu.tags ?? []).map((t, i) => <span key={i} className="fsdeck-svc"><span className="dot" />{t}</span>)}</div>
          </div>
        </div>
      );
    case 4:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Phase 2</div><h2 className="fsdeck-h2">Ensuring Compliance</h2></div></div>
          <div className="fsdeck-grid3">
            {[["CT", "Corporate Tax", d.compliance.ct], ["VAT", "VAT Compliance", d.compliance.vat], ["WPS", "WPS / Payroll", d.compliance.wps]].map(([b, t, v]) => (
              <div key={b} className="fsdeck-compliance"><div className="fsdeck-compliance-badge">{b}</div><div className="fsdeck-compliance-t">{t}</div><div className="fsdeck-compliance-d">{v}</div></div>
            ))}
          </div>
        </div>
      );
    case 5:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Phase 3</div><h2 className="fsdeck-h2">Accounting Software</h2></div></div>
          <div className="fsdeck-twocol">
            <div className="fsdeck-softcol"><div className="fsdeck-softcol-h">If you have existing software</div><p>{d.software.existing}</p></div>
            <div className="fsdeck-softcol rec"><div className="fsdeck-softcol-h">Our recommendation · Zoho Books</div><p>{d.software.recommendation}</p></div>
          </div>
        </div>
      );
    case 6:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Phase 4</div><h2 className="fsdeck-h2">Secure Data Management</h2></div></div>
          <div className="fsdeck-twocol">
            <div className="fsdeck-softcol rec"><div className="fsdeck-softcol-h">Our solution</div><p>A dedicated, encrypted Google Drive organised by year and document type — controlled access, easy retrieval.</p></div>
            <div className="fsdeck-doclist"><div className="fsdeck-softcol-h">Documents we&apos;ll need</div><ul>{DECK_DOCS.map((x) => <li key={x}><span className="tick">✓</span>{x}</li>)}</ul></div>
          </div>
        </div>
      );
    case 7:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Phase 5</div><h2 className="fsdeck-h2">How We Stay Connected</h2></div></div>
          <div className="fsdeck-grid3">
            {[["✉️", "Email", "Formal documentation, reports and major updates."], ["💬", "WhatsApp", "Daily operational queries and quick support."], ["⚡", "Slack", "Optional real-time collaboration if you prefer."]].map(([ic, t, dsc]) => (
              <div key={t} className="fsdeck-channel"><div className="fsdeck-channel-ic">{ic}</div><div className="fsdeck-channel-t">{t}</div><div className="fsdeck-channel-d">{dsc}</div></div>
            ))}
          </div>
        </div>
      );
    case 8:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Engagement</div><h2 className="fsdeck-h2">Contract Summary</h2></div></div>
          <div className="fsdeck-contract">
            <div className="fsdeck-contract-main"><div className="fsdeck-softcol-h">Scope of work</div><p style={{ fontSize: 16, color: "var(--fsd-ink)", lineHeight: 1.55 }}>{d.contract.scope}</p>
              <div className="fsdeck-services" style={{ marginTop: 14 }}>{(d.contract.highlights ?? []).map((h, i) => <span key={i} className="fsdeck-svc"><span className="dot" />{h}</span>)}</div>
            </div>
            <div className="fsdeck-contract-side">
              <div className="fsdeck-side-row"><span>Payment</span><b>{d.contract.payment || "Not specified"}</b></div>
              <div className="fsdeck-side-row"><span>Duration</span><b>{d.contract.duration || "Not specified"}</b></div>
              <div className="fsdeck-side-row"><span>Your responsibilities</span><b>{d.contract.responsibilities || "Not specified"}</b></div>
            </div>
          </div>
        </div>
      );
    case 9:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Next</div><h2 className="fsdeck-h2">Immediate Next Steps</h2></div></div>
          <div className="fsdeck-steps">{(d.nextSteps ?? []).map((s, i) => (
            <div key={i} className="fsdeck-step"><div className="fsdeck-step-n">{i + 1}</div><div className="fsdeck-step-ic">{s.icon}</div><div><div className="fsdeck-step-t">{s.title}</div><div className="fsdeck-step-d">{s.desc}</div></div></div>
          ))}</div>
        </div>
      );
    default:
      return (
        <div className="fsdeck-slide fsdeck-cover fsdeck-thanks">
          <div className="fsdeck-cover-glow" />
          <div className="fsdeck-cover-body">
            <div className="fsdeck-eyebrow orange">Onboarding recap</div>
            <div className="fsdeck-recap">{["Business overview", "Compliance", "Software", "Data", "Contract", "Next steps"].map((c) => <span key={c} className="fsdeck-recap-item"><span className="tick">✓</span>{c}</span>)}</div>
            <h1 className="fsdeck-cover-title"><span className="o">Thank you!</span></h1>
            <div className="fsdeck-cover-mission">Ready to grow together. Let&apos;s begin your journey toward financial mastery with Finanshels.</div>
          </div>
        </div>
      );
  }
}

const DECK_TITLES = ["Welcome", "Agenda", "Roadmap", "What We Understood", "Compliance", "Software", "Data", "Communication", "Contract", "Next Steps", "Thank You"];

function DeckModal({ runId, onClose, onDone }: { runId: string; onClose: () => void; onDone: () => void }) {
  const [deck, setDeck] = useState<DeckData | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "present">("present");
  const [idx, setIdx] = useState(0);
  const [scale, setScale] = useState(0.6);
  const [saving, start] = useTransition();
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    generateDeck(runId).then((r) => {
      if (r.error || !r.deck) { setError(r.error ?? "Could not build the deck."); setPhase("error"); }
      else { setDeck(r.deck); setPhase("ready"); }
    });
  }, [runId]);

  useEffect(() => {
    const fit = () => { const el = stageRef.current; if (!el) return; setScale(Math.min(el.clientWidth / 1200, el.clientHeight / 675)); };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [mode, phase]);

  const set = (fn: (d: DeckData) => DeckData) => setDeck((d) => (d ? fn(d) : d));
  const regen = () => { setPhase("loading"); generateDeck(runId, true).then((r) => { if (r.deck) { setDeck(r.deck); setPhase("ready"); } else { setError(r.error ?? "Failed"); setPhase("error"); } }); };
  const saveAndConfirm = () => { if (!deck) return; start(async () => { await saveDeck(runId, deck); onDone(); }); };

  return (
    <div className="fsdeck-overlay">
      <div className="fsdeck-bar">
        <div className="fsdeck-bar-left">
          <span className="fsdeck-bar-title"><Icon name="presentation" size={16} /> Onboarding deck</span>
          <span className="fsdeck-bar-badge"><Icon name="sparkles" size={11} /> AI-drafted · editable</span>
        </div>
        <div className="fsdeck-bar-right">
          <div className="fsdeck-modeseg">
            <button className={mode === "present" ? "on" : ""} onClick={() => setMode("present")}><Icon name="play" size={12} /> Present</button>
            <button className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}><Icon name="pencil" size={12} /> Edit</button>
          </div>
          <button className="fsdeck-btn ghost" onClick={regen} disabled={phase === "loading"}><Icon name="refresh-cw" size={12} /> Regenerate</button>
          <button className="fsdeck-btn ghost" onClick={onClose}>Close</button>
          <button className="fsdeck-btn primary" onClick={saveAndConfirm} disabled={!deck || saving}><Icon name="check" size={13} /> {saving ? "Saving…" : "Save & confirm step"}</button>
        </div>
      </div>

      {phase === "loading" && <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#fff" }}><div style={{ textAlign: "center" }}><div className="ai-loading"><span className="d" /><span className="d" /><span className="d" /></div><div style={{ marginTop: 12, fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Building the deck from this client&apos;s data…</div></div></div>}

      {phase === "error" && <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#fff" }}><div style={{ textAlign: "center", maxWidth: 420 }}><Icon name="alert-triangle" size={28} /><div style={{ marginTop: 10, fontSize: 14 }}>{error}</div><button className="fsdeck-btn ghost" style={{ marginTop: 14 }} onClick={regen}>Try again</button></div></div>}

      {phase === "ready" && deck && mode === "present" && (
        <div className="fsdeck-present">
          <div className="fsdeck-present-stage" ref={stageRef}>
            <div className="fsdeck-stage" style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>{deckSlide(deck, idx)}</div>
          </div>
          <div className="fsdeck-nav">
            <button className="fsdeck-nav-btn" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>‹</button>
            <div className="fsdeck-dots">{DECK_TITLES.map((_, i) => <span key={i} className={"fsdeck-dot" + (i === idx ? " active" : "")} onClick={() => setIdx(i)} />)}</div>
            <button className="fsdeck-nav-btn" disabled={idx === DECK_TITLES.length - 1} onClick={() => setIdx((i) => Math.min(DECK_TITLES.length - 1, i + 1))}>›</button>
            <span className="fsdeck-counter">{idx + 1} / {DECK_TITLES.length}</span>
          </div>
        </div>
      )}

      {phase === "ready" && deck && mode === "edit" && (
        <div className="fsdeck-editscroll">
          <div className="fsdeck-legend"><span className="fsdeck-legend-h">Sources:</span><span className="fsdeck-conf crm"><span className="dot" />From client</span><span className="fsdeck-conf ai"><span className="dot" />AI-drafted</span><span className="fsdeck-conf client"><span className="dot" />From intake / contract</span></div>

          <DeckEdit n="1" label="Welcome mission" pill="ai"><textarea className="fsdeck-edit" value={deck.mission} onChange={(e) => set((d) => ({ ...d, mission: e.target.value }))} rows={2} /></DeckEdit>

          <DeckEdit n="2" label="What we understood (summary)" pill="ai"><textarea className="fsdeck-edit" value={deck.whatWeUnderstood.summary} onChange={(e) => set((d) => ({ ...d, whatWeUnderstood: { ...d.whatWeUnderstood, summary: e.target.value } }))} rows={2} /></DeckEdit>
          {deck.whatWeUnderstood.points?.map((p, i) => (
            <DeckEdit key={i} n={`2.${i + 1}`} label={`Point — ${p.title || "title"}`} pill="ai">
              <input className="fsdeck-edit" value={p.title} onChange={(e) => set((d) => ({ ...d, whatWeUnderstood: { ...d.whatWeUnderstood, points: d.whatWeUnderstood.points.map((x, j) => j === i ? { ...x, title: e.target.value } : x) } }))} />
              <textarea className="fsdeck-edit" value={p.desc} onChange={(e) => set((d) => ({ ...d, whatWeUnderstood: { ...d.whatWeUnderstood, points: d.whatWeUnderstood.points.map((x, j) => j === i ? { ...x, desc: e.target.value } : x) } }))} rows={2} />
            </DeckEdit>
          ))}

          <DeckEdit n="3" label="Compliance · Corporate Tax" pill="ai"><textarea className="fsdeck-edit" value={deck.compliance.ct} onChange={(e) => set((d) => ({ ...d, compliance: { ...d.compliance, ct: e.target.value } }))} rows={2} /></DeckEdit>
          <DeckEdit n="3.2" label="Compliance · VAT" pill="ai"><textarea className="fsdeck-edit" value={deck.compliance.vat} onChange={(e) => set((d) => ({ ...d, compliance: { ...d.compliance, vat: e.target.value } }))} rows={2} /></DeckEdit>
          <DeckEdit n="3.3" label="Compliance · WPS" pill="ai"><textarea className="fsdeck-edit" value={deck.compliance.wps} onChange={(e) => set((d) => ({ ...d, compliance: { ...d.compliance, wps: e.target.value } }))} rows={2} /></DeckEdit>

          <DeckEdit n="4" label="Software recommendation" pill="ai"><textarea className="fsdeck-edit" value={deck.software.recommendation} onChange={(e) => set((d) => ({ ...d, software: { ...d.software, recommendation: e.target.value } }))} rows={2} /></DeckEdit>

          <DeckEdit n="5" label="Contract · scope" pill="client"><textarea className="fsdeck-edit" value={deck.contract.scope} onChange={(e) => set((d) => ({ ...d, contract: { ...d.contract, scope: e.target.value } }))} rows={2} /></DeckEdit>
          <DeckEdit n="5.2" label="Contract · payment" pill="client"><input className="fsdeck-edit" value={deck.contract.payment} onChange={(e) => set((d) => ({ ...d, contract: { ...d.contract, payment: e.target.value } }))} /></DeckEdit>
          <DeckEdit n="5.3" label="Contract · duration" pill="client"><input className="fsdeck-edit" value={deck.contract.duration} onChange={(e) => set((d) => ({ ...d, contract: { ...d.contract, duration: e.target.value } }))} /></DeckEdit>
          <DeckEdit n="5.4" label="Contract · your responsibilities" pill="client"><textarea className="fsdeck-edit" value={deck.contract.responsibilities} onChange={(e) => set((d) => ({ ...d, contract: { ...d.contract, responsibilities: e.target.value } }))} rows={2} /></DeckEdit>

          {deck.nextSteps?.map((s, i) => (
            <DeckEdit key={i} n={`6.${i + 1}`} label={`Next step — ${s.title || "title"}`} pill="ai">
              <input className="fsdeck-edit" value={s.title} onChange={(e) => set((d) => ({ ...d, nextSteps: d.nextSteps.map((x, j) => j === i ? { ...x, title: e.target.value } : x) }))} />
              <textarea className="fsdeck-edit" value={s.desc} onChange={(e) => set((d) => ({ ...d, nextSteps: d.nextSteps.map((x, j) => j === i ? { ...x, desc: e.target.value } : x) }))} rows={2} />
            </DeckEdit>
          ))}

          <div className="fsdeck-editfoot"><Icon name="info" size={14} /> Auto-filled from this client&apos;s data, intake form and contract. Edit anything, then Present or Save &amp; confirm.</div>
        </div>
      )}
    </div>
  );
}

function DeckEdit({ n, label, pill, children }: { n: string; label: string; pill: "crm" | "ai" | "client"; children: React.ReactNode }) {
  const pillLabel = pill === "crm" ? "From client" : pill === "client" ? "Intake / contract" : "AI-drafted";
  return (
    <div className="fsdeck-editcard">
      <div className="fsdeck-editcard-h"><span className="fsdeck-editcard-n">{n}</span> {label} <span className={"fsdeck-conf " + pill} style={{ marginLeft: "auto" }}><span className="dot" />{pillLabel}</span></div>
      <div className="fsdeck-editwrap">{children}</div>
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

// Hoisted out of IntakeBuilderModal: defining components inside a component
// remounts them every render, which steals focus from inputs after each keystroke.
function IntakeField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label}</label>{children}</div>;
}
function IntakeChips({ options, selected, onToggle }: { options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  const [draft, setDraft] = useState("");
  const all = [...new Set([...options, ...selected])];
  const add = () => { const v = draft.trim(); if (v) { onToggle(v); setDraft(""); } };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {all.map((b) => (
        <button key={b} type="button" className={"tab-pill" + (selected.includes(b) ? " active" : "")} onClick={() => onToggle(b)}>{b}</button>
      ))}
      <input
        value={draft}
        placeholder="+ type & Enter"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        onBlur={add}
        style={{ border: "1px dashed var(--border-strong)", borderRadius: 999, padding: "4px 10px", fontSize: 12, width: 120 }}
      />
    </div>
  );
}
const REVENUE_BY_INDUSTRY: Record<string, string[]> = {
  "Retail": ["In-store sales", "Online store", "Wholesale", "Delivery"],
  "E-commerce": ["Online store", "Marketplace (Amazon/Noon)", "Subscriptions", "Dropshipping"],
  "SaaS": ["Subscriptions", "Setup / onboarding fees", "Professional services", "Add-ons"],
  "Restaurant": ["Dine-in", "Takeaway", "Delivery (Talabat/Deliveroo)", "Catering"],
  "Hospitality": ["Room revenue", "Food & beverage", "Events", "Spa / activities"],
  "Trading": ["Wholesale", "Retail", "Export", "Commission"],
  "Fintech": ["Transaction fees", "Subscriptions", "Interchange", "Float income"],
  "Professional Services": ["Consulting fees", "Retainers", "Project fees", "Commissions"],
  "Holding Company": ["Dividends", "Management fees", "Rental income", "Interest income"],
};
const EXPENSE_BY_INDUSTRY: Record<string, string[]> = {
  "Retail": ["Inventory purchases", "Rent", "Salaries / WPS", "Utilities", "Marketing"],
  "E-commerce": ["Cost of goods", "Shipping / logistics", "Ad spend", "Platform fees", "Salaries / WPS"],
  "SaaS": ["Salaries / WPS", "Hosting / cloud", "Software subscriptions", "Marketing", "Contractors"],
  "Restaurant": ["Food cost", "Rent", "Salaries / WPS", "Utilities", "Delivery commissions"],
  "Hospitality": ["Salaries / WPS", "Rent", "Utilities", "Supplies", "Maintenance"],
  "Trading": ["Cost of goods", "Logistics / freight", "Rent", "Salaries / WPS", "Bank charges"],
  "Fintech": ["Salaries / WPS", "Tech / infrastructure", "Compliance", "Marketing", "Processing fees"],
  "Professional Services": ["Salaries / WPS", "Rent", "Software", "Travel", "Marketing"],
  "Holding Company": ["Management fees", "Professional fees", "Bank charges", "Office costs"],
};
const GENERIC_REVENUE = ["Product sales", "Service fees", "Subscriptions", "Commissions", "Other income"];
const GENERIC_EXPENSE = ["Salaries / WPS", "Rent", "Utilities", "Marketing", "Software", "Bank charges", "Professional fees"];

function IntakeBuilderModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const supabase = createClient();
  const [enabled, setEnabled] = useState(true);
  const [gen, setGen] = useState(false);
  const [saving, start] = useTransition();
  const [industry, setIndustry] = useState<string>("");
  const [f, setF] = useState<IntakePrep>({ enabled: true, description: "", revenue: [], expense: [], banks: [], gateways: [], vat: "", ct: "", wps: "", software: "", painPoints: "", stakeholders: "", reports: "", employees: "" });

  useEffect(() => {
    supabase.from("intake_forms").select("prefilled").eq("run_id", runId).maybeSingle().then(({ data }) => {
      const p = data?.prefilled as IntakePrep | undefined;
      if (p && Object.keys(p).length) { setF((s) => ({ ...s, ...p })); setEnabled(p.enabled ?? true); }
    });
    supabase.from("onboarding_runs").select("clients(industry)").eq("id", runId).maybeSingle().then(({ data }) => {
      const cl = (data as { clients?: { industry?: string } | { industry?: string }[] } | null)?.clients;
      const ind = Array.isArray(cl) ? cl[0]?.industry : cl?.industry;
      if (ind) setIndustry(ind);
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const set = (k: keyof IntakePrep, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const toggleArr = (k: "banks" | "gateways" | "revenue" | "expense", v: string) =>
    setF((s) => { const a = new Set(s[k] ?? []); a.has(v) ? a.delete(v) : a.add(v); return { ...s, [k]: [...a] }; });
  const genDesc = async () => { setGen(true); const r = await generateBusinessDescription(runId); setGen(false); if (r.text) set("description", r.text); else if (r.error) set("description", "AI: " + r.error); };
  const revOpts = REVENUE_BY_INDUSTRY[industry] ?? GENERIC_REVENUE;
  const expOpts = EXPENSE_BY_INDUSTRY[industry] ?? GENERIC_EXPENSE;

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
              <IntakeField label="Business description (AI — editable)">
                <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <button className="btn-ai" type="button" disabled={gen} onClick={genDesc}><Icon name="sparkles" size={13} /> {gen ? "Researching…" : "Research with AI"}</button>
                </div>
                <textarea className="notes" value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} placeholder="What we understood about the client's business…" style={{ minHeight: 90 }} />
              </IntakeField>
              <IntakeField label={`Revenue channels${industry ? ` (${industry} — click to add, or type & Enter)` : " (click to add, or type & Enter)"}`}>
                <IntakeChips options={revOpts} selected={f.revenue ?? []} onToggle={(v) => toggleArr("revenue", v)} />
              </IntakeField>
              <IntakeField label="Expense channels (click to add, or type & Enter)">
                <IntakeChips options={expOpts} selected={f.expense ?? []} onToggle={(v) => toggleArr("expense", v)} />
              </IntakeField>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <IntakeField label="VAT registered"><select value={f.vat ?? ""} onChange={(e) => set("vat", e.target.value)}><option value="">—</option>{YESNO.map((y) => <option key={y}>{y}</option>)}</select></IntakeField>
                <IntakeField label="Corporate Tax"><select value={f.ct ?? ""} onChange={(e) => set("ct", e.target.value)}><option value="">—</option>{YESNO.map((y) => <option key={y}>{y}</option>)}</select></IntakeField>
                <IntakeField label="WPS / Payroll"><select value={f.wps ?? ""} onChange={(e) => set("wps", e.target.value)}><option value="">—</option>{YESNO.map((y) => <option key={y}>{y}</option>)}</select></IntakeField>
              </div>
              <IntakeField label="Employee details"><input value={f.employees ?? ""} onChange={(e) => set("employees", e.target.value)} placeholder="e.g. 45 employees, payroll outsourced" /></IntakeField>
              <IntakeField label="Bank accounts"><IntakeChips options={UAE_BANKS} selected={f.banks ?? []} onToggle={(v) => toggleArr("banks", v)} /></IntakeField>
              <IntakeField label="Payment gateways"><IntakeChips options={GATEWAYS} selected={f.gateways ?? []} onToggle={(v) => toggleArr("gateways", v)} /></IntakeField>
              <IntakeField label="Accounting software"><select value={f.software ?? ""} onChange={(e) => set("software", e.target.value)}><option value="">—</option>{SOFTWARE.map((s) => <option key={s}>{s}</option>)}</select></IntakeField>
              <IntakeField label="Pain points"><textarea className="notes" value={f.painPoints ?? ""} onChange={(e) => set("painPoints", e.target.value)} placeholder="What's hurting today?" /></IntakeField>
              <IntakeField label="Stakeholders (who we report to)"><input value={f.stakeholders ?? ""} onChange={(e) => set("stakeholders", e.target.value)} placeholder="e.g. Owner, Finance Manager" /></IntakeField>
              <IntakeField label="Reports the client needs"><input value={f.reports ?? ""} onChange={(e) => set("reports", e.target.value)} placeholder="e.g. Monthly P&L, cash flow, VAT" /></IntakeField>
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
  const [contractFile, setContractFile] = useState<{ link: string; name: string } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [saving, startSave] = useTransition();

  const onContractFile = async (file: File) => {
    setUploadingFile(true);
    const fd = new FormData(); fd.append("file", file);
    const r = await uploadContractFile(runId, fd);
    setUploadingFile(false);
    if (r.link) setContractFile({ link: r.link, name: r.name ?? file.name });
  };

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
            <label>Engagement contract — attach a file or paste the text (both optional)</label>
            <textarea className="notes" value={contractText} onChange={(e) => setContractText(e.target.value)} placeholder="Paste the contract / engagement letter text…" style={{ minHeight: 80 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn-ai" type="button" disabled={analyzing || !contractText.trim()} onClick={analyze}><Icon name="sparkles" size={13} /> {analyzing ? "Reading…" : "Analyze text with AI"}</button>
              <label className="btn-ghost" style={{ cursor: uploadingFile ? "default" : "pointer" }}>
                <Icon name="paperclip" size={13} /> {uploadingFile ? "Uploading…" : contractFile ? "Replace contract file" : "Attach contract file"}
                <input type="file" hidden disabled={uploadingFile} onChange={(e) => { const f = e.target.files?.[0]; if (f) onContractFile(f); e.target.value = ""; }} />
              </label>
              {contractFile && <a href={contractFile.link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--orange)", fontWeight: 600 }}><Icon name="file-check" size={12} /> {contractFile.name}</a>}
            </div>
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
            const contractData = (ca || contractFile) ? { ...((ca as unknown as Record<string, unknown>) ?? {}), ...(contractFile ? { fileLink: contractFile.link, fileName: contractFile.name } : {}) } : null;
            const r = await saveDrive(runId, stepId, { periodStart: start || undefined, periodEnd: end || undefined, contract: contractData });
            if (!r.error) onDone();
          })}>{saving ? "Creating…" : "Create folders & share link"}</button>
        </div>
      </div>
    </div>
  );
}
