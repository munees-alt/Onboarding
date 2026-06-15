"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { PROVIDER_MODELS, AI_FEATURES, type AiFeature, type FeatureModel, type Provider } from "@/lib/ai-config";
import { saveAiKeys, saveFeatureModels, saveIntegrations } from "./actions";

const PROVIDERS: Provider[] = ["openai", "anthropic", "google"];

export function SettingsForm({
  keysSet, models, fathomSet, pmsName, pmsSet, googleEmail, zohoConnected,
}: {
  keysSet: Record<Provider, boolean>;
  models: Partial<Record<AiFeature, FeatureModel>>;
  fathomSet: boolean;
  pmsName: string;
  pmsSet: boolean;
  googleEmail: string | null;
  zohoConnected: boolean;
}) {
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const [keys, setKeys] = useState({ openai: "", anthropic: "", google: "" });
  const [fm, setFm] = useState<Partial<Record<AiFeature, FeatureModel>>>(models);
  const [fathom, setFathom] = useState("");
  const [pms, setPms] = useState({ name: pmsName, key: "" });

  const allCombos = PROVIDERS.flatMap((p) => PROVIDER_MODELS[p].models.map((m) => ({ provider: p, model: m })));

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 860 }}>
        <div className="section-head"><div><h2>Settings</h2><div className="sub">AI providers, integrations and connections. Keys are encrypted and used server-side only.</div></div></div>

        {/* ── AI Configuration ── */}
        <Card title="AI Configuration" icon="sparkles" desc="Paste your own keys for ChatGPT, Claude and Gemini. Pick which model powers each AI feature.">
          {PROVIDERS.map((p) => (
            <div className="field" key={p}>
              <label>{PROVIDER_MODELS[p].label} API key {keysSet[p] && <span className="pill green" style={{ fontSize: 10, marginLeft: 6 }}><span className="dot" /> Saved</span>}</label>
              <input type="password" placeholder={keysSet[p] ? "•••••••• (saved — paste to replace)" : "Paste API key"} value={keys[p]} onChange={(e) => setKeys((k) => ({ ...k, [p]: e.target.value }))} />
            </div>
          ))}
          <div><button className="btn-primary" disabled={busy} onClick={() => start(async () => { const r = await saveAiKeys(keys); note(r.error ?? "AI keys saved"); setKeys({ openai: "", anthropic: "", google: "" }); })}>Save keys</button></div>

          <div style={{ borderTop: "1px solid var(--border)", margin: "8px 0", paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>Model per feature</div>
            {AI_FEATURES.map((f) => {
              const cur = fm[f.id];
              const val = cur ? `${cur.provider}:${cur.model}` : "";
              return (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{f.label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{f.hint}</div>
                  </div>
                  <select
                    value={val}
                    onChange={(e) => { const [provider, model] = e.target.value.split(":"); setFm((m) => ({ ...m, [f.id]: provider ? { provider: provider as Provider, model } : undefined })); }}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, minWidth: 230 }}
                  >
                    <option value="">Default (first key set)</option>
                    {allCombos.map((c) => <option key={`${c.provider}:${c.model}`} value={`${c.provider}:${c.model}`}>{PROVIDER_MODELS[c.provider].label.split(" ")[0]} · {c.model}</option>)}
                  </select>
                </div>
              );
            })}
            <button className="btn-ghost" disabled={busy} onClick={() => start(async () => { const r = await saveFeatureModels(fm); note(r.error ?? "Models saved"); })}>Save models</button>
          </div>
        </Card>

        {/* ── Fathom ── */}
        <Card title="Fathom note-taker" icon="mic" desc="API key to auto-pull call recordings and notes into the client playbook.">
          <div className="field">
            <label>Fathom API key {fathomSet && <span className="pill green" style={{ fontSize: 10, marginLeft: 6 }}><span className="dot" /> Connected</span>}</label>
            <input type="password" placeholder={fathomSet ? "•••••••• (saved — paste to replace)" : "Paste Fathom API key"} value={fathom} onChange={(e) => setFathom(e.target.value)} />
          </div>
          <div><button className="btn-primary" disabled={busy} onClick={() => start(async () => { const r = await saveIntegrations({ fathomKey: fathom }); note(r.error ?? "Fathom key saved"); setFathom(""); })}>Save Fathom key</button></div>
        </Card>

        {/* ── PMS ── */}
        <Card title="PMS integration" icon="kanban" desc="Push the task board on handover. Two-way status sync where the PMS API supports it.">
          <div className="field"><label>PMS name</label><input value={pms.name} onChange={(e) => setPms((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Monday.com" /></div>
          <div className="field"><label>PMS API key {pmsSet && <span className="pill green" style={{ fontSize: 10, marginLeft: 6 }}><span className="dot" /> Saved</span>}</label><input type="password" placeholder={pmsSet ? "•••••••• (saved)" : "Paste PMS API key"} value={pms.key} onChange={(e) => setPms((p) => ({ ...p, key: e.target.value }))} /></div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" disabled={busy} onClick={() => start(async () => { const r = await saveIntegrations({ pmsName: pms.name, pmsKey: pms.key }); note(r.error ?? "PMS saved"); setPms((p) => ({ ...p, key: "" })); })}>Save PMS</button>
            <button className="btn-ghost" onClick={() => note("Test connection — wired when PMS API is confirmed")}>Test connection</button>
          </div>
        </Card>

        {/* ── Google (per-member) ── */}
        <Card title="Google — Gmail & Drive (per member)" icon="hard-drive" desc="Connect your own Google account so onboarding folders are created inside your Drive and email sends from your Gmail. Each member connects their own — just sign in.">
          {googleEmail ? (
            <div className="sop-ref-bar"><Icon name="check-circle" size={14} /> Connected as <strong>{googleEmail}</strong><a href="/api/connect/google">Reconnect →</a></div>
          ) : (
            <a className="btn-primary" href="/api/connect/google" style={{ textDecoration: "none", width: "fit-content" }}><Icon name="link" size={14} /> Connect Google</a>
          )}
        </Card>

        {/* ── Zoho Books (per-member) ── */}
        <Card title="Zoho Books (per member)" icon="book" desc="Connect your own Zoho Books so the run can import the approved COA and sync data. Each member signs into their own account.">
          {zohoConnected ? (
            <div className="sop-ref-bar"><Icon name="check-circle" size={14} /> Zoho Books connected<a href="/api/connect/zoho">Reconnect →</a></div>
          ) : (
            <a className="btn-primary" href="/api/connect/zoho" style={{ textDecoration: "none", width: "fit-content" }}><Icon name="link" size={14} /> Connect Zoho Books</a>
          )}
          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>How to set up the Zoho app (one-time, admin)</summary>
            <ol style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.7 }}>
              <li>Go to <code>api-console.zoho.com</code> → <strong>Add Client</strong> → <strong>Server-based Applications</strong> (not Self Client — that can&apos;t do per-member sign-in).</li>
              <li>Authorized redirect URI: <code>/api/connect/zoho/callback</code> on this app&apos;s URL.</li>
              <li>Copy the <strong>Client ID</strong> + <strong>Client Secret</strong> into <code>.env</code> (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET).</li>
              <li>Scope: <code>ZohoBooks.fullaccess.all</code>.</li>
              <li>Each member clicks <strong>Connect Zoho Books</strong> and signs in — Cadence stores their refresh token securely.</li>
            </ol>
          </details>
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
