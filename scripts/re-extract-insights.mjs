// Standalone re-extraction: replicates _extractInsightsForClient using direct
// OpenAI calls so we can backfill structured fields for clients whose notes are
// stored in client_meetings (but who couldn't be matched by the prod Fathom
// endpoint's 10-meeting recent window).
//
// Targets clients whose call_insights is blank OR have <3 sections.
// Run: node --env-file=.env.local scripts/re-extract-insights.mjs [--all] [--client="<name substring>"]
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const FORCE_ALL = args.includes("--all");
const ONLY = (args.find((a) => a.startsWith("--client=")) ?? "").replace("--client=", "").toLowerCase();

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

function decryptSecret(payload) {
  const raw = process.env.CADENCE_ENCRYPTION_KEY;
  const key = Buffer.from(raw, "base64");
  const [ivb, tagb, encb] = payload.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivb, "base64"));
  decipher.setAuthTag(Buffer.from(tagb, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encb, "base64")), decipher.final()]).toString("utf8");
}

// ---- load OpenAI key ----
const { data: org } = await db.from("orgs").select("id,name").order("created_at").limit(1).single();
const { data: ai } = await db.from("ai_settings").select("openai_key_enc,feature_models").eq("org_id", org.id).maybeSingle();
if (!ai?.openai_key_enc) { console.error("No OpenAI key in ai_settings"); process.exit(1); }
const openaiKey = decryptSecret(ai.openai_key_enc);
const model = ai.feature_models?.brief?.model ?? "gpt-4o-mini";

const SYSTEM = "You read accounting-firm client-call notes and capture everything useful for the client's playbook. Output ONLY JSON. Use ONLY what is actually in the notes — never invent; if something wasn't discussed, omit that field entirely (do NOT write 'not mentioned' or guess).";

function buildPrompt(name, industry, link, notes) {
  return `From these call notes for "${name ?? "the client"}" (industry: ${industry ?? "unknown"}), return ONLY JSON: ` +
    `{"description":"3-4 sentence brief business description in the client's own words — what they do, how they make money, who they serve","painPoints":["specific problems/frustrations the client raised"],"summary":"2-3 sentence summary of the call",` +
    `"sections":[{"heading":"e.g. Business model / Systems & software / Banking / Compliance / Reporting & close cadence / Client expectations / Open items","body":"the relevant detail from the notes, bullet points separated by newlines"}],` +
    `"profile":{"ownerName":"","entityType":"mainland|free_zone|offshore","primaryContactEmail":"","phone":"","services":["accounting service lines the client wants, e.g. Bookkeeping, VAT, Corporate Tax"],"vatRegistered":"Yes|No","vatTrn":"","ctRegistered":"Yes|No","bankNames":[""],"paymentGateways":[""],"accountingSoftware":"","revenueBracket":"e.g. under 1M / 1-5M AED","revenueChannels":["the revenue streams the client mentioned, e.g. retail, online sales, services"],"expenseTypes":["the major expense categories the client mentioned, e.g. rent, payroll, marketing"]},` +
    `"extraFacts":[{"key":"snake_case_key","label":"Human Label","value":"the value"}]}. ` +
    `"profile" = only the fields actually stated in the notes (omit the rest). "extraFacts" = any other concrete business fact worth keeping that does NOT fit a profile field (e.g. trade license number, license expiry, financial year-end, number of branches, free-zone authority). Omit "profile"/"extraFacts" entirely if nothing applies. ` +
    `Recording link (reference only, you cannot watch it): ${link || "n/a"}.\n\nCall notes:\n${notes.slice(0, 12000)}`;
}

async function callOpenAi(prompt) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? "";
}

// ---- list candidate clients ----
const { data: clients } = await db
  .from("clients")
  .select("id,org_id,name,industry,facts,call_insights,call_link,call_notes,business_description,owner_name,vat_registered,vat_trn,ct_registered,bank_names,payment_gateways,accounting_software,revenue_bracket,services,revenue_channels,phone,primary_contact_email")
  .eq("org_id", org.id);

function sectionsCount(c) {
  return c.call_insights?.sections?.length ?? 0;
}

let candidates = clients;
if (ONLY) candidates = candidates.filter((c) => c.name.toLowerCase().includes(ONLY));
if (!FORCE_ALL && !ONLY) {
  // Only re-extract for clients with <3 sections OR blank business_description (signal of thin extraction)
  candidates = candidates.filter((c) => sectionsCount(c) < 3 || !c.business_description);
}
console.log(`Re-extraction targets: ${candidates.length} clients (model=${model})`);

const report = [];
for (const c of candidates) {
  // Find notes — prefer client_meetings (largest), then clients.call_notes
  const { data: meetings } = await db.from("client_meetings").select("recording_link,notes").eq("client_id", c.id).order("created_at", { ascending: false });
  let bestNotes = c.call_notes || "";
  let bestLink = c.call_link || "";
  for (const m of meetings ?? []) {
    if (m.notes && m.notes.length > bestNotes.length) {
      bestNotes = m.notes;
      bestLink = m.recording_link || bestLink;
    }
  }
  if (!bestNotes || bestNotes.length < 100) {
    report.push({ name: c.name.slice(0, 40), status: "no_notes", chars: bestNotes.length });
    continue;
  }

  try {
    const raw = await callOpenAi(buildPrompt(c.name, c.industry, bestLink, bestNotes));
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    const parsed = s >= 0 ? JSON.parse(raw.slice(s, e + 1)) : {};
    const painPoints = Array.isArray(parsed.painPoints) ? parsed.painPoints.filter(Boolean) : [];
    const sections = Array.isArray(parsed.sections) ? parsed.sections.filter((x) => x?.heading && x?.body) : [];
    const pf = parsed.profile ?? {};
    const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const arr = (v) => (Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean) : undefined);
    const colMap = {
      owner_name: str(pf.ownerName), entity_type: str(pf.entityType), primary_contact_email: str(pf.primaryContactEmail),
      phone: str(pf.phone), vat_registered: str(pf.vatRegistered), vat_trn: str(pf.vatTrn), ct_registered: str(pf.ctRegistered),
      accounting_software: str(pf.accountingSoftware), revenue_bracket: str(pf.revenueBracket),
      services: arr(pf.services), bank_names: arr(pf.bankNames), payment_gateways: arr(pf.paymentGateways),
      revenue_channels: arr(pf.revenueChannels),
    };
    const update = {};
    for (const [k, v] of Object.entries(colMap)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) { if (v.length) update[k] = v; } else update[k] = v;
    }

    // Build extra facts
    const facts = { ...(c.facts ?? {}) };
    const expenses = arr(pf.expenseTypes);
    if (expenses?.length) facts.expense_types = expenses;
    const defs = [];
    for (const f of Array.isArray(parsed.extraFacts) ? parsed.extraFacts : []) {
      const label = str(f?.label); const value = str(f?.value);
      if (!label || !value) continue;
      const key = (str(f?.key) ?? label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
      if (!key) continue;
      facts[key] = value;
      defs.push({ org_id: org.id, key, label });
    }
    if (defs.length) {
      await db.from("client_field_defs").upsert(defs, { onConflict: "org_id,key", ignoreDuplicates: true });
    }

    const patch = {
      ...(parsed.description ? { business_description: parsed.description } : {}),
      pain_points: painPoints,
      call_link: bestLink || null,
      call_notes: bestNotes,
      call_summary: parsed.summary ?? null,
      call_insights: { sections },
      ...update,
      ...(defs.length || expenses?.length ? { facts } : {}),
    };
    const { error: uErr } = await db.from("clients").update(patch).eq("id", c.id);
    if (uErr) { report.push({ name: c.name.slice(0,40), status: `db_err: ${uErr.message}` }); continue; }

    report.push({
      name: c.name.slice(0, 40),
      status: "ok",
      sections: sections.length,
      filled: Object.keys(update).length,
      facts: defs.length + (expenses?.length ? 1 : 0),
      pp: painPoints.length,
    });
  } catch (err) {
    report.push({ name: c.name.slice(0, 40), status: `ai_err: ${(err.message ?? "").slice(0, 80)}` });
  }
}

console.table(report);
const ok = report.filter((r) => r.status === "ok").length;
console.log(`\n${ok}/${candidates.length} clients re-extracted.`);
