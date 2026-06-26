"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { ASSIGN_ROLES, type OnbTemplate, type TemplateStep, type StepKind } from "@/lib/onboarding-templates";
import { forkTemplate, saveTemplateAction } from "../actions";

const KINDS: StepKind[] = ["person", "ai", "link", "doc", "check"];

export function TemplateEditor({ initial }: { initial: OnbTemplate }) {
  const router = useRouter();
  const [tpl, setTpl] = useState<OnbTemplate>(() => structuredClone(initial));
  const [saving, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);

  const update = (fn: (t: OnbTemplate) => void) => setTpl((prev) => { const c = structuredClone(prev); fn(c); return c; });

  const save = () =>
    start(async () => {
      const r = await saveTemplateAction(tpl);
      if (r.error) { setToast(r.error); setTimeout(() => setToast(null), 3000); }
      else { setToast("Template saved"); setTimeout(() => setToast(null), 2000); router.refresh(); }
    });

  const fork = () =>
    start(async () => {
      const r = await forkTemplate(tpl.id);
      if (r.error) { setToast(r.error); setTimeout(() => setToast(null), 3000); return; }
      if (r.id) router.push(`/templates/${r.id}`);
    });

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 880 }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>
          <Link href="/onboarding" style={{ color: "var(--ink-3)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="arrow-left" size={12} /> Onboarding · Templates</Link>
        </div>
        <div className="section-head">
          <div><h2>Edit template</h2><div className="sub">Changes apply to new runs created from this template.</div></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-ghost" onClick={fork} disabled={saving} title="Duplicate this template as a new editable copy"><Icon name="copy" size={14} /> Fork</button>
            <button className="btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save template"}</button>
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 14 }}>
          <div className="field"><label>Template name</label><input value={tpl.name} onChange={(e) => update((t) => { t.name = e.target.value; })} /></div>
          <div className="field" style={{ marginTop: 10 }}><label>Description</label><textarea className="notes" value={tpl.desc} onChange={(e) => update((t) => { t.desc = e.target.value; })} /></div>
        </div>

        {tpl.stages.map((stage, si) => (
          <div key={stage.id} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ width: 24, height: 24, borderRadius: 6, background: "var(--ink-1)", color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{si + 1}</span>
              <input value={stage.name} onChange={(e) => update((t) => { t.stages[si].name = e.target.value; })} style={{ flex: 1, border: "none", fontSize: 14, fontWeight: 700, padding: "4px 6px", borderRadius: 6, background: "var(--bg-soft)" }} />
              <select title="Default assignee role for this stage" value={stage.assignRole ?? ""} onChange={(e) => update((t) => { t.stages[si].assignRole = e.target.value || undefined; })} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 6px", fontSize: 12 }}>
                <option value="">Role: any</option>
                {ASSIGN_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              <button className="icon-btn" title="Move up" disabled={si === 0} onClick={() => update((t) => { [t.stages[si - 1], t.stages[si]] = [t.stages[si], t.stages[si - 1]]; })}><Icon name="chevron-up" size={14} /></button>
              <button className="icon-btn" title="Move down" disabled={si === tpl.stages.length - 1} onClick={() => update((t) => { [t.stages[si + 1], t.stages[si]] = [t.stages[si], t.stages[si + 1]]; })}><Icon name="chevron-down" size={14} /></button>
              <button className="icon-btn" title="Remove stage" style={{ color: "var(--red)" }} onClick={() => update((t) => { t.stages.splice(si, 1); })}><Icon name="trash-2" size={14} /></button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {stage.steps.map((step, pi) => (
                <div key={step.id} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, background: "var(--bg-soft)" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontFamily: "DM Mono, monospace", fontSize: 10.5, color: "var(--ink-4)" }}>{step.id}</span>
                    <input value={step.title} onChange={(e) => update((t) => { t.stages[si].steps[pi].title = e.target.value; })} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 13 }} />
                    <select value={step.kind} onChange={(e) => update((t) => { t.stages[si].steps[pi].kind = e.target.value as StepKind; })} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 6px", fontSize: 12 }}>
                      {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <button className="icon-btn" disabled={pi === 0} onClick={() => update((t) => { const s = t.stages[si].steps; [s[pi - 1], s[pi]] = [s[pi], s[pi - 1]]; })}><Icon name="chevron-up" size={13} /></button>
                    <button className="icon-btn" disabled={pi === stage.steps.length - 1} onClick={() => update((t) => { const s = t.stages[si].steps; [s[pi + 1], s[pi]] = [s[pi], s[pi + 1]]; })}><Icon name="chevron-down" size={13} /></button>
                    <button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => update((t) => { t.stages[si].steps.splice(pi, 1); })}><Icon name="trash-2" size={13} /></button>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                    <input value={step.note ?? ""} placeholder="Helper note (shown on the step)" onChange={(e) => update((t) => { t.stages[si].steps[pi].note = e.target.value; })} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 12 }} />
                    <select title="Assignee role for this step" value={step.assignRole ?? ""} onChange={(e) => update((t) => { t.stages[si].steps[pi].assignRole = e.target.value || undefined; })} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 6px", fontSize: 12, flexShrink: 0 }}>
                      <option value="">Inherit stage role</option>
                      {ASSIGN_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </div>
                  {step.act && (
                    <label className="toggle-row" style={{ marginTop: 4 }}>
                      <input type="checkbox" checked={!!step.act.optional} onChange={(e) => update((t) => { const a = t.stages[si].steps[pi].act; if (a) a.optional = e.target.checked; })} />
                      Optional step (team can skip — e.g. intake form)
                    </label>
                  )}
                </div>
              ))}
              <button className="add-link" onClick={() => update((t) => {
                const n = t.stages[si].steps.length + 1;
                const newStep: TemplateStep = { id: `${stage.id}.${Date.now().toString(36).slice(-4)}`, title: "New step", kind: "person", who: ["AM"] };
                t.stages[si].steps.push(newStep);
              })}><Icon name="plus" size={12} /> Add step</button>
            </div>
          </div>
        ))}

        <button className="btn-ghost" onClick={() => update((t) => {
          t.stages.push({ id: `s${Date.now().toString(36).slice(-4)}`, name: "New stage", desc: "", steps: [] });
        })}><Icon name="plus" size={14} /> Add stage</button>
      </div>

      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}
