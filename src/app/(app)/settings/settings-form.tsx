"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { PROVIDER_MODELS, AI_FEATURES, type AiFeature, type FeatureModel, type Provider } from "@/lib/ai-config";
import { saveAiKeys, saveFeatureModels, saveIntegrations, saveLeadSyncConfig, syncLeadsNow, saveRoleOverride, saveDeptOverride, saveUserNavOverride, saveDeptOverrideBulk, saveUserNavOverrideBulk, awardUserPoints, saveFollowupConfig, saveTaxDefaultAssignee } from "./actions";
import { setFeedbackFormUrl } from "../weekly-updates/actions";
import type { AccessMatrix } from "@/lib/role-access";
import type { Role } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/roles";

const PROVIDERS: Provider[] = ["openai", "anthropic", "google"];

interface LeadCfg {
  enabled: boolean;
  gmailLabel: string;
  matchFrom: string;
  matchSubjectPrefix: string;
  services: string[];
  mailboxMemberId: string;
  lastSyncedAt: string | null;
  lastResult: { scanned: number; created: number; at: string } | null;
}

export interface TeamMemberRow { id: string; name: string; role: string; title: string | null; points: number }
export interface RecentPointEntry { member_id: string; points: number; reason: string; created_at: string }
export interface FollowupCfg { docsOverdueDays: number; accessOverdueDays: number; taskOverdueDays: number; noteExtensionDays: number }

export function SettingsForm({
  keysSet, models, fathomSet, pmsName, pmsSet, googleEmail, zohoConnected, slackWorkspace = null,
  isAdmin = false, lead, mailboxes = [],
  accessMatrix = null, accessRoles = [], team = [], recentPoints = [], followup, feedbackFormUrl = null,
  taxDefaultAssigneeId = null,
}: {
  keysSet: Record<Provider, boolean>;
  models: Partial<Record<AiFeature, FeatureModel>>;
  fathomSet: boolean;
  pmsName: string;
  pmsSet: boolean;
  googleEmail: string | null;
  zohoConnected: boolean;
  slackWorkspace?: string | null;
  isAdmin?: boolean;
  lead?: LeadCfg;
  mailboxes?: { id: string; label: string }[];
  accessMatrix?: AccessMatrix | null;
  accessRoles?: Role[];
  team?: TeamMemberRow[];
  recentPoints?: RecentPointEntry[];
  followup?: FollowupCfg;
  feedbackFormUrl?: string | null;
  taxDefaultAssigneeId?: string | null;
}) {
  const [busy, start] = useTransition();
  const [toast, setToast] = useState<string | null>(null);
  const note = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const [keys, setKeys] = useState({ openai: "", anthropic: "", google: "" });
  const [fm, setFm] = useState<Partial<Record<AiFeature, FeatureModel>>>(models);
  const [fathom, setFathom] = useState("");
  const [pms, setPms] = useState({ name: pmsName, key: "" });

  const [lc, setLc] = useState<LeadCfg>(lead ?? {
    enabled: true, gmailLabel: "Cadence Onboarding", matchFrom: "", matchSubjectPrefix: "",
    services: ["Accounting & Bookkeeping", "Prior-Period Catch-Up & Books Cleanup"], mailboxMemberId: "",
    lastSyncedAt: null, lastResult: null,
  });
  const [newSvc, setNewSvc] = useState("");
  const setL = <K extends keyof LeadCfg>(k: K, v: LeadCfg[K]) => setLc((c) => ({ ...c, [k]: v }));

  const [fu, setFu] = useState<FollowupCfg>(followup ?? { docsOverdueDays: 2, accessOverdueDays: 2, taskOverdueDays: 0, noteExtensionDays: 2 });
  const setF = <K extends keyof FollowupCfg>(k: K, v: FollowupCfg[K]) => setFu((c) => ({ ...c, [k]: v }));

  const [feedbackUrl, setFeedbackUrl] = useState<string>(feedbackFormUrl ?? "");
  const [taxAssigneeId, setTaxAssigneeId] = useState<string>(taxDefaultAssigneeId ?? "");

  const allCombos = PROVIDERS.flatMap((p) => PROVIDER_MODELS[p].models.map((m) => ({ provider: p, model: m })));

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 860 }}>
        <div className="section-head"><div><h2>Settings</h2><div className="sub">AI providers, integrations and connections. Keys are encrypted and used server-side only.</div></div></div>

        {/* ── Access panel (Master Admin only) — shown FIRST so it's easy to find ── */}
        {isAdmin && accessMatrix && (
          <AccessPanel
            matrix={accessMatrix}
            roles={accessRoles}
            onRoleChange={(role, navId, allow) => start(async () => { const r = await saveRoleOverride({ role, navId, allow }); note(r.error ?? "Access saved"); })}
            onDeptChange={(dept, navId, allow) => start(async () => { const r = await saveDeptOverride({ dept, navId, allow }); note(r.error ?? "Access saved"); })}
            onDeptBulk={(dept, navIds, allow) => start(async () => { const r = await saveDeptOverrideBulk({ dept, navIds, allow }); note(r.error ?? `Bulk access saved (${navIds.length} modules)`); })}
            onUserChange={(memberId, navId, allow) => start(async () => { const r = await saveUserNavOverride({ memberId, navId, allow }); note(r.error ?? "Access saved"); })}
            onUserBulk={(memberId, navIds, allow) => start(async () => { const r = await saveUserNavOverrideBulk({ memberId, navIds, allow }); note(r.error ?? `Bulk access saved (${navIds.length} modules)`); })}
            busy={busy}
          />
        )}

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

        {/* ── User Points (Master Admin only) ── */}
        {isAdmin && <UserPointsPanel team={team} recent={recentPoints} onAward={(memberId, points, reason) => start(async () => { const r = await awardUserPoints({ memberId, points, reason }); note(r.error ?? `Awarded ${points > 0 ? "+" : ""}${points} pts`); })} busy={busy} />}

        {/* ── Onboarding lead automation (Master Admin only) ── */}
        {isAdmin && (
          <Card title="Onboarding lead automation" icon="mail" desc="Any new email landing in the chosen Gmail label is turned into an onboarding lead automatically (and on every manual sync). Change any rule here — no code needed.">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={lc.enabled} onChange={(e) => setL("enabled", e.target.checked)} />
              Automation enabled
            </label>

            <div className="field">
              <label>Watch this Gmail label</label>
              <input value={lc.gmailLabel} onChange={(e) => setL("gmailLabel", e.target.value)} placeholder="Cadence Onboarding" />
              <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 4 }}>In Gmail, add a filter that labels the incoming onboarding emails with this exact label. Any new mail in it becomes a lead.</div>
            </div>

            <div className="field">
              <label>Mailbox to read</label>
              <select value={lc.mailboxMemberId} onChange={(e) => setL("mailboxMemberId", e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>
                <option value="">Master Admin (default — first connected)</option>
                {mailboxes.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>

            <div className="field">
              <label>Configured services</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                {lc.services.map((svc) => (
                  <span key={svc} className="tab-pill active" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {svc}
                    <button type="button" onClick={() => setL("services", lc.services.filter((x) => x !== svc))} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", lineHeight: 1 }}><Icon name="x" size={12} /></button>
                  </span>
                ))}
                {lc.services.length === 0 && <span style={{ fontSize: 12, color: "var(--ink-4)" }}>No services configured yet.</span>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={newSvc} onChange={(e) => setNewSvc(e.target.value)} placeholder="Add a service (e.g. VAT Filing)" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = newSvc.trim(); if (v && !lc.services.includes(v)) setL("services", [...lc.services, v]); setNewSvc(""); } }} />
                <button className="btn-ghost" type="button" onClick={() => { const v = newSvc.trim(); if (v && !lc.services.includes(v)) setL("services", [...lc.services, v]); setNewSvc(""); }}>Add</button>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 4 }}>Services found in the email are matched to these names. e.g. Accounting &amp; Bookkeeping, Prior-Period Catch-Up &amp; Books Cleanup.</div>
            </div>

            <details>
              <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>Optional extra filters (sender / subject)</summary>
              <div className="field" style={{ marginTop: 10 }}>
                <label>Only from sender (optional)</label>
                <input value={lc.matchFrom} onChange={(e) => setL("matchFrom", e.target.value)} placeholder="leave blank — the label is enough" />
              </div>
              <div className="field">
                <label>Subject starts with (optional)</label>
                <input value={lc.matchSubjectPrefix} onChange={(e) => setL("matchSubjectPrefix", e.target.value)} placeholder="leave blank — the label is enough" />
              </div>
            </details>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn-primary" disabled={busy} onClick={() => start(async () => { const r = await saveLeadSyncConfig({ enabled: lc.enabled, gmailLabel: lc.gmailLabel, matchFrom: lc.matchFrom, matchSubjectPrefix: lc.matchSubjectPrefix, services: lc.services, mailboxMemberId: lc.mailboxMemberId || null }); note(r.error ?? "Rules saved"); })}>Save rules</button>
              <button className="btn-ghost" disabled={busy} onClick={() => start(async () => { const r = await syncLeadsNow(); if (r.error) { note(r.error); return; } const res = r.result; note(res ? `Synced — ${res.created} new lead(s), ${res.scanned} scanned${res.errors.length ? ` · ${res.errors[0]}` : ""}` : "Synced"); })}><Icon name="refresh-cw" size={14} /> Sync from email now</button>
              {lc.lastResult && <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>Last sync: {lc.lastResult.created} created of {lc.lastResult.scanned} · {new Date(lc.lastResult.at).toLocaleString()}</span>}
            </div>
          </Card>
        )}

        {/* ── Follow-up SLA (Master Admin only) ── */}
        {isAdmin && (
          <Card title="Follow-up SLA" icon="clock" desc="When the daily scan auto-creates a follow-up task for the master admin and AM. Adding a follow-up note inside a run extends the next auto-task by the note-extension window.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="field"><label>Docs received within (days)</label><input type="number" min={0} value={fu.docsOverdueDays} onChange={(e) => setF("docsOverdueDays", Number(e.target.value))} /></div>
              <div className="field"><label>Access shared within (days)</label><input type="number" min={0} value={fu.accessOverdueDays} onChange={(e) => setF("accessOverdueDays", Number(e.target.value))} /></div>
              <div className="field"><label>Task escalation (days past due)</label><input type="number" min={0} value={fu.taskOverdueDays} onChange={(e) => setF("taskOverdueDays", Number(e.target.value))} /></div>
              <div className="field"><label>Note extension (days)</label><input type="number" min={0} value={fu.noteExtensionDays} onChange={(e) => setF("noteExtensionDays", Number(e.target.value))} /></div>
            </div>
            <div><button className="btn-primary" disabled={busy} onClick={() => start(async () => { const r = await saveFollowupConfig(fu); note(r.error ?? "Follow-up SLA saved"); })}>Save follow-up SLA</button></div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>Defaults: 2 / 2 / 0 / 2. Task escalation 0 fires as soon as a task is past its due date.</div>
          </Card>
        )}

        {/* ── Client feedback form URL (Master Admin only) ── */}
        {/* ── Tax Assignments (Master Admin only) ── */}
        {isAdmin && (
          <Card title="Tax assignments" icon="calculator" desc="The team member who receives all tax-related runs by default — VAT registration, CT registration, VAT filing, CT filing, and audit escalations.">
            <div className="field">
              <label>Default tax assignee</label>
              <select
                value={taxAssigneeId}
                onChange={(e) => setTaxAssigneeId(e.target.value)}
                style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}
              >
                <option value="">— none (auto-select by capacity) —</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}{m.title ? ` · ${m.title}` : ""}</option>
                ))}
              </select>
              <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 4 }}>
                When any tax-related run is created or escalated, it will be assigned to this person. Change here if the tax head changes.
              </div>
            </div>
            <div>
              <button className="btn-primary" disabled={busy} onClick={() => start(async () => { const r = await saveTaxDefaultAssignee(taxAssigneeId || null); note(r.error ?? "Tax assignee saved"); })}>Save</button>
            </div>
          </Card>
        )}

        {isAdmin && (
          <Card title="Client feedback form" icon="message-square" desc="A single feedback form link used by the Weekly Client Updates module. When set, the weekly draft includes a ‘share quick feedback’ link to the client.">
            <div className="field">
              <label>Feedback form URL</label>
              <input value={feedbackUrl} onChange={(e) => setFeedbackUrl(e.target.value)} placeholder="https://forms.gle/…" />
            </div>
            <div>
              <button className="btn-primary" disabled={busy} onClick={() => start(async () => { const r = await setFeedbackFormUrl(feedbackUrl); note(r.error ?? "Feedback URL saved"); })}>Save feedback URL</button>
            </div>
          </Card>
        )}

        {/* ── Google (per-member) ── */}
        <Card title="Google — Gmail & Drive (per member)" icon="hard-drive" desc="Connect your own Google account so onboarding folders are created inside your Drive and email sends from your Gmail. Each member connects their own — just sign in.">
          {googleEmail ? (
            <div className="sop-ref-bar"><Icon name="check-circle" size={14} /> Connected as <strong>{googleEmail}</strong><a href="/api/connect/google">Reconnect →</a></div>
          ) : (
            <a className="btn-primary" href="/api/connect/google" style={{ textDecoration: "none", width: "fit-content" }}><Icon name="link" size={14} /> Connect Google</a>
          )}
        </Card>

        {/* ── Slack (per-org workspace) ── */}
        <Card title="Slack (workspace)" icon="message-circle" desc="Connect your Slack workspace so onboarding steps can post templated messages — e.g. ping the accounting-software team with the trade licence + VAT certificate when a client is ready for setup.">
          {slackWorkspace ? (
            <div className="sop-ref-bar"><Icon name="check-circle" size={14} /> Connected to <strong>{slackWorkspace}</strong><a href="/api/connect/slack">Reconnect →</a></div>
          ) : (
            <a className="btn-primary" href="/api/connect/slack" style={{ textDecoration: "none", width: "fit-content" }}><Icon name="link" size={14} /> Connect Slack</a>
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

type AccessTab = "role" | "dept" | "user";

function AccessPanel({
  matrix, roles, onRoleChange, onDeptChange, onDeptBulk, onUserChange, onUserBulk, busy,
}: {
  matrix: AccessMatrix;
  roles: Role[];
  onRoleChange: (role: Role, navId: string, allow: boolean | null) => void;
  onDeptChange: (dept: string, navId: string, allow: boolean | null) => void;
  onDeptBulk: (dept: string, navIds: string[], allow: boolean | null) => void;
  onUserChange: (memberId: string, navId: string, allow: boolean | null) => void;
  onUserBulk: (memberId: string, navIds: string[], allow: boolean | null) => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState<AccessTab>("dept");
  const [focusDept, setFocusDept] = useState<string>(matrix.depts[0] ?? "");
  const [selectedMember, setSelectedMember] = useState<string>(matrix.members[0]?.id ?? "");
  const [memberSearch, setMemberSearch] = useState("");
  const [selModules, setSelModules] = useState<Set<string>>(new Set());

  const toggleModule = (id: string) =>
    setSelModules((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allIds = matrix.modules.map((m) => m.id);
  const allSelected = allIds.every((id) => selModules.has(id));
  const toggleAll = () => setSelModules(allSelected ? new Set() : new Set(allIds));
  const clearSel = () => setSelModules(new Set());

  // reset selection when switching dept/user
  const chooseDept = (d: string) => { setFocusDept(d); clearSel(); };
  const chooseMember = (id: string) => { setSelectedMember(id); clearSel(); };

  // ── Role tab helpers ─────────────────────────────────────────────────────
  function resolveRole(role: Role, m: AccessMatrix["modules"][number]) {
    const o = matrix.overrides[role]?.[m.id];
    if (typeof o === "boolean") return { allowed: o, isOverride: true };
    return { allowed: !m.defaultRoles || m.defaultRoles.includes(role), isOverride: false };
  }
  function cycleRole(role: Role, m: AccessMatrix["modules"][number]) {
    const cur = matrix.overrides[role]?.[m.id];
    const def = !m.defaultRoles || m.defaultRoles.includes(role);
    if (typeof cur !== "boolean") onRoleChange(role, m.id, !def);
    else if (cur !== def) onRoleChange(role, m.id, null);
    else onRoleChange(role, m.id, !def);
  }

  // ── Dept tab helpers ─────────────────────────────────────────────────────
  function resolveDept(dept: string, m: AccessMatrix["modules"][number]) {
    const o = matrix.deptOverrides[dept]?.[m.id];
    if (typeof o === "boolean") return { allowed: o, isOverride: true };
    return { allowed: true, isOverride: false };
  }
  function cycleDept(dept: string, m: AccessMatrix["modules"][number]) {
    const cur = matrix.deptOverrides[dept]?.[m.id];
    if (typeof cur !== "boolean") onDeptChange(dept, m.id, false);
    else if (!cur) onDeptChange(dept, m.id, null);
    else onDeptChange(dept, m.id, false);
  }

  // ── User tab helpers ─────────────────────────────────────────────────────
  function resolveUser(memberId: string, m: AccessMatrix["modules"][number]) {
    const o = matrix.userOverrides[memberId]?.[m.id];
    if (typeof o === "boolean") return { allowed: o, isOverride: true };
    return { allowed: true, isOverride: false };
  }
  function cycleUser(memberId: string, m: AccessMatrix["modules"][number]) {
    const cur = matrix.userOverrides[memberId]?.[m.id];
    if (typeof cur !== "boolean") onUserChange(memberId, m.id, false);
    else if (!cur) onUserChange(memberId, m.id, null);
    else onUserChange(memberId, m.id, false);
  }

  const filteredMembers = matrix.members.filter((m) =>
    !memberSearch || m.name.toLowerCase().includes(memberSearch.toLowerCase()) || (m.dept ?? "").toLowerCase().includes(memberSearch.toLowerCase())
  );

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "5px 14px", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12.5, fontWeight: 600,
    background: active ? "var(--orange)" : "transparent",
    color: active ? "#fff" : "var(--ink-2)",
    transition: "background 0.15s",
  });

  const CELL_BTN = (allowed: boolean, isOverride: boolean): React.CSSProperties => ({
    width: 30, height: 30, border: isOverride ? "1.5px solid var(--orange)" : "1px solid var(--border)",
    borderRadius: 7, background: isOverride ? (allowed ? "var(--orange-soft)" : "#fff") : (allowed ? "var(--green-soft, #ecfdf5)" : "#fff"),
    color: allowed ? "var(--green-700, #047857)" : "var(--red, #dc2626)",
    cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "var(--font)",
  });

  const selCount = selModules.size;

  // Bulk action bar shown when modules are selected (dept or user tab)
  function BulkBar({ onBlock, onAllow, onClear }: { onBlock: () => void; onAllow: () => void; onClear: () => void }) {
    if (selCount === 0) return null;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--orange-soft)", borderRadius: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--orange)" }}>{selCount} module{selCount > 1 ? "s" : ""} selected</span>
        <button type="button" disabled={busy} onClick={onBlock}
          style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "var(--red, #dc2626)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Block selected
        </button>
        <button type="button" disabled={busy} onClick={onAllow}
          style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "var(--green-700, #047857)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          Allow selected
        </button>
        <button type="button" disabled={busy} onClick={onClear}
          style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "#fff", color: "var(--ink-2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
          Clear overrides
        </button>
        <button type="button" onClick={() => setSelModules(new Set())}
          style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "#fff", color: "var(--ink-3)", fontSize: 12, cursor: "pointer" }}>
          Deselect all
        </button>
      </div>
    );
  }

  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center" }}><Icon name="shield" size={16} /></span>
        <h3 style={{ margin: 0, fontSize: 15 }}>Access · who can open which module</h3>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 14, marginLeft: 42 }}>
        Master-Admin only. Select modules with the checkbox then use bulk buttons, or click a cell to toggle one at a time. Changes take effect on next page load for that user.
      </div>

      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "var(--surface-2, #f5f5f5)", borderRadius: 9, padding: 3, width: "fit-content" }}>
        <button type="button" style={TAB_STYLE(tab === "dept")} onClick={() => { setTab("dept"); clearSel(); }}>By Department</button>
        <button type="button" style={TAB_STYLE(tab === "user")} onClick={() => { setTab("user"); clearSel(); }}>By User</button>
        <button type="button" style={TAB_STYLE(tab === "role")} onClick={() => { setTab("role"); clearSel(); }}>By Role</button>
      </div>

      {/* ── By Department ── */}
      {tab === "dept" && (
        <div>
          {matrix.depts.length === 0 ? (
            <div style={{ color: "var(--ink-3)", fontSize: 13, padding: "12px 0" }}>No departments found.</div>
          ) : (
            <div style={{ display: "flex", gap: 12 }}>
              {/* Dept list */}
              <div style={{ width: 190, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 420, overflowY: "auto" }}>
                {matrix.depts.map((d) => (
                  <button key={d} type="button" onClick={() => chooseDept(d)}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderBottom: "1px solid var(--border-light, #eee)", cursor: "pointer", background: focusDept === d ? "var(--orange-soft)" : "#fff", color: focusDept === d ? "var(--orange)" : "var(--ink-1)", fontWeight: focusDept === d ? 700 : 400, fontSize: 12.5 }}>
                    {d}
                  </button>
                ))}
              </div>
              {/* Module list for focused dept */}
              <div style={{ flex: 1 }}>
                {!focusDept ? (
                  <div style={{ color: "var(--ink-3)", fontSize: 13, padding: "12px 0" }}>Select a department on the left.</div>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 8 }}>
                      Modules for <strong>{focusDept}</strong> — ✓ allowed · ✗ blocked · — default (allowed). Select rows then bulk-block or allow.
                    </div>
                    <BulkBar
                      onBlock={() => { onDeptBulk(focusDept, [...selModules], false); clearSel(); }}
                      onAllow={() => { onDeptBulk(focusDept, [...selModules], true); clearSel(); }}
                      onClear={() => { onDeptBulk(focusDept, [...selModules], null); clearSel(); }}
                    />
                    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th style={{ width: 32, padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                            <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" />
                          </th>
                          <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, color: "var(--ink-3)" }}>Module</th>
                          <th style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid var(--border)", fontWeight: 700, color: "var(--ink-3)", minWidth: 80 }}>Access</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.modules.map((m) => {
                          const { allowed, isOverride } = resolveDept(focusDept, m);
                          const checked = selModules.has(m.id);
                          return (
                            <tr key={m.id} style={{ background: checked ? "var(--orange-soft)" : undefined }}>
                              <td style={{ padding: "6px", borderBottom: "1px solid var(--border-light, #eee)", textAlign: "center" }}>
                                <input type="checkbox" checked={checked} onChange={() => toggleModule(m.id)} />
                              </td>
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-light, #eee)", fontWeight: 600 }}>{m.label}</td>
                              <td style={{ textAlign: "center", padding: "6px", borderBottom: "1px solid var(--border-light, #eee)" }}>
                                <button type="button" disabled={busy} onClick={() => cycleDept(focusDept, m)}
                                  title={isOverride ? `Override: ${allowed ? "Allowed" : "Blocked"} (click to cycle)` : "Default: Allowed (click to block)"}
                                  style={CELL_BTN(allowed, isOverride)}>
                                  {isOverride ? (allowed ? "✓" : "✗") : "✓"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── By User ── */}
      {tab === "user" && (
        <div>
          <div style={{ display: "flex", gap: 10, marginBottom: 12, alignItems: "center" }}>
            <input
              placeholder="Search member or department…"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", fontSize: 13 }}
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {/* Member list */}
            <div style={{ width: 190, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 420, overflowY: "auto" }}>
              {filteredMembers.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12.5, color: "var(--ink-3)" }}>No members found.</div>
              ) : filteredMembers.map((mem) => (
                <button key={mem.id} type="button" onClick={() => chooseMember(mem.id)}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", borderBottom: "1px solid var(--border-light, #eee)", cursor: "pointer", background: selectedMember === mem.id ? "var(--orange-soft)" : "#fff", color: selectedMember === mem.id ? "var(--orange)" : "var(--ink-1)", fontWeight: selectedMember === mem.id ? 700 : 400, fontSize: 12.5 }}>
                  <div>{mem.name}</div>
                  {mem.dept && <div style={{ fontSize: 11, color: selectedMember === mem.id ? "var(--orange)" : "var(--ink-3)" }}>{mem.dept}</div>}
                </button>
              ))}
            </div>
            {/* Module toggles for selected member */}
            <div style={{ flex: 1 }}>
              {!selectedMember ? (
                <div style={{ color: "var(--ink-3)", fontSize: 13, padding: "12px 0" }}>Select a team member on the left.</div>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 8 }}>
                    Overrides for <strong>{matrix.members.find((m) => m.id === selectedMember)?.name ?? "this member"}</strong>. — = no override (role/dept rules apply).
                  </div>
                  <BulkBar
                    onBlock={() => { onUserBulk(selectedMember, [...selModules], false); clearSel(); }}
                    onAllow={() => { onUserBulk(selectedMember, [...selModules], true); clearSel(); }}
                    onClear={() => { onUserBulk(selectedMember, [...selModules], null); clearSel(); }}
                  />
                  <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 32, padding: "8px 6px", borderBottom: "1px solid var(--border)" }}>
                          <input type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" />
                        </th>
                        <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, color: "var(--ink-3)" }}>Module</th>
                        <th style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid var(--border)", fontWeight: 700, color: "var(--ink-3)", minWidth: 80 }}>Access</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.modules.map((m) => {
                        const { allowed, isOverride } = resolveUser(selectedMember, m);
                        const checked = selModules.has(m.id);
                        return (
                          <tr key={m.id} style={{ background: checked ? "var(--orange-soft)" : undefined }}>
                            <td style={{ padding: "6px", borderBottom: "1px solid var(--border-light, #eee)", textAlign: "center" }}>
                              <input type="checkbox" checked={checked} onChange={() => toggleModule(m.id)} />
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-light, #eee)", fontWeight: 600 }}>{m.label}</td>
                            <td style={{ textAlign: "center", padding: "6px", borderBottom: "1px solid var(--border-light, #eee)" }}>
                              <button type="button" disabled={busy} onClick={() => cycleUser(selectedMember, m)}
                                title={isOverride ? `Override: ${allowed ? "Allowed" : "Blocked"} (click to cycle)` : "No override — click to block"}
                                style={CELL_BTN(allowed, isOverride)}>
                                {isOverride ? (allowed ? "✓" : "✗") : "—"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── By Role ── */}
      {tab === "role" && (
        <div style={{ overflowX: "auto" }}>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginBottom: 8 }}>✓ = allowed · ✗ = blocked · — = using default. Orange border = explicit override. Click a cell to cycle.</div>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, color: "var(--ink-3)" }}>Module</th>
                {roles.map((r) => <th key={r} style={{ textAlign: "center", padding: "8px 6px", borderBottom: "1px solid var(--border)", fontWeight: 700, color: "var(--ink-3)", minWidth: 64 }}>{ROLE_LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.modules.map((m) => (
                <tr key={m.id}>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-light, #eee)", fontWeight: 600 }}>{m.label}</td>
                  {roles.map((r) => {
                    const { allowed, isOverride } = resolveRole(r, m);
                    return (
                      <td key={r} style={{ textAlign: "center", padding: "6px", borderBottom: "1px solid var(--border-light, #eee)" }}>
                        <button type="button" disabled={busy} onClick={() => cycleRole(r, m)}
                          title={isOverride ? `Override: ${allowed ? "Allowed" : "Blocked"} (click to cycle)` : `Default: ${allowed ? "Allowed" : "Blocked"} (click to override)`}
                          style={CELL_BTN(allowed, isOverride)}>
                          {isOverride ? (allowed ? "✓" : "✗") : (allowed ? "✓" : "—")}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserPointsPanel({ team, recent, onAward, busy }: { team: TeamMemberRow[]; recent: RecentPointEntry[]; onAward: (memberId: string, points: number, reason: string) => void; busy: boolean }) {
  const [memberId, setMemberId] = useState(team[0]?.id ?? "");
  const [pts, setPts] = useState<number | "">("");
  const [reason, setReason] = useState("");
  const memberById = Object.fromEntries(team.map((t) => [t.id, t]));
  const submit = () => {
    if (!memberId || !pts || !reason.trim()) return;
    onAward(memberId, Number(pts), reason.trim());
    setPts(""); setReason("");
  };
  const top = team.slice(0, 10);
  return (
    <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ width: 32, height: 32, borderRadius: 8, background: "var(--orange-soft)", color: "var(--orange)", display: "grid", placeItems: "center" }}><Icon name="award" size={16} /></span>
        <h3 style={{ margin: 0, fontSize: 15 }}>User points · performance leaderboard</h3>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 14, marginLeft: 42 }}>Master-Admin only. Award + or − points with a short reason; teammates see their total later in their profile.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Award points</div>
          <div className="field">
            <label>Team member</label>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)} style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", fontSize: 13 }}>
              {team.map((t) => <option key={t.id} value={t.id}>{t.name} · {ROLE_LABEL[t.role as Role] ?? t.role}{t.points ? ` · ${t.points} pts` : ""}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Points (use a negative number to deduct)</label>
            <input type="number" value={pts} onChange={(e) => setPts(e.target.value === "" ? "" : Number(e.target.value))} placeholder="e.g. 10 or -5" />
          </div>
          <div className="field">
            <label>Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Closed Avobar onboarding 4 days ahead of SLA" />
          </div>
          <button className="btn-primary" disabled={busy || !memberId || !pts || !reason.trim()} onClick={submit}>Award points</button>
        </div>
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Top 10 · leaderboard</div>
          {top.length ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {top.map((t, i) => (
                <div key={t.id} style={{ display: "grid", gridTemplateColumns: "24px 1fr auto", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: i === 0 ? "none" : "1px solid var(--border-light, #f1f1f1)", fontSize: 12.5 }}>
                  <span style={{ color: "var(--ink-4)", fontWeight: 700 }}>{i + 1}</span>
                  <div><div style={{ fontWeight: 600 }}>{t.name}</div><div style={{ fontSize: 11, color: "var(--ink-3)" }}>{ROLE_LABEL[t.role as Role] ?? t.role}</div></div>
                  <span style={{ fontWeight: 700, color: t.points >= 0 ? "var(--green-700, #047857)" : "var(--red)" }}>{t.points > 0 ? "+" : ""}{t.points} pts</span>
                </div>
              ))}
            </div>
          ) : <div style={{ fontSize: 12, color: "var(--ink-4)" }}>No points awarded yet.</div>}
          {recent.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>Recent · last {recent.length} awards</summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 0, listStyle: "none", maxHeight: 180, overflowY: "auto" }}>
                {recent.map((p, i) => (
                  <li key={i} style={{ fontSize: 12, padding: "6px 0", borderBottom: "1px solid var(--border-light, #f1f1f1)" }}>
                    <span style={{ fontWeight: 700, color: p.points >= 0 ? "var(--green-700, #047857)" : "var(--red)", marginRight: 6 }}>{p.points > 0 ? "+" : ""}{p.points}</span>
                    <span>{memberById[p.member_id]?.name ?? "Unknown"}</span> · <span style={{ color: "var(--ink-3)" }}>{p.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
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
