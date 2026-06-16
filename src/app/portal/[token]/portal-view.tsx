"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { confirmCoa, commentCoa, uploadDocFile, submitIntake, postPortalMessage, signOffOnboarding } from "./actions";

export interface PortalData {
  token: string;
  clientName: string;
  ownerName: string | null;
  trn: string | null;
  progress: number;
  currentStage: number;
  status: string;
  coa: { accounts: { code: string; account: string; section: string }[]; signedOff: boolean; industry: string | null } | null;
  documents: { id: string; label: string; status: string }[];
  tasks: { title: string; status: string; type: string; boardColumn?: string | null }[];
  boardColumns?: string[] | null;
  team: Record<string, string>;
  teamEmail: Record<string, string>;
  messages: { author: string; role: string; body: string; at: string; taskRef?: string | null }[];
  signedOff: boolean;
  intakeFields: { id: string; label: string }[];
  intakeSubmitted: Record<string, unknown> | null;
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

/* UAE-specific option banks — mirror of the team-side intake builder. */
const UAE_BANKS = [
  "Emirates NBD", "First Abu Dhabi Bank (FAB)", "Abu Dhabi Commercial Bank (ADCB)",
  "Dubai Islamic Bank (DIB)", "Mashreq", "RAKBANK", "Abu Dhabi Islamic Bank (ADIB)",
  "Emirates Islamic", "Commercial Bank of Dubai (CBD)", "Sharjah Islamic Bank",
  "National Bank of Fujairah (NBF)", "Ajman Bank", "Bank of Sharjah", "HSBC UAE",
  "Citibank UAE", "Standard Chartered UAE", "Wio Bank", "Mashreq Neo", "Liv.", "Zand Bank",
];
const UAE_GATEWAYS = [
  "Telr", "PayTabs", "Network International (N-Genius)", "Stripe", "Checkout.com",
  "Amazon Payment Services (PayFort)", "Tap Payments", "Ziina", "Mamo Pay", "Magnati",
  "PayPal", "Apple Pay / Google Pay", "Tabby", "Tamara",
];
const UAE_ACCT_SW = [
  "Zoho Books", "QuickBooks Online", "Xero", "Tally", "Sage", "Wafeq", "Odoo",
  "Microsoft Dynamics 365 Business Central", "SAP Business One", "FreshBooks",
  "Excel / Google Sheets", "No system yet",
];

type Screen = "welcome" | "intake" | "tasks" | "live";

interface IntakeState {
  desc: string; revenue: string[]; expense: string[]; employees: string;
  pains: string[]; stakeholders: string[]; reports: string[];
  acctSw: string[]; banks: string[]; gateways: string[];
}

export function PortalView({ data }: { data: PortalData }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>("welcome");
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800); };
  const live = data.status === "complete";
  const first = data.ownerName?.split(" ")[0] ?? "there";

  const run = (fn: () => Promise<{ error?: string; ok?: boolean }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.error) note(r.error); else { note(ok); router.refresh(); } });

  const tabs: [Screen, string][] = [
    ["welcome", "Welcome"],
    ...(data.intakeEnabled ? ([["intake", "Intake form"]] as [Screen, string][]) : []),
    ["tasks", "Task board"],
    ["live", "Live setup"],
  ];

  const amName = data.team.am ?? "your Account Manager";
  const amEmail = data.teamEmail.am ?? null;
  const amInitials = (data.team.am ?? "AM").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="obv3-portal">
      <div className="obv3-portal-nav">
        <div className="obv3-logo">
          <span className="mark"><Icon name="gauge" size={18} strokeWidth={2.2} /></span>
          <span className="word">Finan<span className="o">shels</span></span>
        </div>
        <div className="cp-client-locked" title="This secure link is unique to your company">
          <Icon name="building-2" size={13} />
          <span className="nm">{data.clientName}</span>
          <span className="lk"><Icon name="lock" size={11} /> Secure client link</span>
        </div>
      </div>

      <div className="obv3-portal-wrap">
        <div className="obv3-screen-tabs">
          {tabs.map(([id, lbl]) => (
            <button key={id} className={screen === id ? "active" : ""} onClick={() => setScreen(id)}>{lbl}</button>
          ))}
        </div>

        {screen === "welcome" && (
          <Welcome data={data} live={live} first={first} amInitials={amInitials} amName={amName} go={setScreen} />
        )}
        {screen === "intake" && data.intakeEnabled && (
          <IntakeForm data={data} busy={busy} run={run} note={note} go={setScreen} />
        )}
        {screen === "tasks" && (
          <Tasks data={data} amInitials={amInitials} amName={amName} amEmail={amEmail} busy={busy} run={run} note={note} go={setScreen} />
        )}
        {screen === "live" && (
          <Live data={data} amName={amName} amEmail={amEmail} live={live} busy={busy} run={run} go={setScreen} />
        )}
      </div>

      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}

/* ---------- Section 1: Welcome ---------- */
function Welcome({ data, live, first, amInitials, amName, go }: {
  data: PortalData; live: boolean; first: string; amInitials: string; amName: string; go: (s: Screen) => void;
}) {
  const stageCards = [
    { name: "Getting started", desc: "Business profile & documents", state: data.currentStage > 1 || live ? "done" : "current" },
    { name: "Setting up your account", desc: "Chart of accounts & system setup", state: live ? "done" : data.currentStage > 1 ? "current" : "upcoming" },
    { name: "You are live", desc: "Your accounts are live", state: live ? "current" : "upcoming" },
  ];
  return (
    <div className="obv3-fade">
      <div className="cp-hero">
        <div className="cp-hero-main">
          <span className="cp-hero-eyebrow">Welcome to Finanshels</span>
          <h1 className="cp-hero-h">Hi {first} — let&apos;s get {data.clientName} set up.</h1>
          <p className="cp-hero-lead">Your onboarding is underway. Here&apos;s everything in one place — what we need from you, where things stand, and who&apos;s looking after your account.</p>
          <div className="cp-hero-actions">
            <button className="obv3-pbtn primary" onClick={() => go(data.intakeEnabled ? "intake" : "tasks")}>
              {data.intakeEnabled ? "Review your details" : "See what needs your input"} <Icon name="arrow-right" size={15} />
            </button>
          </div>
        </div>
        <div className="cp-hero-aside">
          <div className="cp-hero-ring" style={{ ["--p" as string]: data.progress }}>
            <div className="cp-ring-num">{data.progress}%</div>
            <div className="cp-ring-lbl">complete</div>
          </div>
          <div className="cp-hero-contact">
            <span className="av">{amInitials}</span>
            <div><div className="r">Your Account Manager</div><div className="n">{amName}</div></div>
          </div>
        </div>
      </div>

      <div className="obv3-stagecards">
        {stageCards.map((s, i) => (
          <div key={i} className={"obv3-scard " + s.state}>
            {s.state === "current" && <span className="sc-tag">Current</span>}
            <span className="sc-state"><Icon name={s.state === "done" ? "check" : s.state === "current" ? "loader" : "circle"} size={15} strokeWidth={2.5} /></span>
            <div className="sc-name">{s.name}</div>
            <div className="sc-desc">{s.desc}</div>
          </div>
        ))}
      </div>

      <div className="cp-next-nav">
        {data.intakeEnabled && (
          <button className="cp-nav-card" onClick={() => go("intake")}>
            <span className="ic"><Icon name="clipboard-list" size={18} /></span>
            <div><div className="t">Your intake form</div><div className="d">Confirm your business details</div></div>
            <Icon name="arrow-right" size={16} />
          </button>
        )}
        <button className="cp-nav-card" onClick={() => go("tasks")}>
          <span className="ic"><Icon name="kanban-square" size={18} /></span>
          <div><div className="t">Your task board</div><div className="d">What needs your input</div></div>
          <Icon name="arrow-right" size={16} />
        </button>
        <button className="cp-nav-card" onClick={() => go("live")}>
          <span className="ic"><Icon name="sparkles" size={18} /></span>
          <div><div className="t">Your live setup</div><div className="d">Team &amp; accounting system</div></div>
          <Icon name="arrow-right" size={16} />
        </button>
      </div>
    </div>
  );
}

/* ---------- Section 2: Intake form ---------- */
const SRC: Record<string, [string, string]> = {
  pms: ["crm", "From your records"], ai: ["ai", "Drafted for you"], client: ["client", "From you"],
};
function Field({ label, src, suggested, children }: { label: string; src: keyof typeof SRC; suggested?: boolean; children: React.ReactNode }) {
  const s = SRC[src] ?? SRC.client;
  return (
    <div className="cp-field">
      <div className="v2-ifield-top">
        <span className="v2-ifield-label">{label}</span>
        <span className={"v2-src " + s[0]}>{s[1]}</span>
        {suggested && <span className="obtpl-suggested">Suggested</span>}
      </div>
      {children}
    </div>
  );
}
function ChipList({ items, addLabel, onChange }: { items: string[]; addLabel: string; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim(); if (!v) return; onChange([...items, v]); setDraft(""); };
  return (
    <div>
      <div className="cp-chips">
        {items.map((it, i) => (
          <span key={i} className="cp-chip">{it}<button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="x" size={11} /></button></span>
        ))}
        {items.length === 0 && <span className="cp-empty">Nothing yet — add below.</span>}
      </div>
      <div className="cp-add-row">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={addLabel} />
        <button type="button" onClick={add}><Icon name="plus" size={13} /> Add</button>
      </div>
    </div>
  );
}
function MultiPick({ options, items, onChange, otherLabel }: { options: string[]; items: string[]; onChange: (v: string[]) => void; otherLabel: string }) {
  const [draft, setDraft] = useState("");
  const norm = (s: string) => s.trim().toLowerCase();
  const has = (c: string) => items.some((x) => norm(x) === norm(c));
  const toggle = (c: string) => onChange(has(c) ? items.filter((x) => norm(x) !== norm(c)) : [...items, c]);
  const custom = items.filter((it) => !options.some((o) => norm(o) === norm(it)));
  const addOther = () => { const v = draft.trim(); if (v && !has(v)) onChange([...items, v]); setDraft(""); };
  return (
    <div className="bld-mpick">
      <div className="bld-mpick-chips">
        {options.map((o) => (
          <button key={o} type="button" className={"bld-mpick-chip" + (has(o) ? " on" : "")} onClick={() => toggle(o)}>
            {has(o) ? <Icon name="check" size={10} strokeWidth={3} /> : <Icon name="plus" size={10} />} {o}
          </button>
        ))}
      </div>
      {custom.length > 0 && (
        <div className="bld-mpick-chips" style={{ marginTop: 6 }}>
          {custom.map((c) => (
            <span key={c} className="bld-mpick-chip on custom">{c}<button type="button" onClick={() => toggle(c)}><Icon name="x" size={10} /></button></span>
          ))}
        </div>
      )}
      <div className="cp-add-row" style={{ marginTop: 6 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOther(); } }} placeholder={otherLabel} />
        <button type="button" onClick={addOther}><Icon name="plus" size={13} /> Add other</button>
      </div>
    </div>
  );
}

function initIntake(data: PortalData): IntakeState {
  const sub = data.intakeSubmitted ?? {};
  const prep = data.intakePrep ?? {};
  const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : typeof v === "string" && v.trim() ? v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) : []);
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    desc: str(sub.desc) || prep.description || "",
    revenue: arr(sub.revenue).length ? arr(sub.revenue) : (prep.revenue ?? []),
    expense: arr(sub.expense).length ? arr(sub.expense) : (prep.expense ?? []),
    employees: str(sub.employees) || prep.employees || "",
    pains: arr(sub.pains).length ? arr(sub.pains) : arr(prep.painPoints),
    stakeholders: arr(sub.stakeholders).length ? arr(sub.stakeholders) : arr(prep.stakeholders),
    reports: arr(sub.reports).length ? arr(sub.reports) : arr(prep.reports),
    acctSw: arr(sub.acctSw).length ? arr(sub.acctSw) : (prep.software ? [prep.software] : []),
    banks: arr(sub.banks).length ? arr(sub.banks) : (prep.banks ?? []),
    gateways: arr(sub.gateways).length ? arr(sub.gateways) : (prep.gateways ?? []),
  };
}

function IntakeForm({ data, busy, run, note, go }: {
  data: PortalData; busy: boolean; run: (fn: () => Promise<{ error?: string; ok?: boolean }>, ok: string) => void; note: (m: string) => void; go: (s: Screen) => void;
}) {
  const [f, setF] = useState<IntakeState>(() => initIntake(data));
  const set = <K extends keyof IntakeState>(k: K, v: IntakeState[K]) => setF((s) => ({ ...s, [k]: v }));
  const submitted = data.intakeSubmitted && data.intakeSubmitted !== null && Object.keys(data.intakeSubmitted).length > 0;

  const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!(typeof v === "string" && v.trim()));
  const checks = [f.desc, f.revenue, f.expense, f.employees, f.pains, f.stakeholders, f.reports, f.acctSw, f.banks, f.gateways];
  const done = checks.filter(filled).length + 1; // +1 for the locked company details

  return (
    <div className="obv3-fade">
      <div className="obv3-pcard">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="obv3-pcard-h">Your intake form</div>
            <div className="obv3-pcard-sub">We pre-filled what we already knew — everything below is yours to edit. Add channels, stakeholders and reports as needed.</div>
          </div>
          <span className="pill amber"><span className="dot" />{done} of {checks.length + 1} complete</span>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Company details" src="pms">
            <div className="cp-locked"><Icon name="lock" size={12} /> {data.clientName}{data.ownerName ? ` · ${data.ownerName}` : ""}{data.trn ? ` · TRN ${data.trn}` : ""}</div>
          </Field>

          <Field label="Business description" src="ai">
            <textarea className="cp-input" rows={2} value={f.desc} placeholder="Tell us about your business" onChange={(e) => set("desc", e.target.value)} />
          </Field>

          <Field label="Major revenue channels" src="client">
            <ChipList items={f.revenue} addLabel="Add a revenue channel…" onChange={(v) => set("revenue", v)} />
          </Field>

          <Field label="Major expense channels" src="client">
            <ChipList items={f.expense} addLabel="Add an expense account…" onChange={(v) => set("expense", v)} />
          </Field>

          <Field label="Employee details" src="client">
            <input className="cp-input" value={f.employees} placeholder="e.g. 45 employees · WPS payroll" onChange={(e) => set("employees", e.target.value)} />
          </Field>

          <Field label="Pain points" src="client">
            <ChipList items={f.pains} addLabel="Add a pain point…" onChange={(v) => set("pains", v)} />
          </Field>

          <Field label="Stakeholders" src="client">
            <ChipList items={f.stakeholders} addLabel="Add a stakeholder…" onChange={(v) => set("stakeholders", v)} />
          </Field>

          <Field label="Reports you need" src="client">
            <ChipList items={f.reports} addLabel="Add a report…" onChange={(v) => set("reports", v)} />
          </Field>

          <Field label="Accounting software" src="client" suggested>
            <MultiPick options={UAE_ACCT_SW} items={f.acctSw} onChange={(v) => set("acctSw", v)} otherLabel="Other software — type a name and Enter…" />
          </Field>

          <Field label="Bank accounts" src="client" suggested>
            <MultiPick options={UAE_BANKS} items={f.banks} onChange={(v) => set("banks", v)} otherLabel="Other UAE bank — type a name and Enter…" />
          </Field>

          <Field label="Payment gateways" src="client" suggested>
            <MultiPick options={UAE_GATEWAYS} items={f.gateways} onChange={(v) => set("gateways", v)} otherLabel="Other gateway — type a name and Enter…" />
          </Field>
        </div>
      </div>

      <Documents data={data} note={note} />

      <div className="obv3-pbtn-row">
        <button className="obv3-pbtn secondary" onClick={() => go("welcome")}><Icon name="arrow-left" size={14} /> Back</button>
        <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
          <button className="obv3-pbtn primary" disabled={busy} onClick={() => run(() => submitIntake(data.token, f as unknown as Record<string, unknown>), submitted ? "Updated — your team has been notified" : "Saved — your team has been notified")}>
            Save &amp; continue <Icon name="arrow-right" size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* Documents the client uploads — real upload to Supabase Storage. */
function Documents({ data, note }: { data: PortalData; note: (m: string) => void }) {
  const router = useRouter();
  const [uploading, setUploading] = useState<string | null>(null);
  const received = data.documents.filter((d) => d.status === "uploaded").length;
  const onFile = (docId: string, file: File) => {
    setUploading(docId);
    const fd = new FormData();
    fd.append("file", file);
    uploadDocFile(data.token, docId, fd).then((r) => {
      setUploading(null);
      if (r.error) note(r.error);
      else { note("Document received — your team has been notified"); router.refresh(); }
    });
  };
  if (data.documents.length === 0) return null;
  return (
    <div className="obv3-pcard">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="obv3-pcard-h">Documents to upload</div>
          <div className="obv3-pcard-sub">Browse and upload. Each file lands in the right folder automatically.</div>
        </div>
        <span className="pill amber"><span className="dot" />{received} of {data.documents.length} received</span>
      </div>
      <div style={{ marginTop: 16 }}>
        {data.documents.map((d) => (
          <div key={d.id} className="obv3-doc">
            <span className={"dstate " + (d.status === "uploaded" ? "done" : "pending")}>
              {d.status === "uploaded" ? <Icon name="check" size={13} strokeWidth={2.6} /> : <Icon name="upload" size={12} />}
            </span>
            <span className="dname">{d.label}</span>
            {d.status === "uploaded" ? (
              <span className="pill green" style={{ fontSize: 10.5, height: 18 }}><span className="dot" />Received</span>
            ) : (
              <label className="obv3-doc-upload" style={{ cursor: uploading ? "default" : "pointer" }}>
                <Icon name="upload" size={12} /> {uploading === d.id ? "Uploading…" : "Upload →"}
                <input type="file" hidden disabled={!!uploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(d.id, file); e.target.value = ""; }} />
              </label>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Section 3: Task board + chat ---------- */
function Tasks({ data, amInitials, amName, amEmail, busy, run, note, go }: {
  data: PortalData; amInitials: string; amName: string; amEmail: string | null;
  busy: boolean; run: (fn: () => Promise<{ error?: string; ok?: boolean }>, ok: string) => void; note: (m: string) => void; go: (s: Screen) => void;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [chatTask, setChatTask] = useState("");
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);

  // If the team set custom board columns, mirror those exactly; otherwise group
  // the client-visible tasks by status into friendly columns.
  const useCustom = (data.boardColumns?.length ?? 0) > 0;
  const cols = useCustom
    ? data.boardColumns!.map((c) => ({ key: c, label: c }))
    : [
        { key: "input", label: "Needs your input" },
        { key: "progress", label: "In progress" },
        { key: "done", label: "Done" },
      ];
  const itemsFor = (key: string) => {
    if (useCustom) {
      const first = data.boardColumns![0];
      return data.tasks.filter((t) => (t.boardColumn && data.boardColumns!.includes(t.boardColumn) ? t.boardColumn : first) === key);
    }
    return data.tasks.filter((t) =>
      key === "input" ? t.status === "needs_input"
        : key === "progress" ? (t.status === "in_progress" || t.status === "working")
          : (t.status === "complete" || t.status === "done"));
  };

  const send = () => {
    const body = msg.trim();
    if (!body) return;
    const ref = chatTask || null;
    setMsg(""); setChatTask("");
    postPortalMessage(data.token, body, ref).then((r) => { if (r.error) note(r.error); else router.refresh(); });
  };

  return (
    <div className="obv3-fade">
      <div className="obv3-portal-nudge">
        <span className="ic"><Icon name="bell" size={15} /></span>
        Here is what is moving on your account. Use the chat below to message your team directly.
      </div>

      <div className="obv3-contact">
        <span className="av">{amInitials}</span>
        <div>
          <div className="ct-role">Your Account Manager</div>
          <div className="ct-name">{amName}</div>
          {amEmail && <div className="ct-meta">{amEmail} · WhatsApp preferred</div>}
        </div>
      </div>

      <div className="obv3-pcard">
        <div className="obv3-pcard-h">Your task board — {data.clientName}</div>
        <div className="obv3-pcard-sub" style={{ marginBottom: 18 }}>Only the items relevant to you are shown. Your team handles the rest behind the scenes.</div>
        {data.tasks.length === 0 ? (
          <div className="cp-empty">Nothing needs your input right now — your team is working behind the scenes.</div>
        ) : (
          <div className="cp-board">
            {cols.map((col) => {
              const items = itemsFor(col.key);
              return (
                <div key={col.key} className="cp-board-col">
                  <div className="cp-board-col-h">{col.label}<span className="cp-board-count">{items.length}</span></div>
                  {items.length === 0 && <div className="cp-empty" style={{ padding: "6px 0" }}>—</div>}
                  {items.map((t, i) => (
                    <div key={i} className="cp-board-card">
                      <span className="cp-board-dot" data-col={col.key} />
                      <span style={{ flex: 1 }}>{t.title}</span>
                      {t.type === "milestone" && <span className="pill purple" style={{ fontSize: 10 }}>Milestone</span>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Suggested chart of accounts — AI-tailored, client confirms */}
      {data.coa && data.coa.accounts.length > 0 && (
        <div className="obv3-pcard">
          <div className="obv3-pcard-h">Your chart of accounts {data.coa.industry ? `· ${data.coa.industry}` : ""}</div>
          {data.coa.signedOff ? (
            <div style={{ color: "var(--green)", fontSize: 13, display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <Icon name="check-circle" size={15} /> Thank you — you&apos;ve confirmed this structure. Your team will proceed.
            </div>
          ) : (
            <>
              <div className="obv3-pcard-sub" style={{ marginBottom: 12 }}>This is the account structure we&apos;ve tailored for {data.clientName}. Review and confirm, or tell us what to change.</div>
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
                <textarea className="cp-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What would you like changed?" style={{ marginTop: 8 }} />
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="obv3-pbtn primary" disabled={busy} onClick={() => run(() => confirmCoa(data.token), "Thank you — confirmed!")}>Looks good — confirm</button>
                {showComment ? (
                  <button className="obv3-pbtn secondary" disabled={busy || !comment.trim()} onClick={() => run(() => commentCoa(data.token, comment), "Comment sent to your team")}>Send comment</button>
                ) : (
                  <button className="obv3-pbtn secondary" onClick={() => setShowComment(true)}>I have a comment</button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Two-way chat — same thread the team sees */}
      <div className="obv3-pcard">
        <div className="obv3-pcard-h">Chat with your team</div>
        <div className="obv3-pcard-sub" style={{ marginBottom: 12 }}>Messages here go straight to {amName} and your assigned team.</div>
        <div className="cp-chat">
          {data.messages.length === 0 && <div className="cp-empty">No messages yet — say hello 👋</div>}
          {data.messages.map((m, i) => {
            const mine = m.role === "Client";
            const system = m.role === "System";
            return (
              <div key={i} className={"cp-chat-row" + (mine ? " mine" : "") + (system ? " system" : "")}>
                {!mine && !system && <span className="cp-chat-av">{m.author.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>}
                <div className="cp-chat-bubble">
                  {!mine && !system && <div className="cp-chat-who">{m.author}{m.role ? ` · ${m.role}` : ""}</div>}
                  {m.taskRef && <span className="pill blue" style={{ fontSize: 10, padding: "1px 7px", marginBottom: 4, display: "inline-flex" }}><Icon name="tag" size={10} /> {m.taskRef}</span>}
                  <div className="cp-chat-text">{m.body}</div>
                </div>
              </div>
            );
          })}
        </div>
        {data.tasks.length > 0 && (
          <select value={chatTask} onChange={(e) => setChatTask(e.target.value)} style={{ marginTop: 12, width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>
            <option value="">Tag a task this is about (optional)…</option>
            {data.tasks.map((t, i) => <option key={i} value={t.title}>{t.title}</option>)}
          </select>
        )}
        <div className="cp-add-row" style={{ marginTop: 8 }}>
          <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }} placeholder={chatTask ? `Describe the issue with "${chatTask}"…` : `Message ${amName}…`} />
          <button type="button" onClick={send} disabled={!msg.trim()}><Icon name="send" size={13} /> Send</button>
        </div>
      </div>

      <div className="obv3-pbtn-row">
        <button className="obv3-pbtn secondary" onClick={() => go(data.intakeEnabled ? "intake" : "welcome")}><Icon name="arrow-left" size={14} /> Back</button>
        <button className="obv3-pbtn primary" onClick={() => go("live")}>Next — your live setup <Icon name="arrow-right" size={15} /></button>
      </div>
    </div>
  );
}

/* ---------- Section 4: Live setup ---------- */
function Live({ data, amName, amEmail, live, busy, run, go }: {
  data: PortalData; amName: string; amEmail: string | null; live: boolean;
  busy: boolean; run: (fn: () => Promise<{ error?: string; ok?: boolean }>, ok: string) => void; go: (s: Screen) => void;
}) {
  const ini = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const senior = data.team.senior;
  const junior = data.team.junior;
  const teamLead = data.team.team_lead;
  const teamLeadEmail = data.teamEmail.team_lead;
  return (
    <div className="obv3-fade">
      <div className="obv3-live-banner">
        <h2>Here&apos;s how your account is set up</h2>
        <p>Your team, your accounting system and your point of contact — all in one place.</p>
      </div>

      <div className="cp-live-grid">
        <div className="obv3-pcard cp-live-poc">
          <div className="cp-poc-eyebrow">Point of contact</div>
          <div className="cp-poc-name">{amName}</div>
          <div className="cp-poc-role">Account Manager — for scope, billing or anything else</div>
          {amEmail && <div className="cp-poc-meta"><Icon name="mail" size={13} /> {amEmail}</div>}
          <div className="cp-poc-meta"><Icon name="message-circle" size={13} /> WhatsApp preferred · mornings</div>
        </div>
        <div className="obv3-pcard cp-live-book">
          <div className="cp-poc-eyebrow">Accounting book</div>
          <div className="cp-book-row">
            <span className="cp-book-ic"><Icon name="book-open" size={18} /></span>
            <div><div className="cp-book-name">{data.software ?? "To be confirmed"}</div><div className="cp-book-sub">{live ? "Connected · books migrated" : "Setup in progress"}</div></div>
          </div>
          <div className="cp-book-foot"><span className="pill green" style={{ fontSize: 10.5, height: 18 }}><span className="dot" />{live ? "Live" : "Setting up"}</span> VAT quarterly · CT annual</div>
        </div>
      </div>

      {(senior || junior || teamLead) && (
        <div className="obv3-pcard">
          <div className="obv3-pcard-h">Your team</div>
          <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
            {teamLead && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: 999, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center", fontWeight: 800 }}>{ini(teamLead)}</span>
                <div><div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Team Lead</div><div style={{ fontSize: 14, fontWeight: 700 }}>{teamLead}{teamLeadEmail ? ` · ${teamLeadEmail}` : ""}</div></div>
              </div>
            )}
            {senior && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: 999, background: "var(--blue-soft)", color: "var(--blue)", display: "grid", placeItems: "center", fontWeight: 800 }}>{ini(senior)}</span>
                <div><div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Senior Accountant</div><div style={{ fontSize: 14, fontWeight: 700 }}>{senior}{data.teamEmail.senior ? ` · ${data.teamEmail.senior}` : ""}</div></div>
              </div>
            )}
            {junior && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: 999, background: "var(--teal-soft)", color: "var(--teal)", display: "grid", placeItems: "center", fontWeight: 800 }}>{ini(junior)}</span>
                <div><div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Junior Accountant</div><div style={{ fontSize: 14, fontWeight: 700 }}>{junior} — day-to-day bookkeeping</div></div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="obv3-pcard" style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.9 }}>
        <div className="obv3-pcard-h" style={{ marginBottom: 8 }}>Escalation path</div>
        First, your <strong>Team Lead</strong>{teamLead ? ` (${teamLead}${teamLeadEmail ? ` · ${teamLeadEmail}` : ""})` : ""}. If unresolved, your <strong>Customer Relationship Manager</strong> ({amName}{amEmail ? ` · ${amEmail}` : ""}). Email is the default channel for both.
      </div>

      {/* Sign-off */}
      <div className={"cp-signoff-card" + (data.signedOff ? " done" : "")}>
        {data.signedOff ? (
          <div className="cp-signoff-head">
            <span className="ic done"><Icon name="check" size={20} strokeWidth={3} /></span>
            <div><div className="t">You&apos;re all set — onboarding signed off</div><div className="d">Thank you{data.ownerName ? `, ${data.ownerName.split(" ")[0]}` : ""}. Your team has been notified and your recurring service is live.</div></div>
          </div>
        ) : (
          <>
            <div className="cp-signoff-head">
              <span className="ic"><Icon name="clipboard-check" size={20} /></span>
              <div><div className="t">Happy with your setup?</div><div className="d">Sign off to confirm everything looks right. This lets your team move you to live delivery.</div></div>
            </div>
            <button className="cp-signoff-btn" disabled={busy} onClick={() => run(() => signOffOnboarding(data.token), "Thank you — your onboarding is signed off.")}>
              <Icon name="check-circle" size={16} /> Sign off my onboarding
            </button>
          </>
        )}
      </div>

      <button className="obv3-pbtn secondary" onClick={() => go("welcome")}><Icon name="arrow-left" size={14} /> Back to welcome</button>
    </div>
  );
}
