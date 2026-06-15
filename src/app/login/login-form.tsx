"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icon";
import { createClient } from "@/lib/supabase/client";
import { signInAction, signUpAction, type AuthState } from "./actions";

const initial: AuthState = { error: null };

export function LoginForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const action = mode === "signin" ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const signInWithGoogle = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(900px 480px at 80% -10%, rgba(249,115,22,0.18), transparent 60%), var(--bg)",
        padding: 24,
      }}
    >
      <div style={{ width: 400, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <div className="rail-logo" style={{ width: 40, height: 40 }}>
            <Icon name="gauge" size={22} strokeWidth={2.2} style={{ color: "var(--orange)" }} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>Cadence</div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-3)" }}>
              Finanshels
            </div>
          </div>
        </div>

        <div className="modal" style={{ width: "100%", transform: "none", boxShadow: "var(--shadow-card)" }}>
          <div className="hd">
            <h3>{mode === "signin" ? "Sign in" : "Create your account"}</h3>
            <div className="sub">
              {mode === "signin"
                ? "Welcome back. Sign in to continue."
                : "Use your Finanshels email so your role is set automatically."}
            </div>
          </div>
          <form action={formAction}>
            <div className="bd">
              {mode === "signup" && (
                <div className="field">
                  <label htmlFor="full_name">Full name</label>
                  <input id="full_name" name="full_name" type="text" placeholder="Munees KV" autoComplete="name" />
                </div>
              )}
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" placeholder="you@finanshels.com" autoComplete="email" required />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input id="password" name="password" type="password" placeholder="••••••••" autoComplete={mode === "signin" ? "current-password" : "new-password"} required />
              </div>
              {state.error && (
                <div style={{ fontSize: 12.5, color: "var(--red)", background: "var(--red-soft)", padding: "8px 10px", borderRadius: 8 }}>
                  {state.error}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--ink-4)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em" }}>
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                OR
                <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
              </div>
              <button type="button" className="btn-ghost" onClick={signInWithGoogle} style={{ justifyContent: "center", padding: "9px 12px" }}>
                <Icon name="chrome" size={15} />
                Continue with Google
              </button>
            </div>
            <div className="ft" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
              >
                {mode === "signin" ? "Create account" : "Have an account? Sign in"}
              </button>
              <button type="submit" className="btn-primary" disabled={pending}>
                {pending ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
