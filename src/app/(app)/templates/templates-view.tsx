"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { stepCount, type OnbTemplate } from "@/lib/onboarding-templates";
import { createTemplateFromText, forkTemplate } from "./actions";

export function TemplatesView({ templates }: { templates: OnbTemplate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [forking, setForking] = useState<string | null>(null);
  const [forkErr, setForkErr] = useState<string | null>(null);

  const generate = () =>
    start(async () => {
      setErr(null);
      const r = await createTemplateFromText(text);
      if (r.error) { setErr(r.error); return; }
      if (r.id) router.push(`/templates/${r.id}`);
    });

  const fork = (id: string) => {
    setForkErr(null);
    setForking(id);
    start(async () => {
      const r = await forkTemplate(id);
      if (r.error) { setForkErr(r.error); setForking(null); return; }
      if (r.id) router.push(`/templates/${r.id}`);
    });
  };

  return (
    <div className="scroll">
      <div className="page">
        <div className="section-head">
          <div>
            <h2>Templates</h2>
            <div className="sub">{templates.length} onboarding template{templates.length === 1 ? "" : "s"} · client onboarding — master flow · all editable · fork any to start from a copy</div>
          </div>
          <button className="btn-primary" onClick={() => { setGenOpen(true); setErr(null); }}>
            <Icon name="sparkles" size={14} /> Create from description
          </button>
        </div>
        {forkErr && <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8, marginTop: 8 }}>{forkErr}</div>}

        {genOpen && (
          <div className="modal-overlay open" onClick={() => !busy && setGenOpen(false)}>
            <div className="modal" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
              <div className="hd">
                <h3>Create a template from a description</h3>
                <div className="sub">Describe your onboarding process in plain words. AI drafts the stages and steps — real, based on what you write, fully editable after.</div>
              </div>
              <div className="bd">
                <textarea className="notes" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 160 }}
                  placeholder={"e.g. When a new VAT client signs, the AM assigns a senior and junior. We collect the trade licence and bank statements, set up the books in Zoho, hold a kickoff call, then run a monthly close with a handover to the delivery team."} />
                {err && <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8 }}>{err}</div>}
              </div>
              <div className="ft">
                <button className="btn-ghost" onClick={() => setGenOpen(false)} disabled={busy}>Cancel</button>
                <button className="btn-ai" onClick={generate} disabled={busy || text.trim().length < 20}>
                  <Icon name="sparkles" size={14} /> {busy ? "Generating…" : "Generate template"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <div className="tmpl-grid">
            {templates.map((t) => (
              <div key={t.id} className="tmpl-card" style={{ cursor: "default" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div className="ic"><Icon name={t.id.startsWith("micro") ? "zap" : t.category === "Catch-up" ? "history" : "users"} size={17} /></div>
                  {t.live && <span className="pill green" style={{ fontSize: 10 }}><span className="dot" /> Live</span>}
                </div>
                <h4>{t.name}</h4>
                <div className="meta" style={{ fontWeight: 600, color: "var(--ink-2)" }}>{t.teamLabel}</div>
                <div className="meta" style={{ marginTop: 6, lineHeight: 1.5 }}>{t.desc}</div>
                <div className="ft">
                  <span className="meta">{t.stages.length} stages · {stepCount(t)} steps · {t.usedBy} live run{t.usedBy === 1 ? "" : "s"}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn-ghost" onClick={() => fork(t.id)} disabled={busy && forking === t.id} title="Duplicate this template as a new editable copy">
                      <Icon name="copy" size={13} /> {busy && forking === t.id ? "Forking…" : "Fork"}
                    </button>
                    <button className="btn-ghost" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Hide" : "View"} <Icon name={open === t.id ? "chevron-up" : "chevron-down"} size={13} /></button>
                  </div>
                </div>
                {open === t.id && (
                  <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    {t.stages.map((s, i) => (
                      <div key={s.id}>
                        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{i + 1}. {s.name}</div>
                        <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                          {s.steps.map((st) => <li key={st.id} style={{ fontSize: 12, color: "var(--ink-3)", margin: "2px 0" }}>{st.title}</li>)}
                        </ul>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8 }}>
                      <Link href={`/templates/${t.id}`} className="btn-ghost" style={{ textDecoration: "none" }}><Icon name="pencil" size={13} /> Edit template</Link>
                      <button className="btn-ghost" onClick={() => fork(t.id)} disabled={busy && forking === t.id}>
                        <Icon name="copy" size={13} /> {busy && forking === t.id ? "Forking…" : "Fork as new"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
