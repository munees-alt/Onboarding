"use client";

import { useMemo, useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { saveTaxCodeSet, deleteTaxCodeSet, resetTaxCodeSet } from "./actions";
import type { TaxCode, TaxKind, TaxCodeSet } from "@/lib/tax-codes";

const KIND_OPTIONS: { value: TaxKind; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "zero", label: "Zero-rated" },
  { value: "exempt", label: "Exempt" },
  { value: "rcm", label: "Reverse charge" },
  { value: "out_of_scope", label: "Out of scope" },
];

const KIND_COLOR: Record<TaxKind, string> = {
  standard: "teal",
  zero: "blue",
  exempt: "amber",
  rcm: "purple",
  out_of_scope: "gray",
};

export function MasterTaxCodesView({ sets }: { sets: TaxCodeSet[] }) {
  const [industry, setIndustry] = useState(sets[0]?.industry ?? "");
  const active = useMemo(() => sets.find((s) => s.industry === industry), [sets, industry]);
  const [codes, setCodes] = useState<TaxCode[]>(active?.codes ?? []);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newIndustry, setNewIndustry] = useState("");

  // Keep `codes` synced when industry changes.
  const switchIndustry = (i: string) => {
    setIndustry(i);
    const next = sets.find((s) => s.industry === i);
    setCodes(next?.codes ?? []);
    setMsg(null);
  };

  const setCode = (i: number, patch: Partial<TaxCode>) => setCodes((arr) => arr.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeCode = (i: number) => setCodes((arr) => arr.filter((_, j) => j !== i));
  const addCode = () => setCodes((arr) => [...arr, { code: "", name: "", rate: 0, kind: "standard" }]);

  const save = (industryName: string) => start(async () => {
    setMsg(null);
    const res = await saveTaxCodeSet({ industry: industryName, codes });
    if (res.error) setMsg(res.error);
    else { setSavedId(industryName); setMsg("Saved."); setTimeout(() => setSavedId(null), 1500); }
  });

  const reset = () => start(async () => {
    const res = await resetTaxCodeSet(industry);
    if (res.error) setMsg(res.error);
    else { setMsg("Reset to UAE default. Refresh to see the reverted codes."); }
  });

  const removeSet = () => start(async () => {
    if (!confirm(`Delete the "${industry}" tax-code set? This can be re-seeded later.`)) return;
    const res = await deleteTaxCodeSet(industry);
    if (res.error) setMsg(res.error);
    else { setMsg("Deleted. Refresh to update the list."); }
  });

  const addIndustry = () => {
    const name = newIndustry.trim();
    if (!name) return;
    start(async () => {
      const res = await saveTaxCodeSet({ industry: name, codes: [] });
      if (res.error) setMsg(res.error);
      else { setNewIndustry(""); setMsg("Added — refresh to switch to it."); }
    });
  };

  const filtered = codes.filter((c) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.notes ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="scroll">
      <div className="page">
        <div className="section-head">
          <div>
            <h2>Master tax codes</h2>
            <div className="sub">UAE VAT + Corporate Tax codes per industry. Seeded with the UAE baseline + the priority industry overlays — edit, extend, or reset. The team picks from these on the run&apos;s tax-code step.</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 16, alignItems: "flex-start" }}>
          {/* Sidebar — industry list */}
          <div style={{ width: 280, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 10, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", padding: "4px 8px 8px" }}>Industries</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {sets.map((s) => (
                <button
                  key={s.industry}
                  onClick={() => switchIndustry(s.industry)}
                  style={{
                    textAlign: "left", border: "none", background: s.industry === industry ? "var(--orange-soft)" : "transparent",
                    color: s.industry === industry ? "var(--orange)" : "var(--ink-1)",
                    padding: "8px 10px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}
                >
                  <span>{s.industry}</span>
                  <span style={{ fontSize: 11, color: s.industry === industry ? "var(--orange)" : "var(--ink-3)" }}>{s.codes.length}</span>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10, padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
              <input
                value={newIndustry}
                onChange={(e) => setNewIndustry(e.target.value)}
                placeholder="Add industry…"
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 7, padding: "5px 8px", fontSize: 12.5 }}
              />
              <button className="btn-ghost" disabled={!newIndustry.trim() || busy} onClick={addIndustry} style={{ width: "100%", marginTop: 6, justifyContent: "center", fontSize: 12 }}>
                <Icon name="plus" size={12} /> Add
              </button>
            </div>
          </div>

          {/* Editor */}
          <div style={{ flex: 1, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
            {!industry ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>Pick an industry on the left to view / edit its tax codes.</div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{industry}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{codes.length} codes · {active?.source === "seed" ? "UAE baseline" : "Customised"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search codes…"
                      style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "6px 10px", fontSize: 12.5 }}
                    />
                    <button className="btn-ghost" onClick={addCode}><Icon name="plus" size={13} /> Add code</button>
                    <button className="btn-ghost" onClick={() => {
                      const rows: (string | number)[][] = [["Code", "Name", "Rate %", "Kind", "Notes", "Industry"]];
                      codes.forEach((c) => rows.push([c.code, c.name, c.rate, c.kind, c.notes ?? "", industry]));
                      const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
                      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url; a.download = `tax-codes-${industry.replace(/\s+/g, "-").toLowerCase()}.csv`; a.click();
                      URL.revokeObjectURL(url);
                    }}><Icon name="download" size={13} /> Export CSV</button>
                    <button className="btn-ghost" onClick={reset} disabled={busy} title="Reset to the UAE baseline"><Icon name="refresh-cw" size={13} /> Reset</button>
                    <button className="btn-ghost" onClick={removeSet} disabled={busy} style={{ color: "var(--red)" }}><Icon name="trash-2" size={13} /> Delete</button>
                    <button className="btn-primary" onClick={() => save(industry)} disabled={busy}>{busy ? "Saving…" : savedId === industry ? "Saved ✓" : "Save"}</button>
                  </div>
                </div>

                {msg && <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 7, padding: "7px 10px", fontSize: 12.5, marginBottom: 10 }}>{msg}</div>}

                <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1.5fr 80px 130px 1.4fr 40px", padding: "8px 12px", background: "var(--bg-soft)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)" }}>
                    <div>Code</div><div>Name</div><div>Rate %</div><div>Kind</div><div>Notes</div><div></div>
                  </div>
                  {filtered.length === 0 ? (
                    <div style={{ padding: 30, textAlign: "center", color: "var(--ink-3)", fontSize: 12.5 }}>
                      {codes.length === 0 ? "No codes yet — click Add code." : "Nothing matches."}
                    </div>
                  ) : codes.map((c, i) => {
                    if (search.trim() && !filtered.includes(c)) return null;
                    return (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 1.5fr 80px 130px 1.4fr 40px", padding: "8px 12px", borderTop: "1px solid var(--border)", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input value={c.code} onChange={(e) => setCode(i, { code: e.target.value })} style={inp()} placeholder="VAT-S5" />
                        <input value={c.name} onChange={(e) => setCode(i, { name: e.target.value })} style={inp()} placeholder="Standard rated 5%" />
                        <input type="number" value={c.rate} onChange={(e) => setCode(i, { rate: Number(e.target.value) })} style={inp()} step={0.5} min={0} />
                        <select value={c.kind} onChange={(e) => setCode(i, { kind: e.target.value as TaxKind })} style={inp()}>
                          {KIND_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input value={c.notes ?? ""} onChange={(e) => setCode(i, { notes: e.target.value })} style={inp()} placeholder="Optional notes" />
                        <button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => removeCode(i)} aria-label="Delete row"><Icon name="trash-2" size={13} /></button>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {KIND_OPTIONS.map((k) => {
                    const n = codes.filter((c) => c.kind === k.value).length;
                    return (
                      <span key={k.value} className={"pill " + KIND_COLOR[k.value]} style={{ fontSize: 11 }}>
                        {k.label}: {n}
                      </span>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function inp(): React.CSSProperties {
  return { border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5, background: "#fff", color: "var(--ink-1)", fontFamily: "inherit" };
}
