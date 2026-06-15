"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { saveMyFathomKey } from "./actions";

export function MyConnections({
  name, googleEmail, zohoConnected, fathomSet, linked,
}: {
  name: string; googleEmail: string | null; zohoConnected: boolean; fathomSet: boolean; linked: boolean;
}) {
  const [fathom, setFathom] = useState("");
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 760 }}>
        <div className="section-head"><div><h2>My Connections</h2><div className="sub">Connect your own accounts, {name}. Onboarding folders go to your Drive; emails send from your Gmail.</div></div></div>

        {!linked && (
          <div className="dropzone" style={{ marginBottom: 14, textAlign: "left" }}>Your login isn&apos;t linked to a team-member record yet. Ask an admin to set your email in the Org Chart, then sign in again.</div>
        )}

        <Card title="Google — Gmail & Drive" icon="hard-drive" desc="Folders are created in your Drive; client emails send from your Gmail.">
          {googleEmail ? (
            <div className="sop-ref-bar"><Icon name="check-circle" size={14} /> Connected{googleEmail !== "connected" ? ` as ${googleEmail}` : ""}<a href="/api/connect/google">Reconnect →</a></div>
          ) : (
            <a className="btn-primary" href="/api/connect/google" style={{ textDecoration: "none", width: "fit-content" }}><Icon name="link" size={14} /> Connect Google</a>
          )}
        </Card>

        <Card title="Zoho Books" icon="book" desc="Import the approved COA and sync books in your own Zoho.">
          {zohoConnected ? (
            <div className="sop-ref-bar"><Icon name="check-circle" size={14} /> Zoho connected<a href="/api/connect/zoho">Reconnect →</a></div>
          ) : (
            <a className="btn-primary" href="/api/connect/zoho" style={{ textDecoration: "none", width: "fit-content" }}><Icon name="link" size={14} /> Connect Zoho Books</a>
          )}
        </Card>

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
