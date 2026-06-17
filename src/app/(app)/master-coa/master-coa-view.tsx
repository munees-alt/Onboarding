"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { saveMasterCoa, deleteMasterCoa, generateMasterCoa } from "./actions";
import type { MasterCoa, MasterLine } from "@/lib/master-coa";

const SECTIONS = ["Assets", "Liabilities", "Equity", "Income", "Cost of Goods", "Expenses", "Other"];
const inp: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 };

export function MasterCoaView({ coas }: { coas: MasterCoa[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(null);
  const [lines, setLines] = useState<MasterLine[]>([]);
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const open = (c: MasterCoa) => { setSel(c.industry); setLines(c.accounts.map((a) => ({ ...a })) ?? []); };

  const save = () =>
    start(async () => {
      if (!sel) return;
      const r = await saveMasterCoa(sel, lines);
      if (r.error) flash(r.error); else { flash("Saved"); router.refresh(); }
    });
  const removeIndustry = () =>
    start(async () => {
      if (!sel) return;
      const r = await deleteMasterCoa(sel);
      if (r.error) flash(r.error); else { setSel(null); flash("Industry removed"); router.refresh(); }
    });

  const createNew = (withAi: boolean) =>
    start(async () => {
      setErr(null);
      if (!newName.trim()) { setErr("Name the industry first."); return; }
      let accounts: MasterLine[] = [];
      if (withAi) {
        setAiBusy(true);
        const r = await generateMasterCoa(newName, newNote);
        setAiBusy(false);
        if (r.error) { setErr(r.error); return; }
        accounts = r.accounts ?? [];
      }
      const r = await saveMasterCoa(newName, accounts);
      if (r.error) { setErr(r.error); return; }
      setNewOpen(false); setNewName(""); setNewNote("");
      setSel(newName.trim()); setLines(accounts);
      flash("Industry created");
      router.refresh();
    });

  return (
    <div className="scroll"><div className="page">
      <div className="section-head">
        <div>
          <h2>Master Chart of Accounts</h2>
          <div className="sub">The COA library. Per-client COAs are tailored from these. Managed by Master Admin, Ops Head and AMs.</div>
        </div>
        <button className="btn-primary" onClick={() => { setNewOpen(true); setErr(null); }}><Icon name="plus" size={14} /> New industry COA</button>
      </div>

      <div className="tmpl-grid">
        {coas.map((c) => {
          const sections = [...new Set(c.accounts.map((a) => a.section))];
          return (
            <div key={c.industry} className={"tmpl-card" + (sel === c.industry ? " active" : "")} style={{ cursor: "pointer" }} onClick={() => open(c)}>
              <div className="ic"><Icon name="book-open" size={17} /></div>
              <h4>{c.industry}</h4>
              <div className="meta" style={{ marginTop: 4 }}>{c.accounts.length} accounts · {sections.length} sections</div>
              <div className="ft"><span className="meta">{sel === c.industry ? "Editing below" : "Click to edit"}</span><Icon name="chevron-right" size={14} /></div>
            </div>
          );
        })}
      </div>

      {sel && (
        <div className="runs-card" style={{ padding: 18, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{sel} — {lines.length} accounts</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-ghost" style={{ color: "var(--red)" }} disabled={busy} onClick={removeIndustry}><Icon name="trash-2" size={13} /> Delete industry</button>
              <button className="btn-primary" disabled={busy} onClick={save}><Icon name="check" size={14} /> Save COA</button>
            </div>
          </div>
          <table className="runs-table">
            <thead><tr><th style={{ width: 90 }}>Code</th><th>Account</th><th style={{ width: 150 }}>Section</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><input value={l.code} onChange={(e) => setLines((a) => a.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} style={{ ...inp, width: 80, fontFamily: "DM Mono, monospace" }} /></td>
                  <td><input value={l.account} onChange={(e) => setLines((a) => a.map((x, j) => (j === i ? { ...x, account: e.target.value } : x)))} style={{ ...inp, width: "100%" }} /></td>
                  <td><select value={l.section} onChange={(e) => setLines((a) => a.map((x, j) => (j === i ? { ...x, section: e.target.value } : x)))} style={{ ...inp, width: "100%" }}>{SECTIONS.map((s) => <option key={s}>{s}</option>)}</select></td>
                  <td><button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => setLines((a) => a.filter((_, j) => j !== i))} aria-label="Delete account"><Icon name="x" size={13} /></button></td>
                </tr>
              ))}
              {!lines.length && <tr><td colSpan={4} style={{ textAlign: "center", padding: 24, color: "var(--ink-3)" }}>No accounts — add some below.</td></tr>}
            </tbody>
          </table>
          <button className="add-link" style={{ marginTop: 8 }} onClick={() => setLines((a) => [...a, { code: "", account: "New account", section: "Expenses" }])}><Icon name="plus" size={12} /> Add account</button>
        </div>
      )}

      {newOpen && (
        <div className="modal-overlay open" onClick={() => !busy && !aiBusy && setNewOpen(false)}>
          <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="hd"><h3>New industry COA</h3><div className="sub">Start blank, or let AI draft a real UAE chart of accounts you can edit.</div></div>
            <div className="bd">
              <div className="field"><label>Industry name</label><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Logistics, Clinic, Construction" /></div>
              <div className="field"><label>Notes for AI (optional)</label><textarea className="notes" value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Anything specific about this industry's accounts…" style={{ minHeight: 60 }} /></div>
              {err && <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8 }}>{err}</div>}
            </div>
            <div className="ft">
              <button className="btn-ghost" onClick={() => setNewOpen(false)} disabled={busy || aiBusy}>Cancel</button>
              <button className="btn-ghost" onClick={() => createNew(false)} disabled={busy || aiBusy || !newName.trim()}>Start blank</button>
              <button className="btn-ai" onClick={() => createNew(true)} disabled={busy || aiBusy || !newName.trim()}><Icon name="sparkles" size={14} /> {aiBusy ? "Building…" : "Build with AI"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div></div>
  );
}
