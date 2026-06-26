"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { useIdentity } from "@/components/identity-context";
import { isMasterAdmin } from "@/lib/roles";
import type { OnbTemplate } from "@/lib/onboarding-templates";
import type { ContractAnalysis } from "@/app/(app)/onboarding/[runId]/ai-actions";
import { formatEngagementPeriod } from "@/lib/contract-format";
import { extractCallInsights, saveCallInsights, generateClientSummary, sendClientWeeklyDigest, addClientMeeting, deleteClientMeeting, syncFathomMeetingsForClient, addPlaybookAccess, setPlaybookAccessStatus, deletePlaybookAccess, setClientPortalAccess, rebuildClientCompliance, savePaymentPlan, generatePaymentSchedule, savePaymentEntry, deletePaymentEntry, type InsightSection } from "../actions";
import { INDUSTRIES, ENTITIES } from "../clients-table";

export interface PlaybookData {
  clientId: string;
  name: string;
  industry: string | null;
  entity: string | null;
  status: string;
  profile: Record<string, unknown>;
  am: string | null;
  senior: string | null;
  junior: string | null;
  runId: string | null;
  templateName: string | null;
  template: OnbTemplate | null;
  runs: { id: string; status: string; progress: number; currentStage: number; templateName: string; started: string | null; target: string | null }[];
  intake: { submitted: Record<string, string>; status: string } | null;
  coa: { accounts: { code: string; account: string; section: string }[]; ai_rationale: string | null; base_industry: string | null; client_signed_off: boolean } | null;
  tasks: { title: string; status: string; type: string; owner_kind: string; client_visible: boolean; service: string | null }[];
  projects: Record<string, unknown>[];
  compliance: Record<string, unknown>[];
  catchup: Record<string, unknown>[];
  triage: Record<string, unknown>[];
  access: { rowId?: string; id?: string; label?: string; email?: string; method?: string; status?: string; _status?: string; sharedVia?: string; manual?: boolean }[];
  diagrams: { name: string; nodes: { id: string; label: string; type: string }[] }[];
  documents: { label: string; status: string }[];
  messages: { author_name: string; author_role: string; body: string; created_at: string }[];
  escalations: { title: string; body: string | null; kind: string; created_at: string }[];
  zohoConnected: boolean;
  /** Org-wide extra fields, shared across all clients (values live in profile.facts). */
  fieldDefs: { key: string; label: string; sort: number }[];
  /** Who can open the onboarding portal: the primary email + invited teammates. */
  portalAccess: { email: string | null; altEmails: string[] };
  driveLink: string | null;
  meetings: { id: string; title: string; meeting_date: string | null; recording_link: string | null; notes: string | null; summary: string | null; source: string; created_at: string }[];
  /** Latest contract analysis attached to any of this client's runs (run_items kind='contract'). */
  contract: ContractAnalysis | null;
  contractAnalysedAt: string | null;
  /** Master Admin only — when false the playbook is read-only (edit controls hidden). */
  canEdit: boolean;
  paymentPlan: Record<string, unknown> | null;
  paymentEntries: Record<string, unknown>[];
}

const TABS = [
  "Company Overview", "Engagement", "Runs", "Workflows", "Tasks & Projects", "Templates & SOPs",
  "Compliance Calendar", "Meetings", "Communication", "COA", "Tools & Access", "Escalation History", "Payments",
] as const;
const TAB_ICON: Record<string, string> = {
  "Company Overview": "database", "Engagement": "file-text", "Runs": "activity", "Workflows": "workflow",
  "Tasks & Projects": "folder-kanban", "Templates & SOPs": "layers",
  "Compliance Calendar": "calendar", "Meetings": "video", "Communication": "message-circle",
  "COA": "list-tree", "Tools & Access": "wrench", "Escalation History": "alert-triangle", "Payments": "credit-card",
};

export function ClientPlaybook({ data }: { data: PlaybookData }) {
  // Server already restricts editing to Master Admin (the security boundary). Also honour the
  // admin's "View as" switcher so previewing another role shows the read-only experience.
  const { effectiveRole } = useIdentity();
  data = { ...data, canEdit: data.canEdit && isMasterAdmin(effectiveRole) };
  // Unified-page mode: all sections render simultaneously on a single scrollable
  // page. The top "tabs" act as anchor links that scroll the matching section
  // into view. setTab still tracks active highlight via scroll-spy.
  const [tab, setTab] = useState<(typeof TABS)[number]>("Company Overview");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const setSectionRef = (key: string) => (el: HTMLDivElement | null) => { sectionRefs.current[key] = el; };
  const scrollTo = (t: (typeof TABS)[number]) => {
    setTab(t);
    const el = sectionRefs.current[t];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // Scroll-spy: when a section's top crosses the sticky-nav band, mark it active.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target) {
          const key = (visible.target as HTMLElement).dataset.section as (typeof TABS)[number] | undefined;
          if (key) setTab(key);
        }
      },
      { rootMargin: "-110px 0px -60% 0px", threshold: [0, 0.1] },
    );
    Object.values(sectionRefs.current).forEach((el) => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);
  const first = data.name.split(" ")[0];
  const rest = data.name.slice(first.length);

  return (
    <div className="scroll">
      <div className="page">
        <div style={{ fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
          <Link href="/clients" style={{ color: "var(--ink-3)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="arrow-left" size={12} /> Clients</Link>
          <span>/</span><span>{data.name}</span><span>/</span><span style={{ color: "var(--orange)", fontWeight: 600 }}>Client Playbook</span>
        </div>
        <h2 style={{ fontSize: 26, margin: 0 }}>{first}<span style={{ color: "var(--orange)" }}>{rest}</span></h2>
        <div className="sub" style={{ marginTop: 2 }}>
          {data.industry ?? "—"}{data.am ? ` · AM ${data.am}` : ""}{data.senior ? ` · Sr ${data.senior}` : ""}
        </div>

        {/* Sticky section nav — scrolls to each section instead of switching screens. */}
        <div className="cpb-tabs" style={{ marginTop: 16, position: "sticky", top: 0, zIndex: 5, background: "var(--bg, #fff)", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
          {TABS.map((t) => (
            <button key={t} className={"cpb-tab" + (tab === t ? " active" : "")} onClick={() => scrollTo(t)}>
              <Icon name={TAB_ICON[t] ?? "circle"} size={12} /> {t}
            </button>
          ))}
        </div>

        {/* Auto-compiled banner */}
        {data.runId && (
          <div style={{ border: "1.5px solid var(--orange)", background: "var(--orange-soft)", borderRadius: 12, padding: 16, margin: "14px 0", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <span style={{ width: 36, height: 36, borderRadius: 8, background: "var(--orange)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name="sparkles" size={17} /></span>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>This playbook was auto-compiled from the onboarding run</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {["Intake form", "Chart of accounts", "Compliance calendar", "Catch-up board", "Projects & tasks", "Fathom notes"].map((c) => (
                  <span key={c} className="pill" style={{ background: "#fff", color: "var(--ink-2)", fontSize: 10.5, border: "1px solid var(--border)" }}><Icon name="check" size={10} /> {c}</span>
                ))}
              </div>
            </div>
            <Link href={`/onboarding/${data.runId}`} className="btn-ghost" style={{ textDecoration: "none" }}><Icon name="external-link" size={13} /> Open onboarding run</Link>
          </div>
        )}

        <div className="cpb-content" style={{ marginTop: 14 }}>
          <div ref={setSectionRef("Company Overview")} data-section="Company Overview"><SectionHeading icon="database" title="Company Overview" /><ClientData data={data} /></div>
          <div ref={setSectionRef("Engagement")} data-section="Engagement"><SectionHeading icon="file-text" title="Engagement" /><Engagement data={data} /></div>
          <div ref={setSectionRef("Runs")} data-section="Runs"><SectionHeading icon="activity" title="Runs" /><Runs data={data} /></div>
          <div ref={setSectionRef("Workflows")} data-section="Workflows"><SectionHeading icon="workflow" title="Workflows" /><Workflows data={data} /></div>
          <div ref={setSectionRef("Tasks & Projects")} data-section="Tasks & Projects"><SectionHeading icon="folder-kanban" title="Tasks & Projects" /><TasksProjects data={data} /></div>
          <div ref={setSectionRef("Templates & SOPs")} data-section="Templates & SOPs"><SectionHeading icon="layers" title="Templates & SOPs" /><TemplatesSops data={data} /></div>
          <div ref={setSectionRef("Compliance Calendar")} data-section="Compliance Calendar"><SectionHeading icon="calendar" title="Compliance Calendar" /><Compliance data={data} /></div>
          <div ref={setSectionRef("Meetings")} data-section="Meetings"><SectionHeading icon="video" title="Meetings" /><Meetings data={data} /></div>
          <div ref={setSectionRef("Communication")} data-section="Communication"><SectionHeading icon="message-circle" title="Communication" /><Communication data={data} /></div>
          <div ref={setSectionRef("COA")} data-section="COA"><SectionHeading icon="list-tree" title="COA" /><Coa data={data} /></div>
          <div ref={setSectionRef("Tools & Access")} data-section="Tools & Access"><SectionHeading icon="wrench" title="Tools & Access" /><Tools data={data} /></div>
          <div ref={setSectionRef("Escalation History")} data-section="Escalation History"><SectionHeading icon="alert-triangle" title="Escalation History" /><Escalations data={data} /></div>
          <div ref={setSectionRef("Payments")} data-section="Payments"><SectionHeading icon="credit-card" title="Payments" /><PaymentsSection data={data} /></div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ icon, title }: { icon: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "22px 0 10px", marginTop: 6, borderTop: "1px solid var(--border)", marginBottom: 4 }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center" }}>
        <Icon name={icon} size={14} />
      </span>
      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--ink-1)" }}>{title}</h3>
    </div>
  );
}

function Panel({ title, children, empty, extra }: { title: string; children?: React.ReactNode; empty?: string; extra?: React.ReactNode }) {
  return (
    <div className="cpb-card" style={{ marginBottom: 14 }}>
      <div className="cpb-card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><span>{title}</span>{extra}</div>
      {children ?? <div className="cpb-empty">{empty ?? "Nothing here yet."}</div>}
    </div>
  );
}
function Row({ k, v }: { k: string; v: unknown }) {
  const val = Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "—" : String(v);
  return <div className="cpb-detail-row"><span className="cpb-detail-label">{k}</span><span style={{ color: "var(--ink-1)", textAlign: "right" }}>{val}</span></div>;
}

function CallInsights({ data }: { data: PlaybookData }) {
  const router = useRouter();
  const p = data.profile;
  const description = (p.business_description as string) ?? "";
  const painPoints = (p.pain_points as string[]) ?? [];
  const callSummary = (p.call_summary as string) ?? "";
  const callLink = (p.call_link as string) ?? "";
  const sections = ((p.call_insights as { sections?: InsightSection[] } | null)?.sections) ?? [];

  const [open, setOpen] = useState(false);
  const [link, setLink] = useState(callLink);
  const [notes, setNotes] = useState("");
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  // Edit mode (AM / admin) — server enforces the role.
  const [editing, setEditing] = useState(false);
  const [eDesc, setEDesc] = useState(description);
  const [ePains, setEPains] = useState(painPoints.join("\n"));
  const [eSummary, setESummary] = useState(callSummary);
  const [eSections, setESections] = useState<InsightSection[]>(sections);

  // Company facts editable on the same Edit panel.
  const initialCompany = {
    name: data.name ?? "",
    owner_name: (p.owner_name as string) ?? "",
    industry: (p.industry as string) ?? "",
    entity_type: (p.entity_type as string) ?? "",
    primary_contact_email: (p.primary_contact_email as string) ?? "",
    phone: (p.phone as string) ?? "",
    vat_registered: (p.vat_registered as string) ?? "",
    vat_trn: (p.vat_trn as string) ?? "",
    ct_registered: (p.ct_registered as string) ?? "",
    bank_names: ((p.bank_names as string[]) ?? []).join(", "),
    payment_gateways: ((p.payment_gateways as string[]) ?? []).join(", "),
    accounting_software: (p.accounting_software as string) ?? "",
    revenue_bracket: (p.revenue_bracket as string) ?? "",
  };
  const [eCo, setECo] = useState(initialCompany);
  const setCoField = (k: keyof typeof initialCompany, v: string) => setECo((s) => ({ ...s, [k]: v }));
  const splitCsv = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

  const run = () => start(async () => {
    setMsg(null);
    const r = await extractCallInsights(data.clientId, link, notes);
    if (r.error) setMsg(r.error);
    else { setMsg(r.source === "fathom" ? "Fetched the call from Fathom and updated the playbook." : "Playbook updated from the call."); setNotes(""); setOpen(false); router.refresh(); }
  });
  const startEdit = () => {
    setEDesc(description); setEPains(painPoints.join("\n")); setESummary(callSummary); setESections(sections.length ? sections : [{ heading: "", body: "" }]);
    setECo(initialCompany);
    setEditing(true); setMsg(null);
  };
  const save = () => start(async () => {
    setMsg(null);
    const r = await saveCallInsights(data.clientId, {
      businessDescription: eDesc,
      painPoints: ePains.split("\n").map((s) => s.trim()).filter(Boolean),
      summary: eSummary,
      sections: eSections,
      company: {
        name: eCo.name,
        owner_name: eCo.owner_name,
        industry: eCo.industry,
        entity_type: eCo.entity_type,
        primary_contact_email: eCo.primary_contact_email,
        phone: eCo.phone,
        vat_registered: eCo.vat_registered,
        vat_trn: eCo.vat_trn,
        ct_registered: eCo.ct_registered,
        bank_names: splitCsv(eCo.bank_names),
        payment_gateways: splitCsv(eCo.payment_gateways),
        accounting_software: eCo.accounting_software,
        revenue_bracket: eCo.revenue_bracket,
      },
    });
    if (r.error) setMsg(r.error);
    else { setMsg("Saved."); setEditing(false); router.refresh(); }
  });
  const setSec = (i: number, k: keyof InsightSection, v: string) => setESections((a) => a.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}><Icon name="building-2" size={15} /> Company Overview</div>
        {data.canEdit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!editing && <button className="btn-ghost" onClick={startEdit}><Icon name="pencil" size={13} /> Edit</button>}
            {!editing && <button className="btn-ghost" onClick={() => setOpen((o) => !o)}><Icon name="mic" size={13} /> {open ? "Close" : "Add call notes"}</button>}
            {!editing && (
              <button
                className="btn-ai"
                onClick={() => start(async () => {
                  setMsg(null);
                  const r = await generateClientSummary(data.clientId);
                  if (r.error) setMsg(r.error);
                  else { setMsg("Executive summary updated."); router.refresh(); }
                })}
                disabled={busy}
              >
                <Icon name="sparkles" size={13} /> {busy ? "Generating…" : "AI summary"}
              </button>
            )}
            {!editing && (
              <button
                className="btn-ghost"
                onClick={() => start(async () => {
                  setMsg(null);
                  const r = await sendClientWeeklyDigest(data.clientId);
                  if (r.error) setMsg(r.error);
                  else setMsg(`Weekly digest sent to ${r.sentTo?.join(", ") ?? "the client"}.`);
                })}
                disabled={busy}
                title="Email the client a Monday-style update with open tasks, pending docs and upcoming compliance"
              >
                <Icon name="mail" size={13} /> {busy ? "Sending…" : "Send weekly digest"}
              </button>
            )}
            {editing && <button className="btn-ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>}
            {editing && <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>}
          </div>
        )}
      </div>

      {editing ? (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px" }}>
            <div className="field"><label>Company</label><input value={eCo.name} onChange={(e) => setCoField("name", e.target.value)} /></div>
            <div className="field"><label>Owner</label><input value={eCo.owner_name} onChange={(e) => setCoField("owner_name", e.target.value)} /></div>
            <div className="field"><label>Industry</label>
              <select value={eCo.industry} onChange={(e) => setCoField("industry", e.target.value)}>
                <option value="">— Choose industry —</option>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                {eCo.industry && !INDUSTRIES.includes(eCo.industry) && <option value={eCo.industry}>{eCo.industry} (current)</option>}
              </select>
            </div>
            <div className="field"><label>Entity type</label>
              <select value={eCo.entity_type} onChange={(e) => setCoField("entity_type", e.target.value)}>
                <option value="">— Choose entity type —</option>
                {ENTITIES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                {eCo.entity_type && !ENTITIES.some(([v]) => v === eCo.entity_type) && <option value={eCo.entity_type}>{eCo.entity_type} (current)</option>}
              </select>
            </div>
            <div className="field"><label>Contact email</label><input type="email" value={eCo.primary_contact_email} onChange={(e) => setCoField("primary_contact_email", e.target.value)} /></div>
            <div className="field"><label>Phone</label><input value={eCo.phone} onChange={(e) => setCoField("phone", e.target.value)} placeholder="WhatsApp preferred" /></div>
            <div className="field"><label>VAT status</label><input value={eCo.vat_registered} onChange={(e) => setCoField("vat_registered", e.target.value)} placeholder="Registered / Not registered / Exempt" /></div>
            <div className="field"><label>VAT TRN</label><input value={eCo.vat_trn} onChange={(e) => setCoField("vat_trn", e.target.value)} placeholder="100xxxxxxxxxxxx" /></div>
            <div className="field"><label>Corporate tax</label><input value={eCo.ct_registered} onChange={(e) => setCoField("ct_registered", e.target.value)} placeholder="Registered / Pending / N/A" /></div>
            <div className="field"><label>Revenue bracket</label><input value={eCo.revenue_bracket} onChange={(e) => setCoField("revenue_bracket", e.target.value)} placeholder="< AED 1M · AED 1–3M · …" /></div>
            <div className="field" style={{ gridColumn: "1 / span 2" }}><label>Banks (comma-separated)</label><input value={eCo.bank_names} onChange={(e) => setCoField("bank_names", e.target.value)} placeholder="Emirates NBD, Mashreq, Wio" /></div>
            <div className="field" style={{ gridColumn: "1 / span 2" }}><label>Payment gateways (comma-separated)</label><input value={eCo.payment_gateways} onChange={(e) => setCoField("payment_gateways", e.target.value)} placeholder="Stripe, Telr, Network" /></div>
            <div className="field" style={{ gridColumn: "1 / span 2" }}><label>Accounting software</label><input value={eCo.accounting_software} onChange={(e) => setCoField("accounting_software", e.target.value)} placeholder="Zoho Books / QBO / Xero" /></div>
          </div>
          <div className="field"><label>Business description</label><textarea className="notes" value={eDesc} onChange={(e) => setEDesc(e.target.value)} style={{ minHeight: 70 }} /></div>
          <div className="field"><label>Pain points (one per line)</label><textarea className="notes" value={ePains} onChange={(e) => setEPains(e.target.value)} style={{ minHeight: 70 }} /></div>
          <div className="field"><label>Call summary</label><textarea className="notes" value={eSummary} onChange={(e) => setESummary(e.target.value)} style={{ minHeight: 50 }} /></div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)", marginBottom: 6 }}>Sections</div>
            {eSections.map((s, i) => (
              <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input value={s.heading} onChange={(e) => setSec(i, "heading", e.target.value)} placeholder="Section heading (e.g. Systems & software)" style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 13, fontWeight: 600 }} />
                  <button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => setESections((a) => a.filter((_, j) => j !== i))}><Icon name="trash-2" size={13} /></button>
                </div>
                <textarea className="notes" value={s.body} onChange={(e) => setSec(i, "body", e.target.value)} style={{ minHeight: 60 }} placeholder="Details — one bullet per line" />
              </div>
            ))}
            <button className="add-link" onClick={() => setESections((a) => [...a, { heading: "", body: "" }])}><Icon name="plus" size={12} /> Add section</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
            <Row k="Company" v={data.name} />
            <Row k="Owner" v={p.owner_name} />
            <Row k="Industry" v={p.industry} />
            <Row k="Entity type" v={p.entity_type} />
            <Row k="Contact email" v={p.primary_contact_email} />
            <Row k="Phone" v={p.phone} />
            <Row k="VAT / TRN" v={[p.vat_registered, p.vat_trn].filter(Boolean).join(" · ")} />
            <Row k="Corporate Tax" v={p.ct_registered} />
            <Row k="Bank(s)" v={p.bank_names} />
            <Row k="Payment gateways" v={p.payment_gateways} />
            <Row k="Accounting software" v={p.accounting_software} />
            <Row k="Revenue bracket" v={p.revenue_bracket} />
            {data.fieldDefs.map((fd) => <Row key={fd.key} k={fd.label} v={(p.facts as Record<string, unknown> | null | undefined)?.[fd.key]} />)}
          </div>
          {p.executive_summary ? (
            <div style={{ marginTop: 16, background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--orange)" }}>
                  <Icon name="sparkles" size={11} /> Executive summary
                </div>
                {p.executive_summary_at ? (
                  <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Generated {new Date(p.executive_summary_at as string).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                ) : null}
              </div>
              <div style={{ fontSize: 13, color: "var(--ink-1)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{p.executive_summary as string}</div>
            </div>
          ) : null}

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)", marginBottom: 4 }}>Business description</div>
            <div style={{ fontSize: 13, color: description ? "var(--ink-1)" : "var(--ink-4)", lineHeight: 1.6 }}>{description || "Not captured yet — add the call notes to fill this in."}</div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)", marginBottom: 6 }}>Pain points</div>
            {painPoints.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {painPoints.map((pp, i) => <span key={i} className="pill amber" style={{ fontSize: 11.5 }}><Icon name="alert-circle" size={11} /> {pp}</span>)}
              </div>
            ) : <div style={{ fontSize: 13, color: "var(--ink-4)" }}>None captured yet.</div>}
          </div>

          {sections.map((s, i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)", marginBottom: 4 }}>{s.heading}</div>
              <div style={{ fontSize: 13, color: "var(--ink-1)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{s.body}</div>
            </div>
          ))}

          {callSummary && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)", marginBottom: 4 }}>Call summary</div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>{callSummary}</div>
              {callLink && <a href={callLink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--orange)", fontWeight: 600, display: "inline-flex", gap: 4, marginTop: 4 }}><Icon name="video" size={12} /> Recording</a>}
            </div>
          )}

          {open && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <div className="field"><label>Fathom recording link</label><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://fathom.video/share/… — paste this alone and we fetch the notes from Fathom" /></div>
              <div className="field"><label>Call notes (optional if a Fathom link is given)</label><textarea className="notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 120 }} placeholder="Leave blank to auto-fetch from Fathom, or paste the notes here. AI captures the business description, pain points, structured fields and key sections — only what's actually discussed." /></div>
              <button className="btn-ai" disabled={busy || (!notes.trim() && !link.trim())} onClick={run}><Icon name="sparkles" size={13} /> {busy ? "Reading the call…" : "Extract & update playbook"}</button>
            </div>
          )}
        </>
      )}
      {msg && <div style={{ fontSize: 12.5, color: /Saved|updated/.test(msg) ? "var(--green)" : "var(--red)", marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

// Configure which emails can open the onboarding portal: the primary (where the access code is
// sent) plus invited teammates who can sign in with their own email + code.
function PortalAccessCard({ data }: { data: PlaybookData }) {
  const router = useRouter();
  const [email, setEmail] = useState(data.portalAccess.email ?? "");
  const [alts, setAlts] = useState<string[]>(data.portalAccess.altEmails ?? []);
  const [draft, setDraft] = useState("");
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const valid = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
  const addAlt = () => { const v = draft.trim().toLowerCase(); if (v && valid(v) && v !== email.trim().toLowerCase() && !alts.includes(v)) { setAlts((a) => [...a, v]); setDraft(""); } };
  const save = () => start(async () => {
    setMsg(null);
    const r = await setClientPortalAccess(data.clientId, email, alts);
    if (r.error) setMsg(r.error);
    else { setMsg("Saved — these emails can now open the portal."); setEmail(r.email ?? email); setAlts(r.altEmails ?? alts); router.refresh(); }
  });
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon name="lock" size={15} /><div style={{ fontSize: 14, fontWeight: 700 }}>Onboarding portal access</div>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 12 }}>Set who can open the onboarding portal. A one-time code is emailed to these addresses. Only listed emails can sign in.</div>
      {data.canEdit ? (
        <>
          <div className="field"><label>Primary email (access code is sent here)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </div>
          <div className="field"><label>Additional emails who can also access</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {alts.map((a) => (
                <span key={a} className="pill" style={{ fontSize: 12 }}>{a}
                  <button type="button" onClick={() => setAlts((x) => x.filter((y) => y !== a))} style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", color: "inherit" }}>×</button>
                </span>
              ))}
              <input value={draft} placeholder="+ add email & Enter" onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlt(); } }} onBlur={addAlt}
                style={{ border: "1px dashed var(--border-strong)", borderRadius: 999, padding: "5px 10px", fontSize: 12.5, width: 200 }} />
            </div>
          </div>
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save portal access"}</button>
          {msg && <div style={{ fontSize: 12.5, color: /Saved/.test(msg) ? "var(--green)" : "var(--red)", marginTop: 8 }}>{msg}</div>}
        </>
      ) : (
        <div style={{ fontSize: 13 }}>
          <Row k="Primary email" v={data.portalAccess.email} />
          {data.portalAccess.altEmails.length > 0 && <Row k="Also allowed" v={data.portalAccess.altEmails} />}
        </div>
      )}
    </div>
  );
}

// Engagement = the latest contract analysis attached to any run for this client.
// It mirrors what the team configured in the onboarding run's "Upload contract" step
// and what the client sees on the onboarding portal Live tab. Read-only here — edits
// happen in the run view (single source of truth: run_items kind='contract').
function Engagement({ data }: { data: PlaybookData }) {
  const c = data.contract;
  if (!c) {
    return (
      <Panel
        title="Engagement contract"
        empty={
          data.runId
            ? "No contract analysed yet. In the onboarding run, run the 'Upload contract & confirm deliverables' step — the scope, payment terms and deliverables will appear here."
            : "Once a contract is uploaded in this client's onboarding run, the scope, payment terms and deliverables will appear here."
        }
      />
    );
  }
  const duration = formatEngagementPeriod(c.periodStart ?? null, c.periodEnd ?? null);
  const analysedAt = data.contractAnalysedAt ? new Date(data.contractAnalysedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  return (
    <>
      <div className="cpb-card" style={{ marginBottom: 14 }}>
        <div className="cpb-card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span>Engagement contract</span>
          {analysedAt && <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 500 }}>Analysed {analysedAt}</span>}
        </div>
        <div style={{ padding: "14px 16px", display: "grid", gap: 12 }}>
          {duration && (
            <div className="cpb-detail-row"><span className="cpb-detail-label">Duration</span><span style={{ color: "var(--ink-1)", textAlign: "right" }}>{duration}</span></div>
          )}
          {c.reportingFrequency && (
            <div className="cpb-detail-row"><span className="cpb-detail-label">Reporting frequency</span><span style={{ color: "var(--ink-1)", textAlign: "right" }}>{c.reportingFrequency}</span></div>
          )}
          {c.scope && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Scope of work</div>
              <div style={{ fontSize: 13, color: "var(--ink-1)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{c.scope}</div>
            </div>
          )}
          {c.inclusions && c.inclusions.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Included</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-1)", lineHeight: 1.55 }}>
                {c.inclusions.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            </div>
          )}
          {c.exclusions && c.exclusions.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Out of scope</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-1)", lineHeight: 1.55 }}>
                {c.exclusions.map((it, i) => <li key={i}>{it}</li>)}
              </ul>
            </div>
          )}
          {c.paymentTerms && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Payment terms</div>
              <div style={{ fontSize: 13, color: "var(--ink-1)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{c.paymentTerms}</div>
            </div>
          )}
        </div>
      </div>

      {c.deliverables && c.deliverables.length > 0 && (
        <div className="cpb-card" style={{ marginBottom: 14 }}>
          <div className="cpb-card-head">What we deliver</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--bg-soft)", color: "var(--ink-3)" }}>
                  <th style={{ textAlign: "left", padding: "8px 14px", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Item</th>
                  <th style={{ textAlign: "left", padding: "8px 14px", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Frequency</th>
                  <th style={{ textAlign: "left", padding: "8px 14px", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.05em" }}>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {c.deliverables.map((d, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 14px", color: "var(--ink-1)" }}>{d.item}</td>
                    <td style={{ padding: "10px 14px", color: "var(--ink-2)" }}>{d.frequency}</td>
                    <td style={{ padding: "10px 14px", color: "var(--ink-2)" }}>{d.deadline}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.runId && (
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: -4, marginBottom: 14 }}>
          Edit the engagement in the onboarding run → <Link href={`/onboarding/${data.runId}`} style={{ color: "var(--orange)", fontWeight: 600 }}>Upload contract & confirm deliverables</Link>.
        </div>
      )}
    </>
  );
}

function ClientData({ data }: { data: PlaybookData }) {
  const p = data.profile;
  return (
    <>
      <CallInsights data={data} />

      <PortalAccessCard data={data} />

      {/* Live figures come from Zoho Books once connected. */}
      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: data.zohoConnected ? "var(--green-soft)" : "var(--bg)", color: data.zohoConnected ? "var(--green)" : "var(--ink-3)", display: "grid", placeItems: "center" }}><Icon name="book-open" size={16} /></span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Live accounting data (Zoho Books)</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                {data.zohoConnected
                  ? "Connected — transactions, invoices and balances sync from Zoho Books."
                  : "Not connected. Connect Zoho Books in Settings to pull live transactions, invoices and balances here."}
              </div>
            </div>
          </div>
          <span className={"pill " + (data.zohoConnected ? "green" : "gray")} style={{ fontSize: 11 }}>
            <span className="dot" /> {data.zohoConnected ? "Connected" : "Not connected"}
          </span>
        </div>
        {data.zohoConnected && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 14 }}>
            {["Transactions this month", "Invoices issued", "Bank accounts"].map((l) => (
              <div key={l} style={{ background: "var(--bg-soft)", borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{l}</div>
                <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: "var(--ink-2)" }}>—<span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-4)" }}> syncing</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
      {data.intake?.status === "submitted" && (
        <Panel title="Intake form responses">
          {Object.entries(data.intake.submitted).map(([k, v]) => <Row key={k} k={k} v={v} />)}
        </Panel>
      )}
    </>
  );
}

function Coa({ data }: { data: PlaybookData }) {
  if (!data.coa?.accounts?.length) return <Panel title="Chart of accounts" empty="No COA prepared yet." />;
  const sections = [...new Set(data.coa.accounts.map((a) => a.section))];
  const exportCoa = () => {
    const rows: string[][] = [["Section", "Code", "Account"]];
    data.coa!.accounts.forEach((a) => rows.push([a.section, a.code, a.account]));
    downloadCsv(`${data.name.replace(/[^a-z0-9]+/gi, "-")}-coa.csv`, rows);
  };
  return (
    <div className="cpb-card" style={{ marginBottom: 14 }}>
      <div className="cpb-card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Chart of accounts{data.coa.client_signed_off ? " — client signed off ✓" : ""}</span>
        <button className="btn-ghost" onClick={exportCoa}><Icon name="download" size={13} /> Export to Excel</button>
      </div>
      {data.coa.ai_rationale && <div className="ai-response" style={{ marginTop: 0, marginBottom: 12 }}><div className="hdr"><Icon name="sparkles" size={13} /> AI rationale</div>{data.coa.ai_rationale}</div>}
      {sections.map((s) => (
        <div key={s} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 4 }}>{s}</div>
          {data.coa!.accounts.filter((a) => a.section === s).map((a, i) => (
            <div key={i} style={{ fontSize: 13, padding: "3px 0", display: "flex", gap: 8 }}><span style={{ fontFamily: "DM Mono, monospace", color: "var(--ink-3)", minWidth: 44 }}>{a.code}</span>{a.account}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function downloadComplianceCsv(items: { label: string; type: string; date: string; source?: string }[], clientName: string, reminderDays = 30) {
  const rows: string[][] = [["Item", "Type", "Due date", "Status", "Reminder offset (days)", "Notes"]];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const it of items) {
    const days = Math.round((new Date(it.date).getTime() - today.getTime()) / 86_400_000);
    const status = days < 0 ? `Overdue (${Math.abs(days)}d)` : days === 0 ? "Due today" : `Due in ${days}d`;
    rows.push([it.label, it.type, it.date, status, String(reminderDays), it.source ?? ""]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: "text/csv;charset=utf-8;" }); // UTF-8 BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${clientName.replace(/[^a-z0-9]+/gi, "-")}-compliance-calendar.csv`; a.click();
  URL.revokeObjectURL(url);
}

function downloadComplianceIcs(items: { label: string; type: string; date: string; source?: string }[], clientName: string, reminderDays = 30) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const fmtIcs = (d: Date) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
  const fmtIcsDate = (s: string) => s.replace(/-/g, "");
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Finanshels//Compliance Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Compliance Calendar — ${clientName}`,
  ];
  for (const it of items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date)) continue;
    const uid = `${it.date}-${(it.label || "compliance").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}@finanshels`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${fmtIcs(now)}`);
    lines.push(`DTSTART;VALUE=DATE:${fmtIcsDate(it.date)}`);
    lines.push(`SUMMARY:${(it.label || "Compliance item").replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n")}`);
    const desc = [it.type, it.source ?? ""].filter(Boolean).join(" · ");
    if (desc) lines.push(`DESCRIPTION:${desc.replace(/[\\,;]/g, (m) => `\\${m}`).replace(/\n/g, "\\n")}`);
    lines.push("BEGIN:VALARM");
    lines.push("ACTION:DISPLAY");
    lines.push(`DESCRIPTION:Reminder — ${it.label}`);
    lines.push(`TRIGGER:-P${reminderDays}D`);
    lines.push("END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${clientName.replace(/[^a-z0-9]+/gi, "-")}-compliance-calendar.ics`; a.click();
  URL.revokeObjectURL(url);
}

function TasksProjects({ data }: { data: PlaybookData }) {
  const exportProjects = () => {
    const rows: string[][] = [["Task", "Cadence", "When"]];
    data.projects.forEach((p) => rows.push([String(p.task ?? p.name ?? ""), String(p.cadence ?? ""), String(p.when ?? p.month ?? "")]));
    downloadCsv(`${data.name.replace(/[^a-z0-9]+/gi, "-")}-internal-tasks.csv`, rows);
  };
  return (
    <>
      {/* Client task board — kept separate from internal work */}
      <Panel title="Client task board">
        {data.tasks.length ? (
          <table className="runs-table"><thead><tr><th>Task</th><th>Type</th><th>Client sees</th><th>Status</th></tr></thead>
            <tbody>{data.tasks.map((t, i) => (<tr key={i}><td>{t.title}</td><td>{t.type.replace("_", " ")}</td><td>{t.client_visible ? "Yes" : "No"}</td><td>{t.status.replace("_", " ")}</td></tr>))}</tbody>
          </table>
        ) : <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No tasks yet.</div>}
      </Panel>

      {/* Internal projects — separate + downloadable */}
      <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Internal projects &amp; tasks</div>
          {data.projects.length > 0 && <button className="btn-ghost" onClick={exportProjects}><Icon name="download" size={13} /> Download CSV</button>}
        </div>
        {data.projects.length ? (
          <table className="runs-table"><thead><tr><th>Task</th><th>Cadence</th><th>When</th></tr></thead>
            <tbody>{data.projects.map((p, i) => (<tr key={i}><td style={{ fontWeight: 600 }}>{String(p.task ?? p.name ?? "—")}</td><td style={{ textTransform: "capitalize" }}>{String(p.cadence ?? "—")}</td><td>{String(p.when ?? p.month ?? "—")}</td></tr>))}</tbody>
          </table>
        ) : <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No internal tasks created yet.</div>}
      </div>

      {/* Catch-up — separate board */}
      <Panel title="Catch-up board" empty={data.catchup.length ? undefined : "No catch-up backlog."}>
        {data.catchup.length ? (
          <table className="runs-table"><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>{data.catchup.map((c, i) => (<tr key={i}><td>{String(c.title ?? "Task")}</td><td>{String(c.owner ?? "—")}</td><td>{String(c.due ?? "—")}</td><td>{String(c._status ?? c.status ?? "—")}</td></tr>))}</tbody>
          </table>
        ) : undefined}
      </Panel>
    </>
  );
}

function fmtDate(s?: string) {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function Compliance({ data }: { data: PlaybookData }) {
  return <ComplianceCalendarPro data={data} />;
}

function Meetings({ data }: { data: PlaybookData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const add = () => start(async () => {
    setMsg(null);
    const r = await addClientMeeting(data.clientId, { title, date, recordingLink: link, notes });
    if (r.error) setMsg(r.error);
    else {
      setMsg(r.source === "fathom" ? "Saved — notes fetched from Fathom and summarised." : "Meeting saved.");
      setTitle(""); setDate(""); setLink(""); setNotes(""); setOpen(false); router.refresh();
    }
  });
  const remove = (id: string) => start(async () => { await deleteClientMeeting(id, data.clientId); router.refresh(); });

  return (
    <div className="cpb-card" style={{ marginBottom: 14 }}>
      <div className="cpb-card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>Meeting recordings &amp; notes — {data.meetings.length}</span>
        {data.canEdit && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-ghost" disabled={busy} onClick={() => start(async () => {
              setMsg(null);
              const r = await syncFathomMeetingsForClient(data.clientId);
              if (r.error) setMsg(r.error);
              else setMsg(`Synced — added ${r.added ?? 0}, ${r.skipped ?? 0} already on file (scanned ${r.scanned ?? 0}).`);
              router.refresh();
            })}><Icon name="refresh-cw" size={13} /> Sync from Fathom</button>
            <button className="btn-ghost" onClick={() => setOpen((o) => !o)}><Icon name={open ? "x" : "plus"} size={13} /> {open ? "Close" : "Add meeting"}</button>
          </div>
        )}
      </div>

      {open && (
        <div style={{ borderBottom: "1px solid var(--border)", padding: "12px 0", marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kickoff call (auto-filled if left blank)" /></div>
            <div className="field" style={{ margin: 0 }}><label>Date</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          </div>
          <div className="field" style={{ margin: 0 }}><label>Recording link (Fathom)</label><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://fathom.video/share/… — paste this alone and we fetch the notes from Fathom" /></div>
          <div className="field" style={{ margin: 0 }}><label>Notes (optional if a Fathom link is given)</label><textarea className="notes" value={notes} onChange={(e) => setNotes(e.target.value)} style={{ minHeight: 90 }} placeholder="Leave blank to auto-fetch from Fathom, or paste the notes here." /></div>
          <button className="btn-ai" disabled={busy || (!link.trim() && !notes.trim())} onClick={add}><Icon name="sparkles" size={13} /> {busy ? "Saving…" : "Save meeting"}</button>
          {msg && <div style={{ fontSize: 12.5, color: /Saved|saved|fetched/.test(msg) ? "var(--green)" : "var(--red)" }}>{msg}</div>}
        </div>
      )}

      {data.meetings.length === 0 ? (
        <div className="cpb-empty">No meetings saved yet. Add the recording link and we&apos;ll pull the notes from Fathom.</div>
      ) : (
        data.meetings.map((m) => (
          <div key={m.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Icon name="video" size={15} style={{ color: "var(--orange)" }} />
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{m.title}</div>
              {m.meeting_date && <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{new Date(m.meeting_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
              {m.source === "fathom" && <span className="pill purple" style={{ fontSize: 10 }}>Fathom</span>}
              {m.recording_link && <a href={m.recording_link} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--orange)", fontWeight: 600, display: "inline-flex", gap: 4 }}><Icon name="external-link" size={12} /> Recording</a>}
              {data.canEdit && <button className="icon-btn" style={{ color: "var(--red)", marginLeft: "auto" }} onClick={() => remove(m.id)} disabled={busy}><Icon name="trash-2" size={13} /></button>}
            </div>
            {m.summary && <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6, marginTop: 6 }}>{m.summary}</div>}
            {m.notes && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 12, color: "var(--ink-3)", cursor: "pointer", fontWeight: 600 }}>Prepared notes</summary>
                <div style={{ fontSize: 12.5, color: "var(--ink-1)", lineHeight: 1.6, marginTop: 6, whiteSpace: "pre-wrap" }}>{m.notes}</div>
              </details>
            )}
          </div>
        ))
      )}
    </div>
  );
}

const DIAGRAM_NODE: Record<string, { bg: string; label: string }> = {
  start: { bg: "var(--green)", label: "Start" },
  step: { bg: "var(--blue)", label: "Step" },
  decision: { bg: "var(--amber)", label: "Decision" },
  end: { bg: "var(--red)", label: "End" },
};

function Workflows({ data }: { data: PlaybookData }) {
  if (!data.diagrams.length) return <Panel title="Workflows" empty="No workflow diagrams drawn yet." />;
  return <>{data.diagrams.map((d, i) => (
    <Panel key={i} title={d.name}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, padding: "8px 0" }}>
        {d.nodes.map((n, j) => {
          const s = DIAGRAM_NODE[n.type] ?? DIAGRAM_NODE.step;
          return (
            <div key={n.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ background: s.bg, color: "#fff", fontSize: 12.5, fontWeight: 600, padding: "9px 16px", borderRadius: n.type === "decision" ? 4 : 9, transform: n.type === "decision" ? "rotate(0deg)" : "none", maxWidth: 280, textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,.08)" }}>
                {n.label}
              </div>
              {j < d.nodes.length - 1 && <span style={{ color: "var(--ink-4)", margin: "2px 0" }}><Icon name="arrow-down" size={16} /></span>}
            </div>
          );
        })}
      </div>
    </Panel>
  ))}</>;
}

function Communication({ data }: { data: PlaybookData }) {
  return <Panel title="Communication" empty={data.messages.length ? undefined : "No messages on this run yet."}>
    {data.messages.length ? data.messages.map((m, i) => (
      <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{m.author_name} <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>· {m.author_role}</span></div>
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{m.body}</div>
      </div>
    )) : undefined}
  </Panel>;
}

function TemplatesSops({ data }: { data: PlaybookData }) {
  return <Panel title="Templates & SOPs" empty={data.template ? undefined : "No template linked."}>
    {data.template ? (
      <>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{data.template.name} · {data.template.stages.length} stages</div>
        {data.template.stages.map((s, i) => <Row key={i} k={`${i + 1}. ${s.name}`} v={`${s.steps.length} steps`} />)}
      </>
    ) : undefined}
  </Panel>;
}

function Tools({ data }: { data: PlaybookData }) {
  const missingDocs = data.documents.filter((d) => d.status !== "uploaded");
  const p = data.profile;
  const accountingSoftware = (p.accounting_software as string) ?? "";
  const banks = (p.bank_names as string[] | string | null);
  const gateways = (p.payment_gateways as string[] | string | null);
  const fmtList = (v: string[] | string | null | undefined) => Array.isArray(v) ? v.filter(Boolean).join(", ") : (v ?? "");
  // Systems the client mentioned during meetings/calls — captured in the call-insight sections.
  const sections = ((p.call_insights as { sections?: InsightSection[] } | null)?.sections) ?? [];
  const systemSections = sections.filter((s) => /system|software|tool|platform|stack|app/i.test(s.heading ?? ""));

  return (
    <>
      <Panel title="Drive folder">
        {data.driveLink ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Icon name="folder" size={16} style={{ color: "var(--orange)" }} />
            <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Client documents auto-file here.</span>
            <a href={data.driveLink} target="_blank" rel="noreferrer" className="btn-ghost" style={{ textDecoration: "none" }}><Icon name="external-link" size={13} /> Open Drive folder</a>
          </div>
        ) : <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No Drive folder linked yet — it&apos;s created when onboarding starts.</div>}
      </Panel>

      <Panel title="Systems &amp; software in use">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 24px" }}>
          <Row k="Accounting software (we'll use)" v={accountingSoftware} />
          <Row k="Bank(s)" v={fmtList(banks)} />
          <Row k="Payment gateways" v={fmtList(gateways)} />
        </div>
        {!accountingSoftware && <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 8 }}>Accounting software is set on the &ldquo;Confirm accounting software&rdquo; step after the kickoff call.</div>}
        {systemSections.length > 0 && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)", marginBottom: 6 }}>From the meeting notes</div>
            {systemSections.map((s, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.heading}</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{s.body}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={`Documents — ${data.documents.length - missingDocs.length} of ${data.documents.length} received`} empty={data.documents.length ? undefined : "No documents."}>
        {missingDocs.length > 0 && (
          <div style={{ background: "var(--amber-soft)", border: "1px solid #f0d9a8", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 12.5, color: "var(--amber)", fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
            <Icon name="alert-circle" size={14} /> {missingDocs.length} document{missingDocs.length === 1 ? "" : "s"} not yet received: {missingDocs.map((d) => d.label).join(", ")}
          </div>
        )}
        {data.documents.map((d, i) => <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", fontSize: 13, alignItems: "center" }}><Icon name={d.status === "uploaded" ? "check-circle" : d.status === "rejected" ? "rotate-ccw" : "circle"} size={14} style={{ color: d.status === "uploaded" ? "var(--green)" : d.status === "rejected" ? "var(--red)" : "var(--ink-4)" }} />{d.label}{d.status === "rejected" && <span style={{ color: "var(--red)", fontSize: 11 }}>(re-upload requested)</span>}</div>)}
      </Panel>

      <AccessManager data={data} />

      <Panel title="Integrations">
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.7 }}>Drive folder, Zoho Books and Gmail are connected per team member in Settings. Client documents auto-file to the assigned member&apos;s Drive.</div>
      </Panel>
    </>
  );
}

const SHARE_VIA = ["Email", "Zoho Vault", "Viewer access", "Login credentials"];

function AccessManager({ data }: { data: PlaybookData }) {
  const router = useRouter();
  const access = data.access ?? [];
  const granted = access.filter((a) => (a.status ?? a._status) === "granted").length;
  const [busy, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [via, setVia] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const add = () => start(async () => {
    setMsg(null);
    const r = await addPlaybookAccess(data.clientId, { label, sharedVia: via || undefined });
    if (r.error) setMsg(r.error);
    else { setLabel(""); setVia(""); setAdding(false); router.refresh(); }
  });
  const markShared = (rowId: string, sharedVia: string) => start(async () => {
    const r = await setPlaybookAccessStatus(rowId, data.clientId, "granted", sharedVia);
    if (r.error) setMsg(r.error); else router.refresh();
  });
  const markPending = (rowId: string) => start(async () => {
    const r = await setPlaybookAccessStatus(rowId, data.clientId, "requested");
    if (r.error) setMsg(r.error); else router.refresh();
  });
  const remove = (rowId: string) => start(async () => {
    const r = await deletePlaybookAccess(rowId, data.clientId);
    if (r.error) setMsg(r.error); else router.refresh();
  });

  return (
    <div className="cpb-card" style={{ marginBottom: 14 }}>
      <div className="cpb-card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>System access — {granted} of {access.length} shared</span>
        {data.canEdit && <button className="btn-ghost" onClick={() => setAdding((o) => !o)}><Icon name={adding ? "x" : "plus"} size={13} /> {adding ? "Close" : "Add access"}</button>}
      </div>

      {adding && (
        <div style={{ borderBottom: "1px solid var(--border)", padding: "12px 0", marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0, flex: 2, minWidth: 180 }}><label>Access / system</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. FTA portal, ADCB bank, Telr gateway" /></div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 140 }}><label>Shared via</label>
            <select value={via} onChange={(e) => setVia(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>
              <option value="">Not shared yet (pending)</option>
              {SHARE_VIA.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button className="btn-primary" disabled={busy || !label.trim()} onClick={add}>{busy ? "Saving…" : "Add"}</button>
        </div>
      )}

      {access.length === 0 ? (
        <div className="cpb-empty">No access items yet. Add one here, or configure them on the run&apos;s access step. The client can also confirm access from their portal.</div>
      ) : (
        access.map((a, i) => {
          const isGranted = (a.status ?? a._status) === "granted";
          const fromPortal = isGranted && !a.manual;
          return (
            <div key={a.rowId ?? i} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i < access.length - 1 ? "1px solid var(--border)" : "none", alignItems: "center" }}>
              <Icon name={isGranted ? "check-circle" : "clock"} size={15} style={{ color: isGranted ? "var(--green)" : "var(--amber)" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{a.label ?? a.id}</div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {isGranted
                    ? <>{fromPortal ? "Confirmed in onboarding portal" : `Shared by team${a.sharedVia ? ` · via ${a.sharedVia}` : ""}`}{a.email ? ` · ${a.email}` : ""}</>
                    : <>Pending{a.email ? ` · grant to ${a.email}` : ""}{a.manual ? " · added by team" : ""}</>}
                </div>
              </div>
              <span className={"pill " + (isGranted ? "green" : "amber")} style={{ fontSize: 10.5 }}><span className="dot" />{isGranted ? "Shared" : "Pending"}</span>
              {data.canEdit && (isGranted ? (
                !fromPortal && <button className="btn-ghost" disabled={busy} onClick={() => a.rowId && markPending(a.rowId)} style={{ fontSize: 11, padding: "3px 8px" }}>Mark pending</button>
              ) : (
                <select value="" disabled={busy} onChange={(e) => a.rowId && e.target.value && markShared(a.rowId, e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "5px 8px", fontSize: 12, color: "var(--ink-2)" }}>
                  <option value="">Mark shared via…</option>
                  {SHARE_VIA.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              ))}
              {data.canEdit && a.rowId && <button className="icon-btn" style={{ color: "var(--red)" }} disabled={busy} onClick={() => remove(a.rowId!)}><Icon name="trash-2" size={13} /></button>}
            </div>
          );
        })
      )}
      <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 10 }}>If the client already granted access from their portal it shows as &ldquo;Confirmed in onboarding portal&rdquo; — no action needed. Otherwise add it here and mark how it was shared.</div>
      {msg && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

function Escalations({ data }: { data: PlaybookData }) {
  const triage = data.triage;
  return (
    <>
      <Panel title="Escalations & urgent items" empty={data.escalations.length ? undefined : "No escalations."}>
        {data.escalations.map((e, i) => (
          <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
            <span className={"pill " + (e.kind === "escalation" ? "red" : "purple")} style={{ fontSize: 10 }}>{e.kind}</span>
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>{e.title}</div>
            {e.body && <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{e.body}</div>}
          </div>
        ))}
      </Panel>
      {triage.length > 0 && (
        <Panel title="Compliance triage">
          {triage.map((t, i) => <Row key={i} k={String(t.item ?? "")} v={`${t.severity ?? ""} → ${t.memberName ?? ""}`} />)}
        </Panel>
      )}
    </>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending: "var(--ink-3)", invoiced: "var(--orange)", paid: "#16a34a", overdue: "#dc2626",
};

function PaymentsSection({ data }: { data: PlaybookData }) {
  const [plan, setPlan] = useState<Record<string, unknown>>(data.paymentPlan ?? {});
  const [entries, setEntries] = useState<Record<string, unknown>[]>(data.paymentEntries ?? []);
  const [editPlan, setEditPlan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [genSaving, setGenSaving] = useState(false);
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [entryForm, setEntryForm] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  async function handleSavePlan() {
    setSaving(true);
    const res = await savePaymentPlan({
      clientId: data.clientId,
      billingCycle: String(plan.billing_cycle ?? "monthly"),
      amount: Number(plan.amount ?? 0),
      currency: String(plan.currency ?? "AED"),
      startDate: plan.start_date ? String(plan.start_date) : null,
      notes: plan.notes ? String(plan.notes) : null,
    });
    setSaving(false);
    if (!res.error) setEditPlan(false);
  }

  async function handleGenerate() {
    setGenSaving(true);
    const res = await generatePaymentSchedule(data.clientId);
    setGenSaving(false);
    if (!res.error) { window.location.reload(); }
    else alert(res.error);
  }

  async function handleSaveEntry(id?: string) {
    const res = await savePaymentEntry({
      id,
      clientId: data.clientId,
      dueDate: entryForm.due_date,
      periodLabel: entryForm.period_label || null,
      amount: entryForm.amount ? Number(entryForm.amount) : null,
      invoiceNo: entryForm.invoice_no || null,
      invoiceLink: entryForm.invoice_link || null,
      status: entryForm.status || "pending",
      paidDate: entryForm.paid_date || null,
      notes: entryForm.notes || null,
    });
    if (!res.error) {
      setEditEntryId(null);
      window.location.reload();
    }
  }

  async function handleDeleteEntry(id: string) {
    if (!confirm("Delete this payment entry?")) return;
    startTransition(async () => {
      await deletePaymentEntry(id, data.clientId);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    });
  }

  const currency = String(plan.currency ?? "AED");
  const totalPaid = entries.filter((e) => e.status === "paid").reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const totalOverdue = entries.filter((e) => e.status === "overdue").reduce((s, e) => s + Number(e.amount ?? 0), 0);

  return (
    <>
      {/* Plan header */}
      <Panel title="Payment plan">
        {editPlan ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>Billing cycle
              <select value={String(plan.billing_cycle ?? "monthly")} onChange={(e) => setPlan((p) => ({ ...p, billing_cycle: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 4 }}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label style={{ fontSize: 12 }}>Amount ({currency})
              <input type="number" value={String(plan.amount ?? "")} onChange={(e) => setPlan((p) => ({ ...p, amount: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12 }}>Currency
              <input value={String(plan.currency ?? "AED")} onChange={(e) => setPlan((p) => ({ ...p, currency: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12 }}>Start date
              <input type="date" value={String(plan.start_date ?? "")} onChange={(e) => setPlan((p) => ({ ...p, start_date: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, gridColumn: "span 2" }}>Notes
              <input value={String(plan.notes ?? "")} onChange={(e) => setPlan((p) => ({ ...p, notes: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 4 }} />
            </label>
            <div style={{ gridColumn: "span 3", display: "flex", gap: 8 }}>
              <button className="btn-primary" onClick={handleSavePlan} disabled={saving}>{saving ? "Saving…" : "Save plan"}</button>
              <button className="btn-ghost" onClick={() => setEditPlan(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            {plan.billing_cycle ? (
              <>
                <Row k="Cycle" v={String(plan.billing_cycle)} />
                <Row k="Amount" v={`${currency} ${Number(plan.amount ?? 0).toLocaleString()}`} />
                {plan.start_date && <Row k="Start" v={String(plan.start_date)} />}
                {plan.notes && <Row k="Notes" v={String(plan.notes)} />}
              </>
            ) : <span style={{ fontSize: 13, color: "var(--ink-3)" }}>No payment plan set.</span>}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              {data.canEdit && <button className="btn-ghost" onClick={() => setEditPlan(true)}>Edit plan</button>}
              {data.canEdit && !!plan.billing_cycle && <button className="btn-ghost" onClick={handleGenerate} disabled={genSaving}>{genSaving ? "Generating…" : "Regenerate schedule"}</button>}
            </div>
          </div>
        )}
        {/* Summary pills */}
        {entries.length > 0 && (
          <div style={{ display: "flex", gap: 16, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
            <span style={{ fontSize: 12 }}>Paid: <strong style={{ color: "#16a34a" }}>{currency} {totalPaid.toLocaleString()}</strong></span>
            <span style={{ fontSize: 12 }}>Overdue: <strong style={{ color: "#dc2626" }}>{currency} {totalOverdue.toLocaleString()}</strong></span>
            <span style={{ fontSize: 12 }}>Total entries: <strong>{entries.length}</strong></span>
          </div>
        )}
      </Panel>

      {/* Schedule table */}
      <Panel title="Payment schedule" extra={data.canEdit ? <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => { setEditEntryId("new"); setEntryForm({ due_date: "", status: "pending" }); }}>+ Add entry</button> : undefined}>
        {entries.length === 0 && <span style={{ fontSize: 13, color: "var(--ink-3)" }}>No entries. Set a plan and click "Regenerate schedule".</span>}
        {editEntryId === "new" && (
          <EntryForm form={entryForm} setForm={setEntryForm} onSave={() => handleSaveEntry(undefined)} onCancel={() => setEditEntryId(null)} />
        )}
        {entries.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--ink-3)", fontSize: 12 }}>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Period</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Due date</th>
                  <th style={{ textAlign: "right", padding: "4px 8px" }}>Amount</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Invoice</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Status</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Paid date</th>
                  {data.canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const eid = String(e.id);
                  if (editEntryId === eid) {
                    return (
                      <tr key={eid}>
                        <td colSpan={7}><EntryForm form={entryForm} setForm={setEntryForm} onSave={() => handleSaveEntry(eid)} onCancel={() => setEditEntryId(null)} /></td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={eid} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px" }}>{String(e.period_label ?? "—")}</td>
                      <td style={{ padding: "6px 8px" }}>{String(e.due_date ?? "—")}</td>
                      <td style={{ padding: "6px 8px", textAlign: "right" }}>{e.amount != null ? `${currency} ${Number(e.amount).toLocaleString()}` : "—"}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {e.invoice_link ? <a href={String(e.invoice_link)} target="_blank" rel="noreferrer" style={{ color: "var(--orange)" }}>{String(e.invoice_no ?? "View")}</a> : (e.invoice_no ? String(e.invoice_no) : "—")}
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLORS[String(e.status)] ?? "var(--ink-3)", textTransform: "uppercase" }}>{String(e.status)}</span>
                      </td>
                      <td style={{ padding: "6px 8px" }}>{e.paid_date ? String(e.paid_date) : "—"}</td>
                      {data.canEdit && (
                        <td style={{ padding: "6px 8px", display: "flex", gap: 6 }}>
                          <button className="btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => { setEditEntryId(eid); setEntryForm({ due_date: String(e.due_date ?? ""), period_label: String(e.period_label ?? ""), amount: String(e.amount ?? ""), invoice_no: String(e.invoice_no ?? ""), invoice_link: String(e.invoice_link ?? ""), status: String(e.status ?? "pending"), paid_date: String(e.paid_date ?? ""), notes: String(e.notes ?? "") }); }}>Edit</button>
                          <button className="btn-ghost" style={{ fontSize: 11, padding: "2px 8px", color: "#dc2626" }} onClick={() => handleDeleteEntry(eid)} disabled={pending}>Del</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function EntryForm({ form, setForm, onSave, onCancel }: { form: Record<string, string>; setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>; onSave: () => void; onCancel: () => void }) {
  const f = (k: string) => form[k] ?? "";
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, padding: "10px 0", background: "var(--bg-raised)", borderRadius: 6, paddingLeft: 8 }}>
      <label style={{ fontSize: 12 }}>Due date <input type="date" value={f("due_date")} onChange={set("due_date")} style={{ display: "block", width: "100%", marginTop: 4 }} /></label>
      <label style={{ fontSize: 12 }}>Period label <input value={f("period_label")} onChange={set("period_label")} placeholder="June 2026" style={{ display: "block", width: "100%", marginTop: 4 }} /></label>
      <label style={{ fontSize: 12 }}>Amount <input type="number" value={f("amount")} onChange={set("amount")} style={{ display: "block", width: "100%", marginTop: 4 }} /></label>
      <label style={{ fontSize: 12 }}>Status
        <select value={f("status") || "pending"} onChange={set("status")} style={{ display: "block", width: "100%", marginTop: 4 }}>
          <option value="pending">Pending</option><option value="invoiced">Invoiced</option><option value="paid">Paid</option><option value="overdue">Overdue</option>
        </select>
      </label>
      <label style={{ fontSize: 12 }}>Invoice # <input value={f("invoice_no")} onChange={set("invoice_no")} style={{ display: "block", width: "100%", marginTop: 4 }} /></label>
      <label style={{ fontSize: 12 }}>Invoice link <input value={f("invoice_link")} onChange={set("invoice_link")} placeholder="https://…" style={{ display: "block", width: "100%", marginTop: 4 }} /></label>
      <label style={{ fontSize: 12 }}>Paid date <input type="date" value={f("paid_date")} onChange={set("paid_date")} style={{ display: "block", width: "100%", marginTop: 4 }} /></label>
      <label style={{ fontSize: 12 }}>Notes <input value={f("notes")} onChange={set("notes")} style={{ display: "block", width: "100%", marginTop: 4 }} /></label>
      <div style={{ gridColumn: "span 4", display: "flex", gap: 8, marginTop: 4 }}>
        <button className="btn-primary" onClick={onSave}>Save</button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Runs({ data }: { data: PlaybookData }) {
  return <Panel title="Run history" empty={data.runs.length ? undefined : "No runs."}>
    <table className="runs-table"><thead><tr><th>Run</th><th>Status</th><th>Progress</th><th></th></tr></thead>
      <tbody>{data.runs.map((r) => (
        <tr key={r.id}><td>{r.templateName}</td><td>{r.status.replace("_", " ")}</td><td>{r.progress}%</td>
          <td><Link href={`/onboarding/${r.id}`} className="btn-ghost" style={{ textDecoration: "none" }}>Open</Link></td></tr>
      ))}</tbody></table>
  </Panel>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Compliance Calendar — client-presentable view, with PPTX + PDF export.
// ──────────────────────────────────────────────────────────────────────────────

const COMPLIANCE_BRAND = { navy: "#082032", orange: "#F97316", cream: "#FFF7E9", ink: "#1B2733", ink2: "#51606E", line: "#ECE3D2" };
const PPTX_BRAND = { navy: "082032", orange: "F97316", cream: "FFF7E9", white: "FFFFFF", ink: "1B2733", ink2: "51606E", line: "ECE3D2" };

interface ComplianceItem { label: string; type: string; date: string; source?: string }

function classifyComplianceItem(item: ComplianceItem): "trade-licence" | "establishment" | "vat" | "ct" | "wps" | "other" {
  const text = `${item.label} ${item.type} ${item.source ?? ""}`.toLowerCase();
  if (/trade\s*licen|incorporation/.test(text)) return "trade-licence";
  if (/establishment/.test(text)) return "establishment";
  if (/\bvat\b|fta/.test(text)) return "vat";
  if (/corporate\s*tax|\bct\b/.test(text)) return "ct";
  if (/wps|payroll/.test(text)) return "wps";
  return "other";
}

const CATEGORY_META: Record<ReturnType<typeof classifyComplianceItem>, { label: string; tone: string; icon: string }> = {
  "trade-licence": { label: "Trade Licence", tone: "var(--orange)", icon: "shield" },
  establishment: { label: "Establishment Card", tone: "#0EA5E9", icon: "id-card" },
  vat: { label: "VAT / FTA", tone: "#10B981", icon: "receipt" },
  ct: { label: "Corporate Tax", tone: "#8B5CF6", icon: "landmark" },
  wps: { label: "WPS / Payroll", tone: "#F59E0B", icon: "users" },
  other: { label: "Other compliance", tone: "var(--ink-2)", icon: "calendar" },
};

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr).getTime();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((d - today.getTime()) / 86_400_000);
}

function statusFor(days: number, label?: string): { label: string; bg: string; fg: string } {
  const isHistorical = !!label && /incorporation|first filing date/i.test(label);
  if (days < 0) {
    if (isHistorical) return { label: "On record", bg: "#E5E7EB", fg: "#4B5563" };
    return { label: `Overdue (${Math.abs(days)}d)`, bg: "#FEE2E2", fg: "#B91C1C" };
  }
  if (days <= 30) return { label: `Due in ${days}d`, bg: "#FEF3C7", fg: "#92400E" };
  if (days <= 90) return { label: `Due in ${days}d`, bg: "#DBEAFE", fg: "#1E40AF" };
  return { label: `Due in ${days}d`, bg: "#DCFCE7", fg: "#15803D" };
}

function ComplianceCalendarPro({ data }: { data: PlaybookData }) {
  const router = useRouter();
  const reg = (data.profile.reg_facts as { incorporationDate?: string; tradeLicenceExpiry?: string; vatFirstFiling?: string; ctFirstFiling?: string } | null) ?? {};
  const code = (data.profile.custom_code as string | null) ?? "";

  const rawItems: ComplianceItem[] = data.compliance.map((c) => ({
    label: String(c.label ?? ""),
    type: String(c.type ?? ""),
    date: String(c.date ?? ""),
    source: c.source ? String(c.source) : undefined,
  })).filter((c) => c.date && /^\d{4}-\d{2}-\d{2}$/.test(c.date));

  const items = [...rawItems].sort((a, b) => a.date.localeCompare(b.date));
  const grouped: Record<string, ComplianceItem[]> = {};
  for (const it of items) {
    const cat = classifyComplianceItem(it);
    (grouped[cat] ??= []).push(it);
  }

  const isHistorical = (lbl: string) => /incorporation|first filing date/i.test(lbl);
  const stats = {
    overdue: items.filter((i) => daysUntil(i.date) < 0 && !isHistorical(i.label)).length,
    next30: items.filter((i) => { const d = daysUntil(i.date); return d >= 0 && d <= 30; }).length,
    next90: items.filter((i) => { const d = daysUntil(i.date); return d >= 0 && d <= 90; }).length,
    total: items.filter((i) => !isHistorical(i.label)).length,
  };

  const exportPdf = () => {
    // Trigger the browser's print dialog with our print stylesheet — user gets PDF via "Save as PDF".
    const orig = document.title;
    document.title = `Compliance Calendar — ${data.name}`;
    window.print();
    setTimeout(() => { document.title = orig; }, 1000);
  };
  const exportPptx = () => downloadCompliancePptx({ clientName: data.name, code, reg, items, grouped });

  if (!items.length) {
    return (
      <div className="cpb-card">
        <div className="cpb-card-head" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Compliance calendar</span>
          <RebuildFromDriveButton clientId={data.clientId} clientName={data.name} onDone={() => router.refresh()} />
        </div>
        <div className="cpb-empty">
          No compliance items yet. Click <strong>Rebuild from Drive</strong> above and we&apos;ll read every file in the client&apos;s Drive &ldquo;Company Documents&rdquo; folder, extract expiry / first-filing dates, and append the upcoming statutory VAT + CT filings.
        </div>
      </div>
    );
  }

  return (
    <div className="cc-print-root">
      {/* Action bar — hidden in print */}
      <div className="cc-actions" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 12 }}>
        <RebuildFromDriveButton clientId={data.clientId} clientName={data.name} onDone={() => router.refresh()} />
        <button className="btn-ghost" onClick={exportPdf}><Icon name="printer" size={14} /> Print / Save as PDF</button>
        <button className="btn-ghost" onClick={() => downloadComplianceCsv(items, data.name)}><Icon name="file-down" size={14} /> Export Excel</button>
        <button className="btn-ghost" onClick={() => downloadComplianceIcs(items, data.name)}><Icon name="calendar" size={14} /> Download .ics</button>
        <button className="btn-primary" onClick={exportPptx}><Icon name="file-down" size={14} /> Export PPTX</button>
        <button className="btn-ghost" onClick={() => router.refresh()} title="Refresh from database"><Icon name="refresh-cw" size={14} /></button>
      </div>

      {/* Branded header card */}
      <div style={{ background: `linear-gradient(135deg, ${COMPLIANCE_BRAND.navy} 0%, #143447 100%)`, color: "#fff", borderRadius: 14, padding: "22px 26px", marginBottom: 16, position: "relative", overflow: "hidden" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.14em", color: COMPLIANCE_BRAND.orange, fontWeight: 700, marginBottom: 8 }}>FINANSHELS · COMPLIANCE CALENDAR</div>
        <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.2 }}>{data.name}</div>
        <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.75)", marginTop: 6, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {code && <span><span style={{ color: "rgba(255,255,255,0.5)" }}>Client code </span><strong style={{ fontFamily: "ui-monospace, monospace" }}>{code}</strong></span>}
          {data.industry && <span><span style={{ color: "rgba(255,255,255,0.5)" }}>Industry </span>{data.industry}</span>}
          {reg.tradeLicenceExpiry && <span><span style={{ color: "rgba(255,255,255,0.5)" }}>Trade Licence expires </span>{fmtDate(reg.tradeLicenceExpiry)}</span>}
        </div>
        <div style={{ position: "absolute", right: -10, bottom: -10, width: 120, height: 120, borderRadius: "50%", background: `${COMPLIANCE_BRAND.orange}22` }} />
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
        <StatCard label="Overdue" value={stats.overdue} tone="#DC2626" icon="alert-triangle" />
        <StatCard label="Due in 30 days" value={stats.next30} tone="#D97706" icon="clock" />
        <StatCard label="Due in 90 days" value={stats.next90} tone="#2563EB" icon="calendar" />
        <StatCard label="Total tracked" value={stats.total} tone="var(--ink-2)" icon="list" />
      </div>

      {/* Registration block */}
      {(reg.incorporationDate || reg.tradeLicenceExpiry || reg.vatFirstFiling || reg.ctFirstFiling || (data.profile.trade_licence_authority as string | null)) && (
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 18 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: COMPLIANCE_BRAND.orange, letterSpacing: "0.08em", marginBottom: 10 }}>REGISTRATION &amp; KEY DATES</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
            <RegCell k="Incorporation" v={fmtDate(reg.incorporationDate)} />
            <RegCell k="Trade Licence expiry" v={fmtDate(reg.tradeLicenceExpiry)} highlight={reg.tradeLicenceExpiry ? daysUntil(reg.tradeLicenceExpiry) < 90 : false} />
            <RegCell k="VAT — first filing" v={fmtDate(reg.vatFirstFiling)} />
            <RegCell k="Corporate Tax — first filing" v={fmtDate(reg.ctFirstFiling)} />
          </div>
          {(data.profile.trade_licence_authority as string | null) && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)", letterSpacing: "0.05em" }}>ISSUING AUTHORITY</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: COMPLIANCE_BRAND.ink, padding: "3px 12px", background: `${COMPLIANCE_BRAND.orange}18`, borderRadius: 6, border: `1px solid ${COMPLIANCE_BRAND.orange}40` }}>
                {data.profile.trade_licence_authority as string}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>— auto-extracted from trade licence document</span>
            </div>
          )}
        </div>
      )}

      {/* Timeline + grouped cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 18 }}>
        {/* Timeline */}
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: COMPLIANCE_BRAND.orange, letterSpacing: "0.08em", marginBottom: 14 }}>TIMELINE · NEXT 12 MONTHS</div>
          <div style={{ position: "relative", paddingLeft: 22 }}>
            <div style={{ position: "absolute", left: 8, top: 6, bottom: 6, width: 2, background: COMPLIANCE_BRAND.line }} />
            {items.map((it, i) => {
              const d = daysUntil(it.date);
              const cat = classifyComplianceItem(it);
              const meta = CATEGORY_META[cat];
              const st = statusFor(d);
              return (
                <div key={i} style={{ position: "relative", marginBottom: 16 }}>
                  <div style={{ position: "absolute", left: -22, top: 4, width: 18, height: 18, borderRadius: "50%", background: meta.tone, border: "3px solid #fff", boxShadow: "0 0 0 1px var(--border)" }} />
                  <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>{fmtDate(it.date)}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: COMPLIANCE_BRAND.ink, marginTop: 2 }}>{it.label}</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: `${meta.tone}1A`, color: meta.tone }}>{meta.label}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: statusFor(d, it.label).bg, color: statusFor(d, it.label).fg }}>{statusFor(d, it.label).label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* By category */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Object.entries(grouped).map(([cat, list]) => {
            const meta = CATEGORY_META[cat as keyof typeof CATEGORY_META];
            return (
              <div key={cat} style={{ background: "#fff", border: "1px solid var(--border)", borderLeft: `4px solid ${meta.tone}`, borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <Icon name={meta.icon} size={15} />
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: COMPLIANCE_BRAND.ink }}>{meta.label}</div>
                  <span style={{ fontSize: 11, color: "var(--ink-4)" }}>· {list.length} item{list.length === 1 ? "" : "s"}</span>
                </div>
                {list.map((it, i) => (
                  <div key={i} style={{ padding: "8px 0", borderTop: i === 0 ? "none" : "1px solid var(--border-light, #f1ede4)" }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{it.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 2 }}>
                      {fmtDate(it.date)} · {statusFor(daysUntil(it.date), it.label).label}
                      {it.source && <span style={{ marginLeft: 6, color: "var(--ink-4)" }}>· {it.source}</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ marginTop: 18, padding: "12px 16px", borderRadius: 10, background: "var(--bg-soft)", fontSize: 11.5, color: "var(--ink-3)", textAlign: "center" }}>
        Compliance calendar prepared by <strong>Finanshels</strong>. We monitor every date here and send a reminder 30, 14, and 3 days before each deadline.
      </div>

      {/* Print stylesheet — strips the action bar and any app chrome when printing */}
      <style>{`
        @media print {
          body { background: #fff !important; }
          .rail, .topbar, .topbar-wrap, [class*="action-centre"], .cpb-tabs, .cc-actions { display: none !important; }
          .cc-print-root { padding: 0 !important; }
          .main, .scroll, .page { padding: 0 !important; margin: 0 !important; max-width: 100% !important; }
          @page { margin: 14mm; }
        }
      `}</style>
    </div>
  );
}

function StatCard({ label, value, tone, icon }: { label: string; value: number; tone: string; icon: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 36, height: 36, borderRadius: 9, background: `${tone}1A`, color: tone, display: "grid", placeItems: "center" }}><Icon name={icon} size={17} /></div>
      <div>
        <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: tone, lineHeight: 1.1 }}>{value}</div>
      </div>
    </div>
  );
}

function RegCell({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{k}</div>
      <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4, color: highlight ? "#B45309" : COMPLIANCE_BRAND.ink }}>{v}</div>
    </div>
  );
}

// PPTX export — re-uses the existing CDN-loaded pptxgenjs (same as the onboarding deck export).
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

/* eslint-disable @typescript-eslint/no-explicit-any */
async function downloadCompliancePptx(d: {
  clientName: string;
  code: string;
  reg: { incorporationDate?: string; tradeLicenceExpiry?: string; vatFirstFiling?: string; ctFirstFiling?: string };
  items: ComplianceItem[];
  grouped: Record<string, ComplianceItem[]>;
}) {
  const Pptx = (await loadPptxgen()) as any;
  const p = new Pptx();
  p.layout = "LAYOUT_WIDE"; // 13.3 × 7.5"

  const brand = (s: any, dark = false) => s.addText("FINANSHELS", { x: 10.7, y: 7.0, w: 2.3, fontSize: 9, color: dark ? "FFFFFF" : PPTX_BRAND.ink2, align: "right", bold: true, charSpacing: 2 });

  // Slide 1 — cover
  let s = p.addSlide(); s.background = { color: PPTX_BRAND.navy };
  s.addText("COMPLIANCE CALENDAR", { x: 0.7, y: 1.4, w: 12, h: 0.4, fontSize: 14, color: PPTX_BRAND.orange, bold: true, charSpacing: 3, valign: "middle" });
  s.addText(d.clientName, { x: 0.7, y: 2.0, w: 12, h: 1.6, fontSize: 42, bold: true, color: PPTX_BRAND.white, valign: "middle" });
  s.addText([
    d.code ? `Client code: ${d.code}` : "",
    `Prepared ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
  ].filter(Boolean).join("    ·    "), { x: 0.7, y: 4.0, w: 12, h: 0.5, fontSize: 13, color: "AAB6C0", valign: "middle" });
  s.addShape("rect", { x: 0.7, y: 4.6, w: 0.7, h: 0.06, fill: { color: PPTX_BRAND.orange } });
  s.addText("Every deadline below is monitored by your Finanshels delivery team.\nReminders 30, 14 and 3 days before each due date.", { x: 0.7, y: 4.8, w: 11, h: 1.2, fontSize: 14, color: "D7DEE5", valign: "top" });
  brand(s, true);

  // Slide 2 — registration & key dates
  s = p.addSlide(); s.background = { color: PPTX_BRAND.cream };
  s.addText("REGISTRATION", { x: 0.7, y: 0.5, w: 12, h: 0.3, fontSize: 12, color: PPTX_BRAND.orange, bold: true, charSpacing: 2, valign: "middle" });
  s.addText("Registration & Key Dates", { x: 0.7, y: 0.85, w: 12, h: 0.7, fontSize: 30, bold: true, color: PPTX_BRAND.navy, valign: "middle" });
  s.addShape("rect", { x: 0.7, y: 1.66, w: 0.7, h: 0.06, fill: { color: PPTX_BRAND.orange } });
  const cells = [
    { k: "Incorporation", v: fmtDate(d.reg.incorporationDate) },
    { k: "Trade Licence expiry", v: fmtDate(d.reg.tradeLicenceExpiry) },
    { k: "VAT — first filing", v: fmtDate(d.reg.vatFirstFiling) },
    { k: "Corporate Tax — first filing", v: fmtDate(d.reg.ctFirstFiling) },
  ];
  cells.forEach((c, i) => {
    const x = 0.7 + (i % 2) * 6.15;
    const y = 2.2 + Math.floor(i / 2) * 1.7;
    s.addShape("roundRect", { x, y, w: 6, h: 1.5, fill: { color: PPTX_BRAND.white }, line: { color: PPTX_BRAND.line, width: 1 }, rectRadius: 0.1 });
    s.addText(c.k.toUpperCase(), { x: x + 0.25, y: y + 0.2, w: 5.5, h: 0.3, fontSize: 10, color: PPTX_BRAND.ink2, bold: true, charSpacing: 1 });
    s.addText(c.v, { x: x + 0.25, y: y + 0.55, w: 5.5, h: 0.7, fontSize: 22, color: PPTX_BRAND.navy, bold: true });
  });
  brand(s);

  // Slide 3 — full timeline table
  s = p.addSlide(); s.background = { color: PPTX_BRAND.white };
  s.addText("CALENDAR", { x: 0.7, y: 0.5, w: 12, h: 0.3, fontSize: 12, color: PPTX_BRAND.orange, bold: true, charSpacing: 2, valign: "middle" });
  s.addText("All Compliance Deadlines", { x: 0.7, y: 0.85, w: 12, h: 0.7, fontSize: 28, bold: true, color: PPTX_BRAND.navy, valign: "middle" });
  s.addShape("rect", { x: 0.7, y: 1.66, w: 0.7, h: 0.06, fill: { color: PPTX_BRAND.orange } });
  const header = [
    { text: "Due", options: { bold: true, color: PPTX_BRAND.white, fill: PPTX_BRAND.navy } },
    { text: "Item", options: { bold: true, color: PPTX_BRAND.white, fill: PPTX_BRAND.navy } },
    { text: "Category", options: { bold: true, color: PPTX_BRAND.white, fill: PPTX_BRAND.navy } },
    { text: "Status", options: { bold: true, color: PPTX_BRAND.white, fill: PPTX_BRAND.navy } },
  ];
  const body = d.items.map((it) => {
    const cat = classifyComplianceItem(it);
    const st = statusFor(daysUntil(it.date), it.label);
    return [
      { text: fmtDate(it.date), options: { color: PPTX_BRAND.ink } },
      { text: it.label, options: { bold: true, color: PPTX_BRAND.ink } },
      { text: CATEGORY_META[cat].label, options: { color: PPTX_BRAND.ink2 } },
      { text: st.label, options: { color: PPTX_BRAND.ink2 } },
    ];
  });
  s.addTable([header, ...body], {
    x: 0.7, y: 2.0, w: 11.9, colW: [1.9, 5.0, 2.5, 2.5],
    fontSize: 12, fontFace: "Inter, Arial",
    border: { type: "solid", pt: 0.5, color: PPTX_BRAND.line },
    rowH: 0.45,
  });
  brand(s);

  // Slide 4 — by category cards
  s = p.addSlide(); s.background = { color: PPTX_BRAND.cream };
  s.addText("BREAKDOWN", { x: 0.7, y: 0.5, w: 12, h: 0.3, fontSize: 12, color: PPTX_BRAND.orange, bold: true, charSpacing: 2 });
  s.addText("By Category", { x: 0.7, y: 0.85, w: 12, h: 0.7, fontSize: 28, bold: true, color: PPTX_BRAND.navy });
  s.addShape("rect", { x: 0.7, y: 1.66, w: 0.7, h: 0.06, fill: { color: PPTX_BRAND.orange } });
  const cats = Object.entries(d.grouped);
  const cols = cats.length <= 2 ? cats.length : Math.min(3, cats.length);
  const cardW = (11.9 - (cols - 1) * 0.3) / cols;
  cats.forEach(([cat, list], i) => {
    const x = 0.7 + (i % cols) * (cardW + 0.3);
    const y = 2.0 + Math.floor(i / cols) * 2.6;
    s.addShape("roundRect", { x, y, w: cardW, h: 2.4, fill: { color: PPTX_BRAND.white }, line: { color: PPTX_BRAND.line, width: 1 }, rectRadius: 0.08 });
    s.addText(CATEGORY_META[cat as keyof typeof CATEGORY_META].label.toUpperCase(), { x: x + 0.2, y: y + 0.15, w: cardW - 0.4, h: 0.3, fontSize: 10.5, color: PPTX_BRAND.orange, bold: true, charSpacing: 1.5 });
    const lines = list.slice(0, 6).map((it) => ({ text: `${fmtDate(it.date)}   ${it.label}`, options: { bullet: { code: "2022" }, color: PPTX_BRAND.ink, fontSize: 11, breakLine: true, paraSpaceAfter: 4 } }));
    s.addText(lines, { x: x + 0.2, y: y + 0.55, w: cardW - 0.4, h: 1.75, fontSize: 11, valign: "top", lineSpacingMultiple: 1.1 });
  });
  brand(s);

  // Slide 5 — closing
  s = p.addSlide(); s.background = { color: PPTX_BRAND.navy };
  s.addText("WHAT HAPPENS NEXT", { x: 0.7, y: 1.4, w: 12, h: 0.4, fontSize: 14, color: PPTX_BRAND.orange, bold: true, charSpacing: 3 });
  s.addText("We track. We remind. We file.", { x: 0.7, y: 2.0, w: 12, h: 1.0, fontSize: 36, bold: true, color: PPTX_BRAND.white, valign: "middle" });
  s.addText([
    { text: "Reminder cadence:  30, 14 and 3 days before each deadline.\n", options: { color: "D7DEE5", fontSize: 14, breakLine: true } },
    { text: "Anything escalated to your Account Manager beforehand if action is needed from you.\n", options: { color: "D7DEE5", fontSize: 14, breakLine: true } },
    { text: "Documents auto-collected from your Drive and flagged when renewal data is missing.", options: { color: "D7DEE5", fontSize: 14 } },
  ], { x: 0.7, y: 3.4, w: 12, h: 2.5, valign: "top", lineSpacingMultiple: 1.3 });
  brand(s, true);

  await p.writeFile({ fileName: `Compliance Calendar — ${d.clientName}.pptx` });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Compliance Calendar refresh — re-scans the client's Drive folder + portal
 * uploads, extracts any newly-added trade licences / VAT certificates / CT
 * certificates / expiry dates, and rebuilds the calendar. Run this whenever
 * a document is renewed or a new statutory filing is added.
 */
function RebuildFromDriveButton({
  clientId, clientName, onDone,
}: { clientId: string; clientName: string; onDone: () => void }) {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const click = () => start(async () => {
    setMsg(null);
    const res = await rebuildClientCompliance(clientId);
    if (res.error) { setMsg(res.error); return; }
    if (res.empty) {
      setMsg(`No documents with dates found in ${clientName}'s Drive folder.`);
    } else {
      setMsg(`Calendar rebuilt — ${res.itemCount ?? 0} items.`);
    }
    onDone();
    setTimeout(() => setMsg(null), 6000);
  });

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {msg && <span style={{ fontSize: 11.5, color: msg.startsWith("Calendar rebuilt") ? "var(--green, #047857)" : "var(--ink-3)" }}>{msg}</span>}
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={click}
        title="Re-scan Drive (Company Documents folder) + portal uploads. Use after a renewed licence or new compliance certificate."
        style={{ background: busy ? "var(--ink-3)" : "var(--orange)" }}
      >
        <Icon name={busy ? "loader" : "refresh-cw"} size={14} /> {busy ? "Rebuilding…" : "Rebuild from Drive"}
      </button>
    </div>
  );
}
