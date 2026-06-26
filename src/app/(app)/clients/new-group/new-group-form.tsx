"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { createClientGroupAction, type NewGroupCompanyInput } from "../actions";
import { INDUSTRIES, ENTITIES, type AmOption } from "../clients-table";

interface Props {
  members: AmOption[];
  templates: { id: string; name: string }[];
}

interface Row extends NewGroupCompanyInput { _key: string }

const newRow = (): Row => ({
  _key: Math.random().toString(36).slice(2),
  name: "",
  industry: "",
  entity_type: "",
  am_id: "",
  trade_licence_no: "",
});

export function NewGroupForm({ members, templates }: Props) {
  const router = useRouter();
  const [groupName, setGroupName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [days, setDays] = useState<number | "">(28);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "medium-team");
  const [rows, setRows] = useState<Row[]>([newRow(), newRow()]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) => setRows((rs) => rs.filter((r) => r._key !== key));
  const addRow = () => setRows((rs) => [...rs, newRow()]);

  const submit = () => {
    setErr(null); setInfo(null);
    if (!groupName.trim()) { setErr("Group name is required."); return; }
    if (!contactEmail.trim()) { setErr("Primary contact email is required — that's the single portal login for the whole group."); return; }
    const cleanCompanies = rows.filter((r) => r.name.trim());
    if (!cleanCompanies.length) { setErr("Add at least one company to the group."); return; }
    start(async () => {
      const res = await createClientGroupAction({
        group_name: groupName.trim(),
        primary_contact_name: contactName.trim(),
        primary_contact_email: contactEmail.trim(),
        proposal_id: proposalId.trim() || undefined,
        expected_onboarding_days: typeof days === "number" ? days : undefined,
        template_id: templateId,
        companies: cleanCompanies.map((c) => ({
          name: c.name.trim(),
          owner_name: c.owner_name?.trim() || undefined,
          industry: c.industry || undefined,
          entity_type: c.entity_type || undefined,
          am_id: c.am_id || undefined,
          trade_licence_no: c.trade_licence_no?.trim() || undefined,
          contract_start_date: c.contract_start_date || undefined,
        })),
      });
      if (res.error) { setErr(res.error); return; }
      setInfo(`Group created — ${res.runIds?.length ?? 0} runs spun up.`);
      // Land on the first run so the team can start immediately.
      if (res.runIds?.[0]) {
        router.push(`/onboarding/${res.runIds[0]}`);
      } else {
        router.push("/clients");
      }
    });
  };

  return (
    <div className="scroll">
      <div className="page" style={{ maxWidth: 1080 }}>
        <div className="section-head">
          <div>
            <h2>New client group</h2>
            <div className="sub">One proposal · one primary contact · several companies. Each company gets its own onboarding run. The portal is one login, with an entity switcher.</div>
          </div>
          <button className="btn-ghost" onClick={() => router.push("/clients")}>Cancel</button>
        </div>

        <div className="modal" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, position: "static", boxShadow: "none" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Group identity</h3>
          <div className="sub" style={{ marginTop: 4, fontSize: 12.5, color: "var(--ink-3)" }}>Used as the group label everywhere; the primary contact is the only portal login.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div className="field"><label>Group name *</label>
              <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Al Hussein Holdings" />
            </div>
            <div className="field"><label>Proposal ID</label>
              <input value={proposalId} onChange={(e) => setProposalId(e.target.value)} placeholder="optional" />
            </div>
            <div className="field"><label>Primary contact — name</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="field"><label>Primary contact — email *</label>
              <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="owner@example.ae" type="email" />
            </div>
            <div className="field"><label>Onboarding timeline (days)</label>
              <input
                type="number" min={7} max={180}
                value={days === "" ? "" : String(days)}
                onChange={(e) => setDays(e.target.value ? Math.max(1, Number(e.target.value)) : "")}
              />
            </div>
            <div className="field"><label>Onboarding template</label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 18, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Companies in this group</h3>
              <div className="sub" style={{ marginTop: 4, fontSize: 12.5, color: "var(--ink-3)" }}>Add a row for each entity (trade licence). Each gets its own COA, documents, and sign-off.</div>
            </div>
            <button className="btn-ghost" type="button" onClick={addRow}><Icon name="plus" size={14} /> Add company</button>
          </div>

          {rows.map((r, idx) => (
            <div key={r._key} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginTop: 10, background: "var(--bg)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Company {idx + 1}</div>
                {rows.length > 1 && (
                  <button className="btn-ghost" type="button" onClick={() => removeRow(r._key)} style={{ padding: "4px 10px", fontSize: 12 }}>Remove</button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 10 }}>
                <div className="field"><label>Company name *</label>
                  <input value={r.name} onChange={(e) => updateRow(r._key, { name: e.target.value })} placeholder="e.g. Al Hussein Trading LLC" />
                </div>
                <div className="field"><label>Trade licence #</label>
                  <input value={r.trade_licence_no ?? ""} onChange={(e) => updateRow(r._key, { trade_licence_no: e.target.value })} placeholder="optional" />
                </div>
                <div className="field"><label>Contract start</label>
                  <input type="date" value={r.contract_start_date ?? ""} onChange={(e) => updateRow(r._key, { contract_start_date: e.target.value })} />
                </div>
                <div className="field"><label>Industry</label>
                  <select value={r.industry ?? ""} onChange={(e) => updateRow(r._key, { industry: e.target.value })}>
                    <option value="">—</option>
                    {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div className="field"><label>Entity type</label>
                  <select value={r.entity_type ?? ""} onChange={(e) => updateRow(r._key, { entity_type: e.target.value })}>
                    <option value="">—</option>
                    {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="field"><label>Account Manager</label>
                  <select value={r.am_id ?? ""} onChange={(e) => updateRow(r._key, { am_id: e.target.value })}>
                    <option value="">—</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}{m.title ? ` · ${m.title}` : ""}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>

        {err && <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "var(--red-soft, #fdecec)", color: "var(--red)", fontSize: 13 }}>{err}</div>}
        {info && <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "var(--green-soft, #ecfdf5)", color: "var(--green, #065f46)", fontSize: 13 }}>{info}</div>}

        <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn-ghost" type="button" onClick={() => router.push("/clients")} disabled={busy}>Cancel</button>
          <button className="btn-primary" type="button" onClick={submit} disabled={busy}>
            {busy ? "Creating runs…" : `Create group · ${rows.filter((r) => r.name.trim()).length} ${rows.filter((r) => r.name.trim()).length === 1 ? "company" : "companies"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
