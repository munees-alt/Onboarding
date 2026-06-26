"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import {
  saveUpdate, regenerateDraft, composeDraft, sendEmail, markSent, skipUpdate,
  type WeeklyUpdateRow, type TaskItem, type KeyDate,
} from "../actions";

function fmtWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function DraftEditor({ row }: { row: WeeklyUpdateRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const [completed, setCompleted] = useState<TaskItem[]>(row.completed_tasks ?? []);
  const [inprog, setInprog] = useState<TaskItem[]>(row.inprogress_tasks ?? []);
  const [clientActs, setClientActs] = useState<TaskItem[]>(row.client_action_tasks ?? []);
  const [notes, setNotes] = useState<Record<string, string>>(row.per_task_notes ?? {});
  const [extraClient, setExtraClient] = useState<string>(row.extra_client_actions ?? "");
  const [keyDates, setKeyDates] = useState<KeyDate[]>(row.key_dates ?? []);
  const [feedback, setFeedback] = useState<string>(row.feedback_link ?? "");
  const [feedbackOn, setFeedbackOn] = useState<boolean>(!!row.feedback_link);

  const [subject, setSubject] = useState<string>(row.subject ?? "");
  const [emailBody, setEmailBody] = useState<string>(row.email_body ?? "");
  const [waBody, setWaBody] = useState<string>(row.whatsapp_body ?? "");

  const [tab, setTab] = useState<"email" | "whatsapp">("email");
  const [to, setTo] = useState<string>(row.clientEmail ?? "");
  const [skipping, setSkipping] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [marking, setMarking] = useState(false);
  const [markChannel, setMarkChannel] = useState<"manual" | "call" | "whatsapp" | "email" | "other">("manual");
  const [markNote, setMarkNote] = useState("");

  const setNote = (id: string, v: string) => setNotes((n) => ({ ...n, [id]: v }));

  const persist = () => start(async () => {
    const r = await saveUpdate(row.id, {
      per_task_notes: notes,
      extra_client_actions: extraClient,
      key_dates: keyDates,
      feedback_link: feedbackOn ? (feedback.trim() || null) : null,
      subject,
      email_body: emailBody,
      whatsapp_body: waBody,
    });
    note(r.error ?? "Saved");
  });

  const regen = () => start(async () => {
    const r = await regenerateDraft(row.id);
    if (r.error) { note(r.error); return; }
    note("Tasks refreshed from board.");
    router.refresh();
  });

  const compose = () => start(async () => {
    // Save edits first so the AI sees current notes / key dates / extras.
    await saveUpdate(row.id, { per_task_notes: notes, extra_client_actions: extraClient, key_dates: keyDates, feedback_link: feedbackOn ? (feedback.trim() || null) : null });
    const r = await composeDraft(row.id);
    if (r.error) { note(r.error); return; }
    if (r.subject) setSubject(r.subject);
    if (r.email_body) setEmailBody(r.email_body);
    if (r.whatsapp_body) setWaBody(r.whatsapp_body);
    note("Draft generated.");
  });

  const doSend = () => start(async () => {
    const r = await sendEmail(row.id, to, subject, emailBody);
    if (r.error) { note(r.error); return; }
    note("Email sent and update marked sent.");
    router.refresh();
  });

  const doWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(waBody)}`;
    window.open(url, "_blank", "noopener");
    note("WhatsApp opened — pick the contact and send.");
  };
  const doMarkSent = () => start(async () => {
    const r = await markSent(row.id, "whatsapp");
    if (r.error) { note(r.error); return; }
    note("Marked sent via WhatsApp.");
    router.refresh();
  });
  const doMarkSentManual = () => start(async () => {
    const r = await markSent(row.id, markChannel, undefined, markNote);
    if (r.error) { note(r.error); return; }
    note(`Marked sent via ${markChannel}.`);
    setMarking(false);
    setMarkNote("");
    router.refresh();
  });
  const doCopy = (txt: string, label: string) => {
    navigator.clipboard?.writeText(txt);
    note(`${label} copied`);
  };

  const doSkip = () => start(async () => {
    const r = await skipUpdate(row.id, skipReason);
    if (r.error) { note(r.error); return; }
    note("Skipped this week.");
    router.refresh();
  });

  const isSent = row.status === "sent";
  const isSkipped = row.status === "skipped";
  const snap = row.status_snapshot;

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 920 }}>
        {/* Top header */}
        <div style={{ marginBottom: 16 }}>
          <Link href="/weekly-updates" style={{ fontSize: 12, color: "var(--ink-3)", textDecoration: "none" }}>← All weekly updates</Link>
          <div className="section-head" style={{ marginTop: 8 }}>
            <div>
              <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {row.clientName ?? "Client"}
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: isSent ? "#15803d" : isSkipped ? "#475569" : "#ea580c", color: "#fff", textTransform: "uppercase", letterSpacing: "0.05em" }}>{row.status}</span>
              </h2>
              <div className="sub">Week of {fmtWeek(row.week_of)}{row.sent_at && row.sent_via ? ` · sent via ${row.sent_via}` : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn ghost" disabled={pending} onClick={regen}><Icon name="refresh-cw" size={13} /> Regenerate from board</button>
              {!isSent && !isSkipped && (
                <>
                  <button className="btn ghost" disabled={pending} onClick={() => { setMarking((v) => !v); setSkipping(false); }} title="Mark this update as already handled — closes the Action Items chip">
                    <Icon name="check" size={13} /> {marking ? "Cancel" : "Mark sent"}
                  </button>
                  <button className="btn ghost" disabled={pending} onClick={() => { setSkipping((v) => !v); setMarking(false); }}>{skipping ? "Cancel skip" : "Skip this week"}</button>
                </>
              )}
            </div>
          </div>
          {marking && !isSent && !isSkipped && (
            <div style={{ marginTop: 8, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>Sent via:</span>
              {(["manual", "call", "whatsapp", "email", "other"] as const).map((c) => (
                <label key={c} style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 4, textTransform: "capitalize" }}>
                  <input type="radio" name="hdr-ch" checked={markChannel === c} onChange={() => setMarkChannel(c)} /> {c === "manual" ? "Handled manually" : c}
                </label>
              ))}
              <input value={markNote} onChange={(e) => setMarkNote(e.target.value)} placeholder="Optional note (e.g. 'covered on call 25 Jun')" style={{ flex: "1 1 220px", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
              <button className="btn primary" disabled={pending} onClick={doMarkSentManual}>Confirm sent</button>
            </div>
          )}
          {skipping && !isSent && !isSkipped && (
            <div style={{ marginTop: 8, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: 12, display: "flex", gap: 8 }}>
              <input value={skipReason} onChange={(e) => setSkipReason(e.target.value)} placeholder="Reason (optional)" style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
              <button className="btn primary" disabled={pending} onClick={doSkip}>Confirm skip</button>
            </div>
          )}
        </div>

        {/* Portal status snapshot (Documents / Intake / COA / Access) */}
        {snap && (snap.docs.total > 0 || snap.access.total > 0 || snap.intake !== "none" || snap.coa !== "none") && (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 10 }}>
            <SnapChip icon="file-text" label="Documents"
              value={snap.docs.total > 0 ? `${snap.docs.received}/${snap.docs.total} requested received` : "No documents requested"}
              done={snap.docs.total > 0 && snap.docs.received === snap.docs.total} />
            <SnapChip icon="clipboard-list" label="Intake form"
              value={snap.intake === "submitted" ? "Submitted" : snap.intake === "awaiting" ? "Awaiting client" : "Not configured"}
              done={snap.intake === "submitted"} />
            <SnapChip icon="check-circle" label="COA sign-off"
              value={snap.coa === "signed_off" ? "Signed off" : snap.coa === "pending" ? "Pending" : "Not started"}
              done={snap.coa === "signed_off"} />
            <SnapChip icon="key-round" label="Access"
              value={snap.access.total > 0 ? `${snap.access.shared}/${snap.access.total} shared` : "No access requested"}
              done={snap.access.total > 0 && snap.access.shared === snap.access.total} />
          </div>
        )}

        {/* Section 1 — Completed */}
        <CardSection icon="check-circle" title={`Completed this week · ${completed.length}`}>
          {completed.length === 0 ? <Empty text="Nothing completed this week." /> : completed.map((t) => (
            <TaskRow key={t.id} t={t} note={notes[t.id] ?? ""} setNote={(v) => setNote(t.id, v)} onToggleNewly={(v) => {
              setCompleted((arr) => arr.map((x) => x.id === t.id ? { ...x, newly_completed: v } : x));
            }} />
          ))}
        </CardSection>

        {/* Section 2 — In progress */}
        <CardSection icon="loader" title={`In progress · ${inprog.length}`}>
          {inprog.length === 0 ? <Empty text="Nothing in progress." /> : inprog.map((t) => (
            <TaskRow key={t.id} t={t} note={notes[t.id] ?? ""} setNote={(v) => setNote(t.id, v)} />
          ))}
        </CardSection>

        {/* Section 3 — Client actions */}
        <CardSection icon="user-check" title={`Client actions needed · ${clientActs.length}`}>
          {clientActs.length === 0 ? <Empty text="No client-side tasks pulled from the board." /> : clientActs.map((t) => (
            <TaskRow key={t.id} t={t} note={notes[t.id] ?? ""} setNote={(v) => setNote(t.id, v)} />
          ))}
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>Additional asks for the client</label>
            <textarea value={extraClient} onChange={(e) => setExtraClient(e.target.value)} placeholder="Anything else we need from the client this week — bank statements, signed forms, etc." style={{ width: "100%", minHeight: 60, marginTop: 6, border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: "inherit" }} />
          </div>
        </CardSection>

        {/* Section 4 — Key dates */}
        <CardSection icon="calendar" title={`Key dates · ${keyDates.length}`}>
          {keyDates.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input type="date" value={d.date.slice(0, 10)} onChange={(e) => setKeyDates((arr) => arr.map((x, ix) => ix === i ? { ...x, date: e.target.value } : x))} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 13 }} />
              <input value={d.label} onChange={(e) => setKeyDates((arr) => arr.map((x, ix) => ix === i ? { ...x, label: e.target.value } : x))} placeholder="What's happening" style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 13 }} />
              <button className="btn ghost" onClick={() => setKeyDates((arr) => arr.filter((_, ix) => ix !== i))}><Icon name="x" size={12} /></button>
            </div>
          ))}
          <button className="btn ghost" onClick={() => setKeyDates((arr) => [...arr, { date: new Date().toISOString().slice(0, 10), label: "" }])}><Icon name="plus" size={12} /> Add date</button>
        </CardSection>

        {/* Section 5 — Feedback link */}
        <CardSection icon="message-square" title="Feedback link">
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8 }}>
            <input type="checkbox" checked={feedbackOn} onChange={(e) => setFeedbackOn(e.target.checked)} />
            Include the feedback form link in this update
          </label>
          {feedbackOn && (
            <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="https://forms.gle/…" style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
          )}
        </CardSection>

        {/* Compose */}
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Compose</h3>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn ghost" disabled={pending} onClick={persist}><Icon name="save" size={13} /> Save</button>
              <button className="btn primary" disabled={pending} onClick={compose}><Icon name="sparkles" size={13} /> {emailBody ? "Regenerate draft" : "Generate draft"}</button>
            </div>
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Subject</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Email body</label>
            <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder="Hit Generate draft to compose, or write your own." style={{ width: "100%", minHeight: 280, border: "1px solid var(--border)", borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.6, fontFamily: "inherit" }} />
          </div>
          <div className="field">
            <label style={{ fontSize: 12, fontWeight: 600 }}>WhatsApp message</label>
            <textarea value={waBody} onChange={(e) => setWaBody(e.target.value)} placeholder="Shorter, casual version for WhatsApp." style={{ width: "100%", minHeight: 110, border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 13, lineHeight: 1.5, fontFamily: "inherit" }} />
          </div>
        </div>

        {/* Send */}
        {!isSent && !isSkipped && (
          <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 15, marginBottom: 10 }}>Send</h3>
            <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 12 }}>
              {(["email", "whatsapp"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 14px", border: "none", background: "transparent", borderBottom: tab === t ? "2px solid var(--ink-1)" : "2px solid transparent", fontSize: 13, fontWeight: tab === t ? 700 : 500, color: tab === t ? "var(--ink-1)" : "var(--ink-3)", cursor: "pointer", textTransform: "capitalize" }}>{t}</button>
              ))}
            </div>
            {tab === "email" ? (
              <div style={{ display: "grid", gap: 8 }}>
                <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn ghost" onClick={() => doCopy(`Subject: ${subject}\n\n${emailBody}`, "Email")}><Icon name="copy" size={13} /> Copy</button>
                  <button className="btn primary" disabled={pending || !emailBody.trim() || !to.trim()} onClick={doSend}><Icon name="send" size={13} /> Send via Gmail</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, fontSize: 12.5, whiteSpace: "pre-wrap", color: "var(--ink-2)" }}>{waBody || "Generate a draft first to see the WhatsApp message."}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn ghost" disabled={!waBody} onClick={() => doCopy(waBody, "WhatsApp message")}><Icon name="copy" size={13} /> Copy</button>
                  <button className="btn ghost" disabled={!waBody} onClick={doWhatsApp}><Icon name="external-link" size={13} /> Open WhatsApp</button>
                  <button className="btn primary" disabled={pending} onClick={doMarkSent}><Icon name="check" size={13} /> Mark sent</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}

function CardSection({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name={icon} size={14} /> {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ fontSize: 12.5, color: "var(--ink-4)" }}>{text}</div>;
}

function SnapChip({ icon, label, value, done }: { icon: string; label: string; value: string; done: boolean }) {
  return (
    <div style={{ flex: "1 1 200px", minWidth: 180, display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: done ? "#f0fdf4" : "var(--bg-soft)", border: `1px solid ${done ? "#86efac" : "var(--border)"}`, borderRadius: 8 }}>
      <Icon name={icon} size={14} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-3)", fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: done ? "#15803d" : "var(--ink-2)" }}>{value}</div>
      </div>
    </div>
  );
}

function TaskRow({ t, note, setNote, onToggleNewly }: { t: TaskItem; note: string; setNote: (v: string) => void; onToggleNewly?: (v: boolean) => void }) {
  const [open, setOpen] = useState(!!note);
  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t.title}</div>
          <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {t.owner_name ? `Owner: ${t.owner_name}` : "Unassigned"}
            {t.due_date ? ` · due ${t.due_date}` : ""}
            {t.status ? ` · ${t.status.replace("_", " ")}` : ""}
          </div>
        </div>
        {onToggleNewly && (
          <label style={{ fontSize: 11.5, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={!!t.newly_completed} onChange={(e) => onToggleNewly(e.target.checked)} />
            Newly completed
          </label>
        )}
        <button className="btn ghost" onClick={() => setOpen((v) => !v)} style={{ fontSize: 11.5 }}>{open ? "Hide note" : note ? "Edit note" : "Add note"}</button>
      </div>
      {open && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Context for the client — e.g. ‘waiting on accountant review by Wed.’"
          style={{ width: "100%", marginTop: 6, minHeight: 48, border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit" }}
        />
      )}
    </div>
  );
}
