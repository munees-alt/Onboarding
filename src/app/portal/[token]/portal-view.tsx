"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { confirmCoa, commentCoa, uploadDocFile, uploadDocsBatch, submitIntake, postPortalMessage, signOffOnboarding, attachPortalTaskFile, documentViewUrl, confirmAccessItem } from "./actions";
import { renderSopLine } from "@/lib/access-sops";

export interface PortalData {
  token: string;
  clientName: string;
  ownerName: string | null;
  trn: string | null;
  progress: number;
  currentStage: number;
  status: string;
  coa: { accounts: { code: string; account: string; section: string }[]; signedOff: boolean; industry: string | null } | null;
  documents: { id: string; label: string; status: string; reviewNote?: string | null }[];
  tasks: { title: string; status: string; type: string; boardColumn?: string | null; due?: string | null; ownerKind?: string }[];
  boardColumns?: string[] | null;
  team: Record<string, string>;
  teamEmail: Record<string, string>;
  messages: { author: string; role: string; body: string; at: string; taskRef?: string | null }[];
  signedOff: boolean;
  intakeFields: { id: string; label: string }[];
  intakeSubmitted: Record<string, unknown> | null;
  intakePrep: IntakePrepView | null;
  intakeEnabled: boolean;
  contract: { scope?: string; periodStart?: string; periodEnd?: string; inclusions?: string[]; exclusions?: string[]; paymentTerms?: string; deliverables?: { item: string; frequency: string; deadline: string }[] } | null;
  software: string | null;
  onboardingPartner: string | null;
  csm: { name: string; email: string | null } | null;
  access: { rowId: string; label: string; method: string; email: string; sop: string[]; systemName?: string; status: string; note?: string }[];
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

type Screen = "welcome" | "intake" | "access" | "tasks" | "live";

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

  // The intake screen always exists: with a form when one was configured, or as a
  // documents-only step when it wasn't. The document checklist must show either way.
  const tabs: [Screen, string][] = [
    ["welcome", "Welcome"],
    ["intake", data.intakeEnabled ? "Intake form" : "Documents"],
    ...(data.access.length ? ([["access", "Access"]] as [Screen, string][]) : []),
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
        {screen === "intake" && (
          <IntakeForm data={data} busy={busy} note={note} go={setScreen} />
        )}
        {screen === "access" && (
          <AccessSection data={data} busy={busy} run={run} go={setScreen} />
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
            <button className="obv3-pbtn primary" onClick={() => go("intake")}>
              {data.intakeEnabled ? "Review your details" : "Upload your documents"} <Icon name="arrow-right" size={15} />
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
        <button className="cp-nav-card" onClick={() => go("intake")}>
          <span className="ic"><Icon name={data.intakeEnabled ? "clipboard-list" : "file-text"} size={18} /></span>
          <div><div className="t">{data.intakeEnabled ? "Your intake form" : "Your documents"}</div><div className="d">{data.intakeEnabled ? "Confirm your business details" : "Upload what we need"}</div></div>
          <Icon name="arrow-right" size={16} />
        </button>
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

function IntakeForm({ data, busy, note, go }: {
  data: PortalData; busy: boolean; note: (m: string) => void; go: (s: Screen) => void;
}) {
  const [f, setF] = useState<IntakeState>(() => initIntake(data));
  const set = <K extends keyof IntakeState>(k: K, v: IntakeState[K]) => setF((s) => ({ ...s, [k]: v }));
  const submitted = data.intakeSubmitted && data.intakeSubmitted !== null && Object.keys(data.intakeSubmitted).length > 0;

  const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!(typeof v === "string" && v.trim()));
  const checks = [f.desc, f.revenue, f.expense, f.employees, f.pains, f.acctSw, f.banks, f.gateways];
  const done = checks.filter(filled).length + 1; // +1 for the locked company details

  return (
    <div className="obv3-fade">
      {data.intakeEnabled && (
      <div className="obv3-pcard">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="obv3-pcard-h">Your intake form</div>
            <div className="obv3-pcard-sub">We pre-filled what we already knew — everything below is yours to edit. Add channels and details as needed.</div>
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
      )}

      <Documents data={data} note={note} />

      <div className="obv3-pbtn-row">
        <button className="obv3-pbtn secondary" onClick={() => go("welcome")}><Icon name="arrow-left" size={14} /> Back</button>
        <div style={{ display: "flex", gap: 10, marginLeft: "auto" }}>
          {data.intakeEnabled ? (
            <button className="obv3-pbtn primary" disabled={busy} onClick={() => { submitIntake(data.token, f as unknown as Record<string, unknown>).then((r) => { if (r.error) note(r.error); else { note(submitted ? "Updated — your team has been notified" : "Saved — your team has been notified"); go(data.access.length ? "access" : "tasks"); } }); }}>
              Save &amp; continue <Icon name="arrow-right" size={15} />
            </button>
          ) : (
            <button className="obv3-pbtn primary" onClick={() => go(data.access.length ? "access" : "tasks")}>
              {data.access.length ? "Continue to access" : "Continue to task board"} <Icon name="arrow-right" size={15} />
            </button>
          )}
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
  const onFiles = async (docId: string, files: FileList) => {
    setUploading(docId);
    let ok = 0; let firstErr: string | null = null;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      const r = await uploadDocFile(data.token, docId, fd);
      if (r.error) { firstErr = r.error; } else ok++;
    }
    setUploading(null);
    if (ok > 0) note(ok === 1 ? "Document received — your team has been notified" : `${ok} files received — your team has been notified`);
    else if (firstErr) note(firstErr);
    router.refresh();
  };
  const view = async (docId: string) => {
    const r = await documentViewUrl(data.token, docId);
    if (r.url) window.open(r.url, "_blank", "noopener"); else if (r.error) note(r.error);
  };
  const onUploadAll = async (files: FileList) => {
    setUploading("__all__");
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));
    const r = await uploadDocsBatch(data.token, fd);
    setUploading(null);
    if (r.error) note(r.error);
    else note(`${r.uploaded ?? 0} file${(r.uploaded ?? 0) === 1 ? "" : "s"} received — your team has been notified`);
    router.refresh();
  };
  const pendingCount = data.documents.filter((d) => d.status !== "uploaded").length;
  if (data.documents.length === 0) return null;
  return (
    <div className="obv3-pcard">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="obv3-pcard-h">Documents to upload</div>
          <div className="obv3-pcard-sub">Upload everything in one go with the button on the right, or use the Upload button on each item — whichever is easier for you. You can attach multiple files per item, view what you sent, and re-upload anything we flag.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <span className="pill amber"><span className="dot" />{received} of {data.documents.length} received</span>
          {pendingCount > 0 && (
            <label className="obv3-pbtn primary" style={{ cursor: uploading ? "default" : "pointer" }}>
              <Icon name="upload-cloud" size={14} /> {uploading === "__all__" ? "Uploading…" : "Upload all at once"}
              <input type="file" hidden multiple disabled={!!uploading} onChange={(e) => { const files = e.target.files; if (files && files.length) onUploadAll(files); e.target.value = ""; }} />
            </label>
          )}
        </div>
      </div>
      {(() => {
        const reupload = data.documents.filter((d) => d.status === "rejected").length;
        if (!reupload) return null;
        return (
          <div style={{ marginTop: 14, background: "var(--red-soft)", border: "1px solid #f0c0c0", borderRadius: 10, padding: "10px 14px", color: "var(--red)", fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>
            <Icon name="alert-circle" size={15} /> Action needed — {reupload} document{reupload === 1 ? "" : "s"} need re-uploading. See the highlighted item{reupload === 1 ? "" : "s"} below.
          </div>
        );
      })()}
      <div style={{ marginTop: 16 }}>
        {data.documents.map((d) => {
          const rejected = d.status === "rejected";
          const uploaded = d.status === "uploaded";
          return (
            <div key={d.id} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 8 }}>
              <div className="obv3-doc" style={{ borderBottom: "none", paddingBottom: 0, marginBottom: 0 }}>
                <span className={"dstate " + (uploaded ? "done" : "pending")} style={rejected ? { background: "var(--red-soft)", color: "var(--red)" } : undefined}>
                  {uploaded ? <Icon name="check" size={13} strokeWidth={2.6} /> : rejected ? <Icon name="rotate-ccw" size={12} /> : <Icon name="upload" size={12} />}
                </span>
                <span className="dname">{d.label}</span>
                {uploaded && <button type="button" className="obv3-doc-upload" onClick={() => view(d.id)} style={{ cursor: "pointer" }}><Icon name="eye" size={12} /> View</button>}
                {uploaded && (
                  <label className="obv3-doc-upload" style={{ cursor: uploading ? "default" : "pointer" }}>
                    <Icon name="upload" size={12} /> {uploading === d.id ? "Uploading…" : "Replace"}
                    <input type="file" hidden multiple disabled={!!uploading} onChange={(e) => { const files = e.target.files; if (files && files.length) onFiles(d.id, files); e.target.value = ""; }} />
                  </label>
                )}
                {uploaded ? (
                  <span className="pill green" style={{ fontSize: 10.5, height: 18 }}><span className="dot" />Received</span>
                ) : (
                  <label className="obv3-doc-upload" style={{ cursor: uploading ? "default" : "pointer" }}>
                    <Icon name="upload" size={12} /> {uploading === d.id ? "Uploading…" : rejected ? "Re-upload →" : "Upload →"}
                    <input type="file" hidden multiple disabled={!!uploading} onChange={(e) => { const files = e.target.files; if (files && files.length) onFiles(d.id, files); e.target.value = ""; }} />
                  </label>
                )}
              </div>
              {rejected && d.reviewNote && (
                <div style={{ marginTop: 6, marginLeft: 32, fontSize: 12, color: "var(--red)", background: "var(--red-soft)", borderRadius: 8, padding: "6px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <Icon name="alert-circle" size={13} /> <span><strong>Please re-upload:</strong> {d.reviewNote}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Access: systems the client must grant us access to, each with an SOP ---------- */
function AccessSection({ data, busy, run, go }: {
  data: PortalData; busy: boolean; run: (fn: () => Promise<{ error?: string; ok?: boolean }>, ok: string) => void; go: (s: Screen) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const granted = data.access.filter((a) => a.status === "granted").length;
  return (
    <div className="obv3-fade">
      <div className="obv3-pcard">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="obv3-pcard-h">System access we need</div>
            <div className="obv3-pcard-sub">To manage your accounting & compliance we need access to the systems below. Follow each short guide, then mark it done.</div>
          </div>
          <span className="pill amber"><span className="dot" />{granted} of {data.access.length} granted</span>
        </div>
      </div>

      {data.access.map((a) => (
        <div key={a.rowId} className="obv3-pcard">
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: a.status === "granted" ? "var(--green-soft)" : "var(--orange-soft)", color: a.status === "granted" ? "var(--green)" : "var(--orange)", display: "grid", placeItems: "center" }}>
              <Icon name={a.status === "granted" ? "check" : "key-round"} size={15} />
            </span>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{a.label}{a.systemName ? ` · ${a.systemName}` : ""}</div>
              {a.method && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{a.method}</div>}
            </div>
            <span className={"pill " + (a.status === "granted" ? "green" : "gray")} style={{ fontSize: 10.5 }}><span className="dot" />{a.status === "granted" ? "Granted" : "Action needed"}</span>
          </div>

          {a.email ? (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, background: "var(--bg-soft)", borderRadius: 9, padding: "9px 12px" }}>
              <Icon name="mail" size={14} style={{ color: "var(--orange)" }} />
              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Grant access to:</span>
              <strong style={{ fontSize: 13.5, fontFamily: "DM Mono, monospace" }}>{a.email}</strong>
            </div>
          ) : (
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, background: "var(--red-soft)", borderRadius: 9, padding: "9px 12px", color: "var(--red)", fontSize: 12.5 }}>
              <Icon name="alert-triangle" size={14} /> No access email set yet — your account manager will share the address to grant access to.
            </div>
          )}

          {a.sop.length > 0 && (
            <ol style={{ margin: "12px 0 0", paddingLeft: 20, fontSize: 13, color: "var(--ink-2)", lineHeight: 1.7 }}>
              {a.sop.map((s, i) => <li key={i}>{renderSopLine(s, a.email)}</li>)}
            </ol>
          )}

          {a.status === "granted" ? (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--green)", display: "flex", alignItems: "center", gap: 6 }}>
              <Icon name="check-circle" size={14} /> Thank you — access confirmed.{a.note ? ` (${a.note})` : ""}
            </div>
          ) : (
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input value={notes[a.rowId] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [a.rowId]: e.target.value }))} placeholder="Optional note (e.g. how you shared it)…" style={{ flex: 1, minWidth: 180, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
              <button className="obv3-pbtn primary" disabled={busy} onClick={() => run(() => confirmAccessItem(data.token, a.rowId, notes[a.rowId]), "Thank you — marked as granted")}>
                <Icon name="check" size={14} /> Mark as granted
              </button>
            </div>
          )}
        </div>
      ))}

      <div className="obv3-pbtn-row">
        <button className="obv3-pbtn secondary" onClick={() => go("intake")}><Icon name="arrow-left" size={14} /> Back</button>
        <button className="obv3-pbtn primary" onClick={() => go("tasks")}>Next — your task board <Icon name="arrow-right" size={15} /></button>
      </div>
    </div>
  );
}

/* ---------- Section 3: Task board + chat ---------- */
/* Monday.com-style status chips for the client board. */
const PORTAL_STATUS: Record<string, { label: string; bg: string }> = {
  complete: { label: "Done", bg: "var(--green)" },
  done: { label: "Done", bg: "var(--green)" },
  in_progress: { label: "Working on it", bg: "var(--blue)" },
  working: { label: "Working on it", bg: "var(--blue)" },
  review: { label: "In review", bg: "var(--purple)" },
  needs_input: { label: "Needs your input", bg: "var(--amber)" },
  blocked: { label: "Stuck", bg: "var(--red)" },
  not_started: { label: "Not started", bg: "var(--ink-4)" },
};
const GROUP_ACCENTS = ["var(--orange)", "var(--blue)", "var(--green)", "var(--purple)", "var(--teal)", "var(--amber)"];
const MBOARD_COLS = "minmax(0,1fr) 110px 84px 150px 64px";

function Tasks({ data, amInitials, amName, amEmail, busy, run, note, go }: {
  data: PortalData; amInitials: string; amName: string; amEmail: string | null;
  busy: boolean; run: (fn: () => Promise<{ error?: string; ok?: boolean }>, ok: string) => void; note: (m: string) => void; go: (s: Screen) => void;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [chatTask, setChatTask] = useState("");
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const msgCount = (title: string) => data.messages.filter((m) => m.taskRef === title).length;

  // If the team set custom board columns, mirror those exactly; otherwise group
  // the client-visible tasks by status into friendly columns.
  const useCustom = (data.boardColumns?.length ?? 0) > 0;
  const cols = useCustom
    ? data.boardColumns!.map((c) => ({ key: c, label: c }))
    : [
        { key: "todo", label: "To do" },
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
      key === "input" ? (t.status === "needs_input" || t.status === "blocked")
        : key === "progress" ? (t.status === "in_progress" || t.status === "working" || t.status === "review")
          : key === "done" ? (t.status === "complete" || t.status === "done")
            : (t.status === "not_started" || !["needs_input", "blocked", "in_progress", "working", "review", "complete", "done"].includes(t.status)));
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
        <div className="obv3-pcard-sub" style={{ marginBottom: 18 }}>Only the items relevant to you are shown, grouped exactly as your team tracks them. Open any task to chat or attach documents.</div>
        {data.tasks.length === 0 ? (
          <div className="cp-empty">Nothing needs your input right now — your team is working behind the scenes.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {cols.map((col, ci) => {
              const items = itemsFor(col.key);
              if (!items.length) return null;
              const accent = GROUP_ACCENTS[ci % GROUP_ACCENTS.length];
              return (
                <div key={col.key}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ color: accent, fontWeight: 800, fontSize: 13.5 }}>{col.label}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)", background: "var(--bg-soft)", borderRadius: 999, padding: "1px 8px" }}>{items.length}</span>
                  </div>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "#fff" }}>
                    <div style={{ display: "grid", gridTemplateColumns: MBOARD_COLS, gap: 8, padding: "8px 12px", background: "var(--bg-soft)", borderBottom: "1px solid var(--border)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)" }}>
                      <span>Task</span><span>Owner</span><span>Due</span><span>Status</span><span style={{ textAlign: "right" }}>Chat</span>
                    </div>
                    {items.map((t, i) => {
                      const st = PORTAL_STATUS[t.status] ?? { label: t.status.replace(/_/g, " "), bg: "var(--ink-4)" };
                      return (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: MBOARD_COLS, gap: 8, padding: "10px 12px", borderTop: i ? "1px solid var(--border)" : "none", borderLeft: `3px solid ${accent}`, alignItems: "center", fontSize: 12.5 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                            {t.type === "milestone" && <span className="pill purple" style={{ fontSize: 9, flexShrink: 0 }}>Milestone</span>}
                          </span>
                          <span style={{ color: "var(--ink-2)" }}>{t.ownerKind === "client" ? "You" : "Finanshels"}</span>
                          <span style={{ color: "var(--ink-3)" }}>{t.due || "—"}</span>
                          <span><span style={{ display: "inline-block", background: st.bg, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 6, whiteSpace: "nowrap" }}>{st.label}</span></span>
                          <span style={{ textAlign: "right" }}>
                            <button type="button" onClick={() => setOpenTask(t.title)} title="Open task chat" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--orange)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                              <Icon name="message-square" size={13} />{msgCount(t.title) ? ` ${msgCount(t.title)}` : ""}
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
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
        <button className="obv3-pbtn secondary" onClick={() => go("intake")}><Icon name="arrow-left" size={14} /> Back</button>
        <button className="obv3-pbtn primary" onClick={() => go("live")}>Next — your live setup <Icon name="arrow-right" size={15} /></button>
      </div>

      {openTask && (
        <PortalTaskChat token={data.token} task={openTask} amName={amName}
          messages={data.messages.filter((m) => m.taskRef === openTask)}
          onClose={() => setOpenTask(null)} note={note} />
      )}
    </div>
  );
}

/* Per-task chat — same thread the team sees, filtered to one task. Supports file attachments
   which save to the client's Drive (or storage) and post as a link. */
function PortalTaskChat({ token, task, amName, messages, onClose, note }: {
  token: string; task: string; amName: string; messages: PortalData["messages"]; onClose: () => void; note: (m: string) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    postPortalMessage(token, body, task).then((r) => { if (r.error) note(r.error); else router.refresh(); });
  };
  const attach = async (files: FileList) => {
    setBusy(true);
    let ok = 0; let err: string | null = null;
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.append("file", file);
      const r = await attachPortalTaskFile(token, task, fd);
      if (r.error) err = r.error; else ok++;
    }
    setBusy(false);
    if (ok) note(ok === 1 ? "File attached" : `${ok} files attached`); else if (err) note(err);
    router.refresh();
  };
  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 520, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>{task}</h3><div className="sub">Follow up with {amName} on this task. Attach documents if needed.</div></div>
        <div className="bd" style={{ maxHeight: "56vh" }}>
          <div className="cp-chat">
            {messages.length === 0 && <div className="cp-empty">No messages on this task yet — start the thread.</div>}
            {messages.map((m, i) => {
              const mine = m.role === "Client"; const system = m.role === "System";
              return (
                <div key={i} className={"cp-chat-row" + (mine ? " mine" : "") + (system ? " system" : "")}>
                  {!mine && !system && <span className="cp-chat-av">{m.author.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>}
                  <div className="cp-chat-bubble">
                    {!mine && !system && <div className="cp-chat-who">{m.author}{m.role ? ` · ${m.role}` : ""}</div>}
                    <div className="cp-chat-text">{m.body}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="ft" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div className="cp-add-row">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }} placeholder={`Message about "${task}"…`} />
            <button type="button" onClick={send} disabled={!text.trim()}><Icon name="send" size={13} /> Send</button>
          </div>
          <label className="obv3-pbtn secondary" style={{ cursor: busy ? "default" : "pointer", justifyContent: "center" }}>
            <Icon name="paperclip" size={14} /> {busy ? "Attaching…" : "Attach documents"}
            <input type="file" hidden multiple disabled={busy} onChange={(e) => { const f = e.target.files; if (f && f.length) attach(f); e.target.value = ""; }} />
          </label>
        </div>
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
  const [signName, setSignName] = useState(data.ownerName ?? "");
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
          {data.onboardingPartner && <div className="cp-poc-meta"><Icon name="user-check" size={13} /> Onboarding Partner · {data.onboardingPartner}</div>}
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

      {/* What we deliver — from the contract analysis, with standard deadlines */}
      {(() => {
        const deliverables = data.contract?.deliverables?.length
          ? data.contract.deliverables
          : [
              { item: "Monthly management reports (P&L, balance sheet, cash flow)", frequency: "Monthly", deadline: "By the 15th of the following month" },
              { item: "Bookkeeping & reconciliations", frequency: "Monthly", deadline: "By the 15th of the following month" },
              { item: "VAT return preparation & submission", frequency: "Quarterly", deadline: "Within 28 days of quarter end" },
              { item: "Corporate Tax return", frequency: "Annual", deadline: "Within 9 months of year end" },
            ];
        return (
          <div className="obv3-pcard">
            <div className="obv3-pcard-h">What we deliver</div>
            <div className="obv3-pcard-sub" style={{ marginBottom: 12 }}>Your reports and filings, and when you&apos;ll get them. {data.contract?.scope ? "" : "These are our standard timelines — your team will confirm any client-specific dates."}</div>
            {data.contract?.scope && <div style={{ fontSize: 13, color: "var(--ink-1)", marginBottom: 12 }}>{data.contract.scope}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {deliverables.map((dv, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "#fff" }}>
                  <span style={{ color: "var(--green)" }}><Icon name="calendar-check" size={15} /></span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{dv.item}</span>
                  <span className="pill" style={{ fontSize: 10.5 }}>{dv.frequency}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-3)", minWidth: 180, textAlign: "right" }}>{dv.deadline}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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

      <div className="obv3-pcard" style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
        <div className="obv3-pcard-h" style={{ marginBottom: 10 }}>Escalation path</div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
          <span style={{ width: 22, height: 22, borderRadius: 999, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 11, flexShrink: 0 }}>1</span>
          <div><div style={{ fontWeight: 700, color: "var(--ink-1)" }}>{amName}</div><div style={{ color: "var(--ink-3)" }}>Account Manager{amEmail ? ` · ${amEmail}` : ""}</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ width: 22, height: 22, borderRadius: 999, background: "var(--bg)", color: "var(--ink-3)", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 11, flexShrink: 0, border: "1.5px solid var(--border-strong)" }}>2</span>
          <div><div style={{ fontWeight: 700, color: "var(--ink-1)" }}>{data.csm?.name ?? "Customer Success Manager"}</div><div style={{ color: "var(--ink-3)" }}>Customer Success Manager{data.csm?.email ? ` · ${data.csm.email}` : ""}</div></div>
        </div>
      </div>

      {/* Sign-off */}
      <div className={"cp-signoff-card" + (data.signedOff ? " done" : "")}>
        {data.signedOff ? (
          <>
            <div className="cp-signoff-head">
              <span className="ic done"><Icon name="check" size={20} strokeWidth={3} /></span>
              <div><div className="t">You&apos;re all set — onboarding signed off</div><div className="d">Thank you{data.ownerName ? `, ${data.ownerName.split(" ")[0]}` : ""}. Your team has been notified and your recurring service is live.</div></div>
            </div>
            <a className="cp-signoff-btn" href="https://www.trustpilot.com/review/finanshels.com" target="_blank" rel="noreferrer" style={{ textDecoration: "none", marginTop: 14 }}>
              <Icon name="star" size={16} /> Loved your onboarding? Leave us a review on Trustpilot
            </a>
          </>
        ) : (
          <>
            <div className="cp-signoff-head">
              <span className="ic"><Icon name="clipboard-check" size={20} /></span>
              <div><div className="t">Happy with your setup?</div><div className="d">Type your full name to sign off — this is saved as your confirmation that everything looks right.</div></div>
            </div>
            <input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Your full name"
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px", fontSize: 14, marginTop: 12, marginBottom: 10 }} />
            <button className="cp-signoff-btn" disabled={busy || !signName.trim()} onClick={() => run(() => signOffOnboarding(data.token, signName.trim()), "Thank you — your onboarding is signed off.")}>
              <Icon name="check-circle" size={16} /> Sign off my onboarding
            </button>
          </>
        )}
      </div>

      <button className="obv3-pbtn secondary" onClick={() => go("welcome")}><Icon name="arrow-left" size={14} /> Back to welcome</button>
    </div>
  );
}
