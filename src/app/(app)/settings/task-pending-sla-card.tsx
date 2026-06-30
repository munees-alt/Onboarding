"use client";

import { useState, useTransition } from "react";
import { saveFollowupConfig } from "./actions";

interface Props {
  taskPendingSLADays: number;
  docsOverdueDays: number;
  accessOverdueDays: number;
  taskOverdueDays: number;
  noteExtensionDays: number;
  complianceReminderDays: number;
  teamEscalationDays: number;
}

export function TaskPendingSlaCard({
  taskPendingSLADays,
  docsOverdueDays,
  accessOverdueDays,
  taskOverdueDays,
  noteExtensionDays,
  complianceReminderDays,
  teamEscalationDays,
}: Props) {
  const [days, setDays] = useState(String(taskPendingSLADays));
  const [reminderDays, setReminderDays] = useState(String(complianceReminderDays));
  const [escalDays, setEscalDays] = useState(String(teamEscalationDays));
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    setErr(null);
    setSaved(false);
    startTransition(async () => {
      const res = await saveFollowupConfig({
        docsOverdueDays,
        accessOverdueDays,
        taskOverdueDays,
        noteExtensionDays,
        taskPendingSLADays: Math.max(1, Math.floor(Number(days) || 3)),
        complianceReminderDays: Math.max(1, Math.floor(Number(reminderDays) || 30)),
        teamEscalationDays: Math.max(1, Math.floor(Number(escalDays) || 2)),
      });
      if (res.error) { setErr(res.error); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  };

  const row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const };
  const input = { width: 72, border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", fontSize: 13 };
  const label = { fontSize: 13, color: "var(--ink-2)" };

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Automation &amp; SLA Settings</div>
      <div style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 20 }}>
        Configure thresholds for automated action items. Changes take effect on the next daily cron run.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 6 }}>
            Team task pending alert
          </div>
          <div style={row}>
            <span style={label}>Alert AM after</span>
            <input type="number" min={1} max={30} value={days} onChange={(e) => setDays(e.target.value)} style={input} />
            <span style={label}>day(s) a team task has been pending</span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 6 }}>
            Compliance deadline reminder
          </div>
          <div style={row}>
            <span style={label}>Create action item</span>
            <input type="number" min={1} max={120} value={reminderDays} onChange={(e) => setReminderDays(e.target.value)} style={input} />
            <span style={label}>day(s) before a compliance deadline — sent to AM &amp; master admin</span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 6 }}>
            Team task escalation
          </div>
          <div style={row}>
            <span style={label}>Escalate to manager after</span>
            <input type="number" min={1} max={14} value={escalDays} onChange={(e) => setEscalDays(e.target.value)} style={input} />
            <span style={label}>day(s) unactioned — team member → team lead → AM</span>
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
