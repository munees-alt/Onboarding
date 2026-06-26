"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { runWeeklyScanNow, markSent, type WeeklyUpdateRow } from "./actions";

type SentChannel = "manual" | "call" | "whatsapp" | "email" | "other";

function fmtWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function WeeklyUpdatesView({ rows, loadError }: { rows: WeeklyUpdateRow[]; loadError: string | null }) {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const drafts = rows.filter((r) => r.status === "draft");
  const sent = rows.filter((r) => r.status === "sent");
  const skipped = rows.filter((r) => r.status === "skipped");

  const onScan = async () => {
    setScanning(true);
    const res = await runWeeklyScanNow();
    setScanning(false);
    if (res.error) setFlash(res.error);
    else setFlash(`${res.created} draft(s) generated.`);
    setTimeout(() => setFlash(null), 4000);
    router.refresh();
  };

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 980 }}>
        <div className="section-head" style={{ marginBottom: 12 }}>
          <div>
            <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
              Weekly Client Updates <span className="pill" style={{ fontSize: 10 }}>Master Admin</span>
            </h2>
            <div className="sub">
              Drafts auto-created every Thursday 9am UAE for every active onboarding client. Edit, compose,
              and send via Gmail or WhatsApp. Drafts unsent by Friday 9am surface in Action Items.
            </div>
          </div>
          <button className="btn ghost" disabled={scanning} onClick={onScan}>
            <Icon name="refresh-cw" size={13} /> {scanning ? "Generating…" : "Generate drafts now"}
          </button>
        </div>

        {loadError && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", color: "#7f1d1d", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>
            {loadError}
          </div>
        )}
        {flash && (
          <div style={{ background: "#ecfdf5", border: "1px solid #34d399", color: "#065f46", padding: "8px 12px", borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>
            {flash}
          </div>
        )}

        <Section title={`Drafts · ${drafts.length}`} empty="No drafts yet. Hit ‘Generate drafts now’ to build this week.">
          {drafts.map((r) => <RowCard key={r.id} r={r} />)}
        </Section>

        <Section title={`Sent · ${sent.length}`} empty="Nothing sent yet this period.">
          {sent.map((r) => <RowCard key={r.id} r={r} />)}
        </Section>

        {skipped.length > 0 && (
          <Section title={`Skipped · ${skipped.length}`} empty="">
            {skipped.map((r) => <RowCard key={r.id} r={r} />)}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const childrenArr = Array.isArray(children) ? children : [children];
  const hasContent = childrenArr.filter(Boolean).length > 0;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-3)", marginBottom: 8 }}>{title}</div>
      {hasContent ? <div style={{ display: "grid", gap: 8 }}>{children}</div> : empty ? (
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "20px", textAlign: "center", color: "var(--ink-3)", fontSize: 12.5 }}>{empty}</div>
      ) : null}
    </div>
  );
}

function RowCard({ r }: { r: WeeklyUpdateRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picking, setPicking] = useState(false);
  const [channel, setChannel] = useState<SentChannel>("manual");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const completed = (r.completed_tasks ?? []).length;
  const inprog = (r.inprogress_tasks ?? []).length;
  const ca = (r.client_action_tasks ?? []).length;
  const statusColor =
    r.status === "sent" ? "#15803d" :
    r.status === "skipped" ? "#475569" :
    "#ea580c";

  const confirm = () => start(async () => {
    setErr(null);
    const res = await markSent(r.id, channel, undefined, note);
    if (res.error) { setErr(res.error); return; }
    setPicking(false);
    setNote("");
    router.refresh();
  });

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderLeft: `3px solid ${statusColor}`, borderRadius: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <Link href={`/weekly-updates/${r.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 3, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{r.clientName ?? "Client"}</span>
            {r.status === "draft" && (
              <button
                className="btn ghost"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPicking((v) => !v); }}
                style={{ fontSize: 11, padding: "2px 8px", height: "auto" }}
                title="Mark as already sent — e.g. you covered it on a call"
              >
                <Icon name="check" size={11} /> Mark sent
              </button>
            )}
            <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: statusColor, color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em" }}>{r.status}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
            Week of {fmtWeek(r.week_of)} · {completed} done · {inprog} in progress · {ca} client action{ca === 1 ? "" : "s"}
            {r.sent_at && r.sent_via ? ` · sent via ${r.sent_via}` : ""}
          </div>
        </Link>
      </div>
      {picking && r.status === "draft" && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", background: "#fafafa" }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)", fontWeight: 600 }}>Sent via:</span>
          {(["manual", "call", "whatsapp", "email", "other"] as SentChannel[]).map((c) => (
            <label key={c} style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 4, textTransform: "capitalize" }}>
              <input type="radio" name={`ch-${r.id}`} checked={channel === c} onChange={() => setChannel(c)} /> {c === "manual" ? "Handled manually" : c}
            </label>
          ))}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. 'covered on call 25 Jun')"
            style={{ flex: "1 1 200px", minWidth: 160, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}
          />
          <button className="btn primary" disabled={pending} onClick={confirm} style={{ fontSize: 12 }}>Confirm</button>
          <button className="btn ghost" disabled={pending} onClick={() => { setPicking(false); setErr(null); setNote(""); }} style={{ fontSize: 12 }}>Cancel</button>
          {err && <span style={{ fontSize: 11.5, color: "#b91c1c", width: "100%" }}>{err}</span>}
        </div>
      )}
    </div>
  );
}
