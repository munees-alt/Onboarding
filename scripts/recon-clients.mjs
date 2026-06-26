import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const { data: clients } = await supabase
  .from("clients")
  .select("id,name,status,owner_name,primary_contact_email,industry,entity_type,business_description,pain_points,vat_registered,ct_registered,bank_names,payment_gateways,accounting_software,revenue_channels,call_insights,reg_facts,am_id")
  .order("name");

const onboarded = (clients ?? []).filter((c) => ["onboarding", "active", "signed"].includes(c.status));
console.log(`Total clients: ${clients?.length ?? 0}, onboarded: ${onboarded.length}`);
console.log(`By status:`);
const byStatus = {};
for (const c of clients ?? []) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
for (const [k, v] of Object.entries(byStatus)) console.log(`  ${k}: ${v}`);

const FIELDS = [
  ["owner_name", "Owner name"],
  ["primary_contact_email", "Primary email"],
  ["industry", "Industry"],
  ["entity_type", "Entity type"],
  ["business_description", "Business description"],
  ["pain_points", "Pain points"],
  ["vat_registered", "VAT reg"],
  ["ct_registered", "CT reg"],
  ["bank_names", "Banks"],
  ["payment_gateways", "Gateways"],
  ["accounting_software", "Accounting SW"],
  ["revenue_channels", "Revenue channels"],
  ["call_insights", "Call insights"],
  ["reg_facts", "Reg facts"],
];
console.log(`\nBlank-field counts (across ${onboarded.length} onboarded):`);
for (const [k, label] of FIELDS) {
  const blank = onboarded.filter((c) => {
    const v = c[k];
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "object") return !Object.keys(v).length;
    return String(v).trim() === "";
  }).length;
  console.log(`  ${label.padEnd(24)} blank in ${String(blank).padStart(3)}/${onboarded.length}`);
}
