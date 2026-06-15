"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { confirmCoa, commentCoa, uploadDoc, submitIntake } from "./actions";

export interface PortalData {
  token: string;
  clientName: string;
  ownerName: string | null;
  progress: number;
  currentStage: number;
  status: string;
  coa: { accounts: { code: string; account: string; section: string }[]; signedOff: boolean; industry: string | null } | null;
  documents: { id: string; label: string; status: string }[];
  tasks: { title: string; status: string; type: string }[];
  team: Record<string, string>;
  intakeFields: { id: string; label: string }[];
  intakeSubmitted: Record<string, string> | null;
  intakePrep: IntakePrepView | null;
  intakeEnabled: boolean;
  contract: { scope?: string; periodStart?: string; periodEnd?: string; inclusions?: string[]; exclusions?: string[]; paymentTerms?: string } | null;
  software: string | null;
}
export interface IntakePrepView {
  enabled?: boolean;
  description?: string;
  revenue?: string[];
  expense?: string[];
  banks?: string[];
  gateways?: string[];
  software?: string;
  vat?: string; ct?: string; wps?: string;
  painPoints?: string; stakeholders?: string; reports?: string; employees?: string;
}

export function PortalView({ data }: { data: PortalData }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [intake, setIntake] = useState<Record<string, string>>((): Record<string, string> => {
    const p = data.intakePrep;
    if (!p) return {};
    return {
      description: p.description ?? "", revenue: (p.revenue ?? []).join("\n"), expense: (p.expense ?? []).join("\n"),
      banks: (p.banks ?? []).join(", "), gateways: (p.gateways ?? []).join(", "), software: p.software ?? "",
      vat: p.vat ?? "", ct: p.ct ?? "", wps: p.wps ?? "", employees: p.employees ?? "",
      painPoints: p.painPoints ?? "", stakeholders: p.stakeholders ?? "", reports: p.reports ?? "",
    };
  });
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };
  const live = data.status === "complete";

  const docsDone = data.documents.filter((d) => d.status === "uploaded").length;
  const pendingAction = data.coa && !data.coa.signedOff;

  const stageCards = [
    { name: "Getting Started", desc: "Business profile and documents", state: data.currentStage > 1 || live ? "done" : "current" },
    { name: "Setting Up Your Account", desc: "COA preparation and system setup", state: live ? "done" : data.currentStage > 1 ? "current" : "upcoming" },
    { name: "You Are Live", desc: "Your accounts are live", state: live ? "current" : "upcoming" },
  ];

  const run = (fn: () => Promise<{ error?: string; ok?: boolean }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.error) note(r.error); else { note(ok); router.refresh(); } });

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Header — Finanshels wordmark only, no app chrome */}
      <header style={{ background: "#fff", borderBottom: "1px solid var(--border)", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="rail-logo" style={{ width: 34, height: 34 }}><Icon name="gauge" size={18} style={{ color: "var(--orange)" }} /></div>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em" }}>Finanshels</div>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{data.clientName}</div>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 20px 60px", display: "flex", flexDirection: "column", gap: 18 }}>
        {live && (
          <div style={{ background: "var(--green-soft)", border: "1px solid #b8e5c5", borderRadius: 12, padding: "16px 20px", color: "var(--green)", fontWeight: 700 }}>
            <Icon name="party-popper" size={16} /> Your account is live — welcome to Finanshels.
          </div>
        )}

        {pendingAction && (
          <div style={{ background: "var(--amber-soft)", border: "1px solid #f0d9a8", borderRadius: 10, padding: "10px 14px", color: "var(--amber)", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="bell" size={14} /> You have an action waiting — please review your chart of accounts below.
          </div>
        )}

        {/* Welcome video card */}
        <div style={{ background: "linear-gradient(135deg, var(--orange), var(--orange-600))", borderRadius: 14, padding: "40px 24px", textAlign: "center", color: "#fff" }}>
          <div style={{ width: 60, height: 60, borderRadius: "50%", background: "rgba(255,255,255,0.2)", display: "grid", placeItems: "center", margin: "0 auto 14px" }}>
            <Icon name="play" size={26} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Welcome to Finanshels — 28 seconds</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>Auto-plays muted with captions</div>
        </div>
        <div style={{ fontSize: 15, color: "var(--ink-1)" }}>
          Hi {data.ownerName?.split(" ")[0] ?? "there"} — welcome to Finanshels. We&apos;re excited to get started on your account.
        </div>

        {/* Stage cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {stageCards.map((s) => (
            <div key={s.name} style={{ background: "#fff", border: `1.5px solid ${s.state === "done" ? "#b8e5c5" : s.state === "current" ? "var(--orange)" : "var(--border)"}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: s.state === "done" ? "var(--green)" : s.state === "current" ? "var(--orange)" : "var(--ink-3)" }}>
                {s.state === "done" ? <Icon name="check-circle" size={14} /> : s.state === "current" ? <Icon name="loader" size={14} /> : <Icon name="circle" size={14} />}
                {s.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Intake form */}
        {data.intakeEnabled && (
          <Section title="Your business profile">
            {data.intakeSubmitted ? (
              <div style={{ color: "var(--green)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="check-circle" size={15} /> Thank you — your profile has been received.
              </div>
            ) : data.intakePrep ? (
              <>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 12 }}>Please confirm what we understood — edit anything that&apos;s not quite right.</div>
                <IField label="What you do" v={intake.description} on={(x) => setIntake((m) => ({ ...m, description: x }))} area />
                <IField label="Revenue channels (one per line)" v={intake.revenue} on={(x) => setIntake((m) => ({ ...m, revenue: x }))} area />
                <IField label="Expense channels (one per line)" v={intake.expense} on={(x) => setIntake((m) => ({ ...m, expense: x }))} area />
                <IField label="Bank accounts" v={intake.banks} on={(x) => setIntake((m) => ({ ...m, banks: x }))} />
                <IField label="Payment gateways" v={intake.gateways} on={(x) => setIntake((m) => ({ ...m, gateways: x }))} />
                <IField label="Accounting software" v={intake.software} on={(x) => setIntake((m) => ({ ...m, software: x }))} />
                <IField label="Employees" v={intake.employees} on={(x) => setIntake((m) => ({ ...m, employees: x }))} />
                <IField label="Pain points" v={intake.painPoints} on={(x) => setIntake((m) => ({ ...m, painPoints: x }))} area />
                <IField label="Who we report to" v={intake.stakeholders} on={(x) => setIntake((m) => ({ ...m, stakeholders: x }))} />
                <IField label="Reports you need" v={intake.reports} on={(x) => setIntake((m) => ({ ...m, reports: x }))} />
                <button className="btn-primary" disabled={busy} onClick={() => run(() => submitIntake(data.token, intake), "Profile submitted — thank you!")}>Submit profile</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 12 }}>Tell us a little about your business so we can prepare before our first call.</div>
                {data.intakeFields.map((f) => (
                  <div className="field" key={f.id} style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>{f.label}</label>
                    <textarea className="notes" style={{ minHeight: 60 }} value={intake[f.id] ?? ""} onChange={(e) => setIntake((m) => ({ ...m, [f.id]: e.target.value }))} />
                  </div>
                ))}
                <button className="btn-primary" disabled={busy} onClick={() => run(() => submitIntake(data.token, intake), "Profile submitted — thank you!")}>Submit profile</button>
              </>
            )}
          </Section>
        )}

        {/* Contract / engagement breakdown */}
        {data.contract && (data.contract.scope || data.contract.inclusions?.length) && (
          <Section title="Your engagement">
            {data.contract.scope && <div style={{ fontSize: 13, color: "var(--ink-1)", marginBottom: 8 }}>{data.contract.scope}</div>}
            {(data.contract.periodStart || data.contract.periodEnd) && (
              <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 8 }}>Period: {data.contract.periodStart ?? "—"} → {data.contract.periodEnd ?? "—"}</div>
            )}
            {data.contract.inclusions?.length ? (
              <div style={{ marginBottom: 8 }}><div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)" }}>Included</div>{data.contract.inclusions.map((x, i) => <div key={i} style={{ fontSize: 13, display: "flex", gap: 6 }}><Icon name="check" size={12} style={{ color: "var(--green)" }} /> {x}</div>)}</div>
            ) : null}
            {data.contract.exclusions?.length ? (
              <div style={{ marginBottom: 8 }}><div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)" }}>Not included</div>{data.contract.exclusions.map((x, i) => <div key={i} style={{ fontSize: 13, color: "var(--ink-3)" }}>— {x}</div>)}</div>
            ) : null}
            {data.contract.paymentTerms && <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}><strong>Payment:</strong> {data.contract.paymentTerms}</div>}
          </Section>
        )}

        {/* COA review */}
        {data.coa && (
          <Section title="Your chart of accounts">
            {data.coa.signedOff ? (
              <div style={{ color: "var(--green)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <Icon name="check-circle" size={15} /> Thank you — you&apos;ve confirmed this structure. Your team will proceed.
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 12 }}>This is the account structure we&apos;ve prepared for {data.clientName}. Please review and confirm, or leave a comment if anything needs to change.</div>
                {[...new Set(data.coa.accounts.map((a) => a.section))].map((sec) => (
                  <div key={sec} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 4 }}>{sec}</div>
                    {data.coa!.accounts.filter((a) => a.section === sec).map((a, i) => (
                      <div key={a.code + i} style={{ fontSize: 13, color: "var(--ink-1)", padding: "3px 0", display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon name="check" size={12} style={{ color: "var(--green)" }} /> {a.account}
                      </div>
                    ))}
                  </div>
                ))}
                {showComment && (
                  <textarea className="notes" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What would you like changed?" style={{ marginTop: 8 }} />
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button className="btn-primary" disabled={busy} onClick={() => run(() => confirmCoa(data.token), "Thank you — confirmed!")}>Looks good — confirm</button>
                  {showComment ? (
                    <button className="btn-ghost" disabled={busy || !comment.trim()} onClick={() => run(() => commentCoa(data.token, comment), "Comment sent to your team")}>Send comment</button>
                  ) : (
                    <button className="btn-ghost" onClick={() => setShowComment(true)}>I have a comment</button>
                  )}
                </div>
              </>
            )}
          </Section>
        )}

        {/* Progress timeline */}
        {data.tasks.length > 0 && (
          <Section title="Your onboarding progress">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {data.tasks.map((t, i) => {
                const done = t.status === "complete";
                const active = t.status === "in_progress" || t.status === "needs_input";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < data.tasks.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <span style={{ color: done ? "var(--green)" : active ? "var(--orange)" : "var(--ink-4)" }}>
                      <Icon name={done ? "check-circle" : active ? "loader" : "circle"} size={16} />
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: done ? "var(--ink-3)" : "var(--ink-1)" }}>{t.title}</span>
                    {t.type === "milestone" && <span className="pill purple" style={{ fontSize: 10 }}>Milestone</span>}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Documents */}
        <Section title={`Documents — ${docsDone} of ${data.documents.length} received`}>
          {data.documents.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ color: d.status === "uploaded" ? "var(--green)" : "var(--ink-4)" }}>
                <Icon name={d.status === "uploaded" ? "check-circle" : "circle"} size={16} />
              </span>
              <span style={{ flex: 1, fontSize: 13 }}>{d.label}</span>
              {d.status === "uploaded" ? (
                <span className="pill green" style={{ fontSize: 10 }}>Uploaded</span>
              ) : (
                <button className="btn-ghost" disabled={busy} onClick={() => run(() => uploadDoc(data.token, d.id), "Document received — your team has been notified")}>
                  <Icon name="upload" size={13} /> Upload
                </button>
              )}
            </div>
          ))}
        </Section>

        {/* Team / You are live */}
        {(data.team.am || data.team.senior) && (
          <Section title={live ? "You are live — your team" : "Your team"}>
            <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.9 }}>
              {data.team.senior && <div>Primary contact: <strong>{data.team.senior}</strong>{data.team.junior ? ` (with ${data.team.junior})` : ""}</div>}
              {data.team.am && <div>Account Manager: <strong>{data.team.am}</strong></div>}
              {data.software && <div>Your accounting software: <strong>{data.software}</strong></div>}
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>
                <strong>Escalation:</strong> reach your Senior first, then your Account Manager{data.team.am ? ` (${data.team.am})` : ""}, then Ops.
              </div>
            </div>
          </Section>
        )}
      </div>

      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}

function IField({ label, v, on, area }: { label: string; v?: string; on: (x: string) => void; area?: boolean }) {
  return (
    <div className="field" style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>{label}</label>
      {area
        ? <textarea className="notes" style={{ minHeight: 60 }} value={v ?? ""} onChange={(e) => on(e.target.value)} />
        : <input value={v ?? ""} onChange={(e) => on(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}
