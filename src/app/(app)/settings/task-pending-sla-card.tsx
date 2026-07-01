"use client";

import { useState, useTransition } from "react";
import { saveFollowupConfig } from "./actions";

interface Props {
  clientDataRefireDays: number;
  taskPendingSLADays: number;
  tlEscalationDays: number;
  amEscalationDays: number;
  complianceReminderDays: number;
}

export function TaskPendingSlaCard({
  clientDataRefireDays,
  taskPendingSLADays,
  tlEscalationDays,
  amEscalationDays,
  complianceReminderDays,
}: Props) {
  const [refireDays, setRefireDays] = useState(String(clientDataRefireDays));
  const [pendingDays, setPendingDays] = useState(String(taskPendingSLADays));
  const [tlDays, setTlDays] = useState(String(tlEscalationDays));
  const [amDays, setAmDays] = useState(String(amEscalationDays));
  const [reminderDays, setReminderDays] = useState(String(complianceReminderDays));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setErr(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveFollowupConfig({
        clientDataRefireDays: Math.max(1, Math.floor(Number(refireDays) || 3)),
        taskPendingSLADays: Math.max(1, Math.floor(Number(pendingDays) || 3)),
        tlEscalationDays: Math.max(1, Math.floor(Number(tlDays) || 2)),
        amEscalationDays: Math.max(1, Math.floor(Number(amDays) || 1)),
        complianceReminderDays: Math.max(1, Math.floor(Number(reminderDays) || 30)),
      });
      if (res.error) { setErr(res.error); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  };

  const row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const };
  const input = { width: 72, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 13 };
  const label = { fontSize: 13, color: "var(--ink-2)" };
  const sub = { fontSize: 12, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 6 };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Action Item Configuration</div>
      <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 20 }}>
        Controls when the daily scan turns something pending into an Action Item, and how it escalates if nobody actions it. Changes take effect on the next daily cron run.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={sub}>a) Client data</div>
          <div style={row}>
            <span style={label}>Pending documents / access not yet shared become an Action Item immediately — no waiting window. If still open</span>
            <input type="number" min={1} max={30} value={refireDays} onChange={(e) => setRefireDays(e.target.value)} style={input} />
            <span style={label}>day(s) after being closed, it re-fires.</span>
          </div>
        </div>

        <div>
          <div style={sub}>b) Team tasks</div>
          <div style={row}>
            <span style={label}>Any team task pending more than</span>
            <input type="number" min={1} max={30} value={pendingDays} onChange={(e) => setPendingDays(e.target.value)} style={input} />
            <span style={label}>day(s) becomes an Action Item.</span>
          </div>
        </div>

        <div>
          <div style={sub}>c) TL</div>
          <div style={row}>
            <span style={label}>If a team member hasn&apos;t actioned their item after</span>
            <input type="number" min={1} max={14} value={tlDays} onChange={(e) => setTlDays(e.target.value)} style={input} />
            <span style={label}>day(s), it shoots to their Team Lead.</span>
          </div>
        </div>

        <div>
          <div style={sub}>d) AM</div>
          <div style={row}>
            <span style={label}>If the Team Lead hasn&apos;t actioned it after</span>
            <input type="number" min={1} max={14} value={amDays} onChange={(e) => setAmDays(e.target.value)} style={input} />
            <span style={label}>day(s), it shoots to the AM.</span>
          </div>
        </div>

        <div>
          <div style={sub}>Compliance deadline reminder</div>
          <div style={row}>
            <span style={label}>Create an Action Item</span>
            <input type="number" min={1} max={120} value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} style={input} />
            <span style={label}>day(s) before a compliance deadline — sent to the team member, TL &amp; AM.</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20 }}>
        <button type="button" className="btn primary" disabled={pending} onClick={save} style={{ fontSize: 13, padding: "6px 20px" }}>
          {pending ? "Saving…" : "Save all"}
        </button>
        {saved && <span style={{ fontSize: 12.5, color: "var(--green)" }}>Saved</span>}
        {err && <span style={{ fontSize: 12.5, color: "var(--red)" }}>{err}</span>}
      </div>
    </div>
  );
}
