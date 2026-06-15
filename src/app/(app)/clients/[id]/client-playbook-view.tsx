"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import type { OnbTemplate } from "@/lib/onboarding-templates";

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
  diagrams: { name: string; nodes: { id: string; label: string; type: string }[] }[];
  documents: { label: string; status: string }[];
  messages: { author_name: string; author_role: string; body: string; created_at: string }[];
  escalations: { title: string; body: string | null; kind: string; created_at: string }[];
}

const TABS = [
  "Workflows", "Tasks & Projects", "Templates & SOPs", "Compliance Calendar",
  "Communication", "Client Data", "COA", "Tools & Access", "Escalation History", "Runs",
] as const;

export function ClientPlaybook({ data }: { data: PlaybookData }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Client Data");
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

        {/* Tabs */}
        <div className="tabs-row" style={{ marginTop: 16, overflowX: "auto", flexWrap: "nowrap" }}>
          {TABS.map((t) => (
            <button key={t} className={"tab-btn" + (tab === t ? " active" : "")} onClick={() => setTab(t)} style={{ whiteSpace: "nowrap" }}>{t}</button>
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

        <div style={{ marginTop: 14 }}>
          {tab === "Client Data" && <ClientData data={data} />}
          {tab === "COA" && <Coa data={data} />}
          {tab === "Tasks & Projects" && <TasksProjects data={data} />}
          {tab === "Compliance Calendar" && <Compliance data={data} />}
          {tab === "Workflows" && <Workflows data={data} />}
          {tab === "Communication" && <Communication data={data} />}
          {tab === "Templates & SOPs" && <TemplatesSops data={data} />}
          {tab === "Tools & Access" && <Tools data={data} />}
          {tab === "Escalation History" && <Escalations data={data} />}
          {tab === "Runs" && <Runs data={data} />}
        </div>
      </div>
    </div>
  );
}

function Panel({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{title}</div>
      {children ?? <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{empty ?? "Nothing here yet."}</div>}
    </div>
  );
}
function Row({ k, v }: { k: string; v: unknown }) {
  const val = Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "—" : String(v);
  return <div style={{ display: "flex", gap: 12, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}><span style={{ width: 200, color: "var(--ink-3)" }}>{k}</span><span style={{ flex: 1, color: "var(--ink-1)" }}>{val}</span></div>;
}

function ClientData({ data }: { data: PlaybookData }) {
  const p = data.profile;
  return (
    <>
      <Panel title="Company">
        <Row k="Company" v={data.name} />
        <Row k="Owner" v={p.owner_name} />
        <Row k="Industry" v={p.industry} />
        <Row k="Entity type" v={p.entity_type} />
        <Row k="Contact email" v={p.primary_contact_email} />
        <Row k="Phone" v={p.phone} />
        <Row k="Services" v={p.services} />
        <Row k="VAT" v={p.vat_registered} /><Row k="TRN" v={p.vat_trn} /><Row k="Corporate Tax" v={p.ct_registered} />
        <Row k="Bank" v={p.bank_names} /><Row k="Payment gateways" v={p.payment_gateways} />
        <Row k="Accounting software" v={p.accounting_software} /><Row k="Revenue bracket" v={p.revenue_bracket} />
      </Panel>
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
  return (
    <Panel title={`Chart of accounts${data.coa.client_signed_off ? " — client signed off ✓" : ""}`}>
      {data.coa.ai_rationale && <div className="ai-response" style={{ marginTop: 0, marginBottom: 12 }}><div className="hdr"><Icon name="sparkles" size={13} /> AI rationale</div>{data.coa.ai_rationale}</div>}
      {sections.map((s) => (
        <div key={s} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 4 }}>{s}</div>
          {data.coa!.accounts.filter((a) => a.section === s).map((a, i) => (
            <div key={i} style={{ fontSize: 13, padding: "3px 0", display: "flex", gap: 8 }}><span style={{ fontFamily: "DM Mono, monospace", color: "var(--ink-3)", minWidth: 44 }}>{a.code}</span>{a.account}</div>
          ))}
        </div>
      ))}
    </Panel>
  );
}

function TasksProjects({ data }: { data: PlaybookData }) {
  return (
    <>
      <Panel title="Task board">
        {data.tasks.length ? (
          <table className="runs-table"><thead><tr><th>Task</th><th>Type</th><th>Client sees</th><th>Status</th></tr></thead>
            <tbody>{data.tasks.map((t, i) => (<tr key={i}><td>{t.title}</td><td>{t.type.replace("_", " ")}</td><td>{t.client_visible ? "Yes" : "No"}</td><td>{t.status.replace("_", " ")}</td></tr>))}</tbody>
          </table>
        ) : <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No tasks yet.</div>}
      </Panel>
      <Panel title="Internal projects" empty={data.projects.length ? undefined : "No internal projects created yet."}>
        {data.projects.length ? data.projects.map((p, i) => <Row key={i} k={String(p.name ?? p.month ?? "Project")} v={p.month ?? p.owner ?? ""} />) : undefined}
      </Panel>
      <Panel title="Catch-up board" empty={data.catchup.length ? undefined : "No catch-up backlog."}>
        {data.catchup.length ? data.catchup.map((c, i) => <Row key={i} k={String(c.title ?? "Task")} v={`${c.owner ?? ""} · ${c.due ?? ""} · ${c._status ?? ""}`} />) : undefined}
      </Panel>
    </>
  );
}

function Compliance({ data }: { data: PlaybookData }) {
  return <Panel title="Compliance calendar" empty={data.compliance.length ? undefined : "No compliance items yet."}>
    {data.compliance.length ? (
      <table className="runs-table"><thead><tr><th>Item</th><th>Type</th><th>Due</th></tr></thead>
        <tbody>{data.compliance.map((c, i) => <tr key={i}><td>{String(c.label ?? "")}</td><td>{String(c.type ?? "")}</td><td>{String(c.date ?? "")}</td></tr>)}</tbody></table>
    ) : undefined}
  </Panel>;
}

function Workflows({ data }: { data: PlaybookData }) {
  if (!data.diagrams.length) return <Panel title="Workflows" empty="No workflow diagrams drawn yet." />;
  return <>{data.diagrams.map((d, i) => (
    <Panel key={i} title={d.name}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {d.nodes.map((n, j) => (<span key={n.id} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="pill" style={{ background: "var(--bg)", color: "var(--ink-2)", fontSize: 11 }}>{n.label}</span>
          {j < d.nodes.length - 1 && <Icon name="arrow-right" size={12} style={{ color: "var(--ink-4)" }} />}
        </span>))}
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
  return (
    <>
      <Panel title="Documents" empty={data.documents.length ? undefined : "No documents."}>
        {data.documents.map((d, i) => <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0", fontSize: 13, alignItems: "center" }}><Icon name={d.status === "uploaded" ? "check-circle" : "circle"} size={14} style={{ color: d.status === "uploaded" ? "var(--green)" : "var(--ink-4)" }} />{d.label}</div>)}
      </Panel>
      <Panel title="Access & integrations">
        <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.7 }}>Drive folder, Zoho Books and Gmail are connected per team member in Settings. Client documents auto-file to the assigned member&apos;s Drive.</div>
      </Panel>
    </>
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

function Runs({ data }: { data: PlaybookData }) {
  return <Panel title="Run history" empty={data.runs.length ? undefined : "No runs."}>
    <table className="runs-table"><thead><tr><th>Run</th><th>Status</th><th>Progress</th><th></th></tr></thead>
      <tbody>{data.runs.map((r) => (
        <tr key={r.id}><td>{r.templateName}</td><td>{r.status.replace("_", " ")}</td><td>{r.progress}%</td>
          <td><Link href={`/onboarding/${r.id}`} className="btn-ghost" style={{ textDecoration: "none" }}>Open</Link></td></tr>
      ))}</tbody></table>
  </Panel>;
}
