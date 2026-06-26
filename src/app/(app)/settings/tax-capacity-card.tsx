"use client";

import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { saveAmCapacity, addTaxTeamMember, removeTaxTeamMember, listTaxAddCandidates, setAllTaxCapacity, saveTaxCapacityDefault, saveLoadOverride } from "./actions";

export interface CapacityRow {
  id: string;
  name: string;
  role: string;
  title: string | null;
  isHead: boolean;
  isLead: boolean;
  isExtra: boolean;
  maxTasks: number | null;
  currentLoad: number;
  autoLoad: number;
  loadOverride: number | null;
}

type Candidate = { id: string; name: string; role: string; title: string | null };

interface Props { rows: CapacityRow[]; headName: string | null; leadName?: string | null; taxCapacityDefault: number }

const DEFAULT_MAX = 60;

function BulkSetBar({ count, onApply }: { count: number; onApply: (n: number) => void }) {
  const [val, setVal] = useState<string>(String(DEFAULT_MAX));
  const apply = () => {
    const n = Math.max(0, Math.floor(Number(val) || 0));
    if (!confirm(`Set max tasks to ${n} for all ${count} tax-team member${count === 1 ? "" : "s"}? This overwrites existing per-row values.`)) return;
    onApply(n);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--bg-soft)", border: "1px dashed var(--border)", borderRadius: 8, marginBottom: 12, flexWrap: "wrap" }}>
      <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
        <Icon name="layers" size={13} /> Set the same ceiling for everyone:
      </div>
      <input
        type="number"
        min={0}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        style={{ width: 80, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 13 }}
      />
      <button
        type="button"
        onClick={apply}
        className="btn ghost"
        style={{ fontSize: 12.5 }}
      >
        Apply to all {count}
      </button>
    </div>
  );
}

export function TaxCapacityCard({ rows: initialRows, headName, leadName, taxCapacityDefault: initialDefault }: Props) {
  const [rows, setRows] = useState<CapacityRow[]>(initialRows);
  const [saving, startSave] = useTransition();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [query, setQuery] = useState("");
  const [defaultMax, setDefaultMax] = useState<string>(String(initialDefault));
  const [defaultSaved, setDefaultSaved] = useState(false);

  const setMax = (id: string, value: string) => {
    const n = value.trim() === "" ? null : Math.max(0, Math.floor(Number(value) || 0));
    setRows((r) => r.map((row) => (row.id === id ? { ...row, maxTasks: n } : row)));
  };

  const persist = (row: CapacityRow) => {
    startSave(async () => {
      const res = await saveAmCapacity({ teamMemberId: row.id, maxTasks: row.maxTasks ?? DEFAULT_MAX });
      if (!res.error) {
        setSavedId(row.id);
        setTimeout(() => setSavedId(null), 1500);
      }
    });
  };

  useEffect(() => {
    if (!adding) return;
    listTaxAddCandidates().then(setCandidates);
  }, [adding]);

  const present = new Set(rows.map((r) => r.id));
  const filtered = candidates
    .filter((c) => !present.has(c.id))
    .filter((c) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || (c.title ?? "").toLowerCase().includes(q) || c.role.toLowerCase().includes(q);
    })
    .slice(0, 30);

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="users" size={16} />
          <div style={{ fontSize: 14, fontWeight: 700 }}>Tax team capacity</div>
          {headName && (
            <span style={{ fontSize: 11.5, color: "var(--ink-3)", padding: "2px 8px", borderRadius: 999, background: "var(--bg-soft)" }}>
              Head: <strong>{headName}</strong>
            </span>
          )}
          {leadName && (
            <span style={{ fontSize: 11.5, color: "var(--ink-3)", padding: "2px 8px", borderRadius: 999, background: "var(--bg-soft)" }}>
              Lead: <strong>{leadName}</strong>
            </span>
          )}
        </div>
        <button
          className="btn ghost"
          onClick={() => setAdding((v) => !v)}
          style={{ fontSize: 12.5 }}
        >
          <Icon name={adding ? "x" : "plus"} size={13} /> {adding ? "Cancel" : "Add member"}
        </button>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.55, marginBottom: 10 }}>
        Members from the Tax Head&apos;s org-chart subtree plus anyone the Master Admin has added. The urgent-compliance auto-assigner picks the member with the lowest current load below their ceiling.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "10px 12px", background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8 }}>
        <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 600 }}>Default ceiling for new members:</div>
        <input
          type="number"
          min={0}
          value={defaultMax}
          onChange={(e) => setDefaultMax(e.target.value)}
          style={{ width: 80, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 13 }}
        />
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>runs / member</span>
        <button
          type="button"
          className="btn ghost"
          style={{ fontSize: 12.5 }}
          disabled={saving}
          onClick={() => startSave(async () => {
            const n = Math.max(0, Math.floor(Number(defaultMax) || 0));
            const res = await saveTaxCapacityDefault(n);
            if (!res.error) { setDefaultMax(String(n)); setDefaultSaved(true); setTimeout(() => setDefaultSaved(false), 1500); }
          })}
        >
          {defaultSaved ? "Saved ✓" : "Save"}
        </button>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>(applies when a new member is added to the team)</span>
      </div>

      {rows.length > 0 && (
        <BulkSetBar
          count={rows.length}
          onApply={(n) => startSave(async () => {
            const res = await setAllTaxCapacity(n);
            if (!res.error) {
              setRows((r) => r.map((row) => ({ ...row, maxTasks: n })));
            }
          })}
        />
      )}

      {adding && (
        <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 12 }}>
          <input
            type="text"
            placeholder="Search by name, title, or role…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: "100%", padding: "6px 10px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, marginBottom: 8 }}
            autoFocus
          />
          <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, background: "#fff" }}>
            {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12.5, color: "var(--ink-3)" }}>{candidates.length ? "No matches." : "Loading…"}</div>}
            {filtered.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => startSave(async () => {
                  const res = await addTaxTeamMember(c.id);
                  if (!res.error) {
                    setRows((r) => [...r, { id: c.id, name: c.name, role: c.role, title: c.title, isHead: false, isLead: false, isExtra: true, maxTasks: DEFAULT_MAX, currentLoad: 0, autoLoad: 0, loadOverride: null }]);
                    setAdding(false);
                    setQuery("");
                  }
                })}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: "none", borderTop: "1px solid var(--border)", background: "transparent", cursor: "pointer", fontSize: 13 }}
              >
                <strong>{c.name}</strong>{" "}
                <span style={{ color: "var(--ink-3)" }}>· {c.role.replace("_", " ")}{c.title ? ` · ${c.title}` : ""}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!rows.length && (
        <div style={{ background: "var(--bg-soft)", border: "1px dashed var(--border)", borderRadius: 8, padding: "12px 14px", fontSize: 12.5, color: "var(--ink-3)" }}>
          No tax-team members configured yet. Set the Tax Head&apos;s reports in the Org Chart, or click <strong>Add member</strong> above.
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr 110px 38px", padding: "8px 12px", background: "var(--bg-soft)", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)" }}>
            <div>Member</div>
            <div>Role / Title</div>
            <div>Auto load</div>
            <div>Manual override</div>
            <div>Max tasks</div>
            <div></div>
            <div></div>
          </div>
          {rows.map((row) => {
            const ratio = row.maxTasks && row.maxTasks > 0 ? row.currentLoad / row.maxTasks : null;
            const full = ratio != null && ratio >= 1;
            const warn = ratio != null && ratio >= 0.8 && !full;
            const loadColor = full ? "#dc2626" : warn ? "#d97706" : "#475569";
            return (
              <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr 1fr 110px 38px", padding: "10px 12px", borderTop: "1px solid var(--border)", alignItems: "center", fontSize: 13 }}>
                <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  {row.name}
                  {row.isHead && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "var(--orange-soft)", color: "var(--orange)" }}>HEAD</span>}
                  {row.isLead && !row.isHead && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#fef3c7", color: "#92400e" }}>LEAD</span>}
                  {row.isExtra && !row.isHead && !row.isLead && <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#e0e7ff", color: "#3730a3" }}>ADDED</span>}
                </div>
                <div style={{ color: "var(--ink-3)", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ textTransform: "capitalize" }}>{row.role.replace("_", " ")}</span>
                  {row.title && <span> · {row.title}</span>}
                </div>
                {/* Auto load — read only, shows system-calculated value */}
                <div style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
                  {row.autoLoad}
                  {row.loadOverride != null && <span style={{ marginLeft: 5, fontSize: 10, color: "#8b5cf6" }}>overridden</span>}
                </div>
                {/* Manual override — editable; blank = use auto */}
                <div>
                  <input
                    type="number"
                    min={0}
                    value={row.loadOverride ?? ""}
                    placeholder="auto"
                    title="Leave blank to use auto-calculated load"
                    onChange={(e) => {
                      const val = e.target.value.trim() === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0));
                      setRows((r) => r.map((x) => x.id === row.id ? { ...x, loadOverride: val, currentLoad: val ?? x.autoLoad } : x));
                    }}
                    onBlur={() => startSave(async () => {
                      await saveLoadOverride(row.id, row.loadOverride);
                      setSavedId(row.id);
                      setTimeout(() => setSavedId(null), 1500);
                    })}
                    style={{ width: 72, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 13, color: row.loadOverride != null ? "#8b5cf6" : "inherit" }}
                  />
                </div>
                {/* Effective load indicator */}
                <div style={{ color: loadColor, fontWeight: 600 }}>
                  {row.currentLoad}{row.maxTasks != null ? ` / ${row.maxTasks}` : ""}
                  {full && <span style={{ marginLeft: 6, fontSize: 11, background: "#fef2f2", color: "#dc2626", padding: "1px 6px", borderRadius: 4 }}>FULL</span>}
                </div>
                <div>
                  <input
                    type="number"
                    min={0}
                    value={row.maxTasks ?? ""}
                    placeholder={String(DEFAULT_MAX)}
                    onChange={(e) => setMax(row.id, e.target.value)}
                    onBlur={() => persist(row)}
                    style={{ width: 80, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 13 }}
                  />
                </div>
                <div style={{ textAlign: "center" }}>
                  {savedId === row.id && <span style={{ fontSize: 11, color: "#10b981" }}>✓</span>}
                  {row.isExtra && !row.isHead && (
                    <button
                      type="button"
                      title="Remove from tax team"
                      onClick={() => startSave(async () => {
                        const res = await removeTaxTeamMember(row.id);
                        if (!res.error) setRows((r) => r.filter((x) => x.id !== row.id));
                      })}
                      disabled={saving}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: 14 }}
                    >×</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
