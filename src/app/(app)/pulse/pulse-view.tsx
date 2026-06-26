"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { addPulseEntry, deletePulseEntry, setPulseTodoStatus, generateWeeklyDigest, sendDigest, type PulseEntry } from "./actions";

type Activity = { client: string; status?: string; progress?: number; stage?: number; created?: string }[];
type Meetings = { client: string; title: string; date: string; summary: string | null }[];

const CATS: { key: string; label: string; icon: string }[] = [
  { key: "feature", label: "New features shipped", icon: "sparkles" },
  { key: "improvement", label: "Improvements", icon: "trending-up" },
  { key: "security", label: "Security updates", icon: "shield" },
  { key: "feedback", label: "Feedback received", icon: "message-square" },
  { key: "problem", label: "Problems / risks", icon: "alert-triangle" },
  { key: "research", label: "Research", icon: "search" },
  { key: "focus", label: "Focus for the week", icon: "target" },
];
const TODO_STATUS = ["open", "in_progress", "done"];

export function PulseView({ entries, onboardings, meetings }: { entries: PulseEntry[]; onboardings: Activity; meetings: Meetings }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  // Add-entry form
  const [cat, setCat] = useState("feature");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [owner, setOwner] = useState("");

  // Digest
  const [digest, setDigest] = useState<{ subject: string; body: string } | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);

  const add = () => start(async () => {
    const r = await addPulseEntry(cat, title, detail, cat === "todo" ? owner : undefined);
    if (r.error) note(r.error);
    else { setTitle(""); setDetail(""); setOwner(""); note("Added to the pulse"); router.refresh(); }
  });
  const del = (id: string) => start(async () => { await deletePulseEntry(id); router.refresh(); });
  const setStatus = (id: string, status: string) => start(async () => { await setPulseTodoStatus(id, status); router.refresh(); });

  const generate = async () => {
    setGenBusy(true);
    const r = await generateWeeklyDigest();
    setGenBusy(false);
    if (r.error) note(r.error);
    else setDigest({ subject: r.subject ?? "Weekly Digest", body: r.body ?? "" });
  };
  const copy = () => { if (!digest) return; navigator.clipboard?.writeText(`Subject: ${digest.subject}\n\n${digest.body}`); setCopied(true); setTimeout(() => setCopied(false), 1800); };
  const send = () => start(async () => {
    if (!digest) return;
    const r = await sendDigest(to, digest.subject, digest.body);
    note(r.error ?? "Digest emailed to management");
  });

  const todos = entries.filter((e) => e.category === "todo");

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 920 }}>
        <div className="section-head">
          <div>
            <h2>Weekly Pulse <span className="pill" style={{ fontSize: 10, marginLeft: 6 }}>Master Admin</span></h2>
            <div className="sub">Everything happening with Cadence — features, improvements, security, feedback, meetings, onboardings and the week&apos;s focus. Generates the management digest email.</div>
          </div>
          <button className="btn-primary" disabled={genBusy} onClick={generate}><Icon name="mail" size={14} /> {genBusy ? "Preparing…" : "Generate weekly digest"}</button>
        </div>

        {/* Digest preview */}
        {digest && (
          <div className="runs-card" style={{ padding: 16, marginBottom: 16, borderLeft: "3px solid var(--orange)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{digest.subject}</div>
            <textarea value={digest.body} onChange={(e) => setDigest({ ...digest, body: e.target.value })} style={{ width: "100%", minHeight: 320, fontFamily: "inherit", fontSize: 13, lineHeight: 1.6, border: "1px solid var(--border)", borderRadius: 8, padding: 12 }} />
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button className="btn-ghost" onClick={copy}><Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}</button>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="management@finanshels.com, …" style={{ flex: 1, minWidth: 220, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
              <button className="btn-primary" disabled={busy || !to.trim()} onClick={send}><Icon name="send" size={13} /> Send to management</button>
            </div>
          </div>
        )}

        {/* Add entry */}
        <div className="runs-card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Add to the pulse</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>
              {[...CATS.map((c) => ({ key: c.key, label: c.label })), { key: "meeting", label: "Meeting note" }, { key: "todo", label: "Management to-do" }].map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ flex: 1, minWidth: 200, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
            {cat === "todo" && <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner (optional)" style={{ width: 160, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />}
          </div>
          <textarea value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Detail (optional)" style={{ width: "100%", minHeight: 50, marginTop: 8, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
          <button className="btn-primary" disabled={busy || !title.trim()} onClick={add} style={{ marginTop: 8 }}><Icon name="plus" size={13} /> Add</button>
        </div>

        {/* Management to-dos */}
        <Section icon="list-checks" label={`Management to-dos · ${todos.length}`}>
          {todos.length === 0 ? <Empty /> : todos.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
              <select value={e.status ?? "open"} onChange={(ev) => setStatus(e.id, ev.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "3px 6px", fontSize: 12 }}>
                {TODO_STATUS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, textDecoration: e.status === "done" ? "line-through" : "none", color: e.status === "done" ? "var(--ink-3)" : "var(--ink-1)" }}>{e.title}</div>
                {(e.detail || e.owner) && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{e.owner ? `Owner: ${e.owner}` : ""}{e.owner && e.detail ? " · " : ""}{e.detail ?? ""}</div>}
              </div>
              <button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => del(e.id)}><Icon name="trash-2" size={13} /></button>
            </div>
          ))}
        </Section>

        {/* Category sections */}
        {CATS.map((c) => {
          const items = entries.filter((e) => e.category === c.key);
          return (
            <Section key={c.key} icon={c.icon} label={`${c.label} · ${items.length}`}>
              {items.length === 0 ? <Empty /> : items.map((e) => (
                <div key={e.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{e.title}</div>
                    {e.detail && <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.5 }}>{e.detail}</div>}
                    <div style={{ fontSize: 10.5, color: "var(--ink-4)", marginTop: 2 }}>{e.entry_date}{e.created_by ? ` · ${e.created_by}` : ""}</div>
                  </div>
                  <button className="icon-btn" style={{ color: "var(--red)" }} onClick={() => del(e.id)}><Icon name="trash-2" size={13} /></button>
                </div>
              ))}
            </Section>
          );
        })}

        {/* Live activity (auto-pulled) */}
        <Section icon="user-plus" label={`Onboardings — last 2 weeks · ${onboardings.length}`}>
          {onboardings.length === 0 ? <Empty text="No onboardings created in this period." /> : onboardings.map((o, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{o.client}</span>
              <span style={{ color: "var(--ink-3)" }}>{o.status} · {o.progress}% · stage {o.stage}</span>
            </div>
          ))}
        </Section>
        <Section icon="mic" label={`Meetings — last 2 weeks · ${meetings.length}`}>
          {meetings.length === 0 ? <Empty text="No client meetings recorded in this period." /> : meetings.map((m, i) => (
            <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{m.client} — {m.title}</div>
              {m.summary && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{m.summary}</div>}
            </div>
          ))}
        </Section>
      </div>
      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}

function Section({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className="runs-card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}><Icon name={icon} size={14} /> {label}</div>
      {children}
    </div>
  );
}
function Empty({ text }: { text?: string }) {
  return <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>{text ?? "Nothing recorded yet."}</div>;
}
