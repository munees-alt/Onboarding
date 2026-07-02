"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { createAuditLiquidationCase } from "./actions";

type CaseCard = {
  id: string;
  clientName: string;
  currentStage: number;
  stageCount: number;
  progress: number;
  status: string;
  amName: string | null;
  teamLeadName: string | null;
};

type Board = {
  flow: string;
  templateId: string;
  name: string;
  stages: { no: number; name: string }[];
  cards: CaseCard[];
};

const isDone = (s: string) => s === "complete" || s === "closed";

// Rotating accent palette for the in-progress stage columns/chips. The final
// stage (where completed cases also land) always gets the "done" green so it
// reads as the end of the pipeline regardless of how many stages precede it.
const STAGE_PALETTE = ["#78716c", "#2563eb", "#8b5cf6", "#f59e0b", "#0d9488", "#ea580c"];
const DONE_ACCENT = "#16a34a";
function stageAccent(no: number, isLast: boolean) {
  if (isLast) return DONE_ACCENT;
  return STAGE_PALETTE[(no - 1) % STAGE_PALETTE.length];
}

const AVATAR_COLORS = ["#f97316", "#8b5cf6", "#0ea5e9", "#e11d48", "#14b8a6", "#f59e0b"];
function avatarColor(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

type SortKey = "client" | "progress";

export function AuditLiquidationView({
  boards,
  clients,
  canCreate,
  title,
  lockedFlow,
}: {
  boards: Board[];
  clients: { id: string; name: string }[];
  canCreate: boolean;
  title?: string;
  lockedFlow?: "audit" | "liquidation" | "catchup";
}) {
  const [flow, setFlow] = useState(boards[0]?.flow ?? "audit");
  const [newOpen, setNewOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("client");
  const board = boards.find((b) => b.flow === flow) ?? boards[0];

  const assigneeOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of board?.cards ?? []) {
      const name = c.teamLeadName ?? c.amName;
      if (name) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [board]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = (board?.cards ?? []).filter((c) => {
      const assignee = c.teamLeadName ?? c.amName;
      if (q && !c.clientName.toLowerCase().includes(q)) return false;
      if (assigneeFilter === "__unassigned") { if (assignee) return false; }
      else if (assigneeFilter !== "all" && assignee !== assigneeFilter) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === "progress") return b.progress - a.progress || a.clientName.localeCompare(b.clientName);
      return a.clientName.localeCompare(b.clientName);
    });
    return list;
  }, [board, search, assigneeFilter, sort]);

  const columns = useMemo(() => {
    if (!board) return [] as { no: number; name: string; cards: CaseCard[] }[];
    const cols = board.stages.map((s) => ({ no: s.no, name: s.name, cards: [] as CaseCard[] }));
    const lastNo = board.stages.length;
    for (const c of filtered) {
      // Completed cases sit in the final stage column; otherwise the current stage.
      const targetNo = isDone(c.status) ? lastNo : Math.min(Math.max(c.currentStage, 1), lastNo);
      (cols.find((col) => col.no === targetNo) ?? cols[cols.length - 1])?.cards.push(c);
    }
    return cols;
  }, [board, filtered]);

  const total = board?.cards.length ?? 0;
  const lastStageNo = board?.stages.length ?? 0;

  const chips: { label: string; onRemove: () => void }[] = [];
  if (search.trim()) chips.push({ label: `"${search.trim()}"`, onRemove: () => setSearch("") });
  if (assigneeFilter !== "all") chips.push({ label: assigneeFilter === "__unassigned" ? "Unassigned" : assigneeFilter, onRemove: () => setAssigneeFilter("all") });

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: "none" }}>
        <div className="bk-wrap">
          <div className="bk-head">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div className="bk-title-row">
                <h1 className="bk-title">{title ?? "Liquidation & Audit"}</h1>
                <span className="bk-badge">{total} case{total === 1 ? "" : "s"}</span>
              </div>
              {canCreate && (
                <button className="btn-primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={15} /> New case</button>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: "#78716c", marginTop: 4 }}>
              Cases flow left to right across the stages. Click a card to open and work the case.
            </div>
          </div>

          {/* Flow toggle — only when this view holds more than one board */}
          {boards.length > 1 && (
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 9, padding: 3, gap: 2, marginTop: 14 }}>
              {boards.map((b) => (
                <button
                  key={b.flow}
                  className={"tab-pill" + (flow === b.flow ? " active" : "")}
                  onClick={() => setFlow(b.flow)}
                  style={{ padding: "6px 16px" }}
                >
                  {b.name} <span style={{ opacity: 0.7 }}>· {b.cards.length}</span>
                </button>
              ))}
            </div>
          )}

          {/* Stat chips — one per stage, live-filtered counts */}
          <div className="bk-stats">
            {columns.map((col) => (
              <div className="bk-stat" key={col.no}>
                <span className="bk-stat-dot" style={{ background: stageAccent(col.no, col.no === lastStageNo) }} />
                <span className="bk-stat-count">{col.cards.length}</span>
                <span className="bk-stat-label">{col.name}</span>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="bk-toolbar">
            <div className="bk-toolbar-row">
              <div className="bk-search">
                <Icon name="search" size={16} />
                <input placeholder="Search clients…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>

              <label className="bk-select-wrap">
                <select className="bk-select" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
                  <option value="all">Team lead / AM · All</option>
                  <option value="__unassigned">Unassigned</option>
                  {assigneeOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <Icon name="chevron-down" size={13} className="bk-select-chev" />
              </label>

              <div className="bk-spacer" />

              <label className="bk-select-wrap">
                <select className="bk-select bk-select-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  <option value="client">Client A–Z</option>
                  <option value="progress">Stage progress</option>
                </select>
                <Icon name="arrow-up-down" size={14} className="bk-select-sort-icon" />
                <Icon name="chevron-down" size={13} className="bk-select-chev" />
              </label>
            </div>

            {chips.length > 0 && (
              <div className="bk-chips">
                <span className="bk-chips-label">Filters:</span>
                {chips.map((chip) => (
                  <button key={chip.label} className="bk-chip" onClick={chip.onRemove}>
                    {chip.label}
                    <Icon name="x" size={13} />
                  </button>
                ))}
                <button className="bk-chip-clear" onClick={() => { setSearch(""); setAssigneeFilter("all"); }}>Clear all</button>
              </div>
            )}
          </div>

          {total === 0 ? (
            <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "56px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
              No {board?.name.toLowerCase()} cases yet.{" "}
              {lockedFlow === "catchup"
                ? "Cases arrive when catch-up is escalated from onboarding, or add one with “New case”."
                : "New cases arrive from the “Cadence Audit and Liquidation” email automation, or add one with “New case”."}
            </div>
          ) : (
            <div className="bk-board">
              {columns.map((col) => {
                const accent = stageAccent(col.no, col.no === lastStageNo);
                return (
                  <section className="bk-col" key={col.no}>
                    <div className="bk-col-head">
                      <span className="bk-col-swatch" style={{ background: accent }} />
                      <span className="bk-col-label">{col.no}. {col.name}</span>
                      <span className="bk-col-count">{col.cards.length}</span>
                    </div>
                    <div className="bk-col-cards">
                      {col.cards.map((c) => {
                        const done = isDone(c.status);
                        const assignee = c.teamLeadName ?? c.amName;
                        const pill = done
                          ? { background: "#dcfce7", color: "#15803d" }
                          : { background: "#fff7ed", color: "#c2410c" };
                        return (
                          <article className="bk-card" key={c.id}>
                            <div className="bk-card-head">
                              <Link href={`/onboarding/${c.id}`} className="bk-card-name">{c.clientName}</Link>
                              <span className="bk-pill" style={pill}>{done ? "Completed" : `Stage ${c.currentStage}/${c.stageCount}`}</span>
                            </div>

                            <div className="bk-card-assignee">
                              {assignee ? (
                                <>
                                  <div className="bk-avatar" style={{ width: 22, height: 22, fontSize: 9.5, background: avatarColor(assignee) }}>{initials(assignee)}</div>
                                  <span className="bk-assignee-name">{assignee}</span>
                                </>
                              ) : (
                                <span className="bk-assignee-name" style={{ color: "#f59e0b" }}>Unassigned</span>
                              )}
                            </div>

                            <div className="progress orange" style={{ marginTop: 11 }}><i style={{ width: `${c.progress}%` }} /></div>
                          </article>
                        );
                      })}
                      {col.cards.length === 0 && <div className="bk-col-empty">No cases in this stage.</div>}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {newOpen && (
        <NewCaseModal
          clients={clients}
          defaultFlow={(lockedFlow ?? flow) as "audit" | "liquidation" | "catchup"}
          lockedFlow={lockedFlow}
          onClose={() => setNewOpen(false)}
        />
      )}
    </div>
  );
}

function NewCaseModal({
  clients,
  defaultFlow,
  lockedFlow,
  onClose,
}: {
  clients: { id: string; name: string }[];
  defaultFlow: "audit" | "liquidation" | "catchup";
  lockedFlow?: "audit" | "liquidation" | "catchup";
  onClose: () => void;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [flow, setFlow] = useState<"audit" | "liquidation" | "catchup">(defaultFlow);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!clientId) { setError("Pick a client."); return; }
    setError(null);
    start(async () => {
      const r = await createAuditLiquidationCase({ clientId, flow });
      if (r.error) { setError(r.error); return; }
      if (r.runId) router.push(`/onboarding/${r.runId}`);
    });
  };

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="hd"><h3>New case</h3><div className="sub">Creates the case and opens it. The team is assigned in the first stage.</div></div>
        <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!lockedFlow && (
            <div className="field">
              <label>Case type</label>
              <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 8, padding: 3, gap: 2 }}>
                <button type="button" className={"tab-pill" + (flow === "audit" ? " active" : "")} onClick={() => setFlow("audit")} style={{ padding: "6px 16px" }}>Audit</button>
                <button type="button" className={"tab-pill" + (flow === "liquidation" ? " active" : "")} onClick={() => setFlow("liquidation")} style={{ padding: "6px 16px" }}>Liquidation</button>
              </div>
            </div>
          )}
          <div className="field">
            <label>Client</label>
            {clients.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--ink-3)" }}>No clients yet. <Link href="/clients" style={{ color: "var(--orange)" }}>Add one →</Link></div>
            ) : (
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          {error && <div style={{ fontSize: 12.5, color: "var(--red)" }}>{error}</div>}
        </div>
        <div className="ft">
          <button className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" disabled={busy || !clientId} onClick={submit}>{busy ? "Creating…" : "Create case"}</button>
        </div>
      </div>
    </div>
  );
}
