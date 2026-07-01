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
  lockedFlow?: "audit" | "liquidation";
}) {
  const [flow, setFlow] = useState(boards[0]?.flow ?? "audit");
  const [newOpen, setNewOpen] = useState(false);
  const board = boards.find((b) => b.flow === flow) ?? boards[0];

  const columns = useMemo(() => {
    if (!board) return [] as { no: number; name: string; cards: CaseCard[] }[];
    const cols = board.stages.map((s) => ({ no: s.no, name: s.name, cards: [] as CaseCard[] }));
    const lastNo = board.stages.length;
    for (const c of board.cards) {
      // Completed cases sit in the final stage column; otherwise the current stage.
      const targetNo = isDone(c.status) ? lastNo : Math.min(Math.max(c.currentStage, 1), lastNo);
      (cols.find((col) => col.no === targetNo) ?? cols[cols.length - 1])?.cards.push(c);
    }
    return cols;
  }, [board]);

  const total = board?.cards.length ?? 0;

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: "none" }}>
        <div className="section-head">
          <div>
            <h2>{title ?? "Liquidation & Audit"}</h2>
            <div className="sub">Cases flow left to right across the stages. Click a card to open and work the case.</div>
          </div>
          {canCreate && (
            <button className="btn-primary" onClick={() => setNewOpen(true)}><Icon name="plus" size={15} /> New case</button>
          )}
        </div>

        {/* Flow toggle — only when this view holds more than one board */}
        {boards.length > 1 && (
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 9, padding: 3, gap: 2, marginBottom: 16 }}>
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

        {total === 0 ? (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "56px 40px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            No {board?.name.toLowerCase()} cases yet. New cases arrive from the &ldquo;Cadence Audit and Liquidation&rdquo; email automation, or add one with &ldquo;New case&rdquo;.
          </div>
        ) : (
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
            {columns.map((col) => (
              <div key={col.no} style={{ flex: "0 0 260px", background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 12, padding: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 10px" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--ink-3)" }}>{col.no}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1, minWidth: 0 }}>{col.name}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", background: "#fff", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 7px" }}>{col.cards.length}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 40 }}>
                  {col.cards.map((c) => (
                    <Link
                      key={c.id}
                      href={`/onboarding/${c.id}`}
                      style={{ display: "block", background: "#fff", border: "1px solid var(--border)", borderLeft: `3px solid ${isDone(c.status) ? "var(--green, #16a34a)" : "var(--orange)"}`, borderRadius: 10, padding: "10px 12px", textDecoration: "none", color: "inherit" }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.clientName}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}>
                        {isDone(c.status) ? "Completed" : `Stage ${c.currentStage}/${c.stageCount}`}
                        {c.teamLeadName ? ` · TL ${c.teamLeadName}` : c.amName ? ` · ${c.amName}` : ""}
                      </div>
                      <div className="progress orange" style={{ marginTop: 8 }}><i style={{ width: `${c.progress}%` }} /></div>
                    </Link>
                  ))}
                  {col.cards.length === 0 && <div style={{ fontSize: 11.5, color: "var(--ink-4)", textAlign: "center", padding: "8px 0" }}>—</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {newOpen && (
        <NewCaseModal
          clients={clients}
          defaultFlow={(lockedFlow ?? flow) as "audit" | "liquidation"}
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
  defaultFlow: "audit" | "liquidation";
  lockedFlow?: "audit" | "liquidation";
  onClose: () => void;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [flow, setFlow] = useState<"audit" | "liquidation">(defaultFlow);
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
