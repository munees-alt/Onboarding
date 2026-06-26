// Final per-client completeness report. Shows everything we now have:
// identity, contact, regulatory, services, banking, software, AM/team, and
// what's still genuinely blank (so the next pass can target it).
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: org } = await db.from("orgs").select("id,name").order("created_at").limit(1).single();

const { data: clients } = await db.from("clients")
  .select("id,name,industry,entity_type,status,owner_name,primary_contact_email,phone,trade_licence_no,vat_trn,vat_registered,ct_registered,bank_names,payment_gateways,accounting_software,services,revenue_channels,revenue_bracket,business_description,pain_points,call_link,call_notes,call_insights,reg_facts,facts,am_id,target_go_live,contract_start_date,group_id")
  .eq("org_id", org.id).order("name");

const { data: runs } = await db.from("onboarding_runs")
  .select("id,client_id,template_key,status,current_stage,progress,am_id").eq("org_id", org.id);
const { data: rt } = await db.from("run_team").select("run_id,team_member_id,role_in_run");
const { data: tm } = await db.from("team_members").select("id,full_name");
const tmById = new Map(tm.map((x) => [x.id, x.full_name]));

const runsByClient = new Map();
for (const r of runs) {
  if (!runsByClient.has(r.client_id)) runsByClient.set(r.client_id, []);
  runsByClient.get(r.client_id).push(r);
}
const teamByRun = new Map();
for (const t of rt) {
  if (!teamByRun.has(t.run_id)) teamByRun.set(t.run_id, []);
  teamByRun.get(t.run_id).push({ name: tmById.get(t.team_member_id) ?? "?", role: t.role_in_run });
}

const isBlank = (v) => {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return !Object.keys(v).length;
  return String(v).trim() === "";
};

for (const c of clients) {
  const rs = runsByClient.get(c.id) ?? [];
  const am = tmById.get(c.am_id) ?? "(none)";
  const reg = c.reg_facts ?? {};
  console.log(`\n━━━ ${c.name} ━━━`);
  console.log(`  Status: ${c.status} | Industry: ${c.industry ?? "-"} | Entity: ${c.entity_type ?? "-"} | Group: ${c.group_id ? "yes" : "no"}`);
  console.log(`  AM: ${am}  |  Owner: ${c.owner_name ?? "-"}  |  Email: ${c.primary_contact_email ?? "-"}  |  Phone: ${c.phone ?? "-"}`);
  console.log(`  Trade Licence: ${c.trade_licence_no ?? "-"}  |  Expiry: ${reg.licence_expiry ?? "-"}  |  Incorporated: ${reg.incorporation_date ?? "-"}`);
  console.log(`  Free zone / Jurisdiction: ${reg.free_zone ?? "-"} / ${reg.jurisdiction ?? reg.emirate ?? "-"}`);
  console.log(`  VAT: TRN ${c.vat_trn ?? reg.vat_trn ?? "-"} | reg=${c.vat_registered ?? "-"} | effective ${reg.vat_effective_date ?? "-"}`);
  console.log(`  CT:  TRN ${reg.ct_trn ?? "-"} | reg=${c.ct_registered ?? "-"} | effective ${reg.ct_effective_date ?? "-"}`);
  console.log(`  Banks: [${(c.bank_names ?? []).join(", ")}]`);
  console.log(`  Gateways: [${(c.payment_gateways ?? []).join(", ")}]`);
  console.log(`  Accounting SW: ${c.accounting_software ?? "-"}  |  Revenue: ${c.revenue_bracket ?? "-"}`);
  console.log(`  Services: [${(c.services ?? []).join(", ")}]`);
  console.log(`  Revenue channels: [${(c.revenue_channels ?? []).join(", ")}]`);
  console.log(`  Pain points: ${c.pain_points?.length ?? 0}  |  Description: ${c.business_description ? c.business_description.slice(0, 70) + "..." : "-"}`);
  console.log(`  Fathom: ${c.call_link ? "yes" : "no"}  |  Notes: ${c.call_notes?.length ?? 0} chars  |  Insights sections: ${c.call_insights?.sections?.length ?? 0}`);

  if (rs.length) {
    console.log(`  Runs:`);
    for (const r of rs) {
      const team = (teamByRun.get(r.id) ?? []).map((t) => `${t.name}/${t.role}`).join(", ");
      console.log(`    • ${r.template_key} [${r.status} s${r.current_stage ?? "-"} ${r.progress ?? 0}%]  am=${tmById.get(r.am_id) ?? "-"}  team=[${team}]`);
    }
  } else {
    console.log(`  Runs: (none)`);
  }

  // What's still missing
  const miss = [];
  if (isBlank(c.industry)) miss.push("industry");
  if (isBlank(c.entity_type)) miss.push("entity_type");
  if (isBlank(c.owner_name)) miss.push("owner_name");
  if (isBlank(c.primary_contact_email)) miss.push("primary_contact_email");
  if (isBlank(c.phone)) miss.push("phone");
  if (isBlank(c.trade_licence_no)) miss.push("trade_licence_no");
  if (isBlank(c.vat_trn) && isBlank(reg.vat_trn)) miss.push("vat_trn");
  if (isBlank(c.bank_names)) miss.push("bank_names");
  if (isBlank(c.payment_gateways)) miss.push("payment_gateways");
  if (isBlank(c.accounting_software)) miss.push("accounting_software");
  if (isBlank(c.services)) miss.push("services");
  if (isBlank(c.revenue_channels)) miss.push("revenue_channels");
  if (isBlank(c.business_description)) miss.push("business_description");
  if (isBlank(c.pain_points)) miss.push("pain_points");
  if (isBlank(c.call_notes)) miss.push("call_notes");
  console.log(`  STILL BLANK (${miss.length}): ${miss.join(", ") || "—"}`);
}

// Summary
console.log(`\n\n═══ ORG SUMMARY (${clients.length} clients) ═══`);
const counts = {
  industry: clients.filter(c => c.industry).length,
  entity_type: clients.filter(c => c.entity_type).length,
  owner_name: clients.filter(c => c.owner_name).length,
  trade_licence_no: clients.filter(c => c.trade_licence_no).length,
  vat_trn: clients.filter(c => c.vat_trn || c.reg_facts?.vat_trn).length,
  banks: clients.filter(c => c.bank_names?.length).length,
  gateways: clients.filter(c => c.payment_gateways?.length).length,
  accounting_sw: clients.filter(c => c.accounting_software).length,
  services: clients.filter(c => c.services?.length).length,
  description: clients.filter(c => c.business_description).length,
  call_notes: clients.filter(c => c.call_notes?.length).length,
  call_insights: clients.filter(c => c.call_insights?.sections?.length).length,
  reg_facts: clients.filter(c => c.reg_facts && Object.keys(c.reg_facts).length).length,
  has_run: clients.filter(c => runsByClient.get(c.id)?.length).length,
  has_am: clients.filter(c => c.am_id).length,
};
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(22)} ${v}/${clients.length}`);
}
