"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { saveMyFathomKey } from "./actions";
import { backfillDriveFolders } from "../clients/actions";

export function MyConnections({
  name, googleEmail, zohoConnected, fathomSet, linked, canBackfill = false, zohoStatus = null, zohoReason = null,
}: {
  name: string; googleEmail: string | null; zohoConnected: boolean; fathomSet: boolean; linked: boolean;
  canBackfill?: boolean; zohoStatus?: string | null; zohoReason?: string | null;
}) {
  const [fathom, setFathom] = useState("");
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<string | null>(null);
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };
  const runBackfill = () => start(async () => {
    setBackfill("Working…");
    const r = await backfillDriveFolders();
    setBackfill(r.error ?? `Done — ${r.created ?? 0} created, ${r.existing ?? 0} already had a folder${r.failed ? `, ${r.failed} failed` : ""}.`);
  });

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 760 }}>
        <div className="section-head"><div><h2>My Connections</h2><div className="sub">Connect your own accounts, {name}. Onboarding folders go to your Drive; emails send from your Gmail.</div></div></div>

        {!linked && (
          <div className="dropzone" style={{ marginBottom: 14, textAlign: "left" }}>Your login isn&apos;t linked to a team-member record yet. Ask an admin to set your email in the Org Chart, then sign in again.</div>
        )}

        <Card title="Google — Gmail & Drive" icon="hard-drive" desc="One connect grants: Drive (create client folders), Gmail SEND (client emails go out from you), Gmail READ (the Cadence Onboarding label is scanned for new leads).">
          {googleEmail ? (
            <>
              <div className="sop-ref-bar"><Icon name="check-circle" size={14} /> Connected{googleEmail !== "connected" ? ` as ${googleEmail}` : ""}<a href="/api/connect/google">Reconnect →</a></div>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.55 }}>
                Granted scopes: Drive · Gmail send · Gmail read · profile. If lead sync from the &quot;Cadence Onboarding&quot; label isn&apos;t working, click <strong>Reconnect</strong> once to re-grant.
              </div>
            </>
          ) : (
            <>
              <a className="btn-primary" href="/api/connect/google" style={{ textDecoration: "none", width: "fit-content" }}><Icon name="link" size={14} /> Connect Google</a>
              <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.55 }}>
                You&apos;ll see a Google consent screen listing four permissions: Drive (folders), Gmail send, Gmail read, and basic profile. Approve all four.
              </div>
            </>
          )}
        </Card>

        <Card title="Zoho Books" icon="book" desc="Import the approved COA and sync books in your own Zoho.">
          {zohoStatus === "connected" && <div className="sop-ref-bar" style={{ marginBottom: 10 }}><Icon name="check-circle" size={14} /> Zoho connected successfully.</div>}
          {zohoStatus === "error" && (
            <div style={{ background: "var(--red-soft)", color: "var(--red)", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, marginBottom: 10 }}>
              <Icon name="alert-triangle" size={13} /> Zoho connection failed{zohoReason ? `: ${zohoReason}` : ""}. Check that the redirect URI in the Zoho API console is exactly <code>{(typeof window !== "undefined" ? window.location.origin : "")}/api/connect/zoho/callback</code> and that the app&apos;s data centre matches your Zoho account.
            </div>
          )}
          {zohoConnected ? (
            <div className="sop-ref-bar"><Icon name="check-circle" size={14} /> Zoho connected<a href="/api/connect/zoho">Reconnect →</a></div>
          ) : (
            <a className="btn-primary" href="/api/connect/zoho" style={{ textDecoration: "none", width: "fit-content" }}><Icon name="link" size={14} /> Connect Zoho Books</a>
          )}
        </Card>

        {canBackfill && (
          <Card title="Client Drive folders" icon="folder" desc="Make sure every current client has its Drive folder id saved — needed for the compliance calendar to read uploaded documents.">
            <button className="btn-primary" disabled={busy} onClick={runBackfill} style={{ width: "fit-content" }}><Icon name="refresh-cw" size={14} /> {busy ? "Working…" : "Backfill client Drive folders"}</button>
            {backfill && <div style={{ fontSize: 12.5, color: /failed|Connect|Only/.test(backfill) ? "var(--red)" : "var(--green)", marginTop: 8 }}>{backfill}</div>}
          </Card>
        )}

        <Card title="Fathom note-taker" icon="mic" desc="Your Fathom API key — call recordings & notes flow into client playbooks.">
          <div className="field">
            <label>Fathom API key {fathomSet && <span className="pill green" style={{ fontSize: 10, marginLeft: 6 }}><span className="dot" /> Saved</span>}</label>
            <input type="password" placeholder={fathomSet ? "•••••••• (saved — paste to replace)" : "Paste your Fathom API key"} value={fathom} onChange={(e) => setFathom(e.target.value)} />
          </div>
          <button className="btn-primary" disabled={busy || !fathom.trim()} onClick={() => start(async () => { const r = await saveMyFathomKey(fathom); note(r.error ?? "Fathom key saved"); setFathom(""); })}>Save Fathom key</button>
        </Card>
      </div>
      {toast && <div className="toast show green"><Icon name="check-circle" size={15} /><span>{toast}</span></div>}
    </div>
  );
}

function Card({ title, icon, desc, children }: { title: string; icon: string; desc: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center" }}><Icon name={icon} size={16} /></span>
        <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 14, marginLeft: 42 }}>{desc}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </div>
  );
}
