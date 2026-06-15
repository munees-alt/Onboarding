"use client";

import { useState, useTransition } from "react";
import { Icon } from "./icon";
import { raiseTicket } from "@/app/(app)/tickets/actions";

const KINDS = [
  { id: "feature", label: "Feature request" },
  { id: "suggestion", label: "Suggestion" },
  { id: "bug", label: "Something's broken" },
];

export function RaiseTicket() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("feature");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, start] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => { setOpen(false); setDone(false); setTitle(""); setBody(""); setKind("feature"); setError(null); };

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await raiseTicket({ kind, title, body });
      if (r.error) setError(r.error);
      else setDone(true);
    });

  return (
    <>
      <button className="icon-btn" title="Raise a request" onClick={() => setOpen(true)} aria-label="Raise a request">
        <Icon name="lightbulb" size={18} />
      </button>

      {open && (
        <div className="modal-overlay open" onClick={close} style={{ zIndex: 90 }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="hd">
              <h3>Raise a request</h3>
              <div className="sub">Suggest a feature or improvement. It goes to the admin to review.</div>
            </div>
            {done ? (
              <div className="bd" style={{ alignItems: "center", textAlign: "center", padding: "30px 22px" }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--green-soft)", color: "var(--green)", display: "grid", placeItems: "center", margin: "0 auto 10px" }}>
                  <Icon name="check" size={22} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>Thanks — sent to the admin</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>You can raise as many as you like.</div>
              </div>
            ) : (
              <div className="bd">
                <div className="field">
                  <label>Type</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {KINDS.map((k) => (
                      <button key={k.id} type="button" className={"tab-pill" + (kind === k.id ? " active" : "")} onClick={() => setKind(k.id)}>{k.label}</button>
                    ))}
                  </div>
                </div>
                <div className="field"><label>Title *</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bulk-assign accountants on a run" /></div>
                <div className="field"><label>Details</label><textarea className="notes" value={body} onChange={(e) => setBody(e.target.value)} placeholder="What would help, and why?" /></div>
                {error && <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8 }}>{error}</div>}
              </div>
            )}
            <div className="ft">
              {done ? (
                <button className="btn-primary" onClick={close}>Done</button>
              ) : (
                <>
                  <button className="btn-ghost" onClick={close} disabled={busy}>Cancel</button>
                  <button className="btn-primary" onClick={submit} disabled={busy || !title.trim()}>{busy ? "Sending…" : "Send request"}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
