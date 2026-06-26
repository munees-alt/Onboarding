/**
 * Sweep every onboarded client and fill in playbook fields from cheap sources
 * (intake_forms + client_meetings + Fathom + existing rows) before reporting
 * what still needs hands-on attention.
 *
 * Cheap auto-fills (no OpenAI cost):
 *   • owner_name / primary_contact_email           ← intake_forms.submitted
 *   • business_description / pain_points           ← intake_forms.submitted
 *   • industry / entity_type                       ← existing client row (no-op if set)
 *   • bank_names / payment_gateways                ← intake_forms.submitted.banks/gateways
 *   • accounting_software                          ← intake_forms.submitted.acctSw
 *   • revenue_channels                             ← intake_forms.submitted.revenue
 *   • vat_registered / ct_registered (yes/no)      ← intake_forms.submitted.vat/ct
 *
 * NOT auto-filled (logged for UI follow-up):
 *   • call_insights (needs OpenAI extraction; trigger per client in playbook)
 *   • reg_facts (needs Drive scan; trigger via Playbook → Compliance → Rebuild)
 *
 * Output: prints a per-client report + writes the same to ./reports/playbook-audit-<date>.md
 */

import { createClient } from "@supabase/supabase-js";
import { writeFile, mkdir } from "node:fs/promises";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const dryRun = process.argv.includes("--dry");

function isBlank(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return !Object.keys(v).length;
  return String(v).trim() === "";
}

function asStrArray(v) {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (typeof v === "string") return v.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  return [];
}

function intakeYn(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["yes", "y", "true", "registered", "in progress"].includes(s)) return "yes";
  if (["no", "n", "false", "not applicable", "n/a"].includes(s)) return "no";
  return null;
}

const { data: clients } = await supabase
  .from("clients")
  .select("id,name,status,owner_name,primary_contact_email,industry,entity_type,business_description,pain_points,vat_registered,ct_registered,bank_names,payment_gateways,accounting_software,revenue_channels,call_insights,reg_facts,am_id")
  .in("status", ["onboarding", "active", "signed"])
  .order("name");

if (!clients?.length) {
  console.log("No onboarded clients found.");
  process.exit(0);
}

const lines = [];
const push = (s) => { lines.push(s); console.log(s); };
push(`# Playbook audit — ${new Date().toISOString().slice(0, 10)}`);
push(`\nScanned **${clients.length}** onboarded clients. Mode: ${dryRun ? "DRY-RUN (no writes)" : "WRITE"}.`);
push(``);

let filledTotal = 0;
const stillBlankByField = {};
const needsAi = []; // clients that still need UI-triggered AI work

for (const c of clients) {
  const { data: intakeRow } = await supabase
    .from("intake_forms")
    .select("submitted,status,prefilled")
    .eq("client_id", c.id)
    .maybeSingle();
  const intake = (intakeRow?.submitted ?? {});
  const prefill = (intakeRow?.prefilled ?? {});

  const { data: meetings } = await supabase
    .from("client_meetings")
    .select("id,notes,summary,recording_link")
    .eq("client_id", c.id)
    .order("created_at", { ascending: false });

  const patch = {};
  const filled = [];

  // 1) Identity
  if (isBlank(c.owner_name) && (intake.owner_name || intake.contactName)) {
    patch.owner_name = String(intake.owner_name || intake.contactName).trim();
    filled.push(`owner_name ← intake`);
  }
  if (isBlank(c.primary_contact_email) && intake.primary_email) {
    patch.primary_contact_email = String(intake.primary_email).trim().toLowerCase();
    filled.push(`primary_contact_email ← intake`);
  }

  // 2) Description + pains
  if (isBlank(c.business_description)) {
    const v = intake.business_description ?? prefill.description ?? null;
    if (v && String(v).trim()) { patch.business_description = String(v).trim(); filled.push(`business_description ← intake`); }
  }
  if (isBlank(c.pain_points)) {
    const v = intake.pain_points ?? prefill.painPoints ?? null;
    if (v && String(v).trim()) { patch.pain_points = String(v).trim(); filled.push(`pain_points ← intake`); }
  }

  // 3) Arrays — banks / gateways / revenue
  if (isBlank(c.bank_names)) {
    const banks = asStrArray(intake.banks ?? prefill.banks);
    if (banks.length) { patch.bank_names = banks; filled.push(`bank_names ← intake (${banks.length})`); }
  }
  if (isBlank(c.payment_gateways)) {
    const gws = asStrArray(intake.gateways ?? prefill.gateways);
    if (gws.length) { patch.payment_gateways = gws; filled.push(`payment_gateways ← intake (${gws.length})`); }
  }
  if (isBlank(c.revenue_channels)) {
    const rv = asStrArray(intake.revenue ?? prefill.revenue);
    if (rv.length) { patch.revenue_channels = rv; filled.push(`revenue_channels ← intake (${rv.length})`); }
  }

  // 4) Accounting software
  if (isBlank(c.accounting_software)) {
    const sw = intake.acctSw ?? prefill.software ?? null;
    const swStr = Array.isArray(sw) ? sw.join(", ") : sw;
    if (swStr && String(swStr).trim()) { patch.accounting_software = String(swStr).trim(); filled.push(`accounting_software ← intake`); }
  }

  // 5) Registration flags
  if (isBlank(c.vat_registered)) {
    const y = intakeYn(intake.vat ?? prefill.vat);
    if (y) { patch.vat_registered = y; filled.push(`vat_registered ← intake (${y})`); }
  }
  if (isBlank(c.ct_registered)) {
    const y = intakeYn(intake.ct ?? prefill.ct);
    if (y) { patch.ct_registered = y; filled.push(`ct_registered ← intake (${y})`); }
  }

  // Apply patch.
  if (Object.keys(patch).length && !dryRun) {
    const { error } = await supabase.from("clients").update(patch).eq("id", c.id);
    if (error) {
      push(`\n## ${c.name}\n  ⚠️ update error: ${error.message}`);
      continue;
    }
  }
  filledTotal += filled.length;

  // What's still blank?
  const stillBlank = [];
  const merged = { ...c, ...patch };
  const FIELDS = [
    ["owner_name", "Owner name"],
    ["primary_contact_email", "Primary email"],
    ["industry", "Industry"],
    ["entity_type", "Entity type"],
    ["business_description", "Business description"],
    ["pain_points", "Pain points"],
    ["vat_registered", "VAT registered"],
    ["ct_registered", "CT registered"],
    ["bank_names", "Banks"],
    ["payment_gateways", "Payment gateways"],
    ["accounting_software", "Accounting software"],
    ["revenue_channels", "Revenue channels"],
    ["call_insights", "Call insights"],
    ["reg_facts", "Registration facts"],
  ];
  for (const [k, label] of FIELDS) {
    if (isBlank(merged[k])) {
      stillBlank.push(label);
      stillBlankByField[label] = (stillBlankByField[label] ?? 0) + 1;
    }
  }

  // Flag AI-required follow-ups.
  const hasMeetingWithNotes = (meetings ?? []).some((m) => m.notes || m.summary || m.recording_link);
  const aiTodo = [];
  if (isBlank(merged.call_insights) && hasMeetingWithNotes) aiTodo.push("Extract call insights from meeting notes");
  if (isBlank(merged.reg_facts)) aiTodo.push("Rebuild compliance calendar (Drive scan to extract reg facts)");
  if (aiTodo.length) needsAi.push({ name: c.name, id: c.id, todo: aiTodo });

  push(`\n## ${c.name}`);
  push(`  Status: ${c.status}`);
  if (filled.length) {
    push(`  **Filled**:`);
    for (const f of filled) push(`    • ${f}`);
  } else {
    push(`  Filled: nothing (already complete or no intake data)`);
  }
  if (stillBlank.length) {
    push(`  **Still blank**: ${stillBlank.join(", ")}`);
  } else {
    push(`  ✓ Complete`);
  }
  if (aiTodo.length) {
    push(`  **Needs UI follow-up**:`);
    for (const t of aiTodo) push(`    • ${t}`);
  }
}

// Summary.
push(``);
push(`---`);
push(``);
push(`## Summary`);
push(``);
push(`- Wrote **${filledTotal}** field updates across ${clients.length} clients (${dryRun ? "DRY-RUN — nothing persisted" : "persisted to DB"}).`);
push(``);
push(`### Remaining blanks across all clients`);
const sorted = Object.entries(stillBlankByField).sort((a, b) => b[1] - a[1]);
for (const [label, count] of sorted) {
  push(`  • **${label}** — blank in ${count}/${clients.length}`);
}
push(``);
push(`### Clients needing UI-triggered AI follow-up`);
push(``);
if (needsAi.length === 0) {
  push(`  (none)`);
} else {
  for (const n of needsAi) {
    push(`- **${n.name}**`);
    for (const t of n.todo) push(`  - ${t}`);
  }
}

// Persist.
await mkdir("reports", { recursive: true });
const file = `reports/playbook-audit-${new Date().toISOString().slice(0, 10)}.md`;
await writeFile(file, lines.join("\n"));
console.log(`\n→ Written to ${file}`);
