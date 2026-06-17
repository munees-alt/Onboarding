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
  zohoConnected: boolean;
}

const TABS = [
  "Client Data", "Runs", "Workflows", "Tasks & Projects", "Templates & SOPs",
  "Compliance Calendar", "Communication", "COA", "Tools & Access", "Escalation History",
] as const;
const TAB_ICON: Record<string, string> = {
  "Client Data": "database", "Runs": "activity", "Workflows": "workflow",
  "Tasks & Projects": "folder-kanban", "Templates & SOPs": "layers",
  "Compliance Calendar": "calendar", "Communication": "message-circle",
  "COA": "list-tree", "Tools & Access": "wrench", "Escalation History": "alert-triangle",
};

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
        <div className="cpb-tabs" style={{ marginTop: 16 }}>
          {TABS.map((t) => (
            <button key={t} className={"cpb-tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>
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
    <div className="cpb-card" style={{ marginBottom: 14 }}>
      <div className="cpb-card-head">{title}</div>
      {children ?? <div className="cpb-empty">{empty ?? "Nothing here yet."}</div>}
    </div>
  );
}
function Row({ k, v }: { k: string; v: unknown }) {
  const val = Array.isArray(v) ? v.join(", ") : v == null || v === "" ? "—" : String(v);
  return <div className="cpb-detail-row"><span className="cpb-detail-label">{k}</span><span style={{ color: "var(--ink-1)", textAlign: "right" }}>{val}</span></div>;
}

function ClientData({ data }: { data: PlaybookData }) {
  const p = data.profile;
  return (
    <>
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

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
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

function Compliance({ data }: { data: PlaybookData }) {
  return <Panel title="Compliance calendar" empty={data.compliance.length ? undefined : "No compliance items yet."}>
    {data.compliance.length ? (
      <table className="runs-table"><thead><tr><th>Item</th><th>Type</th><th>Due</th></tr></thead>
        <tbody>{data.compliance.map((c, i) => <tr key={i}><td>{String(c.label ?? "")}</td><td>{String(c.type ?? "")}</td><td>{String(c.date ?? "")}</td></tr>)}</tbody></table>
    ) : undefined}
  </Panel>;
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
