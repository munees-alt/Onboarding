"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { generateSopSteps, saveSop, deleteSop } from "./actions";

export interface SopRow {
  id: string;
  title: string;
  industry: string | null;
  steps: string[];
  created_by_name: string | null;
  created_at: string;
}

export function SopLibrary({ sops }: { sops: SopRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 900 }}>
        <div className="section-head">
          <div><h2>SOP Library</h2><div className="sub">Standard operating procedures — write with AI, reuse across clients.</div></div>
          <button className="btn-primary" onClick={() => setOpen(true)}><Icon name="plus" size={15} /> Create SOP</button>
        </div>

        {sops.length === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "60px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>No SOPs yet. Create one with AI.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {sops.map((s) => (
              <div key={s.id} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--teal-soft)", color: "var(--teal)", display: "grid", placeItems: "center" }}><Icon name="book-open" size={16} /></span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{s.industry ?? "All industries"} · {s.steps.length} steps · {s.created_by_name ?? "—"}</div>
                  </div>
                  <button className="btn-ghost" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>{expanded === s.id ? "Hide" : "View"}</button>
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

      {open && <CreateSopModal onClose={() => setOpen(false)} onDone={() => { setOpen(false); note("SOP saved"); router.refresh(); }} />}
      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}

function CreateSopModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [industry, setIndustry] = useState("");
  const [context, setContext] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const gen = async () => { setAiBusy(true); setError(null); const r = await generateSopSteps(title, context); setAiBusy(false); if (r.error) setError(r.error); else setSteps(r.steps ?? []); };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>Create SOP</h3><div className="sub">Describe it in plain language and let AI write the steps — then edit.</div></div>
        <div className="bd" style={{ maxHeight: "64vh" }}>
          <div className="field"><label>Title *</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monthly bank reconciliation" /></div>
          <div className="field"><label>Industry (optional)</label><input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Retail" /></div>
          <div className="field"><label>What does this SOP cover?</label><textarea className="notes" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Describe the process in plain language…" /></div>
          <button className="btn-ai" disabled={aiBusy || !title.trim()} onClick={gen}><Icon name="sparkles" size={13} /> {aiBusy ? "Writing…" : "Generate steps with AI"}</button>
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
          <button className="btn-primary" disabled={saving || !title.trim() || steps.length === 0} onClick={() => start(async () => { const r = await saveSop({ title, industry, steps }); if (!r.error) onDone(); })}>{saving ? "Saving…" : "Save SOP"}</button>
        </div>
      </div>
    </div>
  );
}
