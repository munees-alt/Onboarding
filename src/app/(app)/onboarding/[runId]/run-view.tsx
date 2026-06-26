"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { useIdentity } from "@/components/identity-context";
import { ASSIGN_ROLES, type TemplateStep, type OnbTemplate } from "@/lib/onboarding-templates";
import { ACCESS_TYPES, AUTHORISED_USER_EMAIL, CREDENTIALS_SOP, accessTypeById, clientEmailSlug, type AccessItem, type AccessMode } from "@/lib/access-sops";
import { fmtDate } from "@/lib/data/runs";
import type { RunDetail } from "@/lib/data/run-detail";
import { completeStep, assignStepMembers, rollbackToStage, rollbackStep, completeOnboarding, dispatchMagicLink, dispatchIntakeLink, setTaskStatus, toggleTaskVisible, saveDiagrams, saveRunItems, assignTriage, escalateUrgentCompliance, escalateUrgentComplianceServices, escalateCatchup, suggestCatchupAssignee, getCatchupGautham, setRunBlocked, suggestAssignee, postMessage, saveDocuments, saveIntakePrep, saveDrive, saveAccess, saveContractAnalysis, saveAccountingSoftware, createComplianceRenewalRun, uploadContractFile, requestSecureMailbox, sendClientEmail, addTask, updateTask, deleteTask, nudgeTeam, saveBoardColumns, saveTaskStatuses, saveCallNotes, saveTaskSla, attachTaskFile, notifyClientOnTask, getDocumentUrl, requestDocReupload, uploadDocForClient, getBoardCols, saveBoardCols, listSops, listTemplatesLite, saveLinkedSops, createSalesUploadLink, revealAccessCredentials, suggestTaxAssignee, pushCoaToZoho, markDocReceivedOutside, markAccessReceivedOutside, addDocFollowupNote, addAccessFollowupNote, type DiagramInput, type DiagramNode, type RunItemInput, type IntakePrep, type BoardCol } from "./actions";
import { loadSlackComposerOptions, listRunAttachableDocs, sendSlackSetupRequest } from "./slack-actions";
import { getPortalAccessCode } from "@/app/portal/[token]/actions";
import { canManageCoa, canRevealAccessCredentials } from "@/lib/roles";

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
  // 2026-06-22 rule: only the confirm/sign-off action (act.type "approve") is gated to AM.
  // Everything else — including Senior prep work — is open to all team roles.
  if (step.act?.type === "approve") { const r = step.approval?.by ? WHO_ROLE[step.approval.by.trim().toLowerCase()] : null; return r ?? "am"; }
  return null;
}
// 2026-06-23: gating OFF (user request) — no per-step "view only" locks; every role can action
// every step on every template. Mirrors ENFORCE_STEP_ROLES + requiredRoleForStep in actions.ts.
const ENFORCE_STEP_ROLES = false;
function canEditStep(myRole: string, step: TemplateStep): boolean {
  if (!ENFORCE_STEP_ROLES) return true;
  const req = stepRequiredRole(step);
  if (!req) return true;
  return (STEP_ROLE_RANK[myRole] ?? 0) >= (STEP_ROLE_RANK[req] ?? 99);
}
const ROLE_NICE: Record<string, string> = { am: "Account Manager", senior: "Senior", junior: "Junior", team_lead: "Team Lead", ops_head: "Ops", intern: "Intern" };
import { createClient } from "@/lib/supabase/client";
import type { TaskRow } from "@/lib/data/run-detail";
import { generateCoa, saveCoa, generateTaxCodes, saveTaxCodes, generateStepText, saveStepText, generateBusinessDescription, analyzeContract, analyzeContractFile, generateCompliance, generateComplianceFromDocs, generateRecurringTasks, generateDiagram, generateDeck, saveDeck, generateOnePager, saveOnePagerNotes, regenerateOnePager, generateTaskBoardEmailDraft, type CoaLine, type ContractAnalysis, type DeckData } from "./ai-actions";
import { formatEngagementPeriod } from "@/lib/contract-format";
import { archiveUrgentRun } from "../../my-work/actions";
import { cleanDocLabels } from "@/lib/doc-labels";
import { INTAKE_EMAIL_SUBJECT, renderIntakeEmail, renderIntakeWhatsapp } from "@/lib/welcome-email";
import { WELCOME_EMAIL_SUBJECT, renderWhatsappWelcome } from "@/lib/welcome-email";

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
  { id: "portal", label: "Onboarding Portal", icon: "external-link" },
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

  // Task owners = the people actually assigned to THIS run (AM, Team Lead, Seniors, Juniors).
  // Falls back to the senior/junior pool if no team is assigned yet. No unrelated org people.
  const taskOwners = (() => {
    const base = detail.assignedTeam.length
      ? detail.assignedTeam.map((m) => ({ id: m.id, name: m.name }))
      : [...detail.seniors, ...detail.juniors];
    const seen = new Set<string>();
    return base.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
  })();

  // ── Org-chart cascade for the Assign Roles steps ──
  // Team Lead options = the AM's reports; Senior options = the assigned Team
  // Lead's reports; Junior options = the assigned Senior's reports. Anchored on
  // the run's AM (detail.amId) and on each slot-step's actual assignee — so it's
  // scoped to the selected AM's org subtree, not whoever is viewing.
  const orgChildren: Record<string, { id: string; name: string; role: string }[]> = {};
  detail.orgPeople.forEach((p) => { if (p.reportsTo) (orgChildren[p.reportsTo] ||= []).push({ id: p.id, name: p.name, role: p.role }); });
  const descendantsOf = (anchorId: string | null): { id: string; name: string; role: string }[] => {
    if (!anchorId) return [];
    const out: { id: string; name: string; role: string }[] = [];
    const seen = new Set<string>();
    const queue = [...(orgChildren[anchorId] ?? [])];
    while (queue.length) { const p = queue.shift()!; if (seen.has(p.id)) continue; seen.add(p.id); out.push(p); (orgChildren[p.id] ?? []).forEach((c) => queue.push(c)); }
    return out;
  };
  // Map each assign slot (by its act.role) to the person currently assigned there.
  const assigneeBySlot: Record<string, string | null> = {};
  tpl.stages.forEach((s) => s.steps.forEach((st) => {
    if (st.act?.type === "assign" && st.act.role) assigneeBySlot[st.act.role.trim().toLowerCase()] = detail.stepState[st.id]?.assigneeId ?? null;
  }));
  const eligibleForAssign = (step: TemplateStep): { id: string; name: string; role: string }[] => {
    const role = (step.act?.role ?? "").trim().toLowerCase();
    let anchor: string | null;
    if (role.includes("team lead")) anchor = detail.amId;
    else if (role.includes("senior")) anchor = assigneeBySlot["team lead"] ?? null;
    else if (role.includes("junior")) anchor = assigneeBySlot["senior"] ?? null;
    else anchor = detail.amId;
    // If the chain is broken (no AM picked, or upstream slot not assigned yet), don't
    // hard-block — fall back to the org-scoped pool so a Team Lead can still configure
    // and assign without waiting on the AM. Gautham feedback 2026-06-24.
    if (anchor) {
      const sub = descendantsOf(anchor);
      if (sub.length) return sub;
      const direct = orgChildren[anchor] ?? [];
      if (direct.length) return direct;
    }
    return detail.assignPeople;
  };

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
        {detail.group && <GroupSwitcherPill group={detail.group} currentRunId={detail.runId} />}
        {detail.blockedReason && (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "var(--red-soft, #fdecec)", border: "1px solid var(--red)" }}>
            <Icon name="pause-circle" size={14} />
            <strong style={{ fontSize: 12.5, color: "var(--red)" }}>BLOCKED · {detail.blockedReason}</strong>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>SLA + compliance alerts paused while this run is blocked.</span>
            <BlockControls runId={detail.runId} currentReason={detail.blockedReason} compact onChange={() => router.refresh()} />
          </div>
        )}
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
          <button className="btn-ghost" onClick={() => { router.refresh(); showToast("Refreshed — showing the latest"); }} title="Refresh to pull the latest team & client updates">
            <Icon name="refresh-cw" size={13} /> Refresh
          </button>
          <button className="btn-ghost" style={{ position: "relative" }} onClick={() => setChatOpen(true)}>
            <Icon name="message-square" size={13} /> Chat
            {chatUnread && <span style={{ position: "absolute", top: 4, right: 4, width: 8, height: 8, borderRadius: "50%", background: "var(--red)", border: "1.5px solid #fff" }} />}
          </button>
          {!detail.blockedReason && (
            <BlockControls runId={detail.runId} currentReason={null} compact={false} onChange={() => router.refresh()} />
          )}
          <DeleteRunButton runId={detail.runId} />
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
                          people={step.act?.type === "assign" ? eligibleForAssign(step) : detail.assignPeople}
                          busy={busy}
                          onOpenAct={() => openAct(step)}
                          onRollback={() => run(() => rollbackStep(detail.runId, step.id), "Step reopened")}
                          onAssignMembers={(members) => run(() => assignStepMembers(detail.runId, step.id, members), members.length ? `Assigned ${members.length} ${members.length === 1 ? "person" : "people"}` : "Step skipped")}
                        />
                      ))}
                      {/Handover/i.test(stage.name) && detail.status !== "complete" && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, padding: "10px 12px", background: "var(--green-soft)", borderRadius: 10, flexWrap: "wrap" }}>
                          <Icon name="flag" size={14} style={{ color: "var(--green)" }} />
                          <span style={{ fontSize: 12.5, color: "var(--ink-2)", flex: 1, minWidth: 180 }}>No handover needed? Complete the onboarding now — marks every step done and moves the client live.</span>
                          <button className="btn-primary" disabled={busy} onClick={() => { if (confirm("Complete this onboarding now and skip the remaining handover steps?")) run(() => completeOnboarding(detail.runId), "Onboarding completed — client is live"); }}>
                            <Icon name="check-circle" size={13} /> Complete onboarding now
                          </button>
                        </div>
                      )}
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
          clientName={detail.clientName}
          contactName={(detail.playbook?.profile as { owner_name?: string | null } | undefined)?.owner_name ?? null}
          tasks={detail.tasks}
          owners={taskOwners}
          columns={(() => { const c = detail.items["board_columns"]?.[0]?.data?.columns; return Array.isArray(c) && c.length ? (c as string[]) : DEFAULT_BOARD_COLUMNS; })()}
          statuses={(() => { const s = detail.items["task_statuses"]?.[0]?.data?.statuses; return Array.isArray(s) && s.length ? (s as string[]) : TASK_STATUSES; })()}
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

      {actStep && actStep.act?.type === "taxcodes" && (
        <TaxCodesBuilderModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Tax codes saved"); router.refresh(); }}
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
          linkedSops={(detail.items["linked_sops"] ?? []).map((i) => i.data as { id: string; title: string })}
          people={detail.assignPeople}
          assignedTeam={detail.assignedTeam}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Saved"); router.refresh(); }}
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

      {actStep && actStep.act?.type === "onepager" && (
        <OnePagerModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("One-pager saved"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "deck" && (
        <DeckModal
          runId={detail.runId}
          onClose={() => setActStep(null)}
          onDone={() => { const s = actStep; setActStep(null); showToast("Onboarding deck saved"); run(() => completeStep(detail.runId, s.id), `${s.title} — done`); }}
        />
      )}

      {actStep && ["agenda", "ai", "mom", "datareq", "report"].includes(actStep.act?.type ?? "") && (
        <AiTextModal
          runId={detail.runId}
          stepId={actStep.id}
          actType={actStep.act!.type}
          title={actStep.title}
          contacts={[
            ...detail.assignPeople.filter((p) => /senior|team.?lead|account manager|^am$/i.test(p.role)).map((p) => p.name),
            ...(detail.amName ? [detail.amName] : []),
          ].filter((v, i, a) => v && a.indexOf(v) === i)}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast(`${actStep.title} — done`); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "triage" && (
        <TriageModal
          runId={detail.runId}
          stepId={actStep.id}
          people={(() => {
            const ams = detail.assignPeople.filter((p) => p.role === "am" || /account manager/i.test(p.role)).map((p) => ({ id: p.id, name: p.name }));
            if (ams.length) return ams;
            return detail.amId ? [{ id: detail.amId, name: detail.amName ?? "Account Manager" }] : [];
          })()}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Run(s) created for the AM — they'll configure & assign"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "access" && (
        <AccessBuilderModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Access requests configured & shared in the portal"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "contract" && (
        <ContractBuilderModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Contract analysed — scope & deliverables shared in the portal"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "accountingsoftware" && (
        <AccountingSoftwareModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Accounting software saved to the client playbook"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "zoho" && (
        <ZohoPushModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("COA pushed to Zoho"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "catchup_config" && (
        <CatchupConfigModal
          runId={detail.runId}
          stepId={actStep.id}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Catch-up configuration saved"); router.refresh(); }}
        />
      )}

      {actStep && actStep.act?.type === "urgent_config" && (
        <UrgentConfigModal
          runId={detail.runId}
          stepId={actStep.id}
          people={(() => {
            const ams = detail.assignPeople.filter((p) => p.role === "am" || /account manager/i.test(p.role)).map((p) => ({ id: p.id, name: p.name }));
            if (ams.length) return ams;
            return detail.amId ? [{ id: detail.amId, name: detail.amName ?? "Account Manager" }] : [];
          })()}
          onClose={() => setActStep(null)}
          onDone={() => { setActStep(null); showToast("Urgent compliance configuration saved"); router.refresh(); }}
        />
      )}

      {actStep && !["coa", "diagram", "catchup", "project", "calendar", "triage", "agenda", "ai", "mom", "datareq", "report", "deck", "uploads", "intake", "drivelink", "access", "contract", "accountingsoftware", "zoho", "onepager", "catchup_config", "urgent_config"].includes(actStep.act?.type ?? "") && (
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
  const [intake, setIntake] = useState<{ portalUrl: string; clientEmail: string; emailSubject: string; emailBody: string; whatsappBody: string } | null>(null);
  const [intakeMsg, setIntakeMsg] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [waCopied, setWaCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [items, setItems] = useState<string[]>(act?.items ?? []);
  const [cover, setCover] = useState<string[]>(act?.cover ?? []);
  // Extra teammate emails the AM wants to add to this onboarding portal link.
  // Chip-list UI: add by pressing Enter, remove with the X. Saved into
  // magic_links.alt_emails on dispatch — those emails can then open the portal too.
  const [altEmails, setAltEmails] = useState<string[]>([]);
  const [altDraft, setAltDraft] = useState("");
  const [altErr, setAltErr] = useState<string | null>(null);

  const allItemsDone = items.length > 0 && items.every((_, i) => checked["i" + i]);
  const allCoverDone = cover.length === 0 || cover.every((_, i) => checked["c" + i]);

  const isValidEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
  const addAltEmail = () => {
    const v = altDraft.trim().toLowerCase();
    if (!v) return;
    if (!isValidEmail(v)) { setAltErr("Enter a valid email address."); return; }
    if (intake && v === intake.clientEmail.trim().toLowerCase()) { setAltErr("Already the primary email."); return; }
    if (altEmails.includes(v)) { setAltErr("Already added."); return; }
    setAltEmails((a) => [...a, v]);
    setAltDraft("");
    setAltErr(null);
  };

  const doDispatch = async () => {
    setWorking(true);
    setIntakeMsg(null);
    // Steps flagged `act.intake === true` (the Stage 1 "Send intake form")
    // generate the PUBLIC NO-LOGIN intake link (/intake/<token>) — autosave,
    // no OTP. All other dispatch steps (e.g. "Re-send portal link") still
    // dispatch the OTP-gated onboarding portal link, optionally adding extra
    // teammate emails to magic_links.alt_emails.
    const res = act?.intake
      ? await dispatchIntakeLink(runId)
      : await dispatchMagicLink(runId, altEmails);
    setWorking(false);
    if (res.error) { setIntakeMsg(res.error); return; }
    // For OTP-gated dispatch the server returns the final alt_emails list.
    if (!act?.intake && Array.isArray((res as { altEmails?: string[] }).altEmails)) {
      setAltEmails(((res as { altEmails?: string[] }).altEmails ?? []) as string[]);
    }
    if (res.url) {
      setLink(res.url);
      const fields = { contactName: res.contactName, companyName: res.clientName, portalUrl: res.url };
      setIntake({
        portalUrl: res.url,
        clientEmail: res.email ?? "",
        emailSubject: INTAKE_EMAIL_SUBJECT,
        emailBody: renderIntakeEmail(fields),
        whatsappBody: renderIntakeWhatsapp(fields),
      });
    }
  };
  // Auto-generate the link as soon as the dispatch step is opened, so the team
  // sees the email/WhatsApp templates pre-filled and ready to send.
  useEffect(() => {
    if (type === "dispatch" && !intake && !working) doDispatch();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [type]);
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
    canConfirm = !!intake;
    body = (
      <div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 12 }}>
          Send (or re-send) the onboarding portal link. The secure link is auto-generated below — copy or send the email + WhatsApp templates to the client. They log in with their email and a one-time code. Add extra teammate emails to give them their own access to the same portal.
        </div>
        {!intake && working && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Generating link…</div>}
        {!intake && !working && intakeMsg && (
          <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 8 }}>{intakeMsg} <button className="btn-ghost" onClick={doDispatch} style={{ marginLeft: 8 }}>Try again</button></div>
        )}
        {intake && (
          <>
            {/* Link bar */}
            <div className="sop-ref-bar" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Icon name="link" size={14} />
              <span style={{ fontSize: 12.5, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360 }}>{intake.portalUrl}</span>
              <button className="btn-ghost" style={{ marginLeft: "auto" }} onClick={() => { navigator.clipboard?.writeText(intake.portalUrl); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1800); }}>
                <Icon name={linkCopied ? "check" : "copy"} size={12} /> {linkCopied ? "Copied" : "Copy link"}
              </button>
              <a href={intake.portalUrl} target="_blank" rel="noreferrer" className="btn-ghost"><Icon name="external-link" size={12} /> Open portal</a>
            </div>

            {/* Additional emails (OTP-gated portal dispatch only — the no-login intake
                link doesn't email-gate, so adding extra emails is meaningless there). */}
            {!act?.intake && (
              <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", background: "var(--bg-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Icon name="users" size={14} style={{ color: "var(--ink-2)" }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>Additional emails</span>
                  <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>· also able to open this onboarding portal</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 8 }}>Add any teammate at the client who should also be able to sign in (finance, ops, founder). They each get a one-time code to their own email. Press Enter to add, click × to remove.</div>
                {altEmails.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {altEmails.map((e) => (
                      <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 8px", background: "#fff", border: "1px solid var(--border)", borderRadius: 999 }}>
                        {e}
                        <button className="icon-btn" aria-label={`Remove ${e}`} style={{ color: "var(--red)" }} onClick={() => setAltEmails((a) => a.filter((x) => x !== e))}>
                          <Icon name="x" size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={altDraft}
                    onChange={(e) => { setAltDraft(e.target.value); if (altErr) setAltErr(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAltEmail(); } }}
                    placeholder="teammate@client.com"
                    style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 13 }}
                  />
                  <button className="btn-ghost" onClick={addAltEmail} disabled={!altDraft.trim()}>
                    <Icon name="plus" size={12} /> Add
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={doDispatch}
                    disabled={working}
                    title="Save these emails to the link and re-render the templates"
                  >
                    <Icon name={working ? "loader" : "refresh-ccw"} size={12} /> {working ? "Saving…" : "Save & refresh"}
                  </button>
                </div>
                {altErr && <div style={{ fontSize: 11.5, color: "var(--red)", marginTop: 6 }}>{altErr}</div>}
              </div>
            )}

            {/* Email template */}
            <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Icon name="mail" size={14} style={{ color: "var(--orange)" }} />
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>Email template</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>· To: {intake.clientEmail || "—"}</span>
              </div>
              <input value={intake.emailSubject} onChange={(e) => setIntake({ ...intake, emailSubject: e.target.value })} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 13, fontWeight: 600, marginBottom: 6 }} placeholder="Subject" />
              <textarea value={intake.emailBody} onChange={(e) => setIntake({ ...intake, emailBody: e.target.value })} style={{ width: "100%", minHeight: 180, border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(`Subject: ${intake.emailSubject}\n\n${intake.emailBody}`); setEmailCopied(true); setTimeout(() => setEmailCopied(false), 1800); }}>
                  <Icon name={emailCopied ? "check" : "copy"} size={13} /> {emailCopied ? "Copied" : "Copy email"}
                </button>
                <button className="btn-ai" disabled={emailSending || !intake.clientEmail} onClick={async () => {
                  setEmailSending(true); setIntakeMsg(null);
                  const r = await sendClientEmail(runId, intake.emailSubject, intake.emailBody);
                  setEmailSending(false);
                  setIntakeMsg(r.error ? `Couldn't send: ${r.error}` : "Sent via your connected Gmail.");
                }}>
                  <Icon name="send" size={13} /> {emailSending ? "Sending…" : "Send via my Gmail"}
                </button>
              </div>
            </div>

            {/* WhatsApp template */}
            <div style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Icon name="message-circle" size={14} style={{ color: "#25D366" }} />
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>WhatsApp message</span>
              </div>
              <textarea value={intake.whatsappBody} onChange={(e) => setIntake({ ...intake, whatsappBody: e.target.value })} style={{ width: "100%", minHeight: 110, border: "1px solid var(--border)", borderRadius: 7, padding: "8px 10px", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(intake.whatsappBody); setWaCopied(true); setTimeout(() => setWaCopied(false), 1800); }}>
                  <Icon name={waCopied ? "check" : "copy"} size={13} /> {waCopied ? "Copied" : "Copy message"}
                </button>
                <a className="btn-ghost" href={`https://wa.me/?text=${encodeURIComponent(intake.whatsappBody)}`} target="_blank" rel="noreferrer">
                  <Icon name="external-link" size={13} /> Open in WhatsApp
                </a>
              </div>
            </div>

            {intakeMsg && <div style={{ fontSize: 12.5, marginTop: 10, color: /Couldn|error/i.test(intakeMsg) ? "var(--red)" : "var(--green)" }}>{intakeMsg}</div>}
          </>
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

// Download rows as a CSV (opens directly in Excel). UTF-8 BOM keeps accents/£ correct.
function downloadCsvRows(filename: string, rows: (string | number)[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function exportCoaCsv(filename: string, lines: CoaLine[]) {
  const rows: (string | number)[][] = [["Section", "Code", "Account", "Included"]];
  lines.forEach((l) => rows.push([l.section, l.code, l.account, l.include ? "Yes" : "No"]));
  downloadCsvRows(filename, rows);
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
  const [openSec, setOpenSec] = useState<Record<string, boolean>>({});
  const SEC_SECONDARY = ["Assets", "Liabilities", "Equity"];
  const SEC_ORDER = ["Income", "Revenue", "Cost of Goods", "COGS", "Expenses", "Assets", "Liabilities", "Equity"];
  const secOpen = (sec: string) => openSec[sec] ?? !SEC_SECONDARY.includes(sec);

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

  const sections = [...new Set(lines.map((l) => l.section))].sort((a, b) => {
    const ia = SEC_ORDER.indexOf(a), ib = SEC_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

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
              {sections.map((sec) => {
                const count = lines.filter((l) => l.section === sec).length;
                const on = lines.filter((l) => l.section === sec && l.include).length;
                const open = secOpen(sec);
                return (
                <div key={sec} style={{ marginTop: 12 }}>
                  <button onClick={() => setOpenSec((s) => ({ ...s, [sec]: !open }))} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 6 }}>
                    <Icon name={open ? "chevron-down" : "chevron-right"} size={14} />
                    <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)" }}>{sec}</span>
                    <span className="pill" style={{ fontSize: 9.5 }}>{on}/{count}</span>
                  </button>
                  {open && lines.map((l, i) => l.section === sec && (
                    <div key={l.code + i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                      <input type="checkbox" checked={l.include} onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} style={{ accentColor: "var(--orange)" }} />
                      <input value={l.code} onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} style={{ fontFamily: "DM Mono, monospace", fontSize: 11, width: 56, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px" }} />
                      <input value={l.account} onChange={(e) => setLines((arr) => arr.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))} style={{ flex: 1, fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px" }} />
                      <button className="icon-btn" onClick={() => setLines((arr) => arr.filter((_, j) => j !== i))} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button>
                    </div>
                  ))}
                  {open && <button className="add-link" onClick={() => setLines((arr) => [...arr, { code: "", account: "New account", section: sec, include: true }])} style={{ marginTop: 4 }}><Icon name="plus" size={12} /> Add account</button>}
                </div>
                );
              })}
            </>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          {phase === "review" && (
            <button className="btn-ghost" onClick={() => exportCoaCsv(`coa-${industry || "client"}.csv`, lines)}><Icon name="download" size={13} /> Export to Excel</button>
          )}
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
  // Capacity-based auto-suggest — pre-tick the lowest-active-run person for this role.
  const [suggested, setSuggested] = useState<{ id: string; name: string; currentLoad: number } | null>(null);
  useEffect(() => {
    if (!primary) return;
    if (!["senior", "junior", "team_lead"].includes(primary)) return;
    suggestAssignee(primary).then((r) => {
      if (!r) return;
      setSuggested(r);
      setSel((s) => (s[r.id] ? s : { ...s, [r.id]: true }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primary]);
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
        {suggested && <span style={{ display: "block", marginTop: 4, fontSize: 11.5, color: "var(--orange)" }}>Auto-picked by capacity: <strong>{suggested.name}</strong> ({suggested.currentLoad} active runs). Untick to choose someone else.</span>}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 12.5, marginBottom: 8 }} />
      <div style={{ maxHeight: 190, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {filtered.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-3)", padding: 8 }}>{people.length === 0 ? "No one available yet — assign the level above (Team Lead → Senior → Junior) first, so we can show their team." : "No matching people."}</div>}
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
  step, assignRole, status, isActive, canEdit, assignedName, people, busy, onOpenAct, onRollback, onAssignMembers,
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
  onRollback: () => void;
  onAssignMembers: (members: { id: string; name: string; role: string }[]) => void;
}) {
  const ki = KIND_ICON[step.kind] ?? KIND_ICON.person;
  const done = status === "complete";
  const isAssign = step.act?.type === "assign";
  const isAuto = !!step.pre; // System "Run auto-created" steps need no human action

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
          {!done && isAuto && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="check-circle" size={12} /> Done automatically
            </div>
          )}
          {!done && !isAuto && canEdit && (
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
          {!done && !isAuto && !canEdit && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="lock" size={12} /> {stepRequiredRole(step) ? `${ROLE_NICE[stepRequiredRole(step)!] ?? stepRequiredRole(step)}'s step — view only` : "View only"}
            </div>
          )}
          {/* Completed steps stay viewable — and editable for anyone allowed; the team is notified on change. */}
          {done && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {step.act?.type && !["assign", "confirm"].includes(step.act.type) && (
                <button className="btn-ghost" disabled={busy} onClick={onOpenAct}>
                  <Icon name="eye" size={13} /> {canEdit ? "View / edit" : "View"}
                </button>
              )}
              <button className="btn-ghost" disabled={busy} onClick={onRollback} title="Reopen just this step (AM+ only)">
                <Icon name="rotate-ccw" size={13} /> Roll back step
              </button>
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
  const { effectiveRole } = useIdentity();
  const [copied, setCopied] = useState(false);
  // Optional Sales upload link (generated on demand — not part of any template).
  const [salesUrl, setSalesUrl] = useState<string | null>(null);
  const [salesBusy, setSalesBusy] = useState(false);
  const [salesCopied, setSalesCopied] = useState(false);
  const makeSalesLink = async () => {
    setSalesBusy(true);
    const r = await createSalesUploadLink(detail.runId);
    setSalesBusy(false);
    if (r.url) {
      const url = r.url.startsWith("http") ? r.url : `${window.location.origin}${r.url}`;
      setSalesUrl(url);
      navigator.clipboard?.writeText(url);
      setSalesCopied(true);
      setTimeout(() => setSalesCopied(false), 1800);
    }
  };
  const visible = detail.tasks.filter((t) => t.clientVisible);
  const cols = (detail.items["board_columns"]?.[0]?.data?.columns as string[] | undefined) ?? null;
  const link = detail.portalLink;
  const docs = detail.playbook.documents;
  const docReceived = docs.filter((d) => d.status === "uploaded").length;
  const intakeSubmitted = !!detail.playbook.intake;
  const coaSignedOff = !!detail.playbook.coa?.signedOff;
  const accessItems = detail.items["access"] ?? [];
  const accessShared = accessItems.filter((r) => r.status === "granted" || (r.data as { status?: string }).status === "granted").length;

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
          <h2 style={{ fontSize: 16 }}>Onboarding portal — live mirror</h2>
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

      {/* Backup: the current portal access code (AM / Master Admin only), in case the client didn't receive the email */}
      {link && canManageCoa(effectiveRole) && <PortalCodeBackup runId={detail.runId} />}

      {/* Optional: Sales upload link — share with Sales to drop in docs they already collected */}
      <div className="runs-card" style={{ padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg-soft)", color: "var(--ink-2)", display: "grid", placeItems: "center" }}><Icon name="upload-cloud" size={15} /></span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Sales upload link <span className="pill" style={{ fontSize: 9.5, marginLeft: 4 }}>Optional</span></div>
            <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{salesUrl ? "Share with Sales — files drop into the client Drive folder and are marked received." : "Generate a link for the Sales team to share documents they already collected."}</div>
          </div>
          {salesUrl ? (
            <button className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(salesUrl); setSalesCopied(true); setTimeout(() => setSalesCopied(false), 1800); }}><Icon name={salesCopied ? "check" : "copy"} size={13} /> {salesCopied ? "Copied" : "Copy link"}</button>
          ) : (
            <button className="btn-ghost" disabled={salesBusy} onClick={makeSalesLink}><Icon name="link" size={13} /> {salesBusy ? "Creating…" : "Create link"}</button>
          )}
        </div>
        {salesUrl && <div style={{ marginTop: 8, fontSize: 12, fontFamily: "DM Mono, monospace", color: "var(--ink-3)", wordBreak: "break-all" }}>{salesUrl}</div>}
      </div>

      {/* Progress chips */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <MirrorChip icon="file-text" label="Documents" value={`${docReceived}/${docs.length} received`} done={docs.length > 0 && docReceived === docs.length} total={docs.length} />
        <MirrorChip icon="clipboard-list" label="Intake form" value={intakeSubmitted ? "Submitted" : "Awaiting client"} done={intakeSubmitted} />
        <MirrorChip icon="check-circle" label="COA sign-off" value={coaSignedOff ? "Signed off" : "Pending"} done={coaSignedOff} />
        <MirrorChip icon="key-round" label="Access" value={`${accessShared}/${accessItems.length} shared`} done={accessItems.length > 0 && accessShared === accessItems.length} total={accessItems.length} />
      </div>

      {/* Access shared — what the client has granted, incl. encrypted logins the team can reveal */}
      {accessItems.length > 0 && <AccessMirrorPanel runId={detail.runId} items={accessItems} canReveal={canRevealAccessCredentials(effectiveRole)} />}

      {/* Sign-off proof — durable evidence the client confirmed their setup */}
      {(() => {
        const proof = detail.items["signoff"]?.[0]?.data as { signed?: boolean; at?: string; clientName?: string; signedBy?: string; signedEmail?: string | null; statement?: string } | undefined;
        if (!proof?.signed) return null;
        return (
          <div className="runs-card" style={{ padding: 16, marginBottom: 14, borderLeft: "3px solid var(--green)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              <Icon name="shield-check" size={15} style={{ color: "var(--green)" }} /> Onboarding sign-off — proof on record
            </div>
            <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>{proof.statement}</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10, fontSize: 12 }}>
              <div><span style={{ color: "var(--ink-3)" }}>Signed by</span><br /><strong>{proof.signedBy ?? proof.clientName ?? "Client"}</strong></div>
              {proof.signedEmail && <div><span style={{ color: "var(--ink-3)" }}>Verified email</span><br /><strong>{proof.signedEmail}</strong></div>}
              {proof.at && <div><span style={{ color: "var(--ink-3)" }}>Date &amp; time</span><br /><strong>{new Date(proof.at).toLocaleString("en-GB")}</strong></div>}
            </div>
          </div>
        );
      })()}

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

      {/* Documents — review what the client uploaded; request a re-upload if wrong */}
      {docs.length > 0 && (
        <div className="runs-card" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Documents received</div>
          {docs.map((d) => <DocReviewRow key={d.id} runId={detail.runId} doc={d} />)}
        </div>
      )}
    </>
  );
}

function DocReviewRow({ runId, doc }: { runId: string; doc: RunDetail["playbook"]["documents"][number] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [flagging, setFlagging] = useState(false);
  const [note, setNote] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [receiveNote, setReceiveNote] = useState("");
  const [fuOpen, setFuOpen] = useState(false);
  const [fuNote, setFuNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const uploaded = doc.status === "uploaded";
  const rejected = doc.status === "rejected";
  const pending = !uploaded && !rejected;

  const view = async () => { const r = await getDocumentUrl(doc.id); if (r.url) window.open(r.url, "_blank", "noopener"); };
  const send = () => start(async () => { await requestDocReupload(runId, doc.id, note); setFlagging(false); setNote(""); router.refresh(); });
  const upload = (file: File) => start(async () => { const fd = new FormData(); fd.append("file", file); await uploadDocForClient(runId, doc.id, fd); router.refresh(); });
  const markReceived = () => start(async () => {
    setErr(null);
    const r = await markDocReceivedOutside(runId, doc.id, receiveNote);
    if (r.error) { setErr(r.error); return; }
    setReceiving(false); setReceiveNote(""); router.refresh();
  });
  const sendFu = () => start(async () => {
    setErr(null);
    const r = await addDocFollowupNote(runId, doc.id, fuNote);
    if (r.error) { setErr(r.error); return; }
    setFuOpen(false); setFuNote(""); router.refresh();
  });

  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "7px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
        <span style={{ color: uploaded ? "var(--green)" : rejected ? "var(--red)" : "var(--ink-4)" }}><Icon name={uploaded ? "check-circle" : rejected ? "rotate-ccw" : "circle"} size={14} /></span>
        <span style={{ flex: 1, minWidth: 160 }}>{doc.label}</span>
        {(uploaded || rejected) && doc.storagePath && <button className="btn-ghost" style={{ padding: "3px 8px" }} onClick={view}><Icon name="eye" size={13} /> View</button>}
        <label className="btn-ghost" style={{ padding: "3px 8px", cursor: busy ? "default" : "pointer" }}>
          <Icon name="upload" size={13} /> {busy ? "…" : uploaded ? "Replace" : "Upload"}
          <input type="file" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        </label>
        {pending && <button className="btn-ghost" style={{ padding: "3px 8px" }} onClick={() => { setReceiving((v) => !v); setFuOpen(false); }}><Icon name="inbox" size={13} /> Mark received outside portal</button>}
        {pending && <button className="btn-ghost" style={{ padding: "3px 8px" }} onClick={() => { setFuOpen((v) => !v); setReceiving(false); }}><Icon name="message-square" size={13} /> Add follow-up note</button>}
        {uploaded && <button className="btn-ghost" style={{ padding: "3px 8px", color: "var(--red)" }} onClick={() => setFlagging((v) => !v)}><Icon name="flag" size={13} /> Request re-upload</button>}
        <span className={"pill " + (uploaded ? "green" : rejected ? "red" : "gray")} style={{ fontSize: 10 }}>{uploaded ? "Received" : rejected ? "Re-upload asked" : "Pending"}</span>
      </div>
      {uploaded && doc.receivedOutsidePortal && doc.receivedNote && (
        <div style={{ marginLeft: 22, marginTop: 4, fontSize: 12, color: "var(--ink-3)" }}>📥 Marked received by team — note: {doc.receivedNote}</div>
      )}
      {rejected && doc.reviewNote && <div style={{ marginLeft: 22, marginTop: 4, fontSize: 12, color: "var(--red)" }}>Asked to re-upload: {doc.reviewNote}</div>}
      {pending && doc.followupNote && (
        <div style={{ marginLeft: 22, marginTop: 4, fontSize: 12, color: "var(--ink-3)" }}>Follow-up note: {doc.followupNote}</div>
      )}
      {flagging && (
        <div style={{ marginLeft: 22, marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea className="notes" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's wrong with it? (the client sees this)" style={{ flex: 1, minHeight: 44, fontSize: 12.5 }} />
          <button className="btn-primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send"}</button>
        </div>
      )}
      {receiving && (
        <div style={{ marginLeft: 22, marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea className="notes" value={receiveNote} onChange={(e) => setReceiveNote(e.target.value)} placeholder="Where did you receive it? (e.g. emailed by client on 24 Jun)" style={{ flex: 1, minHeight: 44, fontSize: 12.5 }} />
          <button className="btn-primary" disabled={busy || !receiveNote.trim()} onClick={markReceived}>{busy ? "Saving…" : "Save"}</button>
        </div>
      )}
      {fuOpen && (
        <div style={{ marginLeft: 22, marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea className="notes" value={fuNote} onChange={(e) => setFuNote(e.target.value)} placeholder="Update on the follow-up (resets the SLA window for the next auto-task)" style={{ flex: 1, minHeight: 44, fontSize: 12.5 }} />
          <button className="btn-primary" disabled={busy || !fuNote.trim()} onClick={sendFu}>{busy ? "Saving…" : "Save"}</button>
        </div>
      )}
      {err && <div style={{ marginLeft: 22, marginTop: 4, fontSize: 12, color: "var(--red)" }}>{err}</div>}
    </div>
  );
}

function MirrorChip({ icon, label, value, done, total }: { icon: string; label: string; value: string; done: boolean; total?: number }) {
  // "0 of 0" reads as a problem — when there are no items to track, surface a green "Completed" pill instead.
  const empty = typeof total === "number" && total === 0;
  const displayValue = empty ? "Completed — no items requested" : value;
  const isDone = empty || done;
  return (
    <div style={{ flex: 1, minWidth: 150, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}><Icon name={icon} size={12} /> {label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: isDone ? "var(--green)" : "var(--ink-1)" }}>{displayValue}</div>
    </div>
  );
}

// Backup for the portal access code: when the client doesn't receive the emailed OTP, the team
// can read them the current code here. It refreshes each time the client requests a new code.
function PortalCodeBackup({ runId }: { runId: string }) {
  const [state, setState] = useState<{ code?: string; secondsLeft?: number; sentTo?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); const r = await getPortalAccessCode(runId); setBusy(false); setState(r); };
  const mins = state?.secondsLeft ? Math.max(1, Math.round(state.secondsLeft / 60)) : 0;
  return (
    <div className="runs-card" style={{ padding: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--bg-soft)", color: "var(--ink-2)", display: "grid", placeItems: "center" }}><Icon name="key-round" size={15} /></span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Access code — backup</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>If the client didn&apos;t get the emailed code, read them the current one. It changes each time they request a new code and expires 10 minutes after it&apos;s sent.</div>
        </div>
        <button className="btn-ghost" disabled={busy} onClick={load}><Icon name={busy ? "loader" : "eye"} size={13} /> {busy ? "Checking…" : "Show current code"}</button>
      </div>
      {state?.error && <div style={{ fontSize: 12.5, color: "var(--amber)", marginTop: 10 }}>{state.error}</div>}
      {state?.code && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, background: "var(--bg-soft)", borderRadius: 9, padding: "10px 14px", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "DM Mono, monospace", fontSize: 22, fontWeight: 700, letterSpacing: "0.18em" }}>{state.code}</span>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>valid ~{mins} min{state.sentTo ? ` · sent to ${state.sentTo}` : ""}</span>
        </div>
      )}
    </div>
  );
}

// Team-side mirror of the access requests: status per system, plus reveal of any
// encrypted login the client stored (credentials mode).
function AccessMirrorPanel({ runId, items, canReveal }: { runId: string; items: { id: string; data: Record<string, unknown>; status: string }[]; canReveal: boolean }) {
  const router = useRouter();
  const [shown, setShown] = useState<Record<string, { username: string; password: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [actionOpen, setActionOpen] = useState<Record<string, "receive" | "followup" | null>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const reveal = async (rowId: string) => {
    if (shown[rowId]) { setShown((s) => { const n = { ...s }; delete n[rowId]; return n; }); return; }
    setBusy(rowId); setErr((e) => ({ ...e, [rowId]: "" }));
    const r = await revealAccessCredentials(runId, rowId);
    setBusy(null);
    if (r.error) setErr((e) => ({ ...e, [rowId]: r.error! }));
    else setShown((s) => ({ ...s, [rowId]: { username: r.username ?? "", password: r.password ?? "" } }));
  };
  const submitReceive = async (rowId: string) => {
    setBusy(rowId); setErr((e) => ({ ...e, [rowId]: "" }));
    const r = await markAccessReceivedOutside(runId, rowId, noteDraft[rowId] ?? "");
    setBusy(null);
    if (r.error) { setErr((e) => ({ ...e, [rowId]: r.error! })); return; }
    setActionOpen((s) => ({ ...s, [rowId]: null }));
    setNoteDraft((s) => ({ ...s, [rowId]: "" }));
    router.refresh();
  };
  const submitFollowup = async (rowId: string) => {
    setBusy(rowId); setErr((e) => ({ ...e, [rowId]: "" }));
    const r = await addAccessFollowupNote(runId, rowId, noteDraft[rowId] ?? "");
    setBusy(null);
    if (r.error) { setErr((e) => ({ ...e, [rowId]: r.error! })); return; }
    setActionOpen((s) => ({ ...s, [rowId]: null }));
    setNoteDraft((s) => ({ ...s, [rowId]: "" }));
    router.refresh();
  };
  return (
    <div className="runs-card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}><Icon name="key-round" size={14} /> Access shared by the client</div>
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((r) => {
          const d = r.data as { label?: string; systemName?: string; method?: string; accessMode?: string; status?: string; note?: string; email?: string; credUsername?: string; credPasswordEnc?: string; items?: Array<{ confirmed?: boolean; receivedOutsidePortal?: boolean; receivedNote?: string; followupNote?: string }>; receivedOutsidePortal?: boolean; receivedNote?: string; followupNote?: string };
          const granted = r.status === "granted" || d.status === "granted";
          const isCred = d.accessMode === "credentials";
          const itemsArr = Array.isArray(d.items) ? d.items : [];
          // surface notes from the first item (or top-level if no items array)
          const recOutside = itemsArr.some((it) => it.receivedOutsidePortal) || !!d.receivedOutsidePortal;
          const recNote = itemsArr.find((it) => it.receivedNote)?.receivedNote ?? d.receivedNote;
          const fuNote = itemsArr.find((it) => it.followupNote && !it.confirmed)?.followupNote ?? d.followupNote;
          const open = actionOpen[r.id] ?? null;
          return (
            <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{d.label ?? "Access"}{d.systemName ? ` · ${d.systemName}` : ""}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{isCred ? "Login credentials" : `Viewer access${d.email ? ` · ${d.email}` : ""}`}</div>
                </div>
                <span className={"pill " + (granted ? "green" : "gray")} style={{ fontSize: 10.5 }}><span className="dot" />{granted ? (isCred ? "Login on file" : "Granted") : "Awaiting client"}</span>
                {!granted && (
                  <>
                    <button className="btn-ghost" style={{ padding: "3px 8px" }} onClick={() => setActionOpen((s) => ({ ...s, [r.id]: open === "receive" ? null : "receive" }))}><Icon name="inbox" size={13} /> Mark received outside portal</button>
                    <button className="btn-ghost" style={{ padding: "3px 8px" }} onClick={() => setActionOpen((s) => ({ ...s, [r.id]: open === "followup" ? null : "followup" }))}><Icon name="message-square" size={13} /> Add follow-up note</button>
                  </>
                )}
                {isCred && d.credPasswordEnc && (
                  canReveal ? (
                    <button className="btn-ghost" onClick={() => reveal(r.id)} disabled={busy === r.id}>
                      <Icon name={shown[r.id] ? "eye-off" : "eye"} size={13} /> {busy === r.id ? "…" : shown[r.id] ? "Hide" : "Reveal login"}
                    </button>
                  ) : (
                    <span style={{ fontSize: 11.5, color: "var(--ink-3)" }} title="Only Senior, Team Lead, AM or admin can see the password.">
                      <Icon name="lock" size={12} /> Restricted
                    </span>
                  )
                )}
              </div>
              {d.note && !isCred && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>Note: {d.note}</div>}
              {granted && recOutside && recNote && (
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>📥 Marked received by team — note: {recNote}</div>
              )}
              {!granted && fuNote && (
                <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>Follow-up note: {fuNote}</div>
              )}
              {open === "receive" && (
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <textarea className="notes" value={noteDraft[r.id] ?? ""} onChange={(e) => setNoteDraft((s) => ({ ...s, [r.id]: e.target.value }))} placeholder="Where / how did the client share it? (e.g. WhatsApp on 22 Jun)" style={{ flex: 1, minHeight: 44, fontSize: 12.5 }} />
                  <button className="btn-primary" disabled={busy === r.id || !(noteDraft[r.id] ?? "").trim()} onClick={() => submitReceive(r.id)}>{busy === r.id ? "Saving…" : "Save"}</button>
                </div>
              )}
              {open === "followup" && (
                <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <textarea className="notes" value={noteDraft[r.id] ?? ""} onChange={(e) => setNoteDraft((s) => ({ ...s, [r.id]: e.target.value }))} placeholder="Update on the follow-up (extends the SLA window)" style={{ flex: 1, minHeight: 44, fontSize: 12.5 }} />
                  <button className="btn-primary" disabled={busy === r.id || !(noteDraft[r.id] ?? "").trim()} onClick={() => submitFollowup(r.id)}>{busy === r.id ? "Saving…" : "Save"}</button>
                </div>
              )}
              {err[r.id] && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{err[r.id]}</div>}
              {shown[r.id] && (
                <div style={{ marginTop: 8, background: "var(--bg-soft)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, display: "grid", gap: 4, fontFamily: "DM Mono, monospace" }}>
                  <div><span style={{ color: "var(--ink-3)" }}>Username:</span> {shown[r.id].username || "—"}</div>
                  <div><span style={{ color: "var(--ink-3)" }}>Password:</span> {shown[r.id].password || "—"}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
// Label for any status value — known ones get a nice label, custom ones are prettified.
const statusLabel = (s: string) => TASK_STATUS_LABEL[s] ?? s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function TaskBoard({
  runId, clientName, contactName, tasks, owners, columns, statuses, sla, confirmStepId, onConfirmStep, onOpenChat,
}: {
  runId: string;
  clientName: string;
  contactName: string | null;
  tasks: TaskRow[];
  owners: { id: string; name: string }[];
  columns: string[];
  statuses: string[];
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
  const [statusMgr, setStatusMgr] = useState<string[] | null>(null); // non-null = manage-statuses modal open
  const [slaOpen, setSlaOpen] = useState(false);
  const [taskFilter, setTaskFilter] = useState<"all" | "active" | "done">("all");
  const [chatTask, setChatTask] = useState<string | null>(null); // per-task chat modal
  const shownTasks = tasks.filter((t) => taskFilter === "all" ? true : taskFilter === "done" ? t.status === "complete" : t.status !== "complete");
  const [slaStart, setSlaStart] = useState(String(sla?.notStartedDays ?? 1));
  const [slaDone, setSlaDone] = useState(String(sla?.notCompletedDays ?? 7));
  const [draft, setDraft] = useState<{ subject: string; body: string; whatsapp: string } | null>(null);
  const [copied, setCopied] = useState<"subject" | "body" | "all" | "wa" | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [draftTab, setDraftTab] = useState<"email" | "whatsapp">("email");
  const [includeForm, setIncludeForm] = useState(true);

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

  const openEmailDraft = async (opts?: { includeForm?: boolean }) => {
    const incForm = opts?.includeForm ?? includeForm;
    setDraftErr(null);
    setCopied(null);
    setDrafting(true);
    setDraft({ subject: `Your Onboarding: Where We Are + What's Next <> ${clientName}`, body: "", whatsapp: "" });
    try {
      const completed = tasks.filter((t) => t.status === "complete").map((t) => ({ title: t.title, notes: t.notes }));
      const inProgress = tasks.filter((t) => t.status !== "complete").map((t) => ({ title: t.title, notes: t.notes }));
      const r = await generateTaskBoardEmailDraft(runId, { clientName, contactName, completed, inProgress, includeForm: incForm });
      if (r.error || !r.body) {
        setDraftErr(r.error || "AI failed");
      } else {
        setDraft({
          subject: r.subject || `Your Onboarding: Where We Are + What's Next <> ${clientName}`,
          body: r.body,
          whatsapp: r.whatsapp || "",
        });
      }
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : "AI failed");
    } finally {
      setDrafting(false);
    }
  };

  const copyText = async (text: string, which: "subject" | "body" | "all" | "wa") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setToast("Couldn't copy — select the text manually.");
      setTimeout(() => setToast(null), 2400);
    }
  };

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
          <button className="btn-ghost" onClick={() => setStatusMgr([...statuses])}><Icon name="list-checks" size={13} /> Manage statuses</button>
          <button className="btn-ghost" onClick={() => setSlaOpen(true)}><Icon name="bell-ring" size={13} /> Reminders</button>
          <button className="btn-ghost" onClick={() => openEmailDraft()} disabled={tasks.length === 0}><Icon name="mail" size={13} /> Email summary</button>
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
          <thead><tr><th style={{ minWidth: 220 }}>Task name</th><th style={{ minWidth: 140 }}>Owner</th><th style={{ width: 140 }}>Due date</th><th style={{ width: 140 }}>Status</th><th style={{ minWidth: 220 }}>Notes</th><th style={{ width: 36 }}></th></tr></thead>
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
                  <input
                    type="date"
                    defaultValue={t.due ?? ""}
                    disabled={busy}
                    onChange={(e) => { if ((e.target.value || null) !== (t.due ?? null)) change(() => updateTask(runId, t.id, { due: e.target.value })); }}
                    style={{ ...inputStyle, width: 130 }}
                  />
                </td>
                <td>
                  <select value={t.status} disabled={busy} onChange={(e) => change(() => setTaskStatus(runId, t.id, e.target.value))} style={inputStyle}>
                    {(statuses.includes(t.status) ? statuses : [t.status, ...statuses]).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                  </select>
                </td>
                <td>
                  <input
                    defaultValue={t.notes ?? ""}
                    disabled={busy}
                    placeholder="Anything you want to write…"
                    onBlur={(e) => { if ((e.target.value || "") !== (t.notes ?? "")) change(() => updateTask(runId, t.id, { notes: e.target.value })); }}
                    style={{ ...inputStyle, width: "100%" }}
                  />
                </td>
                <td>
                  <button className="icon-btn" disabled={busy} onClick={() => change(() => deleteTask(runId, t.id))} style={{ color: "var(--red)" }} aria-label="Delete task"><Icon name="trash-2" size={14} /></button>
                </td>
              </tr>
            ))}
            {!shownTasks.length && <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--ink-3)" }}>{tasks.length ? "No tasks match this filter." : "No tasks yet — click “Add task”."}</td></tr>}
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

      {statusMgr !== null && (
        <div className="modal-overlay open" onClick={() => setStatusMgr(null)}>
          <div className="modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd"><h3>Manage status options</h3><div className="sub">Add, rename or remove the choices in the Status dropdown (e.g. Stuck, Working on it, Approved). Existing tasks keep their value.</div></div>
            <div className="bd" style={{ maxHeight: "56vh" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {statusMgr.map((st, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ color: "var(--ink-4)", fontSize: 12, width: 18 }}>{i + 1}</span>
                    <input value={st} onChange={(e) => setStatusMgr((ss) => ss!.map((c, j) => (j === i ? e.target.value : c)))} style={{ ...inputStyle, flex: 1 }} />
                    <button className="icon-btn" disabled={statusMgr.length <= 1} onClick={() => setStatusMgr((ss) => ss!.filter((_, j) => j !== i))} style={{ color: "var(--red)" }} aria-label="Remove status"><Icon name="trash-2" size={14} /></button>
                  </div>
                ))}
              </div>
              <button className="add-link" onClick={() => setStatusMgr((ss) => [...ss!, "New status"])} style={{ marginTop: 10 }}><Icon name="plus" size={12} /> Add status</button>
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setStatusMgr(null)} disabled={busy}>Cancel</button>
              <button className="btn-primary" disabled={busy || !statusMgr.some((c) => c.trim())} onClick={() => { const ss = statusMgr; setStatusMgr(null); change(() => saveTaskStatuses(runId, ss)); }}>Save statuses</button>
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

      {draft && (
        <div className="modal-overlay open" onClick={() => { if (!drafting) setDraft(null); }}>
          <div className="modal" style={{ width: 660 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>Client update draft — Email + WhatsApp</h3>
              <div className="sub">AI-drafted from this task board using your OpenAI key. Switch tabs to view each channel, edit, then copy & paste. Nothing is sent automatically.</div>
            </div>
            <div className="bd" style={{ maxHeight: "64vh" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button className={"tab-pill" + (draftTab === "email" ? " active" : "")} onClick={() => setDraftTab("email")} disabled={drafting}><Icon name="mail" size={12} /> Email</button>
                <button className={"tab-pill" + (draftTab === "whatsapp" ? " active" : "")} onClick={() => setDraftTab("whatsapp")} disabled={drafting}><Icon name="message-square" size={12} /> WhatsApp</button>
                <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-2)" }}>
                  <input
                    type="checkbox"
                    checked={includeForm}
                    onChange={(e) => { const v = e.target.checked; setIncludeForm(v); openEmailDraft({ includeForm: v }); }}
                    disabled={drafting}
                  />
                  Include feedback form link
                </label>
              </div>

              {draftTab === "email" ? (
                <>
                  <div className="field">
                    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Subject</span>
                      <button className="btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} disabled={drafting || !draft.subject} onClick={() => copyText(draft.subject, "subject")}>
                        <Icon name={copied === "subject" ? "check" : "copy"} size={12} /> {copied === "subject" ? "Copied" : "Copy"}
                      </button>
                    </label>
                    <input value={draft.subject} onChange={(e) => setDraft((d) => (d ? { ...d, subject: e.target.value } : d))} style={inputStyle} disabled={drafting} />
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>Body {drafting && <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 6 }}>· generating…</span>}</span>
                      <button className="btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} disabled={drafting || !draft.body} onClick={() => copyText(draft.body, "body")}>
                        <Icon name={copied === "body" ? "check" : "copy"} size={12} /> {copied === "body" ? "Copied" : "Copy"}
                      </button>
                    </label>
                    <textarea
                      className="notes"
                      value={drafting ? "Drafting with AI… this usually takes a few seconds." : draft.body}
                      onChange={(e) => setDraft((d) => (d ? { ...d, body: e.target.value } : d))}
                      style={{ minHeight: 320, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, whiteSpace: "pre-wrap" }}
                      disabled={drafting}
                    />
                  </div>
                </>
              ) : (
                <div className="field" style={{ marginTop: 4 }}>
                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>WhatsApp message {drafting && <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 6 }}>· generating…</span>}</span>
                    <button className="btn-ghost" style={{ padding: "2px 8px", fontSize: 12 }} disabled={drafting || !draft.whatsapp} onClick={() => copyText(draft.whatsapp, "wa")}>
                      <Icon name={copied === "wa" ? "check" : "copy"} size={12} /> {copied === "wa" ? "Copied" : "Copy"}
                    </button>
                  </label>
                  <textarea
                    className="notes"
                    value={drafting ? "Drafting with AI…" : draft.whatsapp}
                    onChange={(e) => setDraft((d) => (d ? { ...d, whatsapp: e.target.value } : d))}
                    style={{ minHeight: 320, fontSize: 13, whiteSpace: "pre-wrap" }}
                    disabled={drafting}
                  />
                </div>
              )}
              {draftErr && <div style={{ marginTop: 6, color: "var(--red)", fontSize: 12 }}>AI: {draftErr}</div>}
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setDraft(null)} disabled={drafting}>Close</button>
              <button className="btn-ghost" onClick={() => openEmailDraft()} disabled={drafting}><Icon name="refresh-cw" size={13} /> Regenerate</button>
              {draftTab === "email" ? (
                <button className="btn-primary" disabled={drafting || !draft.body} onClick={() => copyText(`Subject: ${draft.subject}\n\n${draft.body}`, "all")}>
                  <Icon name={copied === "all" ? "check" : "copy"} size={13} /> {copied === "all" ? "Copied subject + body" : "Copy subject + body"}
                </button>
              ) : (
                <button className="btn-primary" disabled={drafting || !draft.whatsapp} onClick={() => copyText(draft.whatsapp, "wa")}>
                  <Icon name={copied === "wa" ? "check" : "copy"} size={13} /> {copied === "wa" ? "Copied" : "Copy WhatsApp message"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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

// ── Tax codes builder ─────────────────────────────────────────────────────
type TaxKind = "standard" | "zero" | "exempt" | "rcm" | "out_of_scope";
interface TaxRow { code: string; name: string; rate: number; kind: TaxKind; notes?: string }
const TAX_KIND_OPTIONS: { v: TaxKind; label: string }[] = [
  { v: "standard", label: "Standard" },
  { v: "zero", label: "Zero-rated" },
  { v: "exempt", label: "Exempt" },
  { v: "rcm", label: "Reverse charge" },
  { v: "out_of_scope", label: "Out of scope" },
];
function exportTaxCodesCsv(filename: string, industry: string, codes: TaxRow[]) {
  const rows: (string | number)[][] = [["Code", "Name", "Rate %", "Kind", "Notes", "Industry"]];
  codes.forEach((c) => rows.push([c.code, c.name, c.rate, c.kind, c.notes ?? "", industry]));
  downloadCsvRows(filename, rows);
}

function TaxCodesBuilderModal({ runId, stepId, onClose, onDone }: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const [codes, setCodes] = useState<TaxRow[]>([]);
  const [industry, setIndustry] = useState("");
  const [loading, setLoading] = useState(true);
  const [genBusy, genStart] = useTransition();
  const [saveBusy, saveStart] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    // Hydrate from any prior save on this run; otherwise leave empty until "Generate".
    supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "tax_codes").maybeSingle().then(({ data }) => {
      const d = data?.data as { industry?: string; codes?: TaxRow[] } | null;
      if (d?.codes?.length) { setCodes(d.codes); setIndustry(d.industry ?? ""); }
      setLoading(false);
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const setRow = (i: number, patch: Partial<TaxRow>) => setCodes((arr) => arr.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setCodes((arr) => [...arr, { code: "", name: "", rate: 0, kind: "standard" }]);
  const removeRow = (i: number) => setCodes((arr) => arr.filter((_, j) => j !== i));

  const generate = () => genStart(async () => {
    setMsg(null);
    const r = await generateTaxCodes(runId);
    if (r.error && !r.codes) { setMsg(r.error); return; }
    if (r.codes) setCodes(r.codes);
    if (r.industry) setIndustry(r.industry);
    if (r.error) setMsg(r.error); // partial: e.g. AI failed but baseline returned
  });

  const save = () => saveStart(async () => {
    setMsg(null);
    const r = await saveTaxCodes(runId, stepId, industry, codes);
    if (r.error) setMsg(r.error);
    else onDone();
  });

  const filtered = codes.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.notes ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 920, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Tax codes for this client</h3>
          <div className="sub">Generate from the master list + AI for the client&apos;s industry. Edit, then save — the team picks from these on the run&apos;s books and filings.</div>
        </div>
        <div className="bd" style={{ maxHeight: "66vh" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ flex: "1 1 200px", minWidth: 180 }}>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)" }}>Industry</label>
              <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. E-commerce" style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 13 }} />
            </div>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search codes…" style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "6px 9px", fontSize: 12.5, alignSelf: "flex-end" }} />
            <button className="btn-ai" disabled={genBusy} onClick={generate} style={{ alignSelf: "flex-end" }}>
              <Icon name="sparkles" size={13} /> {genBusy ? "Generating…" : codes.length ? "Re-generate from AI" : "Generate from AI"}
            </button>
            <button className="btn-ghost" disabled={!codes.length} onClick={() => exportTaxCodesCsv(`tax-codes-${(industry || "client").replace(/\s+/g, "-").toLowerCase()}.csv`, industry || "—", codes)} style={{ alignSelf: "flex-end" }}>
              <Icon name="download" size={13} /> Export CSV
            </button>
            <button className="btn-ghost" onClick={addRow} style={{ alignSelf: "flex-end" }}>
              <Icon name="plus" size={13} /> Add code
            </button>
          </div>

          {loading && <div style={{ padding: 20, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>}
          {!loading && codes.length === 0 && (
            <div style={{ background: "var(--bg-soft)", border: "1px dashed var(--border)", borderRadius: 8, padding: "16px 18px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
              Nothing yet. Click <strong>Generate from AI</strong> to pull the UAE baseline + the industry overlay for this client.
            </div>
          )}

          {!loading && codes.length > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1.4fr 70px 130px 1.4fr 40px", padding: "8px 12px", background: "var(--bg-soft)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)" }}>
                <div>Code</div><div>Name</div><div>Rate %</div><div>Kind</div><div>Notes</div><div></div>
              </div>
              {filtered.length === 0 ? (
                <div style={{ padding: 20, textAlign: "center", color: "var(--ink-3)", fontSize: 12.5 }}>Nothing matches.</div>
              ) : codes.map((c, i) => {
                if (search.trim() && !filtered.includes(c)) return null;
                return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 1.4fr 70px 130px 1.4fr 40px", padding: "8px 12px", borderTop: "1px solid var(--border)", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input value={c.code} onChange={(e) => setRow(i, { code: e.target.value })} style={taxInp()} placeholder="VAT-S5" />
                    <input value={c.name} onChange={(e) => setRow(i, { name: e.target.value })} style={taxInp()} placeholder="Standard rated 5%" />
                    <input type="number" value={c.rate} onChange={(e) => setRow(i, { rate: Number(e.target.value) })} style={taxInp()} step={0.5} min={0} />
                    <select value={c.kind} onChange={(e) => setRow(i, { kind: e.target.value as TaxKind })} style={taxInp()}>
                      {TAX_KIND_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                    <input value={c.notes ?? ""} onChange={(e) => setRow(i, { notes: e.target.value })} style={taxInp()} placeholder="Optional notes" />
                    <button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => removeRow(i)} aria-label="Delete row"><Icon name="trash-2" size={13} /></button>
                  </div>
                );
              })}
            </div>
          )}

          {msg && <div style={{ marginTop: 10, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", fontSize: 12.5 }}>{msg}</div>}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saveBusy}>Cancel</button>
          <button className="btn-primary" disabled={saveBusy || codes.length === 0} onClick={save}>{saveBusy ? "Saving…" : "Save tax codes"}</button>
        </div>
      </div>
    </div>
  );
}

function taxInp(): React.CSSProperties {
  return { border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5, background: "#fff", color: "var(--ink-1)", fontFamily: "inherit" };
}

const DIAG_NODE_W = 156;
const DIAG_NODE_H = 54;

function DiagramBuilderModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const [diagrams, setDiagrams] = useState<DiagramInput[]>([{
    name: "Monthly Close",
    nodes: [
      { id: "n1", label: "Bank feed imported", type: "start", x: 60, y: 30 },
      { id: "n2", label: "Junior books transactions", type: "step", x: 60, y: 140 },
      { id: "n3", label: "Reconciled?", type: "decision", x: 60, y: 250 },
      { id: "n4", label: "Senior review & close", type: "end", x: 60, y: 360 },
    ],
    edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3" }, { from: "n3", to: "n4" }],
  }]);
  const [sel, setSel] = useState(0);
  const [saving, start] = useTransition();
  const [aiBrief, setAiBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [mode, setMode] = useState<"select" | "connect">("select");
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const d = diagrams[sel];
  const edges = d.edges ?? [];

  const update = (fn: (x: DiagramInput) => DiagramInput) => setDiagrams((arr) => arr.map((x, i) => (i === sel ? fn(x) : x)));
  const setNodes = (fn: (ns: DiagramNode[]) => DiagramNode[]) => update((x) => ({ ...x, nodes: fn(x.nodes) }));
  const setEdges = (fn: (es: { from: string; to: string }[]) => { from: string; to: string }[]) => update((x) => ({ ...x, edges: fn(x.edges ?? []) }));

  const aiGen = async () => {
    setAiBusy(true);
    const r = await generateDiagram(runId, aiBrief);
    setAiBusy(false);
    if (r.nodes?.length) {
      const nodes: DiagramNode[] = r.nodes.map((n, i) => ({ ...n, x: 60 + (i % 2) * 230, y: 30 + i * 92 }));
      const newEdges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
      update((x) => ({ ...x, nodes, edges: newEdges }));
    }
  };
  const addNode = () => { const id = crypto.randomUUID().slice(0, 8); setNodes((ns) => [...ns, { id, label: "New step", type: "step", x: 90, y: 70 }]); setSelNode(id); };
  const setNode = (id: string, k: "label" | "type", v: string) => setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, [k]: v } : n)));
  const delNode = (id: string) => { setNodes((ns) => ns.filter((n) => n.id !== id)); setEdges((es) => es.filter((e) => e.from !== id && e.to !== id)); if (selNode === id) setSelNode(null); };
  const delEdge = (from: string, to: string) => setEdges((es) => es.filter((e) => !(e.from === from && e.to === to)));

  const onNodeDown = (e: React.PointerEvent, n: DiagramNode) => {
    e.stopPropagation();
    if (mode === "connect") {
      if (!connectFrom) { setConnectFrom(n.id); return; }
      if (connectFrom !== n.id) setEdges((es) => es.some((x) => x.from === connectFrom && x.to === n.id) ? es : [...es, { from: connectFrom, to: n.id }]);
      setConnectFrom(null);
      return;
    }
    setSelNode(n.id);
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    setDrag({ id: n.id, dx: e.clientX - rect.left - (n.x ?? 0), dy: e.clientY - rect.top - (n.y ?? 0) });
  };
  const onCanvasMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - rect.left - drag.dx));
    const y = Math.max(0, Math.round(e.clientY - rect.top - drag.dy));
    setNodes((ns) => ns.map((n) => (n.id === drag.id ? { ...n, x, y } : n)));
  };
  const ctr = (n: DiagramNode) => ({ x: (n.x ?? 0) + DIAG_NODE_W / 2, y: (n.y ?? 0) + DIAG_NODE_H / 2 });
  const byId = (id: string) => d.nodes.find((n) => n.id === id);
  const selected = selNode ? byId(selNode) : null;
  const canvasH = Math.max(440, ...d.nodes.map((n) => (n.y ?? 0) + DIAG_NODE_H + 40));

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 900, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Build workflow diagrams</h3><div className="sub">Drag the boxes to arrange them. Use Connect to link steps. Saved to the client playbook → Workflows.</div></div>
        <div className="bd" style={{ maxHeight: "70vh" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            {diagrams.map((dg, i) => (
              <button key={i} className={"tab-pill" + (i === sel ? " active" : "")} onClick={() => { setSel(i); setSelNode(null); setConnectFrom(null); }}>{dg.name || `Diagram ${i + 1}`}</button>
            ))}
            <button className="tab-pill" onClick={() => { setDiagrams((a) => [...a, { name: `Diagram ${a.length + 1}`, nodes: [], edges: [] }]); setSel(diagrams.length); }}>+ Add diagram</button>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input value={d.name} onChange={(e) => update((x) => ({ ...x, name: e.target.value }))} placeholder="Diagram name" style={{ width: 180, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13 }} />
            <button className="btn-ghost" onClick={addNode}><Icon name="plus" size={13} /> Add node</button>
            <button className={mode === "connect" ? "btn-primary" : "btn-ghost"} onClick={() => { setMode((m) => (m === "connect" ? "select" : "connect")); setConnectFrom(null); }}>
              <Icon name="spline" size={13} /> {mode === "connect" ? (connectFrom ? "Pick target…" : "Connecting — pick source") : "Connect"}
            </button>
            <div style={{ flex: 1 }} />
            <input value={aiBrief} onChange={(e) => setAiBrief(e.target.value)} placeholder="Describe the process → AI draws it" style={{ width: 240, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13 }} />
            <button className="btn-ai" disabled={aiBusy || !aiBrief.trim()} onClick={aiGen}><Icon name="sparkles" size={13} /> {aiBusy ? "Drawing…" : "Generate"}</button>
          </div>

          {/* Canvas */}
          <div
            onPointerMove={onCanvasMove}
            onPointerUp={() => setDrag(null)}
            onPointerLeave={() => setDrag(null)}
            onClick={() => { setSelNode(null); setConnectFrom(null); }}
            style={{
              position: "relative", height: canvasH, borderRadius: 10, overflow: "hidden",
              border: "1px solid var(--border)", background: "var(--bg-soft)",
              backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "20px 20px",
              cursor: mode === "connect" ? "crosshair" : "default", touchAction: "none",
            }}
          >
            <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
              <defs>
                <marker id="diag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink-3)" />
                </marker>
              </defs>
              {edges.map((e, i) => {
                const a = byId(e.from), b = byId(e.to);
                if (!a || !b) return null;
                const p = ctr(a), q = ctr(b);
                return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="var(--ink-3)" strokeWidth={2} markerEnd="url(#diag-arrow)" />;
              })}
            </svg>

            {d.nodes.length === 0 && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "var(--ink-3)", fontSize: 13 }}>
                Add a node or generate with AI to start.
              </div>
            )}

            {d.nodes.map((n) => {
              const s = NODE_STYLE[n.type] ?? NODE_STYLE.step;
              const isSel = selNode === n.id, isFrom = connectFrom === n.id;
              return (
                <div
                  key={n.id}
                  onPointerDown={(e) => onNodeDown(e, n)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute", left: n.x ?? 0, top: n.y ?? 0, width: DIAG_NODE_W, minHeight: DIAG_NODE_H,
                    background: s.bg, color: s.color, borderRadius: n.type === "decision" ? 4 : 10,
                    border: isSel || isFrom ? "2px solid var(--orange)" : "1px solid rgba(0,0,0,0.08)",
                    padding: "8px 10px", fontSize: 12, fontWeight: 600, textAlign: "center",
                    display: "grid", placeItems: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                    cursor: mode === "connect" ? "crosshair" : "grab", userSelect: "none",
                    transform: n.type === "decision" ? "skewX(-6deg)" : "none",
                  }}
                >
                  {n.label}
                </div>
              );
            })}
          </div>

          {/* Selected-node inspector */}
          {selected && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase" }}>Node</span>
              <input value={selected.label} onChange={(e) => setNode(selected.id, "label", e.target.value)} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 9px", fontSize: 13 }} />
              <select value={selected.type} onChange={(e) => setNode(selected.id, "type", e.target.value)}>{NODE_TYPES.map((t) => <option key={t} value={t}>{NODE_STYLE[t].label}</option>)}</select>
              <button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => delNode(selected.id)}><Icon name="trash-2" size={14} /></button>
            </div>
          )}

          {/* Connections list (for deleting links) */}
          {edges.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {edges.map((e, i) => {
                const a = byId(e.from), b = byId(e.to);
                if (!a || !b) return null;
                return (
                  <span key={i} className="pill" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {a.label} → {b.label}
                    <button className="icon-btn" style={{ width: 16, height: 16, color: "var(--red)" }} onClick={() => delEdge(e.from, e.to)}><Icon name="x" size={11} /></button>
                  </span>
                );
              })}
            </div>
          )}
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
  runId, stepId, kind, existing, linkedSops = [], people = [], assignedTeam = [], onClose, onDone,
}: {
  runId: string; stepId: string; kind: string;
  existing: { id: string; data: Record<string, unknown>; status: string }[];
  linkedSops?: { id: string; title: string }[];
  people?: { id: string; name: string; role: string }[];
  assignedTeam?: { id: string; name: string; role: string }[];
  onClose: () => void; onDone: () => void;
}) {
  // Columns are configurable for the catch-up & compliance boards (add/remove/rename + dropdown options).
  const configurable = kind === "catchup" || kind === "compliance";
  const [cols, setCols] = useState<BoardCol[]>(ITEM_FIELDS[kind]);
  const [colMgr, setColMgr] = useState(false);
  useEffect(() => {
    if (!configurable) return;
    getBoardCols(runId, kind).then((r) => { if (r.cols) setCols(r.cols); });
  }, [runId, kind, configurable]);
  const fields = cols;
  // Catch-up routes to the ALC team (Anju) by default — the user can switch
  // to the onboarding team if they want to handle it in-house.
  const [catchupTeam, setCatchupTeam] = useState<"my" | "other">(kind === "catchup" ? "other" : "my");
  const [catchupAm, setCatchupAm] = useState("");
  // Catch-up is optional — the team can declare there's no backlog and skip it.
  const [catchupNeeded, setCatchupNeeded] = useState(existing.length > 0);
  const ownerPool = (catchupTeam === "my" && assignedTeam.length ? assignedTeam : people);
  const baseAmPool = people.filter((p) => p.role === "am" || /account manager/i.test(p.role));
  const [alcSuggested, setAlcSuggested] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (kind !== "catchup") return;
    suggestCatchupAssignee().then((r) => {
      const pick = r.suggested ?? r.head ?? null;
      if (pick) {
        setAlcSuggested(pick);
        setCatchupAm((cur) => cur || pick.id);
      }
    });
  }, [kind]);
  const amPool = (() => {
    if (!alcSuggested) return baseAmPool;
    const exists = baseAmPool.some((p) => p.id === alcSuggested.id);
    return exists ? baseAmPool : [{ id: alcSuggested.id, name: `${alcSuggested.name} (ALC team)`, role: "am" }, ...baseAmPool];
  })();
  const blankRow = () => kind === "project" ? { task: "", cadence: "monthly", when: "" } : Object.fromEntries(fields.map((f) => [f.k, ""]));
  const [rows, setRows] = useState<Record<string, string>[]>(existing.length ? existing.map((e) => e.data as Record<string, string>) : [blankRow()]);
  const [saving, start] = useTransition();
  const [aiBusy, setAiBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [pBrief, setPBrief] = useState(""); // project AI: plain-language task list
  // Link SOPs / templates to internal projects & tasks.
  const [sopList, setSopList] = useState<{ id: string; title: string; flow: string | null; category: string | null }[]>([]);
  const [tplList, setTplList] = useState<{ id: string; name: string }[]>([]);
  const [linkedSopIds, setLinkedSopIds] = useState<string[]>(linkedSops.map((s) => s.id));
  useEffect(() => { if (kind === "project") { listSops().then((r) => setSopList(r.sops)); listTemplatesLite().then((r) => setTplList(r.templates)); } }, [kind]);

  const setCell = (i: number, k: string, v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const addRow = () => setRows((r) => [...r, blankRow()]);
  const del = (i: number) => setRows((r) => r.filter((_, j) => j !== i));

  const aiCompliance = async () => {
    setAiBusy(true); setInfo(null);
    const r = await generateCompliance(runId);
    setAiBusy(false);
    if (r.error) setInfo(r.error);
    else if (r.items?.length) setRows(r.items.map((i) => ({ label: i.label, date: i.date, type: i.type, reminderDays: String(i.reminderDays ?? 30) })));
  };
  const aiComplianceDocs = async () => {
    setAiBusy(true); setInfo(null);
    const r = await generateComplianceFromDocs(runId);
    setAiBusy(false);
    if (r.error) { setInfo(r.error); return; }
    if (r.empty) { setInfo(r.scanned ? "Read the uploaded documents but found no expiry/renewal dates in them." : "No documents in the folder yet — the calendar is built from your documents' expiry dates. Ask the client to upload documents first."); return; }
    if (r.items?.length) setRows(r.items.map((i) => ({ label: i.label, date: i.date, type: i.type, reminderDays: String(i.reminderDays ?? 30) })));
  };
  const aiRecurring = async () => { setAiBusy(true); setInfo(null); const r = await generateRecurringTasks(runId, pBrief); setAiBusy(false); if (r.error) setInfo(r.error); else if (r.items?.length) setRows(r.items.map((i) => ({ task: i.task, cadence: CADENCES.includes(i.cadence) ? i.cadence : "monthly", when: i.when }))); };
  // Spin a tracked compliance item into a lightweight renewal run (one task, no config) in My Work.
  const makeRenewal = (row: Record<string, string>) => start(async () => {
    setInfo(null);
    const r = await createComplianceRenewalRun(runId, { label: row.label, type: row.type, date: row.date });
    setInfo(r.error ? r.error : `Renewal task created in My Work for the assigned AM${row.date ? ` (due ${row.date})` : ""}.`);
  });

  const saveItems = (after?: "email") => start(async () => {
    // No catch-up needed → save an empty board and complete the step (go straight to go-live).
    if (kind === "catchup" && !catchupNeeded) {
      const res = await saveRunItems(runId, stepId, "catchup", []);
      if (res.error) { setInfo(res.error); return; }
      onDone(); return;
    }
    // Catch-up handed to a different team → create a dedicated run for that team's AM.
    if (kind === "catchup" && catchupTeam === "other") {
      if (!catchupAm) { setInfo("Pick the Account Manager for the catch-up team."); return; }
      const amName = people.find((p) => p.id === catchupAm)?.name ?? "AM";
      const r = await escalateCatchup(runId, stepId, catchupAm, amName, rows.filter((row) => Object.values(row).some((v) => v)));
      if (r.error) { setInfo(r.error); return; }
      onDone(); return;
    }
    const items: RunItemInput[] = rows.filter((r) => Object.values(r).some((v) => v)).map((r) => ({ data: r, status: "open" }));
    if (configurable) await saveBoardCols(runId, kind, cols);
    const res = await saveRunItems(runId, stepId, kind, items);
    if (res.error) { setInfo(res.error); return; }
    if (kind === "project") {
      await saveLinkedSops(runId, sopList.filter((s) => linkedSopIds.includes(s.id)).map((s) => ({ id: s.id, title: s.title })));
    }
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
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <button className="btn-ai" disabled={aiBusy} onClick={aiComplianceDocs}><Icon name="folder-open" size={13} /> {aiBusy ? "Reading documents…" : "Build from uploaded documents"}</button>
              <button className="btn-ghost" disabled={aiBusy} onClick={aiCompliance}><Icon name="sparkles" size={13} /> Add statutory dates (VAT / CT / WPS)</button>
            </div>
          )}
          {kind === "catchup" && (
            <div style={{ background: "var(--bg-soft)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Does this client need catch-up accounting?</div>
              <div className="radio-row">
                <label className={"radio" + (!catchupNeeded ? " selected" : "")}><input type="radio" checked={!catchupNeeded} onChange={() => setCatchupNeeded(false)} /><div><div className="r-ttl">No catch-up needed</div><div className="r-desc">Books are current — go straight to go-live.</div></div></label>
                <label className={"radio" + (catchupNeeded ? " selected" : "")}><input type="radio" checked={catchupNeeded} onChange={() => setCatchupNeeded(true)} /><div><div className="r-ttl">Yes — there&apos;s a backlog</div><div className="r-desc">Configure the catch-up tasks below.</div></div></label>
              </div>
              {!catchupNeeded && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 8 }}>No backlog — click &ldquo;Save &amp; confirm&rdquo; to skip catch-up.</div>}
            </div>
          )}
          {kind === "catchup" && catchupNeeded && (
            <div style={{ background: "var(--bg-soft)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Who runs the catch-up?</div>
              <div className="radio-row">
                <label className={"radio" + (catchupTeam === "other" ? " selected" : "")}><input type="radio" checked={catchupTeam === "other"} onChange={() => setCatchupTeam("other")} /><div><div className="r-ttl">ALC catch-up team{alcSuggested ? ` (${alcSuggested.name})` : ""}</div><div className="r-desc">Creates a parallel catch-up run for the ALC team — Anju by default. They configure and assign.</div></div></label>
                <label className={"radio" + (catchupTeam === "my" ? " selected" : "")}><input type="radio" checked={catchupTeam === "my"} onChange={() => setCatchupTeam("my")} /><div><div className="r-ttl">In-house — same onboarding team</div><div className="r-desc">The Senior/Junior already on this run handle it. No parallel run.</div></div></label>
              </div>
              {catchupTeam === "other" && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)", display: "block", marginBottom: 4 }}>Account Manager for the catch-up team</label>
                  <select value={catchupAm} onChange={(e) => setCatchupAm(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, minWidth: 220 }}>
                    <option value="">Select an AM…</option>
                    {amPool.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}>On save, a dedicated catch-up run is created for this AM, pre-seeded with the tasks below.</div>
                </div>
              )}
              {ownerPool.length === 0 && catchupTeam === "my" && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 8 }}>No team members available to assign yet.</div>}
            </div>
          )}
          {kind === "project" && (
            <div style={{ background: "var(--bg-soft)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Describe the recurring tasks (optional AI)</div>
              <textarea className="notes" value={pBrief} onChange={(e) => setPBrief(e.target.value)} placeholder="e.g. Document request monthly 5th, bills & sales booking daily, salary processing monthly 25th, weekly sync meeting with client Thursday" style={{ minHeight: 56 }} />
              <button className="btn-ai" disabled={aiBusy || !pBrief.trim()} onClick={aiRecurring} style={{ marginTop: 6 }}><Icon name="sparkles" size={13} /> {aiBusy ? "Reading…" : "Generate tasks with AI"}</button>
            </div>
          )}
          {kind === "project" && (
            <div style={{ background: "var(--bg-soft)", borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>Link SOPs / templates (optional)</div>
              <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 8 }}>Attach the SOPs the team should follow for this client&apos;s recurring delivery. They show in the playbook.</div>
              {sopList.length === 0 ? (
                <div style={{ fontSize: 12, color: "var(--ink-4)" }}>No SOPs in your library yet — create them in the SOP Library.</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {sopList.map((s) => {
                    const on = linkedSopIds.includes(s.id);
                    return (
                      <button key={s.id} type="button" onClick={() => setLinkedSopIds((ids) => on ? ids.filter((x) => x !== s.id) : [...ids, s.id])}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "5px 10px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? "var(--orange)" : "var(--border)"), background: on ? "var(--orange-soft)" : "#fff", color: on ? "var(--orange)" : "var(--ink-2)" }}>
                        <Icon name={on ? "check" : "plus"} size={12} /> {s.title}{s.flow ? ` · ${s.flow}` : ""}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {configurable && (
            <div style={{ marginBottom: 10 }}>
              <button className="btn-ghost" onClick={() => setColMgr((v) => !v)}><Icon name="columns" size={13} /> {colMgr ? "Done managing columns" : "Manage columns"}</button>
              {colMgr && (
                <div style={{ background: "var(--bg-soft)", borderRadius: 8, padding: 12, marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  {cols.map((c, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <input value={c.l} onChange={(e) => setCols((cs) => cs.map((x, j) => (j === i ? { ...x, l: e.target.value } : x)))} placeholder="Column name" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, width: 150 }} />
                      <input value={(c.opts ?? []).join(", ")} onChange={(e) => setCols((cs) => cs.map((x, j) => (j === i ? { ...x, opts: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x)))} placeholder="Dropdown options (comma-separated) — blank = free text" style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, flex: 1, minWidth: 220 }} />
                      <button className="icon-btn" style={{ color: "var(--red)" }} disabled={cols.length <= 1} onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))}><Icon name="trash-2" size={13} /></button>
                    </div>
                  ))}
                  <button className="add-link" onClick={() => setCols((cs) => [...cs, { k: "col" + cs.length + Math.floor(Math.random() * 1e4).toString(36), l: "New column" }])}><Icon name="plus" size={12} /> Add column</button>
                  <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Add comma-separated options to turn any column into a dropdown.</div>
                </div>
              )}
            </div>
          )}
          {!(kind === "catchup" && !catchupNeeded) && (<>
          {kind === "project" ? (
            <table className="runs-table" style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
              <thead><tr><th style={{ minWidth: 180 }}>Task</th><th>Cadence</th><th>When</th><th>SOP</th><th>Template</th><th></th></tr></thead>
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
                      <td>
                        <select value={row.sop ?? ""} onChange={(e) => setCell(i, "sop", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12, maxWidth: 150 }}>
                          <option value="">— SOP —</option>
                          {sopList.map((s) => <option key={s.id} value={s.title}>{s.title}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={row.template ?? ""} onChange={(e) => setCell(i, "template", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12, maxWidth: 150 }}>
                          <option value="">— Template —</option>
                          {tplList.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                        </select>
                      </td>
                      <td><button className="icon-btn" onClick={() => del(i)} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
          <table className="runs-table" style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
            <thead><tr>{fields.map((f) => <th key={f.k}>{f.l}</th>)}{kind === "compliance" && <th title="Days before the due date that an AM heads-up is fired">Reminder (days)</th>}<th></th></tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {fields.map((f) => (
                    <td key={f.k}>
                      {kind === "catchup" && f.k === "owner" ? (
                        <select value={row[f.k] ?? ""} onChange={(e) => setCell(i, f.k, e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, minWidth: 130 }}>
                          <option value="">Assign to…</option>
                          {ownerPool.map((p) => <option key={p.id} value={p.name}>{p.name} · {ROLE_LBL[p.role] ?? p.role}</option>)}
                          {row.owner && !ownerPool.some((p) => p.name === row.owner) && <option value={row.owner}>{row.owner}</option>}
                        </select>
                      ) : f.opts ? (
                        <select value={row[f.k] ?? ""} onChange={(e) => setCell(i, f.k, e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5 }}>
                          <option value="">—</option>{f.opts.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input value={row[f.k] ?? ""} onChange={(e) => setCell(i, f.k, e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, width: "100%" }} />
                      )}
                    </td>
                  ))}
                  {kind === "compliance" && (
                    <td><input type="number" min={1} value={row.reminderDays ?? "30"} onChange={(e) => setCell(i, "reminderDays", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, width: 80 }} /></td>
                  )}
                  <td style={{ whiteSpace: "nowrap" }}>
                    {kind === "compliance" && (row.label || row.type) && (
                      <button className="icon-btn" title="Create a renewal task in My Work for this item" disabled={saving} onClick={() => makeRenewal(row)} style={{ color: "var(--orange)" }}><Icon name="calendar-plus" size={14} /></button>
                    )}
                    <button className="icon-btn" onClick={() => del(i)} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          {kind === "compliance" && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}><Icon name="calendar-plus" size={12} /> The calendar icon on a row creates a renewal task in the AM&apos;s My Work — no step setup needed. Items also auto-create a task when their due date arrives.</div>}
          <button className="add-link" onClick={addRow} style={{ marginTop: 8 }}><Icon name="plus" size={12} /> Add row</button>
          </>)}
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
  // Tax items default to the Tax Head (Gautam Sanoj). Per-row "Auto-assign by
  // load" picks the least-loaded member of his subtree using the capacity logic.
  const [taxHead, setTaxHead] = useState<{ id: string; name: string } | null>(null);
  const [rows, setRows] = useState<{ item: string; memberId: string; severity: string; isTax: boolean }[]>([{ item: "", memberId: "", severity: "High", isTax: true }]);
  const [saving, start] = useTransition();
  const [assigning, setAssigning] = useState<number | null>(null);

  useEffect(() => {
    suggestTaxAssignee().then((r) => {
      if (r.head) {
        setTaxHead(r.head);
        // Pre-fill the Tax Head into all tax-flagged rows that aren't already set.
        setRows((rs) => rs.map((x) => (x.isTax && !x.memberId ? { ...x, memberId: r.head!.id } : x)));
      }
    });
  }, []);

  const set = (i: number, k: string, v: string | boolean) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  // Make sure the Tax Head shows up in the dropdown even if he's not in `people`.
  const dropdownPeople = (() => {
    if (!taxHead) return people;
    if (people.some((p) => p.id === taxHead.id)) return people;
    return [{ id: taxHead.id, name: `${taxHead.name} (Tax Head)` }, ...people];
  })();

  const autoAssignRow = (i: number) => {
    setAssigning(i);
    suggestTaxAssignee().then((r) => {
      setAssigning(null);
      if (r.suggested) {
        set(i, "memberId", r.suggested.id);
        // Also add into the dropdown list if not present.
        if (!dropdownPeople.some((p) => p.id === r.suggested!.id)) {
          // No-op for state — render adds dynamically below.
        }
      }
    });
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 760, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Urgent compliance triage</h3>
          <div className="sub">Flag penalty-risk items (CT / VAT / WPS / AML) and route each to an owner. Tax items default to <strong>{taxHead?.name ?? "the Tax Head"}</strong> — he can click <em>Auto-assign by load</em> to push it to the lowest-load member of his team.</div>
        </div>
        <div className="bd">
          {rows.map((row, i) => {
            const namedAssignee = dropdownPeople.find((p) => p.id === row.memberId)?.name;
            const showFallback = row.memberId && !namedAssignee;  // when auto-assign sets to someone not in `people`
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 110px 200px auto", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <input placeholder="Risk item (e.g. CT registration overdue)" value={row.item} onChange={(e) => set(i, "item", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13 }} />
                <select value={row.severity} onChange={(e) => set(i, "severity", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 8px", fontSize: 13 }}>{["High", "Medium", "Low"].map((s) => <option key={s}>{s}</option>)}</select>
                <select value={row.memberId} onChange={(e) => set(i, "memberId", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 8px", fontSize: 13 }}>
                  <option value="">Assign to…</option>
                  {dropdownPeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  {showFallback && <option value={row.memberId}>{row.memberId} (auto-assigned)</option>}
                </select>
                <button
                  type="button"
                  onClick={() => autoAssignRow(i)}
                  disabled={assigning === i || saving}
                  title="Pick the least-loaded tax-team member"
                  className="btn-ghost"
                  style={{ fontSize: 11.5, padding: "5px 8px", whiteSpace: "nowrap" }}
                >
                  <Icon name="zap" size={11} /> {assigning === i ? "…" : "Auto-assign"}
                </button>
              </div>
            );
          })}
          <button className="add-link" onClick={() => setRows((r) => [...r, { item: "", memberId: taxHead?.id ?? "", severity: "High", isTax: true }])}><Icon name="plus" size={12} /> Add item</button>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 10, display: "flex", gap: 6, alignItems: "flex-start" }}><Icon name="info" size={13} /> Each item creates a new run for the assigned owner. <em>Auto-assign by load</em> uses the tax-team capacity ceiling from Settings.</div>
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-ghost" disabled={saving} onClick={() => start(async () => { await escalateUrgentCompliance(runId, stepId, []); onDone(); })}>No urgent items</button>
          <button className="btn-primary" disabled={saving} onClick={() => start(async () => { const items = rows.filter((r) => r.item.trim() && r.memberId).map((r) => ({ item: r.item.trim(), amId: r.memberId, amName: dropdownPeople.find((p) => p.id === r.memberId)?.name ?? (taxHead?.id === r.memberId ? taxHead.name : ""), severity: r.severity })); const res = await escalateUrgentCompliance(runId, stepId, items); if (!res.error) onDone(); })}>{saving ? "Creating run(s)…" : "Create run(s) for owner"}</button>
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

const DECK_STATS = [
  { v: "7000+", l: "Happy Founders" },
  { v: "4.9", l: "Trustpilot Rating" },
  { v: "136+", l: "Smart Solutions Team" },
  { v: "9.4", l: "NPS Score" },
];
const DECK_FOUNDER_QUOTE = `"From starting our own businesses in the past, we know that running the back-office was a major distraction; and working with technically challenged accountants was no fun at all. Of all industries out there, accounting was one of the few that had yet to be modernised. We are not just an accounting firm — we want to completely change the way that business owners think about their finances."`;
const DECK_FOUNDER_NAME = "Muhammed Shafeekh · Founder & CEO, Finanshels";
const DECK_VALUES = [
  { n: "01", t: "Personalised Service", d: "Tailoring solutions to your specific business needs." },
  { n: "02", t: "Transparency & Compliance", d: "We ensure all regulations are met and provide clear communication." },
  { n: "03", t: "End-to-End Support", d: "From planning to execution, continuous support for your success." },
];
const DECK_SERVICES = [
  { t: "Accounting & Analytics", d: "Efficient financial management and insightful analytics to support business growth." },
  { t: "Audit", d: "Ensure financial accuracy and compliance with expert audit services." },
  { t: "VAT Registration & Filing", d: "Timely VAT filing and registration with the Federal Tax Authority." },
  { t: "Corporate Tax Registration & Filing", d: "Ensure your business is registered and CT filed accurately to avoid penalties." },
  { t: "AML", d: "Comprehensive services ensuring compliance with all relevant laws and regulations." },
  { t: "Liquidation", d: "Close your business with confidence — expert liquidation services for DDA compliance." },
  { t: "Fractional CFO", d: "Access to experienced CFOs without the full-time commitment." },
  { t: "Outsourced Finance Operations", d: "Tailored financial strategies and operations management to optimise efficiency." },
];
const DECK_TESTIMONIALS = [
  { q: "Fast, friendly, and very professional. I love how communicative they were handling our Corporate tax registration.", n: "Abdulla Al-Ogail", r: "Co-founder & CEO · OLYMON" },
  { q: "I've worked with Finanshels in auditing our financial statements & submitting the corporate tax return. Very professional and on the agreed timeline.", n: "Maged Yousry", r: "Manager · Estaie Tech" },
  { q: "Always very responsive, supportive, with a business mindset and open to feedback. Very happy I took the decision to work with them.", n: "Szilvia Vitos", r: "Founder · LIVVITY" },
  { q: "They designed an accounting system tailor-made to our needs & completely automated our finance operations just like they promised.", n: "Jeremy Khatar", r: "CEO · Ronin Global LLC, USA" },
];

function deckSlide(d: DeckData, idx: number): React.ReactNode {
  const wu = d.whatWeUnderstood;
  // New slide order (15 slides): 0 Cover · 1 Our Story · 2 Mission · 3 Services ·
  // 4 Roadmap · 5 What We Understood · 6 Compliance · 7 Software · 8 Data ·
  // 9 Connected · 10 Scope · 11 Terms · 12 Next Steps · 13 Testimonials · 14 Thanks
  switch (idx) {
    case 0:
      return (
        <div className="fsdeck-slide fsdeck-cover">
          <div className="fsdeck-cover-glow" />
          <div className="fsdeck-cover-body">
            <div className="fsdeck-eyebrow orange">Trusted by 7,000+ SMEs · Welcome to Finanshels</div>
            <h1 className="fsdeck-cover-title">Welcome,<br /><span className="o">{d.clientName}</span></h1>
            <div className="fsdeck-cover-mission">Welcome to Finanshels, {d.clientName}! We&apos;re excited to streamline your accounting and tax processes, ensuring compliance and efficiency.</div>
          </div>
          <div className="fsdeck-cover-foot">Finanshels Onboarding · Your partner in financial growth</div>
        </div>
      );
    case 1:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Trusted by 7,000+ SMEs</div><h2 className="fsdeck-h2">Our Story</h2></div></div>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 24, alignItems: "stretch" }}>
            <div style={{ background: "var(--fsd-cream, #FFF7E9)", border: "1px solid var(--fsd-line, #ECE3D2)", borderRadius: 14, padding: 22, fontSize: 14, lineHeight: 1.6, color: "var(--fsd-ink, #1B2733)" }}>
              <div style={{ fontSize: 32, color: "var(--fsd-orange, #F97316)", lineHeight: 0.9, marginBottom: 4 }}>“</div>
              <div style={{ fontStyle: "italic" }}>{DECK_FOUNDER_QUOTE.replace(/^"|"$/g, "")}</div>
              <div style={{ fontWeight: 700, marginTop: 14, color: "var(--fsd-navy, #082032)" }}>— {DECK_FOUNDER_NAME}</div>
            </div>
            <div style={{ display: "grid", gridTemplateRows: "repeat(4, 1fr)", gap: 10 }}>
              {DECK_STATS.map((s) => (
                <div key={s.l} style={{ background: "#fff", border: "1px solid var(--fsd-line, #ECE3D2)", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 11.5, color: "var(--fsd-ink-2, #51606E)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{s.l}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "var(--fsd-orange, #F97316)" }}>{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    case 2:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Trusted by 7,000+ SMEs</div><h2 className="fsdeck-h2">Our Mission &amp; Values</h2></div></div>
          <div style={{ fontSize: 14, color: "var(--fsd-ink-2, #51606E)", lineHeight: 1.6, marginBottom: 18 }}>
            We&apos;re on a mission to simplify financial life for SMEs through a technology-first approach — giving founders the tools they need to manage finance seamlessly and stay on top of every regulation.
          </div>
          <div className="fsdeck-grid3">
            {DECK_VALUES.map((v) => (
              <div key={v.n} className="fsdeck-phase" style={{ background: "#fff" }}>
                <div className="fsdeck-phase-n">{v.n}</div>
                <div className="fsdeck-phase-t">{v.t}</div>
                <div className="fsdeck-phase-d">{v.d}</div>
              </div>
            ))}
          </div>
        </div>
      );
    case 3:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Trusted by 7,000+ SMEs</div><h2 className="fsdeck-h2">Services That Grow With You</h2><div className="fsdeck-sub">Everything we offer to help you navigate accounting, tax and compliance.</div></div></div>
          <div className="fsdeck-grid2" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {DECK_SERVICES.map((s) => (
              <div key={s.t} className="fsdeck-card" style={{ padding: 14 }}>
                <div className="fsdeck-card-label" style={{ fontSize: 13, fontWeight: 700 }}>{s.t}</div>
                <div className="fsdeck-card-val" style={{ fontSize: 11.5, marginTop: 6, lineHeight: 1.4, color: "var(--fsd-ink-2, #51606E)" }}>{s.d}</div>
              </div>
            ))}
          </div>
        </div>
      );
    case 4:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Roadmap</div><h2 className="fsdeck-h2">Your Onboarding Roadmap</h2></div></div>
          <div className="fsdeck-roadmap">{DECK_PHASES.map((p) => (
            <div key={p.n} className="fsdeck-phase"><div className="fsdeck-phase-n">{p.n}</div><div className="fsdeck-phase-t">{p.t}</div><div className="fsdeck-phase-d">{p.d}</div></div>
          ))}</div>
        </div>
      );
    case 5:
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
    case 6:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Phase 2</div><h2 className="fsdeck-h2">Ensuring Compliance</h2></div></div>
          <div className="fsdeck-grid3" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {[["CT", "Corporate Tax", d.compliance.ct], ["VAT", "VAT Compliance", d.compliance.vat], ["WPS", "WPS / Payroll", d.compliance.wps], ["TL", "Trade Licence — renewal", d.compliance.tradeLicence]].map(([b, t, v]) => (
              <div key={b} className="fsdeck-compliance"><div className="fsdeck-compliance-badge">{b}</div><div className="fsdeck-compliance-t">{t}</div><div className="fsdeck-compliance-d">{v || "We track the licence renewal date and remind you before it expires."}</div></div>
            ))}
          </div>
        </div>
      );
    case 7:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Phase 3</div><h2 className="fsdeck-h2">Accounting Software</h2></div></div>
          <div className="fsdeck-twocol">
            <div className="fsdeck-softcol"><div className="fsdeck-softcol-h">If you have existing software</div><p>{d.software.existing}</p></div>
            <div className="fsdeck-softcol rec"><div className="fsdeck-softcol-h">Our recommendation · Zoho Books</div><p>{d.software.recommendation}</p>{d.software.plan && <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(249,115,22,0.15)", border: "1px solid var(--fsd-orange, #F97316)", color: "var(--fsd-orange, #F97316)", borderRadius: 8, padding: "6px 11px", fontSize: 13, fontWeight: 700 }}><Icon name="badge-check" size={14} /> Plan: {d.software.plan}</div>}</div>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: "var(--fsd-ink-2, #51606E)", background: "rgba(249,115,22,0.08)", border: "1px solid var(--fsd-line, #ECE3D2)", borderRadius: 10, padding: "10px 14px" }}>
            <Icon name="info" size={15} style={{ color: "var(--fsd-orange, #F97316)", flexShrink: 0, marginTop: 1 }} />
            <span>The accounting software subscription is billed directly by the provider (e.g. Zoho) and paid by the client. It is <strong>not included</strong> in our service fees.</span>
          </div>
        </div>
      );
    case 8:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Phase 4</div><h2 className="fsdeck-h2">Secure Data Management</h2></div></div>
          <div className="fsdeck-twocol">
            <div className="fsdeck-softcol rec"><div className="fsdeck-softcol-h">Our solution</div><p>A dedicated, encrypted Google Drive organised by year and document type — controlled access, easy retrieval.</p></div>
            <div className="fsdeck-doclist"><div className="fsdeck-softcol-h">Documents we&apos;ll need</div><ul>{DECK_DOCS.map((x) => <li key={x}><span className="tick">✓</span>{x}</li>)}</ul></div>
          </div>
          {(d.receivedDocs ?? []).length > 0 && (
            <div style={{ marginTop: 14, background: "rgba(34,197,94,0.08)", border: "1px solid #BBE7C6", borderRadius: 10, padding: "10px 14px" }}>
              <div className="fsdeck-softcol-h" style={{ color: "#15803D" }}>Documents attached by our Sales team as of now{" "}<span style={{ fontWeight: 400, color: "var(--fsd-ink-2, #51606E)" }}>— already received, no need to resend</span></div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {(d.receivedDocs ?? []).map((x, i) => <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, background: "#fff", border: "1px solid #BBE7C6", borderRadius: 999, padding: "4px 10px", color: "#15803D" }}><Icon name="check" size={12} /> {x}</span>)}
              </div>
            </div>
          )}
        </div>
      );
    case 9:
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
    case 10:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Engagement</div><h2 className="fsdeck-h2">Scope of Work</h2></div></div>
          <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 8 }}>
            <div className="fsdeck-softcol-h">What we&apos;ll do</div>
            <p style={{ fontSize: 16, color: "var(--fsd-ink)", lineHeight: 1.55 }}>{d.contract.scope || "Not specified"}</p>
            <div className="fsdeck-grid2" style={{ marginTop: 18 }}>
              <div>
                <div className="fsdeck-softcol-h" style={{ color: "#15803D" }}>Included in scope</div>
                {(d.contract.highlights ?? []).length > 0
                  ? <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{(d.contract.highlights ?? []).map((h, i) => (
                      <li key={i} style={{ fontSize: 14, color: "var(--fsd-ink)", lineHeight: 1.7 }}>
                        {h}
                        {d.contract.inclusionsShared?.[i] && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#15803D", background: "rgba(34,197,94,0.12)", border: "1px solid #BBE7C6", borderRadius: 999, padding: "1px 8px", verticalAlign: "middle" }}>
                            <Icon name="check" size={11} /> Shared by sales
                          </span>
                        )}
                      </li>
                    ))}</ul>
                  : <p style={{ fontSize: 14, color: "var(--fsd-ink-2, #51606E)", marginTop: 8 }}>As described in the engagement.</p>}
              </div>
              <div>
                <div className="fsdeck-softcol-h" style={{ color: "#C2410C" }}>Out of scope</div>
                {(d.contract.exclusions ?? []).length > 0
                  ? <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{(d.contract.exclusions ?? []).map((x, i) => <li key={i} style={{ fontSize: 14, color: "#6B5440", lineHeight: 1.7 }}>{x}</li>)}</ul>
                  : <p style={{ fontSize: 14, color: "var(--fsd-ink-2, #51606E)", marginTop: 8 }}>Nothing excluded — full scope as described.</p>}
              </div>
            </div>
          </div>
        </div>
      );
    case 11:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Engagement</div><h2 className="fsdeck-h2">Engagement Terms</h2></div></div>
          <div style={{ maxHeight: 420, overflowY: "auto", paddingRight: 8 }}>
            <div className="fsdeck-grid2">
              <div className="fsdeck-softcard" style={{ background: "var(--fsd-navy, #082032)", color: "#fff", borderRadius: 12, padding: 18 }}>
                <div className="fsdeck-softcol-h" style={{ color: "var(--fsd-orange, #F97316)" }}>Payment — how it works</div>
                <p style={{ fontSize: 15, lineHeight: 1.55, marginTop: 8 }}>{d.contract.payment || "Not specified"}</p>
              </div>
              <div className="fsdeck-softcard" style={{ background: "var(--fsd-navy, #082032)", color: "#fff", borderRadius: 12, padding: 18 }}>
                <div className="fsdeck-softcol-h" style={{ color: "var(--fsd-orange, #F97316)" }}>Engagement period</div>
                <p style={{ fontSize: 15, lineHeight: 1.55, marginTop: 8 }}>{deckDurationText(d.contract.duration)}</p>
              </div>
            </div>
            <div style={{ border: "1px solid var(--fsd-line, #ECE3D2)", borderRadius: 12, padding: 18, marginTop: 16 }}>
              <div className="fsdeck-softcol-h" style={{ color: "var(--fsd-orange, #F97316)" }}>What we need from you</div>
              <p style={{ fontSize: 15, color: "var(--fsd-ink)", lineHeight: 1.6, marginTop: 8 }}>{d.contract.responsibilities || "Not specified"}</p>
            </div>
          </div>
        </div>
      );
    case 12:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Next</div><h2 className="fsdeck-h2">Immediate Next Steps</h2></div></div>
          <div className="fsdeck-steps">{(d.nextSteps ?? []).map((s, i) => (
            <div key={i} className="fsdeck-step"><div className="fsdeck-step-n">{i + 1}</div><div className="fsdeck-step-ic">{s.icon}</div><div><div className="fsdeck-step-t">{s.title}</div><div className="fsdeck-step-d">{s.desc}</div></div></div>
          ))}</div>
        </div>
      );
    case 13:
      return (
        <div className="fsdeck-slide fsdeck-content">
          <div className="fsdeck-slidehead"><div><div className="fsdeck-phasepill">Trusted by 7,000+ SMEs</div><h2 className="fsdeck-h2">Why Founders Choose Us</h2><div className="fsdeck-sub">A diverse range of clients, built on trust and tailored, top-tier service.</div></div></div>
          <div className="fsdeck-grid2" style={{ gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            {DECK_TESTIMONIALS.map((t, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid var(--fsd-line, #ECE3D2)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 22, lineHeight: 0.9, color: "var(--fsd-orange, #F97316)" }}>“</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--fsd-ink, #1B2733)", fontStyle: "italic", flex: 1 }}>{t.q}</div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fsd-navy, #082032)" }}>{t.n}</div>
                  <div style={{ fontSize: 11, color: "var(--fsd-ink-2, #51606E)" }}>{t.r}</div>
                </div>
              </div>
            ))}
          </div>
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

const DECK_TITLES = ["Welcome", "Our Story", "Mission & Values", "Services", "Roadmap", "What We Understood", "Compliance", "Software", "Data", "Communication", "Scope", "Terms", "Next Steps", "Why Founders Choose Us", "Thank You"];

// Load pptxgenjs from CDN (no npm dep) to export the deck as a real .pptx.
let pptxPromise: Promise<unknown> | null = null;
function loadPptxgen(): Promise<unknown> {
  const w = window as unknown as { PptxGenJS?: unknown };
  if (w.PptxGenJS) return Promise.resolve(w.PptxGenJS);
  if (!pptxPromise) {
    pptxPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js";
      s.onload = () => resolve((window as unknown as { PptxGenJS: unknown }).PptxGenJS);
      s.onerror = () => reject(new Error("Could not load the PowerPoint exporter."));
      document.head.appendChild(s);
    });
  }
  return pptxPromise;
}

const PPTX = { navy: "082032", orange: "F97316", cream: "FFF7E9", white: "FFFFFF", ink: "1B2733", ink2: "51606E", line: "ECE3D2" };

// Engagement duration shown on the deck. If the contract gives no period, default to
// "From <current month year> onwards" (e.g. recurring monthly/quarterly/annual service has
// no end date — it runs from the start month onward).
function deckDurationText(duration?: string): string {
  const d = (duration ?? "").trim();
  if (d) return d;
  const monthYear = new Date().toLocaleString("en-GB", { month: "long", year: "numeric" });
  return `From ${monthYear} onwards`;
}

// =========================================================================
// PDF TEMPLATE PREVIEW — the on-screen deck IS the WELCOME PDF (the same
// design as the downloadable PPTX template). Loaded via pdf.js, rendered to
// a canvas per page, with absolute-positioned HTML overlays that swap in the
// client-specific fields (client name on the cover + slide 6) so the user
// sees a personalised preview, not Novamed's sample data.
// =========================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: any) => { promise: Promise<void> } }> };
let pdfDocPromise: Promise<PdfDoc> | null = null;
function loadDeckPdf(): Promise<PdfDoc> {
  if (pdfDocPromise) return pdfDocPromise;
  pdfDocPromise = (async () => {
    const lib: any = await loadPdfjs();
    const buf = await (await fetch("/onboarding-deck-template.pdf", { cache: "force-cache" })).arrayBuffer();
    return (await lib.getDocument({ data: buf }).promise) as PdfDoc;
  })();
  return pdfDocPromise;
}

function PdfTemplateSlide({ pageIdx, deck }: { pageIdx: number; deck: DeckData }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRendered(false);
      try {
        const pdf = await loadDeckPdf();
        if (cancelled) return;
        const page = await pdf.getPage(pageIdx + 1);
        if (cancelled) return;
        // Render at 2× for crispness — CSS scales the 1200×675 stage down to fit.
        const viewport = page.getViewport({ scale: 1200 / 1440 * 2 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = "1200px";
        canvas.style.height = "675px";
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setRendered(true);
      } catch { /* ignore — overlay still shows */ }
    })();
    return () => { cancelled = true; };
  }, [pageIdx]);

  const clientName = (deck.clientName || "").trim();
  // Cover (page 1) — paint over the Novamed title + the welcome subtitle so the
  // preview shows the client's name instead of the template's sample data.
  const isCover = pageIdx === 0;
  // Slide 6 confirmation line "Please confirm the details of Novamed Rescue Medical."
  const isConfirm = pageIdx === 5;
  // Slide 9 (PHASE 4 — Secure Data Management) — bottom line listing the sales-shared docs.
  const isDataMgmt = pageIdx === 8;
  const cleanReceived = cleanDocLabels((deck.receivedDocs ?? []).filter(Boolean));
  const receivedLine = cleanReceived.length
    ? `Documents attached by our Sales team as of now (already received, no need to resend): ${cleanReceived.join(", ")}`
    : "Documents attached by our Sales team as of now: none yet — please upload via the onboarding portal.";

  return (
    <div style={{ position: "absolute", inset: 0, background: "#fff" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "1200px", height: "675px" }} />
      {!rendered && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#51606E", fontSize: 14 }}>Loading slide…</div>
      )}
      {rendered && isCover && clientName && (
        <>
          {/* Navy client name on the WHITE cover background — matches the PDF template.
              Covers the full 2-line Novamed title area so the underlying text is hidden. */}
          <div style={{ position: "absolute", left: "5.2%", top: "33%", width: "80%", height: "22%", background: "#FFFFFF", color: "#082032", fontFamily: "'Trebuchet MS', Arial, sans-serif", fontWeight: 700, fontSize: 54, lineHeight: 1.05, letterSpacing: 0.5, display: "flex", alignItems: "flex-start", paddingTop: 4 }}>{clientName}</div>
          {/* Welcome subtitle — covers the original "Welcome to Finanshels, Novamed…" paragraph. */}
          <div style={{ position: "absolute", left: "5.2%", top: "62%", width: "85%", height: "16%", background: "#FFFFFF", color: "#082032", fontFamily: "'Trebuchet MS', Arial, sans-serif", fontSize: 20, lineHeight: 1.5, padding: "4px 0" }}>
            Welcome to Finanshels, {clientName}! We&apos;re excited to streamline your accounting and tax processes, ensuring compliance and efficiency.
          </div>
        </>
      )}
      {rendered && isConfirm && clientName && (
        <div style={{ position: "absolute", left: "5.2%", bottom: "10%", width: "85%", background: "#082032", color: "#FFFFFF", fontFamily: "'Trebuchet MS', Arial, sans-serif", fontSize: 15, lineHeight: 1.45, padding: "10px 14px", borderRadius: 6 }}>
          The information available is limited due to the generic email domain. Please confirm the details of {clientName}.
        </div>
      )}
      {rendered && isDataMgmt && (
        <div style={{ position: "absolute", left: "5.2%", bottom: "10%", width: "85%", background: "#FFFFFF", color: "#F1660F", fontFamily: "'Trebuchet MS', Arial, sans-serif", fontSize: 15, lineHeight: 1.45, padding: "8px 0", fontStyle: "italic" }}>
          {receivedLine}
        </div>
      )}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Load JSZip from CDN — used to open the WELCOME PDF→PPTX template, substitute
// client-specific text in the slide XML, and re-zip into a downloadable .pptx.
/* eslint-disable @typescript-eslint/no-explicit-any */
let jszipPromise: Promise<any> | null = null;
function loadJszip(): Promise<any> {
  const w = window as unknown as { JSZip?: any };
  if (w.JSZip) return Promise.resolve(w.JSZip);
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
      s.onload = () => resolve((window as unknown as { JSZip: any }).JSZip);
      s.onerror = () => reject(new Error("Could not load the PPTX writer (JSZip)."));
      document.head.appendChild(s);
    });
  }
  return jszipPromise;
}

const escapeXmlText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** PowerPoint splits text into many <a:t> "runs" by font/style — replacing a sentence
 *  like "Novamed Rescue Medical Treatment Facilitation Services" requires finding the
 *  consecutive runs whose non-whitespace words match the target words, then replacing
 *  the FIRST matched run's text with the new value and clearing the others (keeping
 *  their styling tags so the slide doesn't break). Trailing punctuation on the last
 *  word (Services / Services! / Services. / Medical.) is preserved in-place. */
function replaceConsecutiveRuns(xml: string, targetWords: string[], replacement: string): string {
  const re = /<a:t[^>]*>([^<]*)<\/a:t>/g;
  type Run = { full: string; inner: string; start: number; end: number };
  const runs: Run[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    runs.push({ full: m[0], inner: m[1], start: m.index, end: m.index + m[0].length });
  }
  // Strip ASCII trailing punctuation (.!,?;:) so "Services!" matches target "Services".
  const stripPunct = (s: string) => s.replace(/[.!,?;:]+$/, "");
  for (let i = 0; i < runs.length; i++) {
    const matchIdx: number[] = [];
    let lastTrailing = "";
    let ti = 0;
    let j = i;
    while (j < runs.length && ti < targetWords.length) {
      const raw = runs[j].inner;
      const trimmed = raw.trim();
      const stripped = stripPunct(trimmed);
      if (stripped === targetWords[ti]) {
        matchIdx.push(j);
        if (ti === targetWords.length - 1) {
          // Preserve EVERYTHING after the matched word in the original (untrimmed)
          // run text — punctuation AND any trailing whitespace. Without this we
          // collapse "Services! We're" → "Gulf City!We're" (no space before next word).
          const pos = raw.indexOf(stripped);
          lastTrailing = pos >= 0 ? raw.slice(pos + stripped.length) : "";
        }
        ti++;
      } else if (trimmed === "") {
        // ignore whitespace runs between target words
      } else {
        break;
      }
      j++;
    }
    if (ti === targetWords.length && matchIdx.length > 0) {
      const firstIdx = matchIdx[0];
      const lastIdx = matchIdx[matchIdx.length - 1];
      let out = xml.substring(0, runs[firstIdx].start);
      // Empty EVERY run in [firstIdx, lastIdx] — matched words AND the whitespace
      // runs between them — so we don't leave "Gulf City     !" trailing spaces.
      // Only firstIdx keeps text (the replacement); lastIdx keeps any trailing
      // punctuation that was on the final target word ("Services!"/"Medical.").
      for (let k = firstIdx; k <= lastIdx; k++) {
        const r = runs[k];
        if (k === firstIdx) {
          out += r.full.replace(/(<a:t[^>]*>)[^<]*(<\/a:t>)/, `$1${escapeXmlText(replacement)}$2`);
        } else if (k === lastIdx && lastTrailing) {
          // lastTrailing came from the already-encoded XML body — don't double-escape.
          out += r.full.replace(/(<a:t[^>]*>)[^<]*(<\/a:t>)/, `$1${lastTrailing}$2`);
        } else {
          out += r.full.replace(/(<a:t[^>]*>)[^<]*(<\/a:t>)/, `$1$2`);
        }
        if (k < lastIdx) out += xml.substring(r.end, runs[k + 1].start);
      }
      out += xml.substring(runs[lastIdx].end);
      // Recurse to handle multiple occurrences within the same XML (e.g. cover title + body)
      return replaceConsecutiveRuns(out, targetWords, replacement);
    }
  }
  return xml;
}

/** Tokenise a phrase into words for the run-based replacer. */
function phraseToWords(phrase: string): string[] {
  return phrase.trim().split(/\s+/).filter(Boolean);
}

/** Replace a whole PARAGRAPH (single `<a:p>`) whose concatenated plain text contains
 *  the anchor phrase: first `<a:t>` run gets the new text, the rest are emptied. Keeps
 *  the rest of the paragraph (style, indentation, layout) untouched. */
function replaceParagraphByAnchor(xml: string, anchor: string, newText: string): string {
  return xml.replace(/<a:p\b[\s\S]*?<\/a:p>/g, (para) => {
    const runs = [...para.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((r) => r[1]);
    const plain = runs.join("").replace(/\s+/g, " ").trim();
    if (!plain.includes(anchor)) return para;
    let first = true;
    return para.replace(/(<a:t[^>]*>)[^<]*(<\/a:t>)/g, (_, open, close) => {
      if (first) { first = false; return `${open}${escapeXmlText(newText)}${close}`; }
      return `${open}${close}`;
    });
  });
}

/** Replace a whole SHAPE (single `<p:sp>`) whose concatenated plain text contains
 *  the anchor phrase. Use when the field spans multiple paragraphs inside one shape
 *  (e.g. the payment block: "One-Time Total… Recurring Total… VAT (5%)… Estimated…"). */
function replaceShapeByAnchor(xml: string, anchor: string, newText: string): string {
  return xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (shape) => {
    const runs = [...shape.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((r) => r[1]);
    const plain = runs.join("").replace(/\s+/g, " ").trim();
    if (!plain.includes(anchor)) return shape;
    let first = true;
    return shape.replace(/(<a:t[^>]*>)[^<]*(<\/a:t>)/g, (_, open, close) => {
      if (first) { first = false; return `${open}${escapeXmlText(newText)}${close}`; }
      return `${open}${close}`;
    });
  });
}

/** Download the polished PPTX by substituting client-specific text into the WELCOME
 *  TO FINANSHELS template stored at /onboarding-deck-template.pptx. Visual design,
 *  fonts, colours and shapes are preserved exactly — only text values change. */
async function downloadDeckPptx(deck: DeckData) {
  const JSZip = await loadJszip();
  const res = await fetch("/onboarding-deck-template.pptx", { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load the deck template (${res.status}).`);
  const buf = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // The template carries Novamed-Rescue-Medical sample data. We swap the client name
  // on every slide where it appears. Scope / payment / duration paragraphs stay as
  // the template defaults — the team edits those in PowerPoint after download if
  // they need per-client tweaks (a single Find & Replace inside PowerPoint).
  // Order matters — longer phrases first so the slide-6 "Novamed Rescue Medical." line
  // doesn't grab "Novamed Rescue Medical" out of the cover sentence before the full
  // phrase is matched. Trailing punctuation (!/. /etc.) is preserved by the replacer.
  const TEMPLATE_CLIENT_PHRASES = [
    ["Novamed", "Rescue", "Medical", "Treatment", "Facilitation", "Services"],
    ["Novamed", "Rescue", "Medical"],
  ];

  const scope = deck.contract?.scope?.trim() || "";
  const payment = deck.contract?.payment?.trim() || "";
  const duration = (deck.contract?.duration?.trim() || deckDurationText()).trim();
  // Slide 9 — replace the "Documents attached by our Sales team…" line with the
  // client's actual received docs (status=uploaded), cleaned to TYPE names
  // ("VAT Certificate" / "Trade Licence") rather than raw filenames.
  const receivedDocs = cleanDocLabels((deck.receivedDocs ?? []).filter(Boolean));
  const receivedDocsLine = receivedDocs.length
    ? `Documents attached by our Sales team as of now (already received, no need to resend): ${receivedDocs.join(", ")}`
    : "Documents attached by our Sales team as of now: none yet — please upload via the onboarding portal.";

  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  for (const path of slides) {
    let xml = await zip.file(path).async("string");
    if (deck.clientName?.trim()) {
      for (const phrase of TEMPLATE_CLIENT_PHRASES) {
        xml = replaceConsecutiveRuns(xml, phrase, deck.clientName.trim());
      }
    }
    // Slide 11 — replace the SCOPE sentence paragraph (anchor "This contract" only
    // appears in that paragraph in the template). Paragraph-level, not shape-level,
    // because the shape also carries the "Scope of Work" title and "WHAT WE'LL DO"
    // label paragraphs that must stay intact.
    if (/slide11\.xml$/.test(path) && scope) {
      xml = replaceParagraphByAnchor(xml, "This contract", scope);
    }
    // Slide 12 — payment block spans 4 paragraphs inside ONE shape (One-Time Total,
    // Recurring Total, VAT, Estimated Initial Total, "All payments are…"). Anchor
    // on "AED" (the price block is the only place AED appears in the template),
    // shape-level so all 4 paragraphs collapse into the new payment text.
    if (/slide12\.xml$/.test(path)) {
      if (payment) xml = replaceShapeByAnchor(xml, "AED", payment);
      // Duration paragraph "Jun 2026 onwards" — unique anchor "onwards".
      if (duration) xml = replaceParagraphByAnchor(xml, "onwards", duration);
    }
    // Slide 9 received-docs line — anchor "Documents attached" only appears there.
    // Applied across all slides; no-op where the anchor isn't found.
    xml = replaceParagraphByAnchor(xml, "Documents attached", receivedDocsLine);
    zip.file(path, xml);
  }

  const out: Blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  const url = URL.createObjectURL(out);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(deck.clientName || "client").replace(/[^a-z0-9]+/gi, "-")}-onboarding-deck.pptx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Legacy primitive-based PPTX export — kept ONLY for reference / quick fallback. The
// image-based export above is the canonical path because it preserves the WELCOME PDF
// design exactly (this primitive path was the source of the "PPTX looks wrong" report).
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
async function downloadDeckPptxLegacy(deck: DeckData) {
  const Pptx = (await loadPptxgen()) as any;
  const p = new Pptx();
  p.defineLayout({ name: "FS", width: 13.333, height: 7.5 });
  p.layout = "FS";
  const brand = (s: any, dark = false) => s.addText("FINANSHELS", { x: 10.7, y: 7.0, w: 2.3, fontSize: 9, color: dark ? "FFFFFF" : PPTX.ink2, align: "right", bold: true, charSpacing: 2 });
  const head = (s: any, phase: string, title: string) => {
    s.addText(phase.toUpperCase(), { x: 0.7, y: 0.5, w: 12, h: 0.3, fontSize: 12, color: PPTX.orange, bold: true, charSpacing: 2, align: "left", valign: "middle" });
    s.addText(title, { x: 0.7, y: 0.85, w: 12, h: 0.7, fontSize: 30, bold: true, color: PPTX.navy, align: "left", valign: "middle" });
    s.addShape("rect", { x: 0.7, y: 1.66, w: 0.7, h: 0.06, fill: { color: PPTX.orange } });
  };

  // 1. Cover
  let s = p.addSlide(); s.background = { color: PPTX.navy };
  s.addText("TRUSTED BY 7,000+ SMEs · WELCOME TO FINANSHELS", { x: 0.7, y: 1.4, w: 12, h: 0.4, fontSize: 14, color: PPTX.orange, bold: true, charSpacing: 3, valign: "middle" });
  s.addText([{ text: "Welcome, ", options: { color: PPTX.white } }, { text: deck.clientName, options: { color: PPTX.orange } }], { x: 0.7, y: 2.0, w: 12, h: 1.6, fontSize: 44, bold: true, valign: "middle" });
  s.addText(`Welcome to Finanshels, ${deck.clientName}! We're excited to streamline your accounting and tax processes, ensuring compliance and efficiency.`, { x: 0.7, y: 3.9, w: 11.5, h: 2.4, fontSize: 16, color: "D6DEE6", valign: "top", lineSpacingMultiple: 1.1 });
  brand(s, true);

  // 2. Our Story
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Trusted by 7,000+ SMEs", "Our Story");
  s.addShape("roundRect", { x: 0.7, y: 2.2, w: 7.8, h: 4.4, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
  s.addText("“", { x: 0.9, y: 2.3, w: 0.6, h: 0.6, fontSize: 50, color: PPTX.orange, valign: "top" });
  s.addText(DECK_FOUNDER_QUOTE.replace(/^"|"$/g, ""), { x: 0.95, y: 2.85, w: 7.3, h: 3.0, fontSize: 13, italic: true, color: PPTX.ink, valign: "top", lineSpacingMultiple: 1.25 });
  s.addText(`— ${DECK_FOUNDER_NAME}`, { x: 0.95, y: 6.0, w: 7.3, h: 0.4, fontSize: 12, bold: true, color: PPTX.navy, valign: "middle" });
  DECK_STATS.forEach((st, i) => {
    const y = 2.2 + i * 1.1;
    s.addShape("roundRect", { x: 8.8, y, w: 3.85, h: 1.0, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.08 });
    s.addText(st.l.toUpperCase(), { x: 9.0, y: y + 0.15, w: 2.6, h: 0.3, fontSize: 10, color: PPTX.ink2, bold: true, charSpacing: 1, valign: "middle" });
    s.addText(st.v, { x: 11.6, y: y + 0.2, w: 1.0, h: 0.65, fontSize: 22, bold: true, color: PPTX.orange, align: "right", valign: "middle" });
  });
  brand(s);

  // 3. Mission & Values
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Trusted by 7,000+ SMEs", "Our Mission & Values");
  s.addText("We're on a mission to simplify financial life for SMEs through a technology-first approach — giving founders the tools they need to manage finance seamlessly.", { x: 0.7, y: 2.0, w: 12, h: 0.9, fontSize: 13, color: PPTX.ink2, valign: "top", lineSpacingMultiple: 1.2 });
  DECK_VALUES.forEach((v, i) => {
    const x = 0.7 + i * 4.15;
    s.addShape("roundRect", { x, y: 3.2, w: 3.95, h: 3.5, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
    s.addText(v.n, { x: x + 0.25, y: 3.4, w: 3.55, h: 0.6, fontSize: 24, bold: true, color: PPTX.orange, valign: "top" });
    s.addText(v.t, { x: x + 0.25, y: 4.1, w: 3.55, h: 0.55, fontSize: 14, bold: true, color: PPTX.navy, valign: "top" });
    s.addText(v.d, { x: x + 0.25, y: 4.7, w: 3.55, h: 1.85, fontSize: 11, color: PPTX.ink2, valign: "top", lineSpacingMultiple: 1.15 });
  });
  brand(s);

  // 4. Services
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Trusted by 7,000+ SMEs", "Services That Grow With You");
  DECK_SERVICES.forEach((sv, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x = 0.7 + col * 3.05;
    const y = 2.2 + row * 2.35;
    s.addShape("roundRect", { x, y, w: 2.85, h: 2.15, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.08 });
    s.addText(sv.t, { x: x + 0.18, y: y + 0.18, w: 2.5, h: 0.6, fontSize: 12.5, bold: true, color: PPTX.navy, valign: "top", lineSpacingMultiple: 1.1 });
    s.addText(sv.d, { x: x + 0.18, y: y + 0.85, w: 2.5, h: 1.2, fontSize: 10, color: PPTX.ink2, valign: "top", lineSpacingMultiple: 1.15 });
  });
  brand(s);

  // 5. Roadmap (Agenda slide intentionally omitted — Roadmap covers the journey)
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Roadmap", "Your Onboarding Roadmap");
  DECK_PHASES.forEach((ph, i) => {
    const x = 0.7 + i * 2.45;
    s.addShape("roundRect", { x, y: 2.2, w: 2.25, h: 3.2, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
    s.addText(ph.n, { x, y: 2.4, w: 2.25, h: 0.6, align: "center", fontSize: 26, bold: true, color: PPTX.orange, valign: "middle" });
    s.addText(ph.t, { x: x + 0.15, y: 3.1, w: 1.95, h: 0.7, align: "center", fontSize: 13, bold: true, color: PPTX.navy, valign: "top" });
    s.addText(ph.d, { x: x + 0.15, y: 3.85, w: 1.95, h: 1.4, align: "center", fontSize: 10, color: PPTX.ink2, valign: "top", lineSpacingMultiple: 1.05 });
  });

  // 4. What We Understood
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Phase 1 · Discovery", "What We Understood");
  s.addText((deck.whatWeUnderstood?.points || []).map((pt) => ({ text: `${pt.title}: ${pt.desc}`, options: { bullet: { code: "2022" }, color: PPTX.ink, fontSize: 13, breakLine: true, paraSpaceAfter: 6 } })), { x: 0.7, y: 2.0, w: 12, h: 2.9, valign: "top", lineSpacingMultiple: 1.05 });
  s.addShape("roundRect", { x: 0.7, y: 5.1, w: 12, h: 1.6, fill: { color: PPTX.navy }, rectRadius: 0.1 });
  s.addText("WHAT WE UNDERSTOOD — PLEASE CONFIRM", { x: 0.9, y: 5.25, w: 11.6, h: 0.3, fontSize: 10, color: PPTX.orange, bold: true, valign: "middle" });
  s.addText(deck.whatWeUnderstood?.summary || "", { x: 0.9, y: 5.55, w: 11.6, h: 1.0, fontSize: 13, color: PPTX.white, valign: "top" });

  // 5. Compliance — CT / VAT / WPS / Trade licence (2x2)
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Phase 2", "Ensuring Compliance");
  ([
    ["Corporate Tax", deck.compliance?.ct],
    ["VAT", deck.compliance?.vat],
    ["WPS / Payroll", deck.compliance?.wps],
    ["Trade Licence — renewal", deck.compliance?.tradeLicence || "We track the licence renewal date and remind before it expires."],
  ]).forEach(([t, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.7 + col * 6.35, y = 2.05 + row * 2.45;
    s.addShape("roundRect", { x, y, w: 5.95, h: 2.2, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
    s.addText(String(t), { x: x + 0.25, y: y + 0.18, w: 5.45, h: 0.4, fontSize: 15, bold: true, color: PPTX.navy, valign: "middle" });
    s.addText(String(v || "Not specified"), { x: x + 0.25, y: y + 0.62, w: 5.45, h: 1.45, fontSize: 12, color: PPTX.ink2, valign: "top", lineSpacingMultiple: 1.05 });
  });

  // 6. Software
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Phase 3", "Accounting Software");
  s.addShape("roundRect", { x: 0.7, y: 2.2, w: 5.9, h: 3.6, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
  s.addText("If you have existing software", { x: 0.95, y: 2.45, w: 5.4, h: 0.4, fontSize: 13, bold: true, color: PPTX.orange, valign: "middle" });
  s.addText(deck.software?.existing || "", { x: 0.95, y: 2.95, w: 5.4, h: 2.65, fontSize: 12, color: PPTX.ink, valign: "top", lineSpacingMultiple: 1.05 });
  s.addShape("roundRect", { x: 6.85, y: 2.2, w: 5.85, h: 3.6, fill: { color: PPTX.navy }, rectRadius: 0.1 });
  s.addText("Our recommendation · Zoho Books", { x: 7.1, y: 2.45, w: 5.35, h: 0.4, fontSize: 13, bold: true, color: PPTX.orange, valign: "middle" });
  s.addText(deck.software?.recommendation || "", { x: 7.1, y: 2.95, w: 5.35, h: deck.software?.plan ? 1.85 : 2.65, fontSize: 12, color: PPTX.white, valign: "top", lineSpacingMultiple: 1.05 });
  if (deck.software?.plan) {
    s.addShape("roundRect", { x: 7.1, y: 4.95, w: 5.35, h: 0.7, fill: { color: PPTX.orange }, rectRadius: 0.08 });
    s.addText(`Plan: ${deck.software.plan}`, { x: 7.25, y: 4.95, w: 5.05, h: 0.7, fontSize: 12, bold: true, color: PPTX.navy, valign: "middle" });
  }
  s.addText("Note: the accounting software subscription is billed by the provider (e.g. Zoho) and paid by the client — not included in our service fees.", { x: 0.7, y: 6.0, w: 12, h: 0.7, fontSize: 11.5, italic: true, color: PPTX.ink2, valign: "top", lineSpacingMultiple: 1.05 });

  // 7. Data — two columns: our solution (navy) + documents we'll need (checklist), matching the on-screen slide.
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Phase 4", "Secure Data Management");
  s.addShape("roundRect", { x: 0.7, y: 2.2, w: 5.9, h: 4.4, fill: { color: PPTX.navy }, rectRadius: 0.1 });
  s.addText("OUR SOLUTION", { x: 0.95, y: 2.45, w: 5.4, h: 0.3, fontSize: 11, bold: true, color: PPTX.orange, charSpacing: 1, valign: "middle" });
  s.addText("A dedicated, encrypted Google Drive organised by year and document type — controlled access, easy retrieval.", { x: 0.95, y: 2.9, w: 5.4, h: 3.4, fontSize: 14, color: PPTX.white, valign: "top", lineSpacingMultiple: 1.15 });
  s.addShape("roundRect", { x: 6.85, y: 2.2, w: 5.85, h: 4.4, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
  s.addText("DOCUMENTS WE'LL NEED", { x: 7.1, y: 2.45, w: 5.35, h: 0.3, fontSize: 11, bold: true, color: PPTX.orange, charSpacing: 1, valign: "middle" });
  s.addText(DECK_DOCS.map((d) => ({ text: d, options: { bullet: { code: "2713" }, color: PPTX.ink, fontSize: 12.5, breakLine: true, paraSpaceAfter: 5 } })), { x: 7.1, y: 2.95, w: 5.35, h: 3.5, valign: "top", lineSpacingMultiple: 1.05 });
  if ((deck.receivedDocs ?? []).length > 0) {
    s.addText(`Documents attached by our Sales team as of now (already received, no need to resend): ${(deck.receivedDocs ?? []).join(", ")}`, { x: 0.7, y: 6.8, w: 12, h: 0.5, fontSize: 11.5, bold: true, color: "15803D", valign: "top", lineSpacingMultiple: 1.0 });
  }

  // 8. Communication
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Phase 5", "How We Stay Connected");
  [["Email", "Formal documentation, reports and major updates."], ["WhatsApp", "Daily operational queries and quick support."], ["Slack", "Optional real-time collaboration if you prefer."]].forEach(([t, d], i) => {
    const x = 0.7 + i * 4.1;
    s.addShape("roundRect", { x, y: 2.4, w: 3.85, h: 3.0, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
    s.addText(String(t), { x: x + 0.25, y: 2.7, w: 3.35, h: 0.5, fontSize: 16, bold: true, color: PPTX.navy, valign: "middle" });
    s.addText(String(d), { x: x + 0.25, y: 3.25, w: 3.35, h: 1.9, fontSize: 12, color: PPTX.ink2, valign: "top", lineSpacingMultiple: 1.05 });
  });

  // 9. Contract — Scope, with Included / Out-of-scope columns.
  // fit:"shrink" stops long Included / Out-of-scope lists from being clipped in the exported deck.
  const cExcl = (deck.contract?.exclusions || []).filter(Boolean);
  const cIncl = (deck.contract?.highlights || []).filter(Boolean);
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Engagement", "Scope of Work");
  s.addText("WHAT WE'LL DO", { x: 0.7, y: 1.9, w: 12, h: 0.3, fontSize: 11, bold: true, color: PPTX.orange, charSpacing: 1, valign: "middle" });
  s.addText(deck.contract?.scope || "Not specified", { x: 0.7, y: 2.22, w: 12, h: 1.0, fontSize: 13, color: PPTX.ink, valign: "top", lineSpacingMultiple: 1.1, fit: "shrink" } as Record<string, unknown>);
  // Included card (white)
  s.addShape("roundRect", { x: 0.7, y: 3.35, w: 5.9, h: 3.5, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
  s.addText("INCLUDED IN SCOPE", { x: 0.95, y: 3.55, w: 5.4, h: 0.3, fontSize: 11, bold: true, color: PPTX.navy, charSpacing: 1, valign: "middle" });
  s.addText(cIncl.length ? cIncl.map((h) => ({ text: h, options: { bullet: { code: "2713" }, fontSize: 12, color: PPTX.ink, breakLine: true, paraSpaceAfter: 5 } })) : "As described in the engagement.", { x: 0.95, y: 3.95, w: 5.4, h: 2.75, fontSize: 12, color: PPTX.ink, valign: "top", lineSpacingMultiple: 1.05, fit: "shrink" } as Record<string, unknown>);
  // Out-of-scope card (light, orange accent)
  s.addShape("roundRect", { x: 6.85, y: 3.35, w: 5.85, h: 3.5, fill: { color: "FFF1E6" }, line: { color: "F4D7BE", width: 1 }, rectRadius: 0.1 });
  s.addText("OUT OF SCOPE", { x: 7.1, y: 3.55, w: 5.35, h: 0.3, fontSize: 11, bold: true, color: "C2410C", charSpacing: 1, valign: "middle" });
  s.addText(cExcl.length ? cExcl.map((x) => ({ text: x, options: { bullet: { code: "2022" }, fontSize: 12, color: "6B5440", breakLine: true, paraSpaceAfter: 5 } })) : "Nothing excluded — full scope as described.", { x: 7.1, y: 3.95, w: 5.35, h: 2.75, fontSize: 12, color: "6B5440", valign: "top", lineSpacingMultiple: 1.05, fit: "shrink" } as Record<string, unknown>);

  // 9b. Engagement terms — payment, duration, client responsibilities.
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Engagement", "Engagement Terms");
  s.addShape("roundRect", { x: 0.7, y: 2.1, w: 5.9, h: 1.85, fill: { color: PPTX.navy }, rectRadius: 0.1 });
  s.addText("PAYMENT", { x: 0.95, y: 2.35, w: 5.4, h: 0.3, fontSize: 11, bold: true, color: PPTX.orange, charSpacing: 1, valign: "middle" });
  s.addText(deck.contract?.payment || "Not specified", { x: 0.95, y: 2.78, w: 5.4, h: 1.0, fontSize: 13, color: PPTX.white, valign: "top", lineSpacingMultiple: 1.05, fit: "shrink" } as Record<string, unknown>);
  s.addShape("roundRect", { x: 6.85, y: 2.1, w: 5.85, h: 1.85, fill: { color: PPTX.navy }, rectRadius: 0.1 });
  s.addText("DURATION", { x: 7.1, y: 2.35, w: 5.35, h: 0.3, fontSize: 11, bold: true, color: PPTX.orange, charSpacing: 1, valign: "middle" });
  s.addText(deckDurationText(deck.contract?.duration), { x: 7.1, y: 2.78, w: 5.35, h: 1.0, fontSize: 13, color: PPTX.white, valign: "top", lineSpacingMultiple: 1.05, fit: "shrink" } as Record<string, unknown>);
  s.addShape("roundRect", { x: 0.7, y: 4.15, w: 12, h: 2.5, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
  s.addText("WHAT WE NEED FROM YOU", { x: 0.95, y: 4.4, w: 11.5, h: 0.3, fontSize: 11, bold: true, color: PPTX.navy, charSpacing: 1, valign: "middle" });
  s.addText(deck.contract?.responsibilities || "Not specified", { x: 0.95, y: 4.85, w: 11.5, h: 1.6, fontSize: 13, color: PPTX.ink, valign: "top", lineSpacingMultiple: 1.15 });

  // 10. Next steps
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Next", "Immediate Next Steps");
  s.addText((deck.nextSteps || []).flatMap((n) => ([{ text: n.title, options: { bold: true, color: PPTX.navy, fontSize: 15, breakLine: true, paraSpaceBefore: 6 } }, { text: n.desc, options: { color: PPTX.ink2, fontSize: 12, breakLine: true, paraSpaceAfter: 8, indentLevel: 1 } }])), { x: 0.7, y: 2.0, w: 12, h: 5.0, valign: "top", lineSpacingMultiple: 1.05 });

  // 11. Why founders choose us — testimonials
  s = p.addSlide(); s.background = { color: PPTX.cream }; head(s, "Trusted by 7,000+ SMEs", "Why Founders Choose Us");
  DECK_TESTIMONIALS.forEach((t, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.7 + col * 6.15, y = 2.0 + row * 2.5;
    s.addShape("roundRect", { x, y, w: 5.95, h: 2.3, fill: { color: PPTX.white }, line: { color: PPTX.line, width: 1 }, rectRadius: 0.1 });
    s.addText("“", { x: x + 0.2, y: y + 0.1, w: 0.5, h: 0.5, fontSize: 30, color: PPTX.orange, valign: "top" });
    s.addText(t.q, { x: x + 0.25, y: y + 0.55, w: 5.45, h: 1.15, fontSize: 11, italic: true, color: PPTX.ink, valign: "top", lineSpacingMultiple: 1.2 });
    s.addText(t.n, { x: x + 0.25, y: y + 1.75, w: 5.45, h: 0.3, fontSize: 12, bold: true, color: PPTX.navy, valign: "middle" });
    s.addText(t.r, { x: x + 0.25, y: y + 2.0, w: 5.45, h: 0.25, fontSize: 10, color: PPTX.ink2, valign: "middle" });
  });
  brand(s);

  // 12. Thank you
  s = p.addSlide(); s.background = { color: PPTX.navy };
  s.addText("Thank you!", { x: 0.7, y: 2.6, w: 12, h: 1.0, fontSize: 48, bold: true, color: PPTX.orange, valign: "middle" });
  s.addText(`Ready to grow together. Let's begin your journey with Finanshels, ${deck.clientName}.`, { x: 0.7, y: 4.0, w: 11, h: 1.0, fontSize: 18, color: "D6DEE6", valign: "top" });
  brand(s, true);

  await p.writeFile({ fileName: `${(deck.clientName || "client").replace(/[^a-z0-9]+/gi, "-")}-onboarding-deck.pptx` });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

type OnePagerSection = { heading: string; items: string[] };
type OnePagerData = { generated?: string; sections?: OnePagerSection[]; generatedAt?: string; notes?: string };

function OnePagerModal({ runId, stepId, onClose, onDone }: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const [data, setData] = useState<OnePagerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, startWork] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [clientName, setClientName] = useState("Client");
  const [generatedText, setGeneratedText] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "onepager").maybeSingle(),
      supabase.from("onboarding_runs").select("clients(name)").eq("id", runId).maybeSingle(),
    ]).then(([{ data: row }, { data: r }]) => {
      if (!alive) return;
      const d = (row?.data as OnePagerData | undefined) ?? null;
      if (d) {
        setData(d);
        setNotes(d.notes ?? "");
        setGeneratedText(d.generated ?? "");
      }
      const cl = (r as { clients?: { name?: string } | { name?: string }[] } | null)?.clients;
      const name = Array.isArray(cl) ? cl[0]?.name : cl?.name;
      if (name) setClientName(name);
      setLoading(false);
    });
    return () => { alive = false; };
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const runGenerate = () => {
    setError(null);
    startWork(async () => {
      const r = data ? await regenerateOnePager(runId) : await generateOnePager(runId);
      if (r.error || !r.data) { setError(r.error ?? "Failed to generate."); return; }
      setData({ ...r.data, notes });
      setGeneratedText(r.data.generated);
    });
  };

  const saveNotesOnBlur = () => {
    if (!data) return;
    startWork(async () => {
      const r = await saveOnePagerNotes(runId, notes);
      if (r.error) setError(r.error);
    });
  };

  const downloadPdf = () => {
    const orig = document.title;
    document.title = `Onboarding One-Pager — ${clientName}`;
    window.print();
    setTimeout(() => { document.title = orig; }, 1000);
  };

  const saveAndConfirm = () => {
    if (!data) return;
    startWork(async () => {
      if (notes !== (data.notes ?? "")) {
        await saveOnePagerNotes(runId, notes);
      }
      await completeStep(runId, stepId);
      onDone();
    });
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 760, maxWidth: "calc(100vw - 32px)", maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Onboarding one-pager</h3>
          <div className="sub">Polished summary of the compliance calendar, first delivery, team contacts and UAE compliance details — share with the client before recurring delivery starts.</div>
        </div>
        <div className="bd" style={{ overflowY: "auto" }}>
          {loading && <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Loading…</div>}

          {!loading && !data && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 14 }}>
                No one-pager generated yet. Click below to build it from the compliance calendar, contract and team.
              </div>
              <button className="btn-primary" disabled={working} onClick={runGenerate}>
                {working ? "Generating…" : "Generate one-pager"}
              </button>
            </div>
          )}

          {!loading && data && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {(data.sections ?? []).map((s, i) => (
                  <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "#fff" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 6 }}>{s.heading}</div>
                    {s.items.length ? (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-1)", display: "flex", flexDirection: "column", gap: 4 }}>
                        {s.items.map((it, j) => <li key={j}>{it}</li>)}
                      </ul>
                    ) : (
                      <div style={{ fontSize: 13, color: "var(--ink-3)" }}>—</div>
                    )}
                  </div>
                ))}

                <div className="field">
                  <label>Generated body (edit if needed)</label>
                  <textarea
                    value={generatedText}
                    onChange={(e) => setGeneratedText(e.target.value)}
                    rows={8}
                    style={{ width: "100%", fontSize: 13, fontFamily: "inherit" }}
                  />
                </div>

                <div className="field">
                  <label>Notes (your additions — saved with the one-pager)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={saveNotesOnBlur}
                    rows={3}
                    placeholder="Anything to add — internal or client-facing"
                    style={{ width: "100%", fontSize: 13, fontFamily: "inherit" }}
                  />
                </div>
              </div>
              {data.generatedAt && (
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>
                  Last generated {new Date(data.generatedAt).toLocaleString()}
                </div>
              )}
            </>
          )}

          {error && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 10 }}>{error}</div>}
        </div>
        <div className="ft" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button className="btn-ghost" onClick={onClose} disabled={working}>Close</button>
          <div style={{ display: "flex", gap: 8 }}>
            {data && <button className="btn-ghost" disabled={working} onClick={runGenerate}>{working ? "Working…" : "Regenerate"}</button>}
            {data && <button className="btn-ghost" onClick={downloadPdf}><Icon name="download" size={13} /> Download PDF</button>}
            {data && <button className="btn-primary" disabled={working} onClick={saveAndConfirm}>{working ? "Saving…" : "Save & confirm step"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function DeckModal({ runId, onClose, onDone }: { runId: string; onClose: () => void; onDone: () => void }) {
  const [deck, setDeck] = useState<DeckData | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "present">("present");
  const [idx, setIdx] = useState(0);
  const [scale, setScale] = useState(0.6);
  const [saving, start] = useTransition();
  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isFs, setIsFs] = useState(false);

  const toggleFs = () => {
    const el = overlayRef.current;
    if (!document.fullscreenElement) el?.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

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

  const [exporting, setExporting] = useState(false);
  const set = (fn: (d: DeckData) => DeckData) => setDeck((d) => (d ? fn(d) : d));
  const regen = () => { setPhase("loading"); generateDeck(runId, true).then((r) => { if (r.deck) { setDeck(r.deck); setPhase("ready"); } else { setError(r.error ?? "Failed"); setPhase("error"); } }); };
  const saveAndConfirm = () => { if (!deck) return; start(async () => { await saveDeck(runId, deck); onDone(); }); };
  const exportPptx = async () => { if (!deck) return; setExporting(true); try { await downloadDeckPptx(deck); } catch (e) { setError(e instanceof Error ? e.message : "Export failed"); } finally { setExporting(false); } };

  return (
    <div className="fsdeck-overlay" ref={overlayRef}>
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
          <button className="fsdeck-btn ghost" onClick={toggleFs}><Icon name={isFs ? "minimize" : "maximize"} size={12} /> {isFs ? "Exit full screen" : "Full screen"}</button>
          <button className="fsdeck-btn ghost" onClick={regen} disabled={phase === "loading"}><Icon name="refresh-cw" size={12} /> Regenerate</button>
          <button className="fsdeck-btn ghost" onClick={exportPptx} disabled={!deck || exporting}><Icon name="download" size={12} /> {exporting ? "Exporting…" : "Download PPTX"}</button>
          <button className="fsdeck-btn ghost" onClick={onClose}>Close</button>
          <button className="fsdeck-btn primary" onClick={saveAndConfirm} disabled={!deck || saving}><Icon name="check" size={13} /> {saving ? "Saving…" : "Save & confirm step"}</button>
        </div>
      </div>

      {phase === "loading" && <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#fff" }}><div style={{ textAlign: "center" }}><div className="ai-loading"><span className="d" /><span className="d" /><span className="d" /></div><div style={{ marginTop: 12, fontSize: 13, color: "rgba(255,255,255,0.7)" }}>Building the deck from this client&apos;s data…</div></div></div>}

      {phase === "error" && <div style={{ flex: 1, display: "grid", placeItems: "center", color: "#fff" }}><div style={{ textAlign: "center", maxWidth: 420 }}><Icon name="alert-triangle" size={28} /><div style={{ marginTop: 10, fontSize: 14 }}>{error}</div><button className="fsdeck-btn ghost" style={{ marginTop: 14 }} onClick={regen}>Try again</button></div></div>}

      {phase === "ready" && deck && mode === "present" && (
        <div className="fsdeck-present">
          <div className="fsdeck-present-stage" ref={stageRef}>
            <div className="fsdeck-stage" style={{ transform: `scale(${scale})`, transformOrigin: "center", background: "#fff" }}>
              <PdfTemplateSlide pageIdx={idx} deck={deck} />
            </div>
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
          <div className="fsdeck-legend"><span className="fsdeck-legend-h">Editable fields:</span><span className="fsdeck-conf crm"><span className="dot" />Client</span><span className="fsdeck-conf client"><span className="dot" />Contract</span></div>

          <DeckEdit n="1" label="Client name (shown on the cover)" pill="crm">
            <input className="fsdeck-edit" value={deck.clientName} onChange={(e) => set((d) => ({ ...d, clientName: e.target.value }))} />
          </DeckEdit>

          <DeckEdit n="2" label="Contract · scope (1–2 sentences shown on the Scope slide)" pill="client">
            <textarea className="fsdeck-edit" value={deck.contract.scope} onChange={(e) => set((d) => ({ ...d, contract: { ...d.contract, scope: e.target.value } }))} rows={2} />
          </DeckEdit>

          <DeckEdit n="3" label="Contract · included in scope — tick the items the sales team has already committed to" pill="client">
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(deck.contract.highlights ?? []).map((h, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={!!deck.contract.inclusionsShared?.[i]} onChange={(e) => set((d) => {
                    const next = [...(d.contract.inclusionsShared ?? [])];
                    while (next.length < d.contract.highlights.length) next.push(false);
                    next[i] = e.target.checked;
                    return { ...d, contract: { ...d.contract, inclusionsShared: next } };
                  })} title="Shared by sales — shows a Shared badge on the Scope slide" />
                  <input className="fsdeck-edit" style={{ flex: 1 }} value={h} onChange={(e) => set((d) => ({ ...d, contract: { ...d.contract, highlights: d.contract.highlights.map((x, j) => j === i ? e.target.value : x) } }))} />
                  <button type="button" onClick={() => set((d) => ({ ...d, contract: { ...d.contract, highlights: d.contract.highlights.filter((_, j) => j !== i), inclusionsShared: (d.contract.inclusionsShared ?? []).filter((_, j) => j !== i) } }))} style={{ background: "transparent", border: "1px solid var(--fsd-line, #ECE3D2)", borderRadius: 6, padding: "3px 7px", fontSize: 11, color: "var(--fsd-ink-2, #51606E)", cursor: "pointer" }}>Remove</button>
                </div>
              ))}
              <button type="button" onClick={() => set((d) => ({ ...d, contract: { ...d.contract, highlights: [...d.contract.highlights, ""], inclusionsShared: [...(d.contract.inclusionsShared ?? []), false] } }))} style={{ alignSelf: "flex-start", background: "transparent", border: "1px dashed var(--fsd-line, #ECE3D2)", borderRadius: 6, padding: "5px 10px", fontSize: 12, color: "var(--fsd-ink-2, #51606E)", cursor: "pointer" }}>+ Add included item</button>
            </div>
          </DeckEdit>

          <DeckEdit n="4" label="Contract · out of scope (one per line)" pill="client">
            <textarea className="fsdeck-edit" value={(deck.contract.exclusions ?? []).join("\n")} onChange={(e) => set((d) => ({ ...d, contract: { ...d.contract, exclusions: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } }))} rows={3} />
          </DeckEdit>

          <DeckEdit n="5" label="Contract · payment terms" pill="client">
            <input className="fsdeck-edit" value={deck.contract.payment} onChange={(e) => set((d) => ({ ...d, contract: { ...d.contract, payment: e.target.value } }))} />
          </DeckEdit>

          <DeckEdit n="6" label="Contract · engagement duration" pill="client">
            <input className="fsdeck-edit" value={deck.contract.duration} placeholder={deckDurationText()} onChange={(e) => set((d) => ({ ...d, contract: { ...d.contract, duration: e.target.value } }))} />
          </DeckEdit>

          <div className="fsdeck-editfoot"><Icon name="info" size={14} /> Only client name + contract terms are editable — every other slide is the standard Finanshels template. Tick a scope item to flag it as already shared by sales.</div>
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
  runId, stepId, actType, title, contacts = [], onClose, onDone,
}: { runId: string; stepId: string; actType: string; title: string; contacts?: string[]; onClose: () => void; onDone: () => void }) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  // WhatsApp welcome message (point-of-contact picker + copy).
  const [waOpen, setWaOpen] = useState(false);
  const [waContact, setWaContact] = useState(contacts[0] ?? "");
  const [waCopied, setWaCopied] = useState(false);
  const waText = renderWhatsappWelcome(waContact);

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
        <div className="hd"><h3>{title}</h3><div className="sub">{actType === "mom" ? "Welcome email — the saved template with your client's name, company, portal link and the meeting minutes filled in. Review and edit before sending." : "AI draft — review and edit before saving. Powered by your configured model."}</div></div>
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

          {actType === "mom" && (
            <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              <button onClick={() => setWaOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--bg-soft)", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--ink-2)" }}>
                <Icon name="message-circle" size={15} style={{ color: "#25D366" }} /> WhatsApp group welcome message
                <Icon name={waOpen ? "chevron-up" : "chevron-down"} size={15} style={{ marginLeft: "auto" }} />
              </button>
              {waOpen && (
                <div style={{ padding: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Point of contact</span>
                    {contacts.length > 0 ? (
                      <select value={waContact} onChange={(e) => setWaContact(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 13 }}>
                        {contacts.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : (
                      <input value={waContact} onChange={(e) => setWaContact(e.target.value)} placeholder="Name shown in the message" style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 13, flex: 1, minWidth: 160 }} />
                    )}
                  </div>
                  <textarea readOnly value={waText} style={{ width: "100%", minHeight: 168, border: "1px solid var(--border)", borderRadius: 8, padding: "9px 11px", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit", background: "#fff", resize: "vertical" }} />
                  <button className="btn-soft" style={{ marginTop: 8 }} onClick={() => { navigator.clipboard?.writeText(waText); setWaCopied(true); setTimeout(() => setWaCopied(false), 1800); }}>
                    <Icon name={waCopied ? "check" : "copy"} size={13} /> {waCopied ? "Copied — paste into WhatsApp" : "Copy message"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          {/* Agenda step → WhatsApp ONLY (no email). Confirmation required: team copies the drafted message + opens WhatsApp, then marks the step Save & confirm. */}
          {actType === "agenda" && (
            <>
              <button className="btn-soft" disabled={!text.trim()} onClick={() => { navigator.clipboard?.writeText(text); setWaCopied(true); setTimeout(() => setWaCopied(false), 1800); }}>
                <Icon name={waCopied ? "check" : "copy"} size={13} /> {waCopied ? "Copied — paste into WhatsApp" : "Copy message"}
              </button>
              <a className="btn-ai" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" aria-disabled={!text.trim()} style={!text.trim() ? { pointerEvents: "none", opacity: 0.5 } : undefined}>
                <Icon name="message-circle" size={13} /> Open in WhatsApp
              </a>
            </>
          )}
          {["mom", "ai", "welcome_email", "deck", "datareq", "report"].includes(actType) && (
            <button className="btn-ai" disabled={saving || phase !== "ready" || !text.trim()} onClick={() => startSave(async () => {
              const s = await sendClientEmail(runId, actType === "mom" ? WELCOME_EMAIL_SUBJECT : title, text);
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

      {(detail.items["linked_sops"] ?? []).length > 0 && (
        <PlaybookCard title="Linked SOPs & templates">
          {(detail.items["linked_sops"] ?? []).map((it, i) => {
            const s = it.data as { id: string; title: string };
            return <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "3px 0" }}><Icon name="book-open" size={14} style={{ color: "var(--orange)" }} />{s.title}</div>;
          })}
        </PlaybookCard>
      )}

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

// Load pdf.js from CDN once (no npm dep) so we can read the contract text in the
// browser and feed the proven text analyzer — far more reliable than the file API.
let pdfjsPromise: Promise<{ getDocument: (o: unknown) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str: string }[] }> }> }> }; GlobalWorkerOptions: { workerSrc: string } }> | null = null;
function loadPdfjs() {
  const w = window as unknown as { pdfjsLib?: unknown };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib as never);
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = () => { const lib = (window as unknown as { pdfjsLib: { GlobalWorkerOptions: { workerSrc: string } } }).pdfjsLib; lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; resolve(lib as never); };
      s.onerror = () => reject(new Error("Could not load the PDF reader."));
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}
async function extractPdfText(file: File): Promise<string> {
  const lib = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return text.trim();
}

function ContractBuilderModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const [contractText, setContractText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [ca, setCa] = useState<ContractAnalysis | null>(null);
  const [contractFile, setContractFile] = useState<{ link: string; name: string } | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "contract").maybeSingle().then(({ data }) => {
      const d = data?.data as (ContractAnalysis & { fileLink?: string; fileName?: string }) | undefined;
      if (d && Object.keys(d).length) { setCa(d); if (d.fileLink) setContractFile({ link: d.fileLink, name: d.fileName ?? "Contract file" }); }
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const onFile = async (file: File) => {
    setUploadingFile(true);
    setError(null);
    const fd = new FormData(); fd.append("file", file);
    const r = await uploadContractFile(runId, fd);
    if (r.link) setContractFile({ link: r.link, name: r.name ?? file.name });
    setAnalyzing(true);
    try {
      let result: ContractAnalysis | undefined;
      let textPathError: string | null = null;
      let extractedTextLen = 0;
      // PDFs: read the text in the browser and use the proven text analyzer
      // (the same content ChatGPT handles well) — most reliable.
      if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
        try {
          const text = await extractPdfText(file);
          extractedTextLen = text?.length ?? 0;
          if (text && text.length > 80) {
            const a = await analyzeContract(runId, text);
            if (a.result) result = a.result;
            else if (a.error) textPathError = a.error;
          } else {
            textPathError = "The PDF had no readable text (likely scanned). Trying file-based reading…";
          }
        } catch (e) {
          textPathError = e instanceof Error ? `PDF reader failed: ${e.message}` : "PDF reader failed.";
        }
      }
      // Fallback: OpenAI native file understanding (scanned PDFs, images, docx).
      if (!result) {
        const fd2 = new FormData(); fd2.append("file", file);
        const a = await analyzeContractFile(runId, fd2);
        if (a.result) result = a.result;
        else {
          const msg = a.error ?? "Couldn't extract contract terms from the file.";
          setError(textPathError && extractedTextLen > 80 ? `${textPathError} • File API: ${msg}` : msg);
        }
      }
      if (result) { setCa(result); setError(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong reading the contract.");
    } finally {
      setAnalyzing(false);
      setUploadingFile(false);
    }
  };
  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    const r = await analyzeContract(runId, contractText);
    setAnalyzing(false);
    if (r.result) { setCa(r.result); setError(null); }
    else if (r.error) setError(r.error);
  };
  const upd = (patch: Partial<ContractAnalysis>) => setCa((c) => ({ ...(c ?? {}), ...patch }));

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 660, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Upload contract & confirm what we deliver</h3><div className="sub">Attach or paste the engagement contract — AI extracts the scope, exclusions, payment terms and the reports we deliver. This is what the client sees in their portal.</div></div>
        <div className="bd" style={{ maxHeight: "66vh" }}>
          <div className="field">
            <label>Engagement contract / proposal — just attach the file and AI reads it (or paste the text)</label>
            <textarea className="notes" value={contractText} onChange={(e) => setContractText(e.target.value)} placeholder="Paste the contract / engagement letter text… (optional — attaching a PDF is enough)" style={{ minHeight: 80 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
              <label className="btn-ai" style={{ cursor: uploadingFile || analyzing ? "default" : "pointer" }}>
                <Icon name="paperclip" size={13} /> {uploadingFile ? "Uploading…" : analyzing ? "Reading the file…" : contractFile ? "Replace file & re-read" : "Attach contract & analyze"}
                <input type="file" hidden disabled={uploadingFile || analyzing} onChange={(e) => { const f = e.target.files?.[0]; if (f) { setError(null); onFile(f); } e.target.value = ""; }} />
              </label>
              <button className="btn-ghost" type="button" disabled={analyzing || !contractText.trim()} onClick={() => { setError(null); analyze(); }}><Icon name="sparkles" size={13} /> {analyzing ? "Reading…" : "Analyze pasted text"}</button>
              {contractFile && <a href={contractFile.link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--orange)", fontWeight: 600 }}><Icon name="file-check" size={12} /> {contractFile.name}</a>}
            </div>
            {error && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{error}</div>}
          </div>
          {ca && (
            <>
              <div className="field" style={{ margin: 0 }}><label>Scope (client sees this)</label><textarea className="notes" value={ca.scope ?? ""} onChange={(e) => upd({ scope: e.target.value })} style={{ minHeight: 50 }} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}><label>Engagement starts</label><input type="month" value={ca.periodStart ?? ""} onChange={(e) => upd({ periodStart: e.target.value })} /></div>
                <div className="field" style={{ margin: 0 }}><label>Engagement ends <span style={{ fontWeight: 400, color: "var(--ink-3)" }}>— leave blank if ongoing</span></label><input type="month" value={ca.periodEnd ?? ""} onChange={(e) => upd({ periodEnd: e.target.value || undefined })} /></div>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                <Icon name="calendar" size={13} /> Duration: <strong>{formatEngagementPeriod(ca.periodStart, ca.periodEnd) || "Not specified"}</strong>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
                <div className="field" style={{ margin: 0 }}><label>Included (one per line)</label><textarea className="notes" value={(ca.inclusions ?? []).join("\n")} onChange={(e) => upd({ inclusions: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} style={{ minHeight: 60 }} /></div>
                <div className="field" style={{ margin: 0 }}><label>Excluded (one per line)</label><textarea className="notes" value={(ca.exclusions ?? []).join("\n")} onChange={(e) => upd({ exclusions: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} style={{ minHeight: 60 }} /></div>
              </div>
              <div className="field" style={{ marginTop: 8 }}><label>Payment terms</label><input value={ca.paymentTerms ?? ""} onChange={(e) => upd({ paymentTerms: e.target.value })} /></div>
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>What we deliver &amp; when</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 6 }}>Standard deadlines pre-filled — edit per the client&apos;s request. Shown in the onboarding portal.</div>
                {(ca.deliverables ?? []).map((dv, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                    <input value={dv.item} placeholder="Deliverable" onChange={(e) => upd({ deliverables: (ca.deliverables ?? []).map((x, j) => (j === i ? { ...x, item: e.target.value } : x)) })} style={{ flex: 3, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }} />
                    <input value={dv.frequency} placeholder="Frequency" onChange={(e) => upd({ deliverables: (ca.deliverables ?? []).map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)) })} style={{ width: 95, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }} />
                    <input value={dv.deadline} placeholder="Deadline" onChange={(e) => upd({ deliverables: (ca.deliverables ?? []).map((x, j) => (j === i ? { ...x, deadline: e.target.value } : x)) })} style={{ flex: 3, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }} />
                    <button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => upd({ deliverables: (ca.deliverables ?? []).filter((_, j) => j !== i) })}><Icon name="x" size={12} /></button>
                  </div>
                ))}
                <button className="add-link" style={{ marginTop: 6 }} onClick={() => upd({ deliverables: [...(ca.deliverables ?? []), { item: "New deliverable", frequency: "Monthly", deadline: "By the 15th of the following month" }] })}><Icon name="plus" size={12} /> Add deliverable</button>
              </div>
            </>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => startSave(async () => {
            const data = (ca || contractFile) ? { ...((ca as unknown as Record<string, unknown>) ?? {}), ...(contractFile ? { fileLink: contractFile.link, fileName: contractFile.name } : {}) } : null;
            const r = await saveContractAnalysis(runId, stepId, data);
            if (!r.error) onDone();
          })}>{saving ? "Saving…" : "Save & confirm"}</button>
        </div>
      </div>
    </div>
  );
}

const ACCOUNTING_SOFTWARE = ["Zoho Books", "QuickBooks Online", "Xero", "Odoo", "Tally", "Wafeq", "Other"];

function AccountingSoftwareModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const [choice, setChoice] = useState("");
  const [other, setOther] = useState("");
  const [saved, setSaved] = useState(false);            // becomes true after first successful save
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState("the client");

  useEffect(() => {
    Promise.all([
      supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "accounting_software").maybeSingle(),
      supabase.from("onboarding_runs").select("clients(name)").eq("id", runId).maybeSingle(),
    ]).then(([{ data }, { data: r }]) => {
      const sw = (data?.data as { software?: string } | undefined)?.software;
      if (sw) {
        if (ACCOUNTING_SOFTWARE.includes(sw)) setChoice(sw);
        else { setChoice("Other"); setOther(sw); }
        setSaved(true);
      }
      const cl = (r as { clients?: { name?: string } | { name?: string }[] } | null)?.clients;
      const name = Array.isArray(cl) ? cl[0]?.name : cl?.name;
      if (name) setClientName(name);
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const value = choice === "Other" ? other.trim() : choice;
  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 560, maxWidth: "calc(100vw - 32px)", maxHeight: "92vh", display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Accounting software & team handoff</h3><div className="sub">Pick the platform, then post a Slack message to the setup team with the trade licence + VAT certificate attached.</div></div>
        <div className="bd" style={{ overflowY: "auto" }}>
          <div className="field"><label>1. Accounting software</label>
            <select value={choice} onChange={(e) => { setChoice(e.target.value); setError(null); }} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13.5 }}>
              <option value="">Select…</option>
              {ACCOUNTING_SOFTWARE.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {choice === "Other" && (
            <div className="field" style={{ marginTop: 8 }}><label>Name the software</label><input value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. Sage, Zoho Books UAE…" autoFocus /></div>
          )}
          {error && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{error}</div>}

          {!saved && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn-primary" disabled={saving || !value} onClick={() => startSave(async () => {
                const r = await saveAccountingSoftware(runId, stepId, value);
                if (r.error) setError(r.error); else setSaved(true);
              })}>{saving ? "Saving…" : "Save & continue"}</button>
            </div>
          )}

          {saved && (
            <SlackHandoffComposer
              runId={runId}
              stepId={stepId}
              clientName={clientName}
              software={value}
              onClose={onClose}
              onSent={onDone}
            />
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Close</button>
          {saved && (
            <button className="btn-ghost" onClick={onDone}>Skip Slack & finish</button>
          )}
        </div>
      </div>
    </div>
  );
}

type ComposerOpts = Awaited<ReturnType<typeof loadSlackComposerOptions>>;
type AttachableDoc = Awaited<ReturnType<typeof listRunAttachableDocs>>[number];

function SlackHandoffComposer({
  runId, stepId, clientName, software, onClose, onSent,
}: { runId: string; stepId: string; clientName: string; software: string; onClose: () => void; onSent: () => void }) {
  const [opts, setOpts] = useState<ComposerOpts | null>(null);
  const [docs, setDocs] = useState<AttachableDoc[]>([]);
  const [channel, setChannel] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, true>>({});
  const [message, setMessage] = useState("");
  const [sending, startSend] = useTransition();
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadSlackComposerOptions(runId), listRunAttachableDocs(runId)]).then(([o, d]) => {
      setOpts(o); setDocs(d);
      const pre: Record<string, true> = {};
      d.forEach((doc) => { if (doc.isPreferred) pre[doc.id] = true; });
      setPicked(pre);
    });
  }, [runId]);

  useEffect(() => {
    const mentionTokens = mentionIds.map((id) => `@${opts?.users.find((u) => u.id === id)?.name ?? "team"}`).join(", ");
    const greet = mentionTokens || "team";
    setMessage(
      `Hi ${greet},\n\nPlease create a ${software || "[software]"} account for ${clientName}. The client's trade licence + VAT certificate are attached.\n\nLet me know once the account is live and shared.\n\nThanks.`,
    );
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [mentionIds, software, clientName, opts?.users]);

  const usersFiltered = (opts?.users ?? []).filter((u) => {
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.real_name.toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q);
  }).slice(0, 12);

  if (!opts) {
    return <div style={{ marginTop: 16, padding: 12, background: "var(--bg-soft)", borderRadius: 8, fontSize: 12.5, color: "var(--ink-3)" }}>Loading Slack workspace…</div>;
  }
  if (!opts.connected) {
    return (
      <div style={{ marginTop: 16, padding: 14, background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 8, fontSize: 13 }}>
        <strong>Slack isn&apos;t connected yet.</strong>{" "}
        <Link href="/settings#slack" style={{ color: "var(--orange)" }}>Connect Slack in Settings →</Link>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>Once connected, this card lets you send a templated setup request to the accounting-software team with the client&apos;s docs attached.</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>2. Send setup request to team via Slack</div>

      <div className="field"><label>Channel</label>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13.5 }}>
          <option value="">Select a channel…</option>
          {opts.channels.map((c) => <option key={c.id} value={c.id}>{c.isPrivate ? "🔒 " : "#"}{c.name}</option>)}
        </select>
      </div>

      <div className="field" style={{ marginTop: 10 }}><label>Mention (@) — pick people to ping</label>
        <input value={mentionQuery} onChange={(e) => setMentionQuery(e.target.value)} placeholder="Type to filter (name, handle, email)…" style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13.5 }} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {mentionIds.map((id) => {
            const u = opts.users.find((x) => x.id === id);
            return (
              <span key={id} style={{ background: "var(--orange-soft)", color: "var(--orange)", padding: "3px 8px", borderRadius: 999, fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                @{u?.name ?? "user"}
                <button onClick={() => setMentionIds((arr) => arr.filter((x) => x !== id))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: 13 }}>×</button>
              </span>
            );
          })}
        </div>
        {mentionQuery && (
          <div style={{ marginTop: 6, border: "1px solid var(--border)", borderRadius: 8, maxHeight: 180, overflowY: "auto" }}>
            {usersFiltered.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { if (!mentionIds.includes(u.id)) setMentionIds([...mentionIds, u.id]); setMentionQuery(""); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", background: "transparent", cursor: "pointer", fontSize: 12.5 }}
              >
                <strong>@{u.name}</strong> <span style={{ color: "var(--ink-3)" }}>· {u.real_name}{u.email ? ` · ${u.email}` : ""}</span>
              </button>
            ))}
            {!usersFiltered.length && <div style={{ padding: 8, fontSize: 12, color: "var(--ink-3)" }}>No matches.</div>}
          </div>
        )}
      </div>

      <div className="field" style={{ marginTop: 10 }}><label>Attach documents</label>
        {docs.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>No uploaded documents on this run yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            {docs.map((d) => (
              <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "4px 6px", borderRadius: 6, background: picked[d.id] ? "var(--orange-soft)" : "transparent", cursor: "pointer" }}>
                <input type="checkbox" checked={!!picked[d.id]} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[d.id] = true; else delete n[d.id]; return n; })} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.typeName} · <span style={{ color: "var(--ink-3)" }}>{d.label}</span></span>
                {d.isPreferred && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999, background: "var(--orange)", color: "#fff" }}>RECOMMENDED</span>}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="field" style={{ marginTop: 10 }}><label>Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={7}
          style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontFamily: "inherit", resize: "vertical" }}
        />
        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4 }}>Mentioned people are added at the top of the message in Slack format automatically — you can keep this body free of @-tokens.</div>
      </div>

      {sendErr && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 6 }}>{sendErr}</div>}
      {sentNote && <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 6, background: "#ecfdf5", border: "1px solid #34d399", padding: "6px 10px", borderRadius: 6 }}>{sentNote}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button className="btn-ghost" onClick={onClose} disabled={sending}>Skip & close</button>
        <button
          className="btn-primary"
          disabled={sending || !channel || !message.trim()}
          onClick={() => startSend(async () => {
            setSendErr(null); setSentNote(null);
            const docIds = Object.keys(picked);
            const r = await sendSlackSetupRequest(runId, stepId, { channel, mentionIds, message, docIds });
            if (!r.ok) { setSendErr(r.error ?? "Failed to send"); return; }
            if (r.error) setSentNote(r.error); else setSentNote("Sent to Slack.");
            // Auto-close after a brief beat so the user sees the confirmation.
            setTimeout(onSent, 900);
          })}
        >{sending ? "Sending…" : "Send to Slack"}</button>
      </div>
    </div>
  );
}

interface AccessEntry { on: boolean; label: string; systemName: string; method: string; sop: string; emails: string[]; accessMode: AccessMode; isCustom?: boolean; category?: string }

function AccessBuilderModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const [email, setEmail] = useState(AUTHORISED_USER_EMAIL);
  const [secureDefault, setSecureDefault] = useState(AUTHORISED_USER_EMAIL);
  const [loaded, setLoaded] = useState(false);
  const [saving, start] = useTransition();
  const [mailbox, setMailbox] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [people, setPeople] = useState<{ label: string; email: string }[]>([]);
  const [entries, setEntries] = useState<Record<string, AccessEntry>>(() =>
    Object.fromEntries(ACCESS_TYPES.map((t) => [t.id, { on: false, label: t.label, systemName: "", method: t.methods[0], sop: t.sop.join("\n"), emails: [], accessMode: "viewer" as AccessMode }])),
  );

  useEffect(() => {
    Promise.all([
      supabase.from("run_items").select("data").eq("run_id", runId).eq("kind", "access").order("sort"),
      supabase.from("onboarding_runs").select("org_id,clients(name)").eq("id", runId).maybeSingle(),
      supabase.from("run_team").select("team_members(full_name,email)").eq("run_id", runId),
    ]).then(async ([{ data }, { data: runRow }, { data: teamRows }]) => {
      const cl = (runRow as { clients?: { name?: string } | { name?: string }[] } | null)?.clients;
      const name = Array.isArray(cl) ? cl[0]?.name : cl?.name;
      const secure = `secure+${clientEmailSlug(name ?? "")}@finanshels.com`;
      setSecureDefault(secure);

      // Build the email option list: shared secure inbox, the per-client alias, master admin + assigned people.
      const opts: { label: string; email: string }[] = [
        { label: "Shared secure inbox", email: "secure@finanshels.com" },
        { label: "Per-client secure alias (default)", email: secure },
      ];
      const orgId = (runRow as { org_id?: string } | null)?.org_id;
      if (orgId) {
        const { data: admins } = await supabase.from("team_members").select("full_name,email").eq("org_id", orgId).eq("role", "admin").eq("active", true);
        (admins ?? []).forEach((a: { full_name: string; email: string | null }) => { if (a.email) opts.push({ label: `${a.full_name} (Master Admin)`, email: a.email }); });
      }
      (teamRows ?? []).forEach((t: { team_members: { full_name: string; email: string | null } | { full_name: string; email: string | null }[] | null }) => {
        const tm = Array.isArray(t.team_members) ? t.team_members[0] : t.team_members;
        if (tm?.email) opts.push({ label: `${tm.full_name} (assigned)`, email: tm.email });
      });
      // de-dupe by email
      const seen = new Set<string>();
      setPeople(opts.filter((o) => o.email && !seen.has(o.email.toLowerCase()) && seen.add(o.email.toLowerCase())));

      const rows = (data ?? []).map((r) => r.data as AccessItem);
      if (rows.length) {
        setEntries((prev) => {
          const next = { ...prev };
          rows.forEach((it) => {
            const isCustom = !ACCESS_TYPES.some((t) => t.id === it.id);
            next[it.id] = { on: true, label: it.label, systemName: it.systemName ?? "", method: it.method, sop: (it.sop ?? []).join("\n"), emails: (it.email ?? "").split(",").map((s) => s.trim()).filter(Boolean), accessMode: it.accessMode ?? "viewer", isCustom, category: isCustom ? "Other" : undefined };
          });
          return next;
        });
      }
      setEmail(secure);
      setLoaded(true);
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const set = (id: string, patch: Partial<AccessEntry>) => setEntries((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const enabledCount = Object.values(entries).filter((e) => e.on).length;
  const sendMailboxRequest = () => { setMailbox("sending"); requestSecureMailbox(runId, (email.split(",")[0] || secureDefault).trim()).then((r) => setMailbox(r.ok ? "sent" : "error")); };

  const addCustom = () => {
    const id = `custom_${Date.now().toString(36)}`;
    setEntries((prev) => ({
      ...prev,
      [id]: {
        on: true, label: "Custom system", systemName: "", method: "Add us as a user (recommended)",
        sop: ["Log in to the system.", "Add {email} with read / reporting access.", "Confirm here once done."].join("\n"),
        emails: [secureDefault], accessMode: "viewer", isCustom: true, category: "Other",
      },
    }));
  };

  const save = () => start(async () => {
    const items: AccessItem[] = Object.entries(entries)
      .filter(([, e]) => e.on)
      .map(([id, e]) => {
        const predefined = ACCESS_TYPES.find((t) => t.id === id);
        return {
          id,
          label: e.label.trim() || predefined?.label || "Custom access",
          method: e.accessMode === "credentials" ? "Share login credentials" : e.method,
          email: e.accessMode === "credentials" ? "" : ((e.emails.length ? e.emails.join(", ") : secureDefault) || AUTHORISED_USER_EMAIL),
          sop: e.sop.split("\n").map((s) => s.trim()).filter(Boolean),
          systemName: e.systemName.trim() || undefined,
          status: "requested",
          accessMode: e.accessMode,
        };
      });
    const r = await saveAccess(runId, stepId, items);
    if (!r.error) onDone();
  });

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 720, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Configure access requests</h3><div className="sub">Pick the systems the client must give us access to. Each shows a step-by-step SOP in their portal — editable here.</div></div>
        <div className="bd" style={{ maxHeight: "66vh" }}>
          <div className="field">
            <label>Secure mailbox for this client (request it if it doesn&apos;t exist). Per-system access emails are configured on each system below.</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={secureDefault} />
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
              {email.trim() !== secureDefault && <button className="btn-ghost" type="button" onClick={() => setEmail(secureDefault)}><Icon name="rotate-ccw" size={12} /> Use secure default ({secureDefault})</button>}
              <button className="btn-ghost" type="button" disabled={mailbox === "sending"} onClick={sendMailboxRequest}>
                <Icon name={mailbox === "sent" ? "check" : "mail"} size={12} /> {mailbox === "sending" ? "Sending…" : mailbox === "sent" ? "Mailbox request sent to Lohith" : mailbox === "error" ? "Couldn't send — retry" : "Request this mailbox from Lohith"}
              </button>
            </div>
          </div>
          {!loaded ? <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div> : (
            <>
            {Object.entries(entries).map(([id, e]) => {
              const t = ACCESS_TYPES.find((x) => x.id === id);
              const category = t?.category ?? e.category ?? "Other";
              const isCustom = !t || e.isCustom;
              const fallbackMethods = t?.methods ?? ["Add us as a user (recommended)", "Share login credentials"];
              const fallbackSop = t?.sop ?? ["Log in to the system.", "Add {email} with read access.", "Confirm here once done."];
            return (
              <div key={id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 8, background: e.on ? "#fff" : "var(--bg-soft)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600 }}>
                  <input type="checkbox" checked={e.on} onChange={(ev) => set(id, { on: ev.target.checked, emails: ev.target.checked && !e.emails.length ? [secureDefault] : e.emails })} style={{ accentColor: "var(--orange)" }} />
                  {isCustom ? (
                    <input value={e.label} onChange={(ev) => set(id, { label: ev.target.value })} onClick={(ev) => ev.preventDefault()} style={{ flex: 1, border: "1px dashed var(--border-strong)", borderRadius: 6, padding: "3px 7px", fontSize: 13.5, fontWeight: 600, background: "#fff" }} placeholder="Custom system name" />
                  ) : (t?.label ?? e.label)}
                  <span className="pill gray" style={{ fontSize: 10, marginLeft: "auto" }}>{isCustom ? "Custom" : category}</span>
                  {isCustom && (
                    <button type="button" className="icon-btn" onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); setEntries((prev) => { const n = { ...prev }; delete n[id]; return n; }); }} style={{ color: "var(--red)" }} aria-label="Remove custom access"><Icon name="trash-2" size={13} /></button>
                  )}
                </label>
                {e.on && (
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div className="field" style={{ margin: 0 }}><label>Display label</label><input value={e.label} onChange={(ev) => set(id, { label: ev.target.value })} /></div>
                      <div className="field" style={{ margin: 0 }}><label>Specific system name (optional)</label><input value={e.systemName} onChange={(ev) => set(id, { systemName: ev.target.value })} placeholder="e.g. Emirates NBD, Telr" /></div>
                    </div>
                    {/* How the client shares this access */}
                    <div className="field" style={{ margin: 0 }}>
                      <label>How does the client share this access?</label>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className={"tab-pill" + (e.accessMode !== "credentials" ? " active" : "")}
                          onClick={() => set(id, { accessMode: "viewer", method: fallbackMethods[0], sop: fallbackSop.join("\n") })}>
                          {e.accessMode !== "credentials" ? "✓ " : ""}Share viewer / user access
                        </button>
                        <button type="button" className={"tab-pill" + (e.accessMode === "credentials" ? " active" : "")}
                          onClick={() => set(id, { accessMode: "credentials", method: "Share login credentials", sop: CREDENTIALS_SOP.join("\n") })}>
                          {e.accessMode === "credentials" ? "✓ " : ""}Share login credentials
                        </button>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 6 }}>
                        {e.accessMode === "credentials"
                          ? "The client pastes their username & password in the portal. We store the password encrypted; you can reveal it in the Onboarding Portal tab."
                          : "The client adds us as a read-only / authorised user, following the SOP."}
                      </div>
                    </div>
                    {e.accessMode !== "credentials" && (
                    <div className="field" style={{ margin: 0 }}>
                      <label>Grant access to which email(s)? — used in this system&apos;s SOP</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                        {people.map((p) => {
                          const on = e.emails.includes(p.email);
                          return (
                            <button key={p.email} type="button" className={"tab-pill" + (on ? " active" : "")} title={p.email}
                              onClick={() => set(id, { emails: on ? e.emails.filter((x) => x !== p.email) : [...e.emails, p.email] })}>
                              {on ? "✓ " : ""}{p.label}
                            </button>
                          );
                        })}
                      </div>
                      {/* any custom emails already added that aren't in the option list */}
                      {e.emails.filter((em) => !people.some((p) => p.email === em)).map((em) => (
                        <span key={em} className="tab-pill active" style={{ marginRight: 6 }}>✓ {em}
                          <button type="button" onClick={() => set(id, { emails: e.emails.filter((x) => x !== em) })} style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "inherit" }}>×</button>
                        </span>
                      ))}
                      <input placeholder="+ add another email & press Enter"
                        onKeyDown={(ev) => {
                          if (ev.key === "Enter") {
                            ev.preventDefault();
                            const v = (ev.target as HTMLInputElement).value.trim();
                            if (v && /\S+@\S+\.\S+/.test(v) && !e.emails.includes(v)) { set(id, { emails: [...e.emails, v] }); (ev.target as HTMLInputElement).value = ""; }
                          }
                        }}
                        style={{ width: "100%", marginTop: 6, border: "1px dashed var(--border-strong)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5 }} />
                      {e.emails.length === 0 && <div style={{ fontSize: 11.5, color: "var(--red)", marginTop: 4 }}>Pick at least one email — without it the access request isn&apos;t effective.</div>}
                    </div>
                    )}
                    <div className="field" style={{ margin: 0 }}><label>SOP — one step per line ({"{email}"} is auto-filled with the selected email)</label>
                      <textarea className="notes" value={e.sop} onChange={(ev) => set(id, { sop: ev.target.value })} style={{ minHeight: 100, fontFamily: "inherit" }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="btn-ghost" onClick={addCustom} style={{ width: "100%", justifyContent: "center", marginTop: 4, border: "1px dashed var(--border-strong)" }}>
            <Icon name="plus" size={13} /> Add custom access type
          </button>
          </>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : `Save & share ${enabledCount || ""} access ${enabledCount === 1 ? "request" : "requests"}`}</button>
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
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, startSave] = useTransition();

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
      <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Create & share Drive folders</h3><div className="sub">Set the service period — we build the Books folders for those months and share the Drive link.</div></div>
        <div className="bd" style={{ maxHeight: "60vh" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Service period — start</label><input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div className="field"><label>Service period — end</label><input type="month" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
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
            const r = await saveDrive(runId, stepId, { periodStart: start || undefined, periodEnd: end || undefined, contract: null });
            if (!r.error) onDone();
          })}>{saving ? "Creating…" : "Create folders & share link"}</button>
        </div>
      </div>
    </div>
  );
}

function ZohoPushModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const [coaCount, setCoaCount] = useState<number | null>(null);
  const [pushing, startPush] = useTransition();
  const [result, setResult] = useState<{ created: number; skipped: number; failed: number; errors: Array<{ code: string; account: string; reason: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("coa_instances").select("accounts").eq("run_id", runId).maybeSingle().then(({ data }) => {
      const lines = (data?.accounts ?? []) as Array<{ include?: boolean; account?: string }>;
      setCoaCount(lines.filter((l) => l.include !== false && l.account?.trim()).length);
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const push = () => {
    setError(null);
    startPush(async () => {
      const r = await pushCoaToZoho(runId, stepId);
      if (r.error) setError(r.error);
      else setResult({ created: r.created ?? 0, skipped: r.skipped ?? 0, failed: r.failed ?? 0, errors: r.errors ?? [] });
    });
  };

  const close = () => {
    if (result && result.failed === 0) onDone();
    else onClose();
  };

  return (
    <div className="modal-wrap" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-head">
          <h3>Import COA into Zoho Books</h3>
          <button className="icon-btn" onClick={close}><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 13.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
            Pushes every account in the saved COA into the Zoho Books org connected by any team member.
            Duplicate codes already in Zoho are skipped.
          </div>
          <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>
            <Icon name="layers" size={13} /> {coaCount === null ? "Loading COA…" : `${coaCount} account${coaCount === 1 ? "" : "s"} ready to push`}
          </div>

          {result && (
            <div style={{ background: result.failed === 0 ? "#ecfdf5" : "#fef3c7", border: `1px solid ${result.failed === 0 ? "#a7f3d0" : "#fde68a"}`, color: result.failed === 0 ? "#065f46" : "#92400e", borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{result.failed === 0 ? "Pushed successfully" : "Pushed with some failures"}</div>
              <div style={{ marginTop: 4 }}>{result.created} created · {result.skipped} already in Zoho · {result.failed} failed</div>
              {result.errors.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: "pointer", fontSize: 12 }}>Show failed accounts ({result.errors.length})</summary>
                  <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12 }}>
                    {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e.code} · {e.account}: {e.reason}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {error && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-ghost" onClick={close}>{result ? "Close" : "Cancel"}</button>
          {!result && (
            <button className="btn-primary" onClick={push} disabled={pushing || coaCount === 0}>
              {pushing ? "Pushing…" : `Push ${coaCount ?? 0} accounts to Zoho`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Optional Operations stage — two small yes/no config modals.

   Both reuse the existing escalateCatchup / escalateUrgentCompliance actions
   to spin up a parallel run when needed. "No" just completes the step.
   ───────────────────────────────────────────────────────────────────────────── */

function CatchupConfigModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; onClose: () => void; onDone: () => void }) {
  const [needed, setNeeded] = useState<"yes" | "no" | null>(null);
  const [service, setService] = useState("Catch-up bookkeeping");
  const [gautham, setGautham] = useState<{ id: string; name: string } | null>(null);
  const [resolving, setResolving] = useState(true);
  const [saving, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCatchupGautham().then((r) => {
      if (cancelled) return;
      setGautham(r);
      setResolving(false);
    });
    return () => { cancelled = true; };
  }, []);

  const save = () => {
    setErr(null);
    if (needed === "yes") {
      if (!gautham) { setErr("Couldn't resolve the Tax Head (Gautham) — check the org chart."); return; }
      if (!service.trim()) { setErr("Add a service / scope."); return; }
    }
    start(async () => {
      if (needed === "yes" && gautham) {
        const r = await escalateCatchup(runId, stepId, gautham.id, gautham.name, [{ service: service.trim(), title: service.trim() }]);
        if (r.error) { setErr(r.error); return; }
        onDone();
      } else {
        const r = (await completeStep(runId, stepId)) as { error?: string };
        if (r.error) { setErr(r.error); return; }
        onDone();
      }
    });
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 540, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Catch-up account configuration</h3>
          <div className="sub">Decide if the client needs catch-up bookkeeping. If yes, we&apos;ll spin up a parallel catch-up run assigned to Gautham.</div>
        </div>
        <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setNeeded("yes")}
              style={{ flex: 1, padding: "10px 14px", border: needed === "yes" ? "1px solid var(--orange)" : "1px solid var(--border)", background: needed === "yes" ? "var(--orange-soft)" : "transparent", fontWeight: 600, borderRadius: 8, cursor: "pointer" }}
            >Yes — catch-up needed</button>
            <button
              type="button"
              onClick={() => setNeeded("no")}
              style={{ flex: 1, padding: "10px 14px", border: needed === "no" ? "1px solid var(--ink-2)" : "1px solid var(--border)", background: needed === "no" ? "var(--bg-soft)" : "transparent", fontWeight: 600, borderRadius: 8, cursor: "pointer" }}
            >No — not needed</button>
          </div>
          {needed === "yes" && (
            <>
              <div className="field"><label>Service / scope</label>
                <input value={service} onChange={(e) => setService(e.target.value)} placeholder="Catch-up bookkeeping" />
              </div>
              <div className="field"><label>Account Manager</label>
                <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, background: "var(--bg-soft)", color: "var(--ink-1)" }}>
                  {resolving ? "Resolving Gautham…" : gautham?.name ?? "Gautham (not found in org chart)"}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4 }}>Locked to Gautham — the only AM allowed to own catch-up accounting.</div>
              </div>
            </>
          )}
          {needed === "no" && (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "6px 4px" }}>This step will be marked complete with a &ldquo;Not needed&rdquo; note. You can re-open it later from the run timeline.</div>
          )}
          {err && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving || needed === null || (needed === "yes" && resolving)} onClick={save}>
            {saving ? "Saving…" : needed === "yes" ? "Configure & spin up catch-up run" : "Mark not needed"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UrgentConfigModal({
  runId, stepId, onClose, onDone,
}: { runId: string; stepId: string; people: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [needed, setNeeded] = useState<"yes" | "no" | null>(null);
  const SERVICES: { id: string; label: string; note?: string }[] = [
    { id: "ct-registration", label: "Corporate Tax Registration" },
    { id: "vat-registration", label: "VAT Registration" },
    { id: "ct-filing", label: "Corporate Tax Filing" },
    { id: "vat-filing", label: "VAT Filing" },
    { id: "audit", label: "Statutory Audit", note: "Uses the CT Filing template" },
  ];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const save = () => {
    setErr(null);
    if (needed === "yes" && picked.size === 0) {
      setErr("Pick at least one service to escalate, or choose No urgent compliance.");
      return;
    }
    start(async () => {
      const r = await escalateUrgentComplianceServices(runId, stepId, needed === "yes", Array.from(picked));
      if (r.error) { setErr(r.error); return; }
      onDone();
    });
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 600, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <h3>Urgent compliance configuration</h3>
          <div className="sub">Is there any urgent compliance to handle for this client? If yes, pick the services — each spins up a parallel run on the Tax team (auto-assigned by capacity, default head: Gautham).</div>
        </div>
        <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setNeeded("yes")}
              style={{ flex: 1, padding: "10px 14px", border: needed === "yes" ? "1px solid var(--red)" : "1px solid var(--border)", background: needed === "yes" ? "var(--red-soft, #fdecec)" : "transparent", fontWeight: 600, borderRadius: 8, cursor: "pointer" }}
            >Yes — there is urgent compliance</button>
            <button
              type="button"
              onClick={() => { setNeeded("no"); setPicked(new Set()); }}
              style={{ flex: 1, padding: "10px 14px", border: needed === "no" ? "1px solid var(--ink-2)" : "1px solid var(--border)", background: needed === "no" ? "var(--bg-soft)" : "transparent", fontWeight: 600, borderRadius: 8, cursor: "pointer" }}
            >No urgent compliance</button>
          </div>
          {needed === "yes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>Which services?</div>
              {SERVICES.map((s) => {
                const on = picked.has(s.id);
                return (
                  <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: on ? "1px solid var(--orange)" : "1px solid var(--border)", borderRadius: 8, cursor: "pointer", background: on ? "var(--orange-soft)" : "transparent" }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(s.id)} style={{ width: 16, height: 16 }} />
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{s.label}</span>
                    {s.note && <span style={{ fontSize: 11.5, color: "var(--ink-3)", marginLeft: "auto" }}>{s.note}</span>}
                  </label>
                );
              })}
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>One parallel run will be created per ticked service, auto-assigned to the least-loaded tax-team member.</div>
            </div>
          )}
          {needed === "no" && (
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", padding: "6px 4px" }}>The step will be marked complete with a &ldquo;No urgent compliance&rdquo; note. You can re-open it later if anything surfaces.</div>
          )}
          {err && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{err}</div>}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving || needed === null} onClick={save}>
            {saving ? "Saving…" : needed === "yes" ? `Spin up ${picked.size || ""} run${picked.size === 1 ? "" : "s"} for Tax team` : "Mark — no urgent compliance"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Sticky pill shown when this run is part of a client group.
 * Lets the team flip between sibling entities (each entity = its own run)
 * without losing the group context.
 */
function GroupSwitcherPill({
  group, currentRunId,
}: {
  group: NonNullable<RunDetail["group"]>;
  currentRunId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "var(--orange-soft)", color: "var(--orange)", fontSize: 12, fontWeight: 700, border: "1px solid var(--orange)" }}>
        <Icon name="users" size={12} /> Group: {group.name}
      </span>
      {group.primaryContactName && (
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
          {group.primaryContactName}{group.primaryContactEmail ? ` · ${group.primaryContactEmail}` : ""}
        </span>
      )}
      <div style={{ position: "relative" }}>
        <button className="btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setOpen((v) => !v)}>
          Switch entity ({group.siblings.length}) <Icon name="chevron-down" size={11} />
        </button>
        {open && (
          <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50, minWidth: 280, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,0.12)", padding: 4 }} onMouseLeave={() => setOpen(false)}>
            {group.siblings.map((s) => {
              const current = s.runId === currentRunId;
              return (
                <button
                  key={s.runId}
                  className="btn-ghost"
                  onClick={() => { if (!current) router.push(`/onboarding/${s.runId}`); setOpen(false); }}
                  style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderRadius: 8, background: current ? "var(--bg-soft)" : "transparent" }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>{s.clientName}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{current ? "Currently viewing" : `${s.progress}% · ${s.status}`}</div>
                  </div>
                  {!current && <Icon name="arrow-right" size={13} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Mark a run "blocked" (or unblock it) — pauses the SLA + compliance crons
 * for this run. AM-level and above only (server-side enforced).
 *
 * `compact` (true) renders just the Unblock affordance inline with the red
 * banner; (false) renders the "Mark blocked" picker for the header row.
 */
function BlockControls({
  runId, currentReason, compact, onChange,
}: {
  runId: string;
  currentReason: string | null;
  compact: boolean;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [busy, start] = useTransition();
  const PRESETS = [
    "Catch-up bookkeeping incomplete",
    "Waiting on client documents",
    "Waiting on FTA / authority response",
    "Pending client sign-off / decision",
  ];

  const submit = (reason: string | null) => start(async () => {
    const res = await setRunBlocked(runId, reason);
    if (res.error) { alert(res.error); return; }
    setOpen(false); setPicked(""); setCustom("");
    onChange();
  });

  if (compact) {
    return (
      <button
        type="button"
        className="btn-ghost"
        disabled={busy}
        onClick={() => submit(null)}
        style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12, color: "var(--red)" }}
      >
        {busy ? "Unblocking…" : "Unblock"}
      </button>
    );
  }

  if (currentReason) {
    return (
      <button type="button" className="btn-ghost" disabled={busy} onClick={() => submit(null)} title="Resume SLA + compliance alerts">
        <Icon name="play-circle" size={13} /> {busy ? "Unblocking…" : "Unblock"}
      </button>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="btn-ghost" onClick={() => setOpen((v) => !v)} title="Pause SLA + compliance alerts (the team is waiting on upstream)">
        <Icon name="pause-circle" size={13} /> Mark blocked
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 60, minWidth: 320, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(15,23,42,0.12)", padding: 12 }} onMouseLeave={() => setOpen(false)}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-1)", marginBottom: 8 }}>Why is this blocked?</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {PRESETS.map((p) => (
              <label key={p} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer", background: picked === p ? "var(--bg-soft)" : "transparent", fontSize: 12.5 }}>
                <input type="radio" name="block-reason" checked={picked === p} onChange={() => setPicked(p)} /> {p}
              </label>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer", background: picked === "_custom" ? "var(--bg-soft)" : "transparent", fontSize: 12.5 }}>
              <input type="radio" name="block-reason" checked={picked === "_custom"} onChange={() => setPicked("_custom")} /> Other…
            </label>
            {picked === "_custom" && (
              <input
                autoFocus value={custom} onChange={(e) => setCustom(e.target.value)}
                placeholder="Short reason"
                style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12.5, marginTop: 4 }}
              />
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={busy} style={{ padding: "4px 10px", fontSize: 12 }}>Cancel</button>
            <button
              type="button" className="btn-primary"
              disabled={busy || (picked === "_custom" ? !custom.trim() : !picked)}
              onClick={() => submit(picked === "_custom" ? custom.trim() : picked)}
              style={{ padding: "4px 12px", fontSize: 12 }}
            >
              {busy ? "Blocking…" : "Block run"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeleteRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const { effectiveRole } = useIdentity();
  if (!["admin", "ops_head", "am"].includes(effectiveRole)) return null;
  async function doDelete() {
    setBusy(true);
    const res = await archiveUrgentRun(runId);
    setBusy(false);
    if (res.error) { alert(res.error); return; }
    router.push("/onboarding");
  }
  if (confirm) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--red)" }}>Archive this run?</span>
        <button className="btn-ghost" style={{ fontSize: 12, color: "var(--red)", padding: "2px 8px" }} onClick={doDelete} disabled={busy}>{busy ? "…" : "Confirm"}</button>
        <button className="btn-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setConfirm(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <button className="btn-ghost" style={{ color: "var(--red)" }} onClick={() => setConfirm(true)}>
      <Icon name="trash-2" size={13} /> Delete run
    </button>
  );
}
