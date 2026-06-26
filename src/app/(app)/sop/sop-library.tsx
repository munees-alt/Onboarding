"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { generateSopSteps, saveSop, deleteSop, seedAccessSops, type SopInput } from "./actions";

export interface SopRow {
  id: string;
  title: string;
  industry: string | null;
  steps: string[];
  scope: string | null;     // master | client | industry
  flow: string | null;      // accounting | tax | general
  category: string | null;  // bank | gateway | fta | ...
  client_id: string | null;
  created_by_name: string | null;
  created_at: string;
}

const SCOPES = [
  { id: "master", label: "Master", icon: "shield-check" },
  { id: "client", label: "Client", icon: "building-2" },
  { id: "industry", label: "Industry", icon: "layers" },
];
const FLOWS = [
  { id: "onboarding", label: "Onboarding" },
  { id: "accounting", label: "Accounting" },
  { id: "tax", label: "Taxation" },
  { id: "auditing", label: "Auditing" },
  { id: "general", label: "General" },
];
const CAT_LABEL: Record<string, string> = { bank: "Bank", gateway: "Payment gateway", fta: "FTA", vat: "VAT", ct: "Corporate Tax" };

export function SopLibrary({ sops }: { sops: SopRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SopRow | "new" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [fScope, setFScope] = useState<string>("");
  const [fFlow, setFFlow] = useState<string>("");
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  const filtered = useMemo(() => sops.filter((s) =>
    (!fScope || (s.scope ?? "master") === fScope) && (!fFlow || (s.flow ?? "general") === fFlow)
  ), [sops, fScope, fFlow]);

  const hasAccess = sops.some((s) => ["bank", "gateway", "fta"].includes(s.category ?? ""));

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 920 }}>
        {/* Finanshels-branded header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg, var(--orange), var(--orange-600, #d96518))", color: "#fff", borderRadius: 14, padding: "18px 22px", marginBottom: 18 }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(255,255,255,0.18)", display: "grid", placeItems: "center" }}><Icon name="gauge" size={22} strokeWidth={2.2} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>Finanshels SOP Library</div>
            <div style={{ fontSize: 12.5, opacity: 0.9 }}>Standard operating procedures — master, client and industry playbooks. Write with AI, reuse everywhere.</div>
          </div>
          <button className="btn-ghost" style={{ background: "rgba(255,255,255,0.16)", color: "#fff", border: "none" }} onClick={() => setEditing("new")}><Icon name="plus" size={15} /> Create SOP</button>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)" }}>Scope</span>
            <button className={"tab-pill" + (fScope === "" ? " active" : "")} onClick={() => setFScope("")}>All</button>
            {SCOPES.map((s) => <button key={s.id} className={"tab-pill" + (fScope === s.id ? " active" : "")} onClick={() => setFScope(s.id)}><Icon name={s.icon} size={12} /> {s.label}</button>)}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)" }}>Flow</span>
            <button className={"tab-pill" + (fFlow === "" ? " active" : "")} onClick={() => setFFlow("")}>All</button>
            {FLOWS.map((f) => <button key={f.id} className={"tab-pill" + (fFlow === f.id ? " active" : "")} onClick={() => setFFlow(f.id)}>{f.label}</button>)}
          </div>
          {!hasAccess && (
            <button className="btn-ghost" style={{ marginLeft: "auto" }} disabled={busy} onClick={() => start(async () => { const r = await seedAccessSops(); note(r.added ? `Added ${r.added} standard access SOPs` : r.error ?? "Already added"); router.refresh(); })}>
              <Icon name="download" size={14} /> Add standard access SOPs
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "60px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            No SOPs here yet. Create one with AI{!hasAccess ? ", or add the standard access SOPs above" : ""}.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((s) => (
              <div key={s.id} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16, borderLeft: "3px solid var(--orange)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center" }}><Icon name="book-open" size={16} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                      {s.title}
                      {s.scope && <span className="pill" style={{ fontSize: 9.5, textTransform: "uppercase" }}>{s.scope}</span>}
                      {s.flow && <span className="pill teal" style={{ fontSize: 9.5 }}>{FLOWS.find((f) => f.id === s.flow)?.label ?? s.flow}</span>}
                      {s.category && <span className="pill amber" style={{ fontSize: 9.5 }}>{CAT_LABEL[s.category] ?? s.category}</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{s.industry ?? "All industries"} · {s.steps.length} steps · {s.created_by_name ?? "—"}</div>
                  </div>
                  <button className="btn-ghost" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>{expanded === s.id ? "Hide" : "View"}</button>
                  <button className="btn-ghost" onClick={() => setEditing(s)}><Icon name="pencil" size={13} /> Edit</button>
                  <button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => { if (confirm("Delete this SOP?")) start(async () => { await deleteSop(s.id); router.refresh(); }); }}><Icon name="trash-2" size={14} /></button>
                </div>
                {expanded === s.id && (
                  <ol style={{ margin: "12px 0 0", paddingLeft: 20 }}>
                    {s.steps.map((st, i) => <li key={i} style={{ fontSize: 13, color: "var(--ink-2)", margin: "4px 0" }}>{st}</li>)}
                  </ol>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <SopModal initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); note("SOP saved"); router.refresh(); }} />}
      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}

function SopModal({ initial, onClose, onDone }: { initial: SopRow | null; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [industry, setIndustry] = useState(initial?.industry ?? "");
  const [scope, setScope] = useState(initial?.scope ?? "master");
  const [flow, setFlow] = useState(initial?.flow ?? "general");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [context, setContext] = useState("");
  const [steps, setSteps] = useState<string[]>(initial?.steps ?? []);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const gen = async () => { setAiBusy(true); setError(null); const r = await generateSopSteps(title, context); setAiBusy(false); if (r.error) setError(r.error); else setSteps((cur) => [...cur, ...(r.steps ?? [])]); };

  const save = () => start(async () => {
    const input: SopInput = { id: initial?.id, title, industry, steps, scope, flow, category: category.trim() || undefined };
    const r = await saveSop(input);
    if (r.error) setError(r.error); else onDone();
  });

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>{initial ? "Edit SOP" : "Create SOP"}</h3><div className="sub">Describe it in plain language and let AI write the steps — then edit. Tag it so the team can filter.</div></div>
        <div className="bd" style={{ maxHeight: "66vh" }}>
          <div className="field"><label>Title *</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bank account access — handover" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div className="field"><label>Scope</label><select value={scope} onChange={(e) => setScope(e.target.value)}>{SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            <div className="field"><label>Flow</label><select value={flow} onChange={(e) => setFlow(e.target.value)}>{FLOWS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select></div>
            <div className="field"><label>Category</label><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder={flow === "tax" ? "e.g. fta" : flow === "accounting" ? "e.g. bank / gateway" : "optional"} /></div>
          </div>
          <div className="field"><label>Industry (optional)</label><input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Retail — leave blank for all" /></div>
          <div className="field"><label>What does this SOP cover?</label><textarea className="notes" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Describe the process in plain language…" /></div>
          <button className="btn-ai" disabled={aiBusy || !title.trim()} onClick={gen}><Icon name="sparkles" size={13} /> {aiBusy ? "Writing…" : steps.length ? "Add AI steps" : "Generate steps with AI"}</button>
          {error && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 8 }}>{error}</div>}
          {steps.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)" }}>Steps (editable)</div>
              {steps.map((st, i) => (
                <div key={i} style={{ display: "flex", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "var(--ink-4)", width: 18, paddingTop: 8 }}>{i + 1}</span>
                  <input value={st} onChange={(e) => setSteps((a) => a.map((x, j) => (j === i ? e.target.value : x)))} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 13 }} />
                  <button className="icon-btn" onClick={() => setSteps((a) => a.filter((_, j) => j !== i))} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /></button>
                </div>
              ))}
              <button className="add-link" onClick={() => setSteps((a) => [...a, ""])}><Icon name="plus" size={12} /> Add step</button>
            </div>
          )}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" disabled={saving || !title.trim() || steps.length === 0} onClick={save}>{saving ? "Saving…" : initial ? "Save changes" : "Save SOP"}</button>
        </div>
      </div>
    </div>
  );
}
