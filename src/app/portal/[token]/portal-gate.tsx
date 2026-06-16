"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { requestPortalCode, verifyPortalCode } from "./actions";

export function PortalGate({ token, emailHint }: { token: string; emailHint: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const sendCode = () =>
    start(async () => {
      setErr(null); setNote(null);
      const r = await requestPortalCode(token, email);
      if (r.error) { setErr(r.error); return; }
      setStep("code"); setNote(`We sent a 6-digit code to ${emailHint}. It expires in 10 minutes.`);
    });

  const verify = () =>
    start(async () => {
      setErr(null);
      const r = await verifyPortalCode(token, code);
      if (r.error) { setErr(r.error); return; }
      router.refresh();
    });

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#fff", border: "1px solid var(--border)", borderRadius: 14, padding: 28, boxShadow: "0 10px 40px rgba(0,0,0,.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center" }}><Icon name="shield-check" size={17} /></span>
          <strong style={{ fontSize: 15 }}>Secure access</strong>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.6, marginBottom: 16 }}>
          {step === "email"
            ? "For your security, this onboarding portal can only be opened by the email it was sent to."
            : "Enter the 6-digit code we just emailed you."}
        </div>

        {step === "email" ? (
          <>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)" }}>Your email</label>
            <input
              type="email" value={email} autoFocus
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) sendCode(); }}
              placeholder="you@company.com"
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px", fontSize: 14, marginTop: 6, marginBottom: 12 }}
            />
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy || !email.trim()} onClick={sendCode}>
              {busy ? "Sending…" : "Send me a code"}
            </button>
          </>
        ) : (
          <>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-3)" }}>6-digit code</label>
            <input
              inputMode="numeric" value={code} autoFocus maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) verify(); }}
              placeholder="••••••"
              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 9, padding: "10px 12px", fontSize: 20, letterSpacing: "0.4em", textAlign: "center", marginTop: 6, marginBottom: 12 }}
            />
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center" }} disabled={busy || code.length !== 6} onClick={verify}>
              {busy ? "Verifying…" : "Open my portal"}
            </button>
            <button className="btn-ghost" style={{ width: "100%", justifyContent: "center", marginTop: 8 }} disabled={busy} onClick={() => { setStep("email"); setCode(""); setErr(null); setNote(null); }}>
              Use a different email
            </button>
          </>
        )}

        {note && <div style={{ fontSize: 12.5, color: "var(--green)", marginTop: 12, background: "var(--green-soft)", padding: "8px 10px", borderRadius: 8 }}>{note}</div>}
        {err && <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 12, background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8 }}>{err}</div>}
      </div>
    </div>
  );
}
